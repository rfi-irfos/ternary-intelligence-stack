// Sparse Top-3 MoE routing with asymmetric safety gate — whitepaper §11.1, §10.4
// Gate kept in F32 (candle_nn::Linear): routing needs fine-grained signal that
// ternary resolution can't provide at 256→12 scale. Expert MLPs remain ternary.
//
// Ternary Traffic Light (TTL) routing layer:
// Each expert is assigned a trit state (Green/Orange/Red) from rolling EMA utilization.
// Green experts get a gate logit boost; Red are suppressed; Orange pass unmodified
// but contribute at ORANGE_SCALE to the output mix. The trit is the execution
// budget, not just the routing signal.
use candle_core::{Result, Tensor};
use candle_nn::{Module, VarBuilder};
use super::mlp::Mlp;
use super::traffic_light::TrafficLight;
use std::cell::RefCell;

thread_local! {
    static ROUTING_ACC: RefCell<Vec<f32>> = RefCell::new(Vec::new());
    static ENTROPY_ACC: RefCell<Option<Tensor>> = RefCell::new(None);
    static LB_ACC:      RefCell<Option<Tensor>> = RefCell::new(None);
    // Traffic light telemetry: accumulated (green, orange, red, state_string) per step.
    // Each MoeBlock appends its layer's counts; train_bible drains once per batch.
    static TLIGHT_ACC:  RefCell<Vec<(usize, usize, usize, String)>> = RefCell::new(Vec::new());
    // Expert output divergence loss accumulator.
    // Each MoeBlock appends neg-variance-scalar (gradient-carrying); train_bible drains per batch.
    // Separate f32 log acc for per-layer variance logging (non-gradient).
    static DIV_ACC:     RefCell<Option<Tensor>> = RefCell::new(None);
    static DIV_LOG_ACC: RefCell<Vec<f32>> = RefCell::new(Vec::new());
    // F32 shadow weight variance log: per-layer variance of expert mean-abs F32 weights.
    // Diagnostic for H3 (STE swallowing) — if this grows while DIV_LOG_ACC stays flat,
    // F32 weights are diverging but ternary outputs are not (quantization barrier confirmed).
    static DIV_F32_LOG_ACC: RefCell<Vec<f32>> = RefCell::new(Vec::new());
    // Gate: train_bible sets true only on optimizer-step batches to avoid per-batch autograd overhead.
    static DIV_ENABLED: RefCell<bool> = RefCell::new(false);
    // Training mode flag: Gumbel noise is injected during training only.
    // prepare_inference() sets this to false so eval_perplexity gets clean deterministic routing.
    static TRAIN_MODE: RefCell<bool> = RefCell::new(true);
    // Gate diversity bias scale. When non-zero, adds a fixed linear logit spread across experts
    // (expert 0 gets -scale, expert E-1 gets +scale) to break Nash routing equilibrium.
    // Not learned — purely a structural asymmetry to force non-uniform routing from the start.
    // Set via --gate-diversity in train_bible. Disabled in eval mode.
    static GATE_DIVERSITY_SCALE: RefCell<f32> = RefCell::new(0.0);
}

pub fn clear_routing_capture() { ROUTING_ACC.with(|r| r.borrow_mut().clear()); }
pub fn clear_entropy_capture() { ENTROPY_ACC.with(|e| *e.borrow_mut() = None); }
pub fn clear_lb_capture()      { LB_ACC.with(|lb| *lb.borrow_mut() = None); }
pub fn clear_tlight_capture()  { TLIGHT_ACC.with(|t| t.borrow_mut().clear()); }
pub fn clear_div_capture()     {
    DIV_ACC.with(|d| *d.borrow_mut() = None);
    DIV_LOG_ACC.with(|d| d.borrow_mut().clear());
    DIV_F32_LOG_ACC.with(|d| d.borrow_mut().clear());
}

