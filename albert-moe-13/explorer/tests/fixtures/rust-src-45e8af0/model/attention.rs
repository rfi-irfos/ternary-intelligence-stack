use candle_core::{DType, Result, Tensor, D};
use candle_nn::VarBuilder;
use super::ternary_linear::TernaryLinear;
use std::cell::RefCell;

/// Rotary Position Embedding (RoPE). Applies position-dependent rotation to Q or K.
/// x: [batch, heads, seq, head_dim]. start_pos: absolute position of x[:,;,0,:].
/// Uses rotate_half convention: matches LLaMA/HuggingFace implementation.
fn apply_rope(x: &Tensor, start_pos: usize) -> Result<Tensor> {
    let (_b, _h, s, d) = x.dims4()?;
    let half_d = d / 2;
    let dev = x.device();
    let dtype = x.dtype();

    let freqs: Vec<f32> = (0..half_d)
        .map(|i| 1.0_f32 / 10000_f32.powf(2.0 * i as f32 / d as f32))
        .collect();
    let freqs = Tensor::from_slice(&freqs, half_d, dev)?.to_dtype(dtype)?;

    let positions: Vec<f32> = (start_pos..start_pos + s).map(|p| p as f32).collect();
    let positions = Tensor::from_slice(&positions, s, dev)?.to_dtype(dtype)?;

    // angles[s, half_d] = pos[:, None] * freq[None, :]
    let angles = positions.unsqueeze(1)?.broadcast_mul(&freqs.unsqueeze(0)?)?;
    let cos = Tensor::cat(&[&angles.cos()?, &angles.cos()?], 1)?.unsqueeze(0)?.unsqueeze(0)?;
    let sin = Tensor::cat(&[&angles.sin()?, &angles.sin()?], 1)?.unsqueeze(0)?.unsqueeze(0)?;

    // rotate_half: cat([-x2, x1])
    let x1 = x.narrow(D::Minus1, 0, half_d)?;
    let x2 = x.narrow(D::Minus1, half_d, half_d)?;
    let x_rot = Tensor::cat(&[&x2.neg()?, &x1], D::Minus1)?;

    x.broadcast_mul(&cos)?.broadcast_add(&x_rot.broadcast_mul(&sin)?)
}

pub struct Attention {
    q_proj: TernaryLinear,
    k_proj: TernaryLinear,
    v_proj: TernaryLinear,
    o_proj: TernaryLinear,
    num_heads: usize,
    head_dim: usize,
    // Cached causal mask: (seq_len, Tensor). Rebuilt only when seq_len changes.
    mask_cache: RefCell<Option<(usize, Tensor)>>,
    // KV-cache for autoregressive decode: (k, v) shaped [1, heads, seq, head_dim].
    // Populated by forward_and_cache() (prefill); grown by forward_decode() each step.
    kv_cache: RefCell<Option<(Tensor, Tensor)>>,
}

impl Attention {
    pub fn new(hidden_size: usize, num_heads: usize, vb: VarBuilder, threshold: f32) -> Result<Self> {
        let head_dim = hidden_size / num_heads;
        let q_proj = TernaryLinear::new(hidden_size, hidden_size, false, threshold, vb.pp("q_proj"))?;
        let k_proj = TernaryLinear::new(hidden_size, hidden_size, false, threshold, vb.pp("k_proj"))?;
        let v_proj = TernaryLinear::new(hidden_size, hidden_size, false, threshold, vb.pp("v_proj"))?;
        let o_proj = TernaryLinear::new(hidden_size, hidden_size, false, threshold, vb.pp("o_proj"))?;
        Ok(Self {
            q_proj, k_proj, v_proj, o_proj,
            num_heads, head_dim,
            mask_cache: RefCell::new(None),
            kv_cache: RefCell::new(None),
        })
    }

    pub fn prepare_inference(&self) -> Result<()> {
        self.q_proj.prepare_inference()?;
        self.k_proj.prepare_inference()?;
        self.v_proj.prepare_inference()?;
        self.o_proj.prepare_inference()
    }

    pub fn clear_kv_cache(&self) {
        *self.kv_cache.borrow_mut() = None;
    }

    // Training / full-sequence forward (no KV-cache side effects).
    pub fn forward(&self, x: &Tensor) -> Result<Tensor> {
        let (b_sz, seq_len, h_sz) = x.dims3()?;

        let q = self.q_proj.forward(x)?;
        let k = self.k_proj.forward(x)?;
        let v = self.v_proj.forward(x)?;

        let q = q.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;
        let k = k.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;
        let v = v.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;

        let q = apply_rope(&q, 0)?;
        let k = apply_rope(&k, 0)?;

        let mask = self.get_mask(seq_len, x.device())?;

        #[cfg(feature = "cuda")]
        if x.device().is_cuda() {
            let scale = (self.head_dim as f64).sqrt();
            let q16 = q.to_dtype(DType::F16)?;
            let k16 = k.to_dtype(DType::F16)?;
            let v16 = v.to_dtype(DType::F16)?;
            let mask16 = mask.to_dtype(DType::F16)?;
            let mut attn = (q16.matmul(&k16.transpose(2, 3)?.contiguous()?)? / scale)?;
            attn = attn.broadcast_add(&mask16)?;
            let attn = candle_nn::ops::softmax(&attn, D::Minus1)?;
            let out = attn.matmul(&v16)?.to_dtype(DType::F32)?
                .transpose(1, 2)?.contiguous()?.reshape((b_sz, seq_len, h_sz))?;
            return self.o_proj.forward(&out);
        }

        let mut attn_weights = (q.matmul(&k.transpose(2, 3)?.contiguous()?)? / (self.head_dim as f64).sqrt())?;
        attn_weights = attn_weights.broadcast_add(&mask)?;
        let attn_weights = candle_nn::ops::softmax(&attn_weights, D::Minus1)?;

        let attn_output = attn_weights.matmul(&v)?;
        let attn_output = attn_output.transpose(1, 2)?.contiguous()?.reshape((b_sz, seq_len, h_sz))?;
        self.o_proj.forward(&attn_output)
    }

