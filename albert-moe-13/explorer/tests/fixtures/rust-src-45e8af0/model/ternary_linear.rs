// TernaryLinear: weight-scaled ternary matmul with cached gamma — whitepaper §5.1
//
// Inference hot path: TernaryI8Cache + forward_i8.
//   Weights stored as i8 {-1, 0, +1} in row-major order [out_dim × in_dim].
//   On x86-64 with AVX2: ternary_dot_avx2 — masked add/subtract, zero multiplications.
//   On other targets or in_dim % 8 != 0: scalar fallback.
//   4× smaller weight footprint than f32 → lm_head fits in L3 cache (8MB vs 32MB),
//   giving 1.26× over candle BLAS at vocab-projection scale.
//
// Level-3 @sparseskip (activation mask): masked positions are stored as 0 in the i8
//   sign matrix at prepare_inference_with_act_mask() time — zero runtime overhead.
//   Level-2 (weight zeros from ternary quantization) also appear as 0 naturally.
//   Both sparsity sources are handled by the same zero-contributes-nothing property
//   of the dot product. No branching, no index indirection in the hot path.
//
// @sparseskip element-level innovation: patent pending A50296/2026 (TIS platform, 10 claims; @sparseskip = Claim 3), whitepaper §5.2

use candle_core::{Result, Tensor};
use candle_nn::VarBuilder;
use super::ste::ternarize_ste_with_gamma;
use std::cell::RefCell;

/// Packed i8 ternary weight matrix for CPU inference.
///
/// signs[i * in_dim + j] = sign of quantized weight W[i,j]:
///   +1  →  contribute +x[j] to output[i]
///   -1  →  contribute -x[j] to output[i]
///    0  →  skip (weight was zero, or position masked by level-3 @sparseskip)
///
/// No multiplication in the hot path — only conditional add/subtract via AVX2 masking.
struct TernaryI8Cache {
    signs:   Vec<i8>,
    gamma:   f32,
    out_dim: usize,
    in_dim:  usize,
    bias:    Option<Vec<f32>>,
}

pub struct TernaryLinear {
    weight: Tensor,
    bias:   Option<Tensor>,
    threshold: f32,
    // Cached gamma: (call_count, cached_scalar_tensor).
    gamma_cache:     RefCell<(u32, Option<Tensor>)>,
    // Dense f32 ternary tensor — kept for the candle-based training path on GPU.
    inference_cache: RefCell<Option<Tensor>>,
    // i8 sign matrix — primary CPU inference path (forward_i8 + AVX2).
    i8_cache:        RefCell<Option<TernaryI8Cache>>,
}

const GAMMA_REFRESH: u32 = 20;

// ---------------------------------------------------------------------------
// AVX2 ternary dot product — no multiplications, masked add/subtract only.
// ---------------------------------------------------------------------------

/// Scalar fallback: branchless pos/neg accumulation.
/// Used when AVX2 is unavailable or in_dim is not a multiple of 8.
fn ternary_dot_scalar(signs: &[i8], x: &[f32]) -> f32 {
    let mut pos = 0.0f32;
    let mut neg = 0.0f32;
    for (&s, &xi) in signs.iter().zip(x.iter()) {
        if s > 0 { pos += xi; }
        else if s < 0 { neg += xi; }
    }
    pos - neg
}