/// Drains per-layer F32 shadow weight variance (diagnostic for H3 STE swallowing).
pub fn take_div_f32_log_capture() -> Vec<f32> {
    DIV_F32_LOG_ACC.with(|d| std::mem::take(&mut *d.borrow_mut()))
}
pub fn enter_eval_mode()        { TRAIN_MODE.with(|m| *m.borrow_mut() = false); }
pub fn set_div_enabled(v: bool) { DIV_ENABLED.with(|d| *d.borrow_mut() = v); }
pub fn set_gate_diversity_scale(v: f32) { GATE_DIVERSITY_SCALE.with(|g| *g.borrow_mut() = v); }

pub fn take_routing_capture(num_experts: usize) -> Vec<f32> {
    ROUTING_ACC.with(|r| {
        let acc = r.borrow();
        if acc.is_empty() { return vec![0.0; num_experts]; }
        let total: f32 = acc.iter().sum::<f32>().max(1e-9);
        acc.iter().map(|&w| w / total).collect()
    })
}

pub fn take_entropy_capture() -> Option<Tensor> {
    ENTROPY_ACC.with(|e| e.borrow_mut().take())
}

pub fn take_lb_capture() -> Option<Tensor> {
    LB_ACC.with(|lb| lb.borrow_mut().take())
}

/// Returns per-layer traffic light snapshots: (green, orange, red, state_string).
/// One entry per MoeBlock that fired this step.
pub fn take_tlight_capture() -> Vec<(usize, usize, usize, String)> {
    TLIGHT_ACC.with(|t| std::mem::take(&mut *t.borrow_mut()))
}

/// Drains the gradient-carrying divergence loss tensor (sum over all layers this batch).
pub fn take_div_capture() -> Option<Tensor> {
    DIV_ACC.with(|d| d.borrow_mut().take())
}

/// Drains per-layer variance floats for logging (detached, one entry per MoE layer).
pub fn take_div_log_capture() -> Vec<f32> {
    DIV_LOG_ACC.with(|d| std::mem::take(&mut *d.borrow_mut()))
}

// Router temperature < 1.0 sharpens the gate softmax, amplifying small logit differences.
const ROUTER_TEMP: f64 = 0.7;

// Gumbel noise scale for training-time routing exploration.
// Additive noise of O(1) regardless of logit magnitude — the ±2% multiplicative
// noise it replaces was a no-op when logits ≈ 0 (Universal Nash state).
// Scale 0.2: logit spread after kaiming-init+temp ≈ 0.125 vs noise std ≈ 0.26,
// keeping routing competitive between gate signal and noise. At 1.0 the noise
// dominated completely (90%+), zeroing gate gradients and preventing learning.
// Disabled in eval mode via TRAIN_MODE flag.
const GUMBEL_NOISE_SCALE: f64 = 0.35;

pub struct MoeBlock {
    gate: candle_nn::Linear,
    experts: Vec<Mlp>,
    // Per-expert seed bias: F32 [hidden_size], unique random init, learned by Adam.
    // Added to each expert's input before the Mlp forward to break Nash symmetry:
    // different inputs → different CE gradients per expert → expert F32 weights diverge.
    // Unlike σ-perturbation (one-shot on ternary), this persists and amplifies.
    expert_seeds: Vec<Tensor>,
    num_experts: usize,
    // Ternary Traffic Light: per-expert execution budget controller.
    // Interior mutability: forward() takes &self but needs to update EMA each step.
    traffic_light: RefCell<TrafficLight>,
}

impl MoeBlock {
    pub fn new(hidden_size: usize, num_experts: usize, vb: VarBuilder, threshold: f32) -> Result<Self> {
        let gate = candle_nn::linear_no_bias(hidden_size, num_experts, vb.pp("gate"))?;
        let mut experts = Vec::new();
        let mut expert_seeds = Vec::new();
        let vb_experts = vb.pp("experts");
        for i in 0..num_experts {
            experts.push(Mlp::new(hidden_size, hidden_size * 4, vb_experts.pp(i), threshold)?);
            let seed = vb_experts.pp(i).get_with_hints(
                hidden_size, "seed_bias",
                candle_nn::Init::Uniform { lo: -0.01, up: 0.01 },
            )?;
            expert_seeds.push(seed);
        }
        Ok(Self {
            gate,
            experts,
            expert_seeds,
            num_experts,
            traffic_light: RefCell::new(TrafficLight::new(num_experts)),
        })
    }

