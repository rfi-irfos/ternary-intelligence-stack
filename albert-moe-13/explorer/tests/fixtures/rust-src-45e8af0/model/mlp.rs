use candle_core::{Device, Result, Tensor};
use candle_nn::VarBuilder;
use super::ternary_linear::TernaryLinear;

/// Threshold for level-3 @sparseskip activation mask.
/// Post-GeLU neurons with |output| below this value are excluded from c_proj
/// sparse indices at prepare_inference() time.
///
/// Value 0.001 = deep-saturation only. Quality probe (expert_activation_probe §4)
/// on albert_v3.0 shows: mean max |delta| = 0.022 (< ternary noise floor ~0.03),
/// top-1 agreement = 100%, zero signed bias across 5400 evaluations.
/// ~29.6% of INNER neurons fall below this, all seed-determined (tok_var < 0.5%).
///
/// 0.05 masks ~39.6% and improves c_proj skip rate further but introduces mean
/// delta = 0.71 (> noise floor) and 0.6% top-1 loss — too aggressive for albert_v3.0.
/// Raising this threshold requires re-verification against a fresh checkpoint.
const ACT_SKIP_THRESHOLD: f32 = 0.001;

pub struct Mlp {
    c_fc: TernaryLinear,
    c_proj: TernaryLinear,
}

impl Mlp {
    pub fn new(hidden_size: usize, intermediate_size: usize, vb: VarBuilder, threshold: f32) -> Result<Self> {
        let c_fc = TernaryLinear::new(hidden_size, intermediate_size, true, threshold, vb.pp("c_fc"))?;
        let c_proj = TernaryLinear::new(intermediate_size, hidden_size, true, threshold, vb.pp("c_proj"))?;
        Ok(Self { c_fc, c_proj })
    }

    /// Standard prepare_inference — no activation mask. c_proj uses weight-only sparseskip.
    pub fn prepare_inference(&self) -> Result<()> {
        self.c_fc.prepare_inference()?;
        self.c_proj.prepare_inference()
    }

    /// Level-3 @sparseskip: build c_proj sparse indices that additionally exclude
    /// input positions where the canonical post-GeLU activation is near-zero.
    ///
    /// `seed` is the per-expert seed_bias vector (shape [hidden_size]). It dominates
    /// the layer-norm output (seed std≈0.7 >> LN output std≈0.003), so the canonical
    /// forward pass through c_fc(seed) reliably identifies which INNER neurons are
    /// near-zero regardless of the input token.
    ///
    /// Quality note (verified on albert_v3.0, expert_activation_probe §4):
    /// with ACT_SKIP_THRESHOLD=0.001, mean max |delta| on c_proj output = 0.022
    /// (< ternary noise floor ~0.03), top-1 agreement = 100% across 5400 evals.
    /// ~29.6% of INNER positions are masked, c_proj skip rate rises from 31% to ~51%.
    pub fn prepare_inference_with_seed(&self, seed: &[f32]) -> Result<()> {
        // Step 1: build c_fc sparse cache (weight-only, no mask needed for c_fc).
        self.c_fc.prepare_inference()?;

        // Step 2: compute canonical forward through c_fc on the seed input.
        let seed_t = Tensor::from_slice(seed, (1, seed.len()), &Device::Cpu)?;
        let pre_act = self.c_fc.forward(&seed_t)?;  // [1, INNER]
        let post_gelu = pre_act.gelu()?;             // [1, INNER]
        let gelu_vec = post_gelu.flatten_all()?.to_vec1::<f32>()?;

        // Step 3: build activation mask — true = near-zero, exclude from c_proj indices.
        let act_mask: Vec<bool> = gelu_vec.iter()
            .map(|&v| v.abs() < ACT_SKIP_THRESHOLD)
            .collect();

        let skipped = act_mask.iter().filter(|&&b| b).count();
        let _ = skipped;  // logged externally via probe; no per-call overhead here

        // Step 4: build c_proj sparse cache with mask applied.
        self.c_proj.prepare_inference_with_act_mask(Some(&act_mask))
    }

    /// Average mean-abs of F32 shadow weights across both linear layers.
    /// Tracks expert divergence in weight space for H3 (STE swallowing) diagnostic.
    pub fn f32_weight_signal(&self) -> Result<f32> {
        Ok((self.c_fc.weight_mean_abs()? + self.c_proj.weight_mean_abs()?) / 2.0)
    }

    /// Differentiable version: returns (c_fc_mean_abs + c_proj_mean_abs) / 2 as a Tensor.
    /// Gradient flows directly to F32 shadow weights without passing through STE.
    pub fn f32_weight_signal_tensor(&self) -> Result<Tensor> {
        let fc   = self.c_fc.weight_mean_abs_tensor()?;
        let proj = self.c_proj.weight_mean_abs_tensor()?;
        (fc + proj)? * 0.5_f64
    }

    pub fn forward(&self, x: &Tensor) -> Result<Tensor> {
        let x = self.c_fc.forward(x)?;
        let x = x.gelu()?;
        self.c_proj.forward(&x)
    }
}