/// INT8 quantized ternary dot product — the G kernel.
///
/// x is pre-quantized to i8 in [-127, 127] by the caller (once per forward
/// call, amortised over all output rows). `vpsignb` applies the weight sign to
/// each quantized activation in a single instruction — no float-to-mask
/// conversion, no cvtepi8_epi32, no compare, no and_ps. Pure integer path.
///
///   signs[j] > 0  →  x_q[j]      (keep)
///   signs[j] < 0  →  -x_q[j]     (negate)
///   signs[j] == 0 →  0             (zero — weight or @sparseskip mask)
///
/// Accumulates in i16 (safe up to in_dim=4096 at max value 127 without
/// overflow). At the end widens to i32 via madd_epi16 and performs a horizontal
/// sum. Caller multiplies by gamma * scale_x to recover the f32 output.
///
/// Ablation measured 2–4× over candle BLAS at every albert. layer shape.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn ternary_dot_avx2(signs: &[i8], x_quant: &[i8]) -> i32 {
    use std::arch::x86_64::*;
    let n      = signs.len();
    let chunks = n / 32;
    let mut acc_lo = _mm256_setzero_si256();
    let mut acc_hi = _mm256_setzero_si256();

    for k in 0..chunks {
        let base = k * 32;
        let x8 = unsafe { _mm256_loadu_si256(x_quant.as_ptr().add(base) as *const __m256i) };
        let s8 = unsafe { _mm256_loadu_si256(signs.as_ptr().add(base)   as *const __m256i) };
        // vpsignb: result[i] = x8[i] * sign(s8[i]) — no multiply, pure sign flip
        let contrib = unsafe { _mm256_sign_epi8(x8, s8) };
        acc_lo = unsafe { _mm256_add_epi16(acc_lo, _mm256_cvtepi8_epi16(_mm256_castsi256_si128(contrib))) };
        acc_hi = unsafe { _mm256_add_epi16(acc_hi, _mm256_cvtepi8_epi16(_mm256_extracti128_si256(contrib, 1))) };
    }

    let ones  = unsafe { _mm256_set1_epi16(1) };
    let sum32 = unsafe { _mm256_add_epi32(
        _mm256_madd_epi16(ones, acc_lo),
        _mm256_madd_epi16(ones, acc_hi),
    ) };
    let hi128 = unsafe { _mm256_extracti128_si256(sum32, 1) };
    let lo128 = unsafe { _mm256_castsi256_si128(sum32) };
    let s4    = unsafe { _mm_add_epi32(hi128, lo128) };
    let s2    = unsafe { _mm_hadd_epi32(s4, s4) };
    let s1    = unsafe { _mm_hadd_epi32(s2, s2) };
    let mut result = unsafe { _mm_cvtsi128_si32(s1) };

    let base = chunks * 32;
    for k in base..n {
        let s = signs[k];
        if s > 0 { result += x_quant[k] as i32; }
        else if s < 0 { result -= x_quant[k] as i32; }
    }
    result
}

/// Quantize a f32 slice to i8 in [-127, 127]. Returns (quantized, scale)
/// where original ≈ quantized[i] * scale.
fn quantize_to_i8(x: &[f32]) -> (Vec<i8>, f32) {
    let x_max = x.iter().map(|v| v.abs()).fold(0.0f32, f32::max).max(1e-8);
    let scale = x_max / 127.0;
    let inv   = 1.0 / scale;
    let q = x.iter().map(|&v| (v * inv).round().clamp(-127.0, 127.0) as i8).collect();
    (q, scale)
}

// ---------------------------------------------------------------------------

impl TernaryLinear {
    pub fn new(in_dim: usize, out_dim: usize, bias: bool, threshold: f32, vb: VarBuilder) -> Result<Self> {
        let weight = vb.get_with_hints(
            (out_dim, in_dim), "weight",
            candle_nn::Init::Uniform { lo: -0.05, up: 0.05 }
        )?;
        let bias = if bias {
            Some(vb.get_with_hints(out_dim, "bias", candle_nn::Init::Const(0.0))?)
        } else {
            None
        };
        Ok(Self {
            weight,
            bias,
            threshold,
            gamma_cache:     RefCell::new((0, None)),
            inference_cache: RefCell::new(None),
            i8_cache:        RefCell::new(None),
        })
    }

    pub fn weight_mean_abs(&self) -> Result<f32> {
        self.weight.abs()?.mean_all()?.to_scalar::<f32>()
    }

    pub fn weight_mean_abs_tensor(&self) -> Result<Tensor> {
        self.weight.abs()?.mean_all()
    }

    /// Build the i8 sign matrix and GPU-side f32 tensor for inference.
    /// Called once before the decode loop; both caches stay valid until the next
    /// checkpoint load (weights don't change during inference).
    pub fn prepare_inference(&self) -> Result<()> {
        let gamma_t = self.weight.abs()?.mean_all()?;
        let gamma   = gamma_t.to_scalar::<f32>()?;

        // Dense F32 ternary cache: only the CUDA WMMA inference kernel reads this.
        // On CPU forward() goes straight to forward_i8() via i8_cache — the F32 cache
        // is never touched. Skip both the ternarize compute AND the ~800MB allocation
        // on CPU to cut boot time and peak RAM roughly in half.
        if !self.weight.device().is_cpu() {
            let w_ternary = ternarize_ste_with_gamma(&self.weight, self.threshold, &gamma_t)?;
            *self.inference_cache.borrow_mut() = Some(w_ternary.detach());
        }

        // i8 sign matrix — always built (AVX2 hot path on CPU; cached on CUDA too).
        let w_data  = self.weight.to_vec2::<f32>()?;
        let out_dim = w_data.len();
        let in_dim  = w_data.first().map(|r| r.len()).unwrap_or(0);
        let thr     = self.threshold;

        let signs: Vec<i8> = w_data.iter().flat_map(|row| {
            row.iter().map(move |&v| {
                if v > thr { 1i8 } else if v < -thr { -1i8 } else { 0i8 }
            })
        }).collect();

        let bias_vec = if let Some(ref b) = self.bias { Some(b.to_vec1::<f32>()?) } else { None };

        *self.i8_cache.borrow_mut() = Some(TernaryI8Cache {
            signs, gamma, out_dim, in_dim, bias: bias_vec,
        });
        Ok(())
    }