    /// Dual-stream constructor: gate weights from `vb_stream` (stream-specific),
    /// expert FFN weights from `vb_experts` (shared between stream A and stream B).
    /// Both streams accessing the same `vb_experts` prefix in the VarMap means they
    /// reference identical underlying tensors — gradient from both streams accumulates
    /// on each expert, not halved.
    pub fn new_stream(
        hidden_size: usize,
        num_experts: usize,
        vb_stream: VarBuilder,
        vb_experts: VarBuilder,
        threshold: f32,
    ) -> Result<Self> {
        let gate = candle_nn::linear_no_bias(hidden_size, num_experts, vb_stream.pp("gate"))?;
        let mut experts = Vec::new();
        let mut expert_seeds = Vec::new();
        for i in 0..num_experts {
            experts.push(Mlp::new(hidden_size, hidden_size * 4, vb_experts.pp(i), threshold)?);
            let seed = vb_experts.pp(i).get_with_hints(
                hidden_size, "seed_bias",
                candle_nn::Init::Uniform { lo: -0.01, up: 0.01 },
            )?;
            expert_seeds.push(seed);
        }
        Ok(Self {
            gate,
            experts,
            expert_seeds,
            num_experts,
            traffic_light: RefCell::new(TrafficLight::new(num_experts)),
        })
    }

    pub fn prepare_inference(&self) -> Result<()> {
        enter_eval_mode();
        // Level-3 @sparseskip: use seed-aware prepare so c_proj sparse indices
        // exclude ~29.6% of INNER neurons that are deep-GeLU-saturated due to seed_bias.
        // Quality-verified at this threshold: mean max delta = 0.022, top-1 = 100%.
        // Falls back to standard prepare_inference if seed extraction fails.
        for (expert, seed_t) in self.experts.iter().zip(self.expert_seeds.iter()) {
            match seed_t.to_vec1::<f32>() {
                Ok(seed_vec) => expert.prepare_inference_with_seed(&seed_vec)?,
                Err(_)       => expert.prepare_inference()?,
            }
        }
        Ok(())
    }

    /// Activate TTL warmup freeze on this layer's traffic light.
    /// Called by train_bible when a gradient-norm burst is detected.
    pub fn freeze_ttl(&self, steps: usize) {
        self.traffic_light.borrow_mut().freeze(steps);
    }