    // Prefill: full prompt, populates KV-cache for subsequent decode steps.
    pub fn forward_and_cache(&self, x: &Tensor) -> Result<Tensor> {
        let (b_sz, seq_len, h_sz) = x.dims3()?;

        let q = self.q_proj.forward(x)?;
        let k = self.k_proj.forward(x)?;
        let v = self.v_proj.forward(x)?;

        let q = q.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;
        let k = k.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;
        let v = v.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;

        let q = apply_rope(&q, 0)?;
        let k = apply_rope(&k, 0)?;

        *self.kv_cache.borrow_mut() = Some((k.clone(), v.clone()));

        let mask = self.get_mask(seq_len, x.device())?;

        #[cfg(feature = "cuda")]
        if x.device().is_cuda() {
            let scale = (self.head_dim as f64).sqrt();
            let q16 = q.to_dtype(DType::F16)?;
            let k16 = k.to_dtype(DType::F16)?;
            let v16 = v.to_dtype(DType::F16)?;
            let mask16 = mask.to_dtype(DType::F16)?;
            let mut attn = (q16.matmul(&k16.transpose(2, 3)?.contiguous()?)? / scale)?;
            attn = attn.broadcast_add(&mask16)?;
            let attn = candle_nn::ops::softmax(&attn, D::Minus1)?;
            let out = attn.matmul(&v16)?.to_dtype(DType::F32)?
                .transpose(1, 2)?.contiguous()?.reshape((b_sz, seq_len, h_sz))?;
            return self.o_proj.forward(&out);
        }

        let mut attn_weights = (q.matmul(&k.transpose(2, 3)?.contiguous()?)? / (self.head_dim as f64).sqrt())?;
        attn_weights = attn_weights.broadcast_add(&mask)?;
        let attn_weights = candle_nn::ops::softmax(&attn_weights, D::Minus1)?;

        let attn_output = attn_weights.matmul(&v)?;
        let attn_output = attn_output.transpose(1, 2)?.contiguous()?.reshape((b_sz, seq_len, h_sz))?;
        self.o_proj.forward(&attn_output)
    }

    // Decode: single new token. Only computes Q for the new token; K/V come from cache + new.
    // No causal mask needed — single Q token attends over all cached (past) positions.
    pub fn forward_decode(&self, x: &Tensor) -> Result<Tensor> {
        let (b_sz, seq_len, h_sz) = x.dims3()?;

        let q     = self.q_proj.forward(x)?;
        let k_new = self.k_proj.forward(x)?;
        let v_new = self.v_proj.forward(x)?;

        let q     = q    .reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;
        let k_new = k_new.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;
        let v_new = v_new.reshape((b_sz, seq_len, self.num_heads, self.head_dim))?.transpose(1, 2)?.contiguous()?;

        // Position = length of existing KV cache (absolute index of this new token).
        let start_pos = {
            let cache = self.kv_cache.borrow();
            match *cache { Some((ref k_c, _)) => k_c.dim(2)?, None => 0 }
        };
        let q     = apply_rope(&q,     start_pos)?;
        let k_new = apply_rope(&k_new, start_pos)?;

        let (k, v) = {
            let cache = self.kv_cache.borrow();
            match *cache {
                Some((ref k_c, ref v_c)) => (
                    Tensor::cat(&[k_c, &k_new], 2)?,
                    Tensor::cat(&[v_c, &v_new], 2)?,
                ),
                None => (k_new.clone(), v_new.clone()),
            }
        };
        *self.kv_cache.borrow_mut() = Some((k.clone(), v.clone()));

        let scale = (self.head_dim as f64).sqrt();

        #[cfg(feature = "cuda")]
        if x.device().is_cuda() {
            let q16 = q.to_dtype(DType::F16)?;
            let k16 = k.to_dtype(DType::F16)?;
            let v16 = v.to_dtype(DType::F16)?;
            let attn = candle_nn::ops::softmax(
                &(q16.matmul(&k16.transpose(2, 3)?.contiguous()?)? / scale)?,
                D::Minus1,
            )?;
            let out = attn.matmul(&v16)?.to_dtype(DType::F32)?
                .transpose(1, 2)?.contiguous()?.reshape((b_sz, seq_len, h_sz))?;
            return self.o_proj.forward(&out);
        }

        let attn_weights = candle_nn::ops::softmax(
            &(q.matmul(&k.transpose(2, 3)?.contiguous()?)? / scale)?,
            D::Minus1,
        )?;

        let attn_output = attn_weights.matmul(&v)?;
        let attn_output = attn_output.transpose(1, 2)?.contiguous()?.reshape((b_sz, seq_len, h_sz))?;
        self.o_proj.forward(&attn_output)
    }

    fn get_mask(&self, seq_len: usize, device: &candle_core::Device) -> Result<Tensor> {
        let mut cache = self.mask_cache.borrow_mut();
        if let Some((cached_len, ref mask)) = *cache {
            if cached_len == seq_len { return Ok(mask.clone()); }
        }
        let mask_data: Vec<f32> = (0..seq_len)
            .flat_map(|i| (0..seq_len).map(move |j| if j > i { f32::NEG_INFINITY } else { 0f32 }))
            .collect();
        let mask = Tensor::from_slice(&mask_data, (seq_len, seq_len), device)?
            .unsqueeze(0)?.unsqueeze(0)?;
        *cache = Some((seq_len, mask.clone()));
        Ok(mask)
    }
}