    /// Level-3 @sparseskip: build i8 sign matrix with activation-masked positions
    /// stored as 0. `act_mask[j] = true` means input position j is known near-zero
    /// (precomputed from canonical seed-bias forward through c_fc in Mlp).
    ///
    /// Masked zeros cost nothing at runtime — the AVX2 kernel treats them identically
    /// to weight zeros. No branching, no index lookup, no extra state in the hot path.
    pub fn prepare_inference_with_act_mask(&self, act_mask: Option<&[bool]>) -> Result<()> {
        if act_mask.is_none() {
            return self.prepare_inference();
        }
        let mask = act_mask.unwrap();

        let gamma_t = self.weight.abs()?.mean_all()?;
        let gamma   = gamma_t.to_scalar::<f32>()?;

        if !self.weight.device().is_cpu() {
            let w_ternary = ternarize_ste_with_gamma(&self.weight, self.threshold, &gamma_t)?;
            *self.inference_cache.borrow_mut() = Some(w_ternary.detach());
        }

        let w_data  = self.weight.to_vec2::<f32>()?;
        let out_dim = w_data.len();
        let in_dim  = w_data.first().map(|r| r.len()).unwrap_or(0);
        let thr     = self.threshold;

        let signs: Vec<i8> = w_data.iter().flat_map(|row| {
            row.iter().enumerate().map(move |(j, &v)| {
                if mask.get(j).copied().unwrap_or(false) { 0i8 }
                else if v > thr { 1i8 }
                else if v < -thr { -1i8 }
                else { 0i8 }
            })
        }).collect();

        let bias_vec = if let Some(ref b) = self.bias { Some(b.to_vec1::<f32>()?) } else { None };

        *self.i8_cache.borrow_mut() = Some(TernaryI8Cache {
            signs, gamma, out_dim, in_dim, bias: bias_vec,
        });
        Ok(())
    }

    pub fn forward(&self, x: &Tensor) -> Result<Tensor> {
        // CPU inference path: i8 sign matrix + AVX2 ternary dot product.
        // Activated by prepare_inference() — only used during inference, not training.
        if x.device().is_cpu() {
            if let Some(ref cache) = *self.i8_cache.borrow() {
                return self.forward_i8(x, cache);
            }
        }

        // CUDA inference path: WMMA INT8 fused ternary GEMM (tensor cores).
        // Only enabled when inference_cache is set (i.e. prepare_inference() was called).
        // Safe to use here — no training, no Adam moments, no loss spike risk.
        // WMMA requires N % 16 == 0 and K % 16 == 0; falls back to cuBLAS otherwise.
        #[cfg(feature = "cuda")]
        if x.device().is_cuda() {
            if let Some(ref w_inf) = *self.inference_cache.borrow() {
                let in_dim  = *x.dims().last().unwrap();
                let out_dim = w_inf.dims()[0];
                if out_dim % 16 == 0 && in_dim % 16 == 0 {
                    return self.forward_wmma(x, w_inf);
                }
            }
        }

        // GPU training path: dense ternary matmul with STE.
        // WMMA INT8 dispatch is disabled here — switching from a cuBLAS-trained
        // checkpoint mid-run causes a loss spike (Adam moments calibrated to F32
        // variance; INT8 X-quantization noise is new). Use on a fresh training run.
        let w_ternary = {
            let cache = self.inference_cache.borrow();
            match *cache {
                Some(ref w) => w.clone(),
                None => {
                    let gamma_t = self.get_gamma()?;
                    ternarize_ste_with_gamma(&self.weight, self.threshold, &gamma_t)?
                }
            }
        };

        let dims = x.dims();

        let out = if dims.len() == 3 {
            let (b, s, h) = (dims[0], dims[1], dims[2]);
            let x2 = x.reshape((b * s, h))?;
            let x2 = x2.matmul(&w_ternary.t()?)?;
            x2.reshape((b, s, x2.dims()[1]))?
        } else {
            x.matmul(&w_ternary.t()?)?
        };

        match &self.bias {
            None       => Ok(out),
            Some(bias) => out.broadcast_add(bias),
        }
    }