    pub fn forward(&self, x: &Tensor) -> Result<Tensor> {
        let (b, s, h) = x.dims3()?;
        let dev = x.device();
        let x_flat = x.reshape((b * s, h))?;

        // 1. Gate logits — F32 linear for routing resolution
        let mut gate_logits = self.gate.forward(x)?; // [B, S, E]
        gate_logits = (gate_logits / ROUTER_TEMP)?;

        // 1b. Gate diversity bias: fixed linear logit spread to break Nash symmetry.
        // Expert E-1 gets +scale, expert 0 gets -scale. Not learned — purely structural.
        // Applied in post-temperature logit space; disabled in eval mode.
        if TRAIN_MODE.with(|m| *m.borrow()) {
            let scale = GATE_DIVERSITY_SCALE.with(|g| *g.borrow());
            if scale != 0.0 {
                let biases: Vec<f32> = (0..self.num_experts)
                    .map(|e| {
                        let rank = e as f32 / (self.num_experts as f32 - 1.0) - 0.5;
                        rank * 2.0 * scale
                    })
                    .collect();
                let bias_tensor = Tensor::from_vec(biases, (1usize, 1usize, self.num_experts), dev)?;
                gate_logits = gate_logits.broadcast_add(&bias_tensor)?;
            }
        }

        // 2. Clean probabilities for LB loss and entropy (computed on unmodified logits
        //    so LB gradient is orthogonal to the traffic light hard correction).
        let full_probs = candle_nn::ops::softmax(&gate_logits, candle_core::D::Minus1)?;

        // Neg-entropy accumulation.
        {
            let log_p = (&full_probs + 1e-9_f64)?.log()?;
            let neg_entropy = (&full_probs * log_p)?.sum(candle_core::D::Minus1)?.mean_all()?;
            ENTROPY_ACC.with(|e| {
                let mut cell = e.borrow_mut();
                *cell = match cell.take() {
                    None       => Some(neg_entropy),
                    Some(prev) => Some((&prev + &neg_entropy).unwrap()),
                };
            });
        }

        // 3. Ternary Traffic Light logit modifier — applied AFTER full_probs (keeps LB
        //    gradient clean) and BEFORE noise (consistent per-expert pressure each step).
        //    During warmup (first 50 steps) all modifiers are 0.0 — no routing change.
        {
            let tl = self.traffic_light.borrow();
            if !tl.is_warmup() {
                let modifiers = tl.logit_modifiers();
                let mod_tensor = Tensor::from_vec(modifiers, (1usize, 1usize, self.num_experts), dev)?;
                gate_logits = gate_logits.broadcast_add(&mod_tensor)?;
            }
        }

        // 4. Gumbel noise for exploration (training only).
        // g = -log(-log(u)), u ~ Uniform(ε, 1-ε) → standard Gumbel(0,1).
        // Additive: meaningful even when logits ≈ 0, directly breaks Universal Nash.
        if TRAIN_MODE.with(|m| *m.borrow()) {
            let u = Tensor::rand(1e-6_f32, 1.0_f32 - 1e-6_f32, gate_logits.shape(), dev)?;
            let gumbel = u.log()?.neg()?.log()?.neg()?;
            gate_logits = (gate_logits + (gumbel * GUMBEL_NOISE_SCALE)?)?;
        }

        // 5. Top-3 Routing.
        let large_neg_val = Tensor::new(&[-1e9f32], dev)?;

        let max1_indices = gate_logits.argmax(candle_core::D::Minus1)?.to_dtype(candle_core::DType::U32)?;
        let mask1 = Tensor::arange(0u32, self.num_experts as u32, dev)?
            .reshape((1, 1, self.num_experts))?.to_dtype(candle_core::DType::U32)?
            .broadcast_eq(&max1_indices.unsqueeze(candle_core::D::Minus1)?)?;

        let gate_logits_m1 = mask1.where_cond(&large_neg_val.broadcast_as(gate_logits.shape())?, &gate_logits)?;
        let max2_indices = gate_logits_m1.argmax(candle_core::D::Minus1)?.to_dtype(candle_core::DType::U32)?;
        let mask2 = Tensor::arange(0u32, self.num_experts as u32, dev)?
            .reshape((1, 1, self.num_experts))?.to_dtype(candle_core::DType::U32)?
            .broadcast_eq(&max2_indices.unsqueeze(candle_core::D::Minus1)?)?;

        let gate_logits_m2 = mask2.where_cond(&large_neg_val.broadcast_as(gate_logits.shape())?, &gate_logits_m1)?;
        let max3_indices = gate_logits_m2.argmax(candle_core::D::Minus1)?.to_dtype(candle_core::DType::U32)?;
        let mask3 = Tensor::arange(0u32, self.num_experts as u32, dev)?
            .reshape((1, 1, self.num_experts))?.to_dtype(candle_core::DType::U32)?
            .broadcast_eq(&max3_indices.unsqueeze(candle_core::D::Minus1)?)?;

        // 6. Load-balancing loss (Switch Transformer §5).
        let f_i_tensor;
        {
            let sel = ((mask1.to_dtype(candle_core::DType::F32)?
                + mask2.to_dtype(candle_core::DType::F32)?)?
                + mask3.to_dtype(candle_core::DType::F32)?)?;
            let f_i = sel.reshape((b * s, self.num_experts))?.mean(0)?;
            let p_i = full_probs.reshape((b * s, self.num_experts))?.mean(0)?;
            let lb = ((&f_i * &p_i)?.sum_all()? * self.num_experts as f64)?;
            LB_ACC.with(|acc| {
                let mut cell = acc.borrow_mut();
                *cell = match cell.take() {
                    None       => Some(lb),
                    Some(prev) => Some((&prev + &lb).unwrap()),
                };
            });
            f_i_tensor = f_i;
        }

        // 7. Pull expert load to CPU for skipping and traffic light update (single sync).
        let f_i_vec = f_i_tensor.to_vec1::<f32>().unwrap_or_else(|_| vec![0.0; self.num_experts]);
        {
            let mut tl = self.traffic_light.borrow_mut();
            tl.update(&f_i_vec);
            let (g, o, r) = tl.counts();
            let states = tl.state_string();
            TLIGHT_ACC.with(|t| t.borrow_mut().push((g, o, r, states)));
        }

        // 8. Asymmetric safety gate (v2.0): zero out low-confidence safety experts.
        let max1_values = gate_logits.max(candle_core::D::Minus1)?;
        let max2_values = gate_logits_m1.max(candle_core::D::Minus1)?;
        let max3_values = gate_logits_m2.max(candle_core::D::Minus1)?;

        let safety_threshold = 0.0f32;
        let apply_safety = |idx_tensor: &Tensor, val_tensor: &Tensor| -> Result<Tensor> {
            let is_safety  = idx_tensor.lt(4u32)?.to_dtype(candle_core::DType::F32)?;
            let is_low_conf = val_tensor.lt(safety_threshold)?.to_dtype(candle_core::DType::F32)?;
            let should_hold = (is_safety * is_low_conf)?;
            let multiplier  = (should_hold.neg()? + 1.0)?;
            val_tensor.broadcast_mul(&multiplier)
        };

        let max1_values = apply_safety(&max1_indices, &max1_values)?;
        let max2_values = apply_safety(&max2_indices, &max2_values)?;
        let max3_values = apply_safety(&max3_indices, &max3_values)?;

        // Top-3 softmax weights.
        let top3_logits = Tensor::stack(
            &[max1_values.flatten_all()?, max2_values.flatten_all()?, max3_values.flatten_all()?],
            1,
        )?;
        let top3_probs = candle_nn::ops::softmax(&top3_logits, 1)?;

        let mut final_output = Tensor::zeros((b * s, h), x.dtype(), dev)?;

        let m1_flat = max1_indices.flatten_all()?;
        let m2_flat = max2_indices.flatten_all()?;
        let m3_flat = max3_indices.flatten_all()?;

        let p1 = top3_probs.narrow(1, 0, 1)?.flatten_all()?;
        let p2 = top3_probs.narrow(1, 1, 1)?.flatten_all()?;
        let p3 = top3_probs.narrow(1, 2, 1)?.flatten_all()?;

        // 9. Sequential expert execution with ternary execution budget.
        let output_scales = self.traffic_light.borrow().output_scales();

        for expert_idx in 0..self.num_experts {
            // @sparseskip: skip non-routed experts entirely — whitepaper §5.2.
            // We use the load value from the CPU-synced f_i_vec.
            if f_i_vec[expert_idx] == 0.0 { continue; }

            let mask1_bool = m1_flat.eq(expert_idx as u32)?;
            let mask2_bool = m2_flat.eq(expert_idx as u32)?;
            let mask3_bool = m3_flat.eq(expert_idx as u32)?;

            let w1 = (mask1_bool.to_dtype(x.dtype())? * &p1)?;
            let w2 = (mask2_bool.to_dtype(x.dtype())? * &p2)?;
            let w3 = (mask3_bool.to_dtype(x.dtype())? * &p3)?;
            let combined_weight = (w1 + w2 + w3)?.unsqueeze(1)?;

            // Record routing participation (no sync needed, we use the value we already have).
            ROUTING_ACC.with(|r| {
                let mut acc = r.borrow_mut();
                if acc.len() <= expert_idx { acc.resize(expert_idx + 1, 0.0); }
                acc[expert_idx] += f_i_vec[expert_idx];
            });

            // Apply per-expert seed bias to break Nash symmetry.
            let x_seeded = x_flat.broadcast_add(&self.expert_seeds[expert_idx])?;
            let expert_out = self.experts[expert_idx].forward(&x_seeded)?;

            // Ternary execution budget: scale output by traffic light state.
            let scale = output_scales[expert_idx] as f64;
            let scaled_weight = if (scale - 1.0).abs() > 1e-6 {
                (combined_weight * scale)?
            } else {
                combined_weight
            };

            final_output = (final_output + expert_out.broadcast_mul(&scaled_weight)?)?;
        }

        // Expert output divergence loss — optimizer-step batches only (DIV_ENABLED gate),
        // single-position sample, detached from main graph.
        // Runs all experts (bypassing @sparseskip on the sample) so rarely-routed experts
        // also receive gradient to develop distinct outputs.
        // L2-normalized variance: bounded in [0,1], measures directional diversity.
        if DIV_ENABLED.with(|d| *d.borrow()) {
            let num_sample = 1.min(b * s);
            let x_sample = x_flat.narrow(0, 0, num_sample)?.detach();
            let mut expert_norms: Vec<Tensor> = Vec::with_capacity(self.num_experts);
            for (ei, expert) in self.experts.iter().enumerate() {
                let x_div = x_sample.broadcast_add(&self.expert_seeds[ei])?;
                let out = expert.forward(&x_div)?;                            // [N, H]
                let l2  = out.sqr()?.sum_keepdim(candle_core::D::Minus1)?.sqrt()?; // [N, 1]
                let l2_clamped = l2.clamp(1e-8_f64, f64::MAX)?;
                expert_norms.push(out.broadcast_div(&l2_clamped)?);            // [N, H] L2-norm
            }
            let stacked = Tensor::stack(&expert_norms, 0)?;                   // [E, N, H]
            let mean    = stacked.mean_keepdim(0)?;                            // [1, N, H]
            let diff    = stacked.broadcast_sub(&mean)?;                       // [E, N, H]
            let var     = diff.sqr()?.mean_all()?;                             // scalar

            // Log f32 (detached) for per-layer variance telemetry.
            let var_f32 = var.to_scalar::<f32>().unwrap_or(0.0);
            DIV_LOG_ACC.with(|d| d.borrow_mut().push(var_f32));

            // F32 shadow weight variance — diagnostic for H3 (STE swallowing).
            // Compute variance of mean-abs F32 weights across experts. If this grows
            // while var_f32 stays flat, weights are diverging in F32 space but not
            // crossing ternary thresholds (quantization barrier confirmed).
            let f32_signals: Vec<f32> = self.experts.iter()
                .filter_map(|e| e.f32_weight_signal().ok()) // unchanged: seed_bias tracked separately
                .collect();
            if f32_signals.len() == self.num_experts {
                let mean_s: f32 = f32_signals.iter().sum::<f32>() / f32_signals.len() as f32;
                let f32_var: f32 = f32_signals.iter()
                    .map(|&s| (s - mean_s).powi(2))
                    .sum::<f32>() / f32_signals.len() as f32;
                DIV_F32_LOG_ACC.with(|d| d.borrow_mut().push(f32_var));
            }

            // Output-based neg-variance: gradient flows via STE through ternary expert outputs.
            let neg_var = var.neg()?;

            // F32-direct divergence: gradient flows directly to F32 shadow weights,
            // bypassing STE and routing entirely. Computes variance of per-expert
            // mean-abs F32 weights and maximises it. This is the primary gradient
            // signal when STE is weak (H3) or routing is uniform (Nash).
            // Gradient per expert: 2×(mean_abs_e − global_mean) / E × sign(w[i,j]) / n_params
            // Experts above the global mean grow further; those below shrink — amplifying spread.
            let expert_f32_signals: Vec<Tensor> = self.experts.iter()
                .map(|e| e.f32_weight_signal_tensor())
                .collect::<Result<Vec<_>>>()?;
            let f32_stack  = Tensor::stack(&expert_f32_signals, 0)?;   // [E] scalar per expert
            let f32_mean   = f32_stack.mean_all()?;                     // global mean
            let f32_diff   = f32_stack.broadcast_sub(&f32_mean)?;       // [E] deviations
            let f32_var    = f32_diff.sqr()?.mean_all()?;               // variance scalar
            let neg_f32_var = f32_var.neg()?;

            // Accumulate both terms: output-based (STE path) + F32-direct (bypass path).
            DIV_ACC.with(|d| {
                let mut cell = d.borrow_mut();
                let combined = (&neg_var + &neg_f32_var).unwrap();
                *cell = match cell.take() {
                    None       => Some(combined),
                    Some(prev) => Some((&prev + &combined).unwrap()),
                };
            });
        }

        final_output.reshape((b, s, h))
    }
}