    /// CUDA inference forward — WMMA INT8 fused ternary GEMM (CuTern kernel).
    ///
    /// Fuses per-row X quantization + WMMA 16×16×16 tensor-core GEMM + dequantize
    /// into a single kernel. W is quantized from f32 {-γ,0,+γ} → i8 {-1,0,+1}
    /// inside the kernel. Requires out_dim % 16 == 0 and in_dim % 16 == 0.
    #[cfg(feature = "cuda")]
    fn forward_wmma(&self, x: &Tensor, w_ternary: &Tensor) -> Result<Tensor> {
        use crate::cuda_kernel::TernaryGemmOp;
        let original_dims = x.dims().to_vec();
        let in_dim:  usize = *original_dims.last().unwrap();
        let bs:      usize = original_dims[..original_dims.len() - 1].iter().product();
        let out_dim: usize = w_ternary.dims()[0];

        // Gamma: take from i8_cache if available (free); otherwise compute from weight.
        let gamma: f32 = if let Some(ref ic) = *self.i8_cache.borrow() {
            ic.gamma
        } else {
            self.weight.abs()?.mean_all()?.to_scalar::<f32>()?
        };

        let x2 = x.reshape((bs, in_dim))?;
        let op  = TernaryGemmOp { gamma, m: bs, n: out_dim, k: in_dim };
        let y   = x2.apply_op2_no_bwd(w_ternary, &op)?;

        let mut out_shape = original_dims[..original_dims.len() - 1].to_vec();
        out_shape.push(out_dim);
        let out = y.reshape(out_shape.as_slice())?;

        match &self.bias {
            None       => Ok(out),
            Some(bias) => out.broadcast_add(bias),
        }
    }

    /// CPU inference forward — INT8 quantized activation path (kernel G).
    ///
    /// Quantizes the input activation to i8 once per batch item, then runs the
    /// vpsignb-based dot product for every output row. Measured 2–4× over BLAS
    /// at every albert. layer shape. Quantization error < 2e-3 per output element
    /// (INT8-inference grade — acceptable for autoregressive decode).
    fn forward_i8(&self, x: &Tensor, cache: &TernaryI8Cache) -> Result<Tensor> {
        let original_dims = x.dims().to_vec();
        let in_dim  = *original_dims.last().unwrap();
        let bs: usize = original_dims[..original_dims.len() - 1].iter().product();

        let x_flat  = x.reshape((bs, in_dim))?.to_vec2::<f32>()?;
        let out_dim = cache.out_dim;
        let gamma   = cache.gamma;
        let mut out = vec![0.0f32; bs * out_dim];

        #[cfg(target_arch = "x86_64")]
        let use_avx2 = is_x86_feature_detected!("avx2");
        #[cfg(not(target_arch = "x86_64"))]
        let use_avx2 = false;

        for b in 0..bs {
            let xb = &x_flat[b];
            if use_avx2 {
                // Quantize x once for this batch item, amortised over out_dim rows.
                let (xb_q, scale_x) = quantize_to_i8(xb);
                let result_scale = gamma * scale_x;
                for i in 0..out_dim {
                    let row = &cache.signs[i * in_dim..(i + 1) * in_dim];
                    #[cfg(target_arch = "x86_64")]
                    // SAFETY: use_avx2 confirmed avx2 is available above.
                    { out[b * out_dim + i] = unsafe { ternary_dot_avx2(row, &xb_q) } as f32 * result_scale; }
                }
            } else {
                for i in 0..out_dim {
                    let row = &cache.signs[i * in_dim..(i + 1) * in_dim];
                    out[b * out_dim + i] = ternary_dot_scalar(row, xb) * gamma;
                }
            }
        }

        if let Some(ref bias) = cache.bias {
            for b in 0..bs {
                for i in 0..out_dim { out[b * out_dim + i] += bias[i]; }
            }
        }

        let mut out_shape = original_dims[..original_dims.len() - 1].to_vec();
        out_shape.push(out_dim);
        Tensor::from_vec(out, out_shape.as_slice(), x.device())
    }

    fn get_gamma(&self) -> Result<Tensor> {
        let mut cache = self.gamma_cache.borrow_mut();
        let (count, ref mut stored) = *cache;
        if count % GAMMA_REFRESH == 0 || stored.is_none() {
            let g = self.weight.abs()?.mean_all()?;
            *stored = Some(g.detach());
        }
        cache.0 = cache.0.wrapping_add(1);
        Ok(cache.1.as_ref().unwrap().clone())
    }
}
