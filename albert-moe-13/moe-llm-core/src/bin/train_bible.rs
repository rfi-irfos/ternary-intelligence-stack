use candle_core::{Device, DType, Result, Tensor};
use candle_core::backprop::GradStore;
use candle_nn::{Optimizer, VarBuilder, loss, VarMap};
use moe_llm_core::model::{Transformer, TransformerConfig, clear_routing_capture, take_routing_capture, clear_entropy_capture, take_entropy_capture, clear_lb_capture, take_lb_capture, clear_tlight_capture, take_tlight_capture, clear_div_capture, take_div_capture, take_div_log_capture, take_div_f32_log_capture, set_div_enabled, set_gate_diversity_scale, clear_cord_captures, take_cord_gate_capture, take_cord_cosim_capture};
use moe_llm_core::tokenizer::BpeTokenizer;
use moe_llm_core::evolution::EvolutionManager;
use moe_llm_core::mycelium::MyceliumModule;
use moe_llm_core::wald::{WaldModule, format_wald_line};
use moe_llm_core::spore::SporeManager;
use moe_llm_core::mandelbrot::{MandelbrotSurgery, format_mandelbrot_line};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::process::CommandExt;
use std::time::{SystemTime, UNIX_EPOCH, Instant};
use rayon::ThreadPoolBuilder;
use serde_json::{Value, json};
use std::collections::HashMap;

struct TrainFlags {
    /// Load-balancing loss weight. 0.0 = disabled entirely.
    lb_weight: f64,
    /// Epochs over which LB ramps from 0.1× to 1.0× when re-enabled from disabled.
    lb_ramp_epochs: usize,
    /// Seed F32 shadow expert weights with orthogonal Householder rotations on startup.
    seed_experts: bool,
    /// Reset gate weights to kaiming-uniform and add σ=0.15 noise to expert weights.
    /// Only needed when routing has collapsed; off by default to preserve learned routing.
    break_symmetry: bool,
    /// Override the scheduled DIV loss weight with a fixed value for this run.
    div_weight_override: Option<f64>,
    /// Fixed per-expert gate logit bias spread (0.0 = disabled). Expert E-1 gets +scale,
    /// expert 0 gets -scale. Breaks Nash routing symmetry without learning.
    gate_diversity: f32,
    /// Root directory for all data/model/log paths. Default: "." (run from project root).
    /// On a rental machine: --root=/path/to/albert-moe-13
    root: String,
    /// Perform mycelial cord surgery (dual-stream expansion) and exit. Run once manually
    /// when the width ceiling is reached. Subsequent restarts train the dual-stream model.
    cord_surgery: bool,
    /// Exit cleanly after this many total epochs. Checkpoint is written before exit.
    /// Useful for milestone checkpoints: albert-train --stop-at-epoch=900
    stop_at_epoch: Option<u32>,
    /// Path to the albert-spores/spores/ directory.
    /// Default: ~/projects/albert-spores/spores (auto-detected from HOME).
    /// Empty string = auto-detect. Pass --spores-dir=none to disable scanning.
    spores_dir: String,
    /// Number of batches per epoch. Default 300 (GPU). Contributors use 30 for
    /// frequent checkpoints on slow hardware.
    batches_per_epoch: usize,
    /// Micro-batch size per forward pass. Default 8 (GPU). Use 2 for CPU to avoid freezing.
    batch_size: usize,
    /// Vestigial-expert rescue: let mycelium resurrection also act on experts that
    /// are routed but weight-starved and stalled (the flux blind spot, F9).
    /// Default ON — opt out with --no-vestigial-rescue (the patience + recovery
    /// guards spare slots that are still recovering, e.g. CTX 0->2%).
    vestigial_rescue: bool,
    /// Epochs an expert must remain vestigial-and-not-recovering before rescue.
    vestigial_patience: usize,
    /// BRICK 2 — natural-selection gate seeding. When > 0, the NEXT plateau-gated
    /// surgery gently row-scales the new layer's router toward the experts that
    /// historically carried albert's best epochs (the ATL-credit prior), by this
    /// factor. 0.0 (default) = symmetric init (the A/B control). Suggested A/B
    /// treatment: 0.15–0.30. Centered + bounded + fully learnable-away; LB still
    /// counters monoculture. Only ever tilts a layer the gate already chose to add.
    atl_seed_scale: f32,
}

fn parse_args() -> TrainFlags {
    let args: Vec<String> = std::env::args().collect();
    let mut flags = TrainFlags {
        lb_weight:           0.03,
        lb_ramp_epochs:      5,
        seed_experts:        false,
        break_symmetry:      false,
        div_weight_override: None,
        gate_diversity:      0.0,
        root:                ".".to_string(),
        cord_surgery:        false,
        stop_at_epoch:       None,
        spores_dir:          String::new(),
        batches_per_epoch:   300,
        batch_size:          8,
        vestigial_rescue:    true,   // ON by default — flux nerve wired to self-repair; opt out with --no-vestigial-rescue
        vestigial_patience:  12,
        atl_seed_scale:      0.0,    // OFF by default — symmetric init is the A/B control
    };
    for arg in &args[1..] {
        match arg.as_str() {
            "--lb-disable"   => flags.lb_weight = 0.0,
            "--seed-experts"    => flags.seed_experts = true,
            "--break-symmetry"  => flags.break_symmetry = true,
            "--cord-surgery"    => flags.cord_surgery = true,
            "--vestigial-rescue"    => flags.vestigial_rescue = true,  // explicit-on (now the default)
            "--no-vestigial-rescue" => flags.vestigial_rescue = false, // opt-out, no rebuild needed
            _ => {
                if let Some(v) = arg.strip_prefix("--lb-weight=") {
                    if let Ok(w) = v.parse::<f64>() { flags.lb_weight = w; }
                } else if let Some(v) = arg.strip_prefix("--lb-ramp=") {
                    if let Ok(e) = v.parse::<usize>() { flags.lb_ramp_epochs = e; }
                } else if let Some(v) = arg.strip_prefix("--div-weight=") {
                    if let Ok(w) = v.parse::<f64>() { flags.div_weight_override = Some(w); }
                } else if let Some(v) = arg.strip_prefix("--gate-diversity=") {
                    if let Ok(w) = v.parse::<f32>() { flags.gate_diversity = w; }
                } else if let Some(v) = arg.strip_prefix("--root=") {
                    flags.root = v.trim_end_matches('/').to_string();
                } else if let Some(v) = arg.strip_prefix("--stop-at-epoch=") {
                    if let Ok(e) = v.parse::<u32>() { flags.stop_at_epoch = Some(e); }
                } else if let Some(v) = arg.strip_prefix("--spores-dir=") {
                    flags.spores_dir = v.to_string();
                } else if let Some(v) = arg.strip_prefix("--batches-per-epoch=") {
                    if let Ok(n) = v.parse::<usize>() { flags.batches_per_epoch = n.max(1); }
                } else if let Some(v) = arg.strip_prefix("--batch-size=") {
                    if let Ok(n) = v.parse::<usize>() { flags.batch_size = n.max(1); }
                } else if let Some(v) = arg.strip_prefix("--vestigial-patience=") {
                    if let Ok(n) = v.parse::<usize>() { flags.vestigial_patience = n.max(1); }
                } else if let Some(v) = arg.strip_prefix("--atl-seed-scale=") {
                    if let Ok(w) = v.parse::<f32>() { flags.atl_seed_scale = w.max(0.0); }
                }
            }
        }
    }
    flags
}

// Gradient clipping + collapse detection — whitepaper §11.4 (Ternary Training Innovations)

// Gradient clipping threshold — prevents weight explosions.
// Healthy grad norms for this model are typically 0.1–2.0.
const MAX_GRAD_NORM: f32 = 1.0;

// If a single batch loss exceeds this, the weights have already exploded.
// ln(vocab=32000) ≈ 10.373 — anything above 11.0 is catastrophic.
const LOSS_EXPLOSION_THRESHOLD: f32 = 11.0;

// If the epoch-average loss sits at or above this for COLLAPSE_STREAK_LIMIT
// consecutive epochs the model has collapsed to uniform distribution.
// 32k vocab random baseline: ln(32000) ≈ 10.373. Threshold set at 11.0 —
// well above the vocabulary-transfer plateau band (~10.35) so normal
// post-vocab-expansion epochs don't trigger false collapse detection.
// Old value (10.2) was calibrated for 8k vocab; recalibrated for 32k here.
const COLLAPSE_THRESHOLD:    f32 = 11.0;
const COLLAPSE_STREAK_LIMIT: u32 = 2;

// Gradient accumulation: backward each micro-batch immediately and SUM ITS GRADIENTS
// into a running GradStore (see accumulate_grads); opt.step() fires once per N. This
// gives an effective batch of N at the memory of ONE forward graph, because each
// micro-batch's graph is freed right after its backward. (Earlier this summed loss
// *tensors* and ran one backward over all N — which held N full forward graphs at
// once and OOM'd a 24GB GPU at N=4 the moment the whole body trained. Fixed 2026-05-29.)
// Mirrors the ternary hold state: withhold the weight update until enough evidence accumulates.
const GRAD_ACCUM_STEPS: usize = 1;
// TEMP DIAGNOSTIC (2026-05-29): ablate the L1 sparsity aux-loss to test whether it is
// the source of the ~8.5GB GPU-memory spike that fires once loss drops below 8.0.
// The L1 term builds an abs() graph node over ALL 2184 weight tensors and backprops
// through them. Set false to skip it entirely (batch_loss = ce_loss). Flip back / replace
// with a graph-free gradient-term implementation once the diagnosis is confirmed.
const _L1_REG_ENABLED: bool = false;
const _BATCH_SIZE: usize = 8;   // CTX=256, F16 attn: T4 16GB comfortable at 8 (params+moments ~2GB, activations ~4GB)
// Direct LR boost applied after Adam's step for cold layers (norm < THRESHOLD).
// Adam normalizes away gradient amplification via its second-moment denominator,
// so we bypass it entirely: a sign-normalized SGD step with lr = current_lr * cold_boost.
// Self-terminating: once a layer's norm exceeds THRESHOLD the condition is false.
// cold_boost is driven by wald_amplify_scale (updated each epoch from WALD severity).
// At severity=0.983 → scale=47×. Floor of 8× prevents under-reinforcement at low severity.

// TTL burst detection — freeze logit modifiers when per-layer grad norm spikes.
// GRAD_NORM_EMA_ALPHA: ~1/α ≈ 50-step window for the per-layer baseline EMA.
// BURST_RATIO_THRESHOLD: fire when current_norm / baseline > this value.
// TTL_FREEZE_GRAD_STEPS: freeze duration in optimizer steps; multiply by GRAD_ACCUM_STEPS
//   for the update() call count passed to TrafficLight::freeze().
// MAX_BURSTS_PER_EPOCH: safety circuit — disable further freezes after this many per epoch per layer.
const GRAD_NORM_EMA_ALPHA: f32 = 0.02;
const BURST_RATIO_THRESHOLD: f32 = 5.0;
const TTL_FREEZE_GRAD_STEPS: usize = 50;
const MAX_BURSTS_PER_EPOCH: usize = 5;

// Expert output divergence loss — breaks Universal Nash by pushing expert outputs apart.
// Continuous restoring force in output space; operates independent of routing impulses.
// Linear decay from START to END over DIV_DECAY_START..DIV_DECAY_END epochs, then off.
const DIV_LOSS_WEIGHT_START: f64 = 5e-2;
const DIV_LOSS_WEIGHT_END:   f64 = 1e-4;
const DIV_DECAY_START_EPOCH: usize = 105; // re-enabled from ep105 with seed biases live
const DIV_DECAY_END_EPOCH:   usize = 125; // exclusive: epoch 125+ weight = 0.0

fn div_loss_weight(epoch: usize) -> f64 {
    if epoch < DIV_DECAY_START_EPOCH {
        DIV_LOSS_WEIGHT_START
    } else if epoch >= DIV_DECAY_END_EPOCH {
        0.0
    } else {
        let t = (epoch - DIV_DECAY_START_EPOCH) as f64
              / (DIV_DECAY_END_EPOCH - DIV_DECAY_START_EPOCH - 1) as f64;
        DIV_LOSS_WEIGHT_START * (1.0 - t) + DIV_LOSS_WEIGHT_END * t
    }
}

fn timestamp() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

// Cosine annealing with warm restart — whitepaper §11.4
fn cosine_lr(base_lr: f64, min_lr: f64, step: usize, total_steps: usize) -> f64 {
    let t = step as f64 / total_steps.max(1) as f64;
    min_lr + 0.5 * (base_lr - min_lr) * (1.0 + (std::f64::consts::PI * t).cos())
}

/// Save the current varmap weights to a file.
fn save_checkpoint(varmap: &VarMap, path: &str) -> Result<()> {
    let all_vars = varmap.data().lock().unwrap();
    let mut tensor_map = HashMap::new();
    for (name, var) in all_vars.iter() {
        tensor_map.insert(name.clone(), var.as_tensor().clone());
    }
    candle_core::safetensors::save(&tensor_map, path)?;
    Ok(())
}

/// Load checkpoint weights into an existing varmap (shape-guarded).
fn load_checkpoint(varmap: &VarMap, path: &str, device: &Device) -> Result<usize> {
    let checkpoint_data = candle_core::safetensors::load(path, device)?;
    let all_vars = varmap.data().lock().unwrap();
    let mut loaded = 0usize;
    for (name, var) in all_vars.iter() {
        if let Some(tensor) = checkpoint_data.get(name) {
            if tensor.shape() == var.shape() {
                var.set(tensor)?;
                loaded += 1;
            }
        }
    }
    Ok(loaded)
}

/// Compute the global L2 gradient norm across all variables.
/// Returns 0.0 if no gradients are present.
fn global_grad_norm(varmap: &VarMap, grads: &candle_core::backprop::GradStore) -> f32 {
    let mut sq_sum = 0.0_f32;
    let all_vars = varmap.all_vars();
    for var in &all_vars {
        if let Some(g) = grads.get(var.as_tensor()) {
            if let Ok(sq) = g.sqr().and_then(|t| t.sum_all()).and_then(|t| t.to_scalar::<f32>()) {
                if sq.is_finite() {
                    sq_sum += sq;
                }
            }
        }
    }
    sq_sum.sqrt()
}

/// Memory-efficient gradient accumulation: fold one micro-batch's GradStore into a
/// running accumulator by summing per-variable grads. This lets us backward() each
/// micro-batch immediately (freeing its forward graph) instead of summing loss
/// tensors and holding all GRAD_ACCUM_STEPS forward graphs at once. The old
/// loss-tensor approach OOM'd once the whole body trained (it held N full dual-stream
/// graphs); this keeps peak memory at exactly ONE graph regardless of N.
fn accumulate_grads(acc: &mut Option<GradStore>, g: GradStore, vars: &[candle_core::Var]) -> Result<()> {
    match acc {
        None => *acc = Some(g),
        Some(a) => {
            for var in vars {
                let t = var.as_tensor();
                if let Some(gi) = g.get(t) {
                    let summed = match a.get(t) {
                        Some(prev) => (prev + gi)?,
                        None       => gi.clone(),
                    };
                    a.insert(t, summed);
                }
            }
        }
    }
    Ok(())
}

/// Best-effort GPU memory snapshot via nvidia-smi: (used, free, total) in MB.
/// Returns None on CPU / if nvidia-smi is unavailable. Diagnostic telemetry to
/// distinguish a per-step leak (straight ramp in `used`) from CUDA-allocator
/// fragmentation (sawtooth that drifts up), and to measure the real footprint.
fn gpu_mem_mb() -> Option<(u64, u64, u64)> {
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.used,memory.free,memory.total", "--format=csv,noheader,nounits"])
        .output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().next()?;
    let mut it = line.split(',').map(|x| x.trim().parse::<u64>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/// Compute L2 gradient norm per transformer layer, plus embed and lm_head.
/// Returns a Vec of length num_layers + 2:
///   [0..num_layers] = block layer norms (blocks.N.*)
///   [num_layers]    = embedding norm (embed.*)
///   [num_layers+1]  = lm_head norm (lm_head.*)
/// Appending non-block entries makes the bars non-zero even when ternary block
/// gradients are near machine-zero (common in late F32 training).
fn per_layer_grad_norm(varmap: &VarMap, grads: &candle_core::backprop::GradStore, num_layers: usize) -> Vec<f32> {
    let mut sq: Vec<f32> = vec![0.0; num_layers + 2];
    // One-shot diagnostic: on first call print how many block/embed/lm vars have vs. lack grads.
    static GRAD_DIAG_DONE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    let first_call = GRAD_DIAG_DONE.set(()).is_ok();
    let (mut block_with, mut block_without) = (0usize, 0usize);
    let (mut lm_with, mut lm_without) = (0usize, 0usize);
    let all_vars = varmap.data().lock().unwrap();
    for (name, var) in all_vars.iter() {
        let idx = if let Some(rest) = name.strip_prefix("blocks.") {
            rest.split('.').next()
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|&i| i < num_layers)
        } else if name.starts_with("embed.") {
            Some(num_layers)
        } else if name.starts_with("lm_head.") {
            Some(num_layers + 1)
        } else {
            None
        };
        if let Some(i) = idx {
            if let Some(g) = grads.get(var.as_tensor()) {
                if first_call {
                    if i < num_layers { block_with += 1; } else { lm_with += 1; }
                }
                if let Ok(s) = g.sqr().and_then(|t| t.sum_all()).and_then(|t| t.to_scalar::<f32>()) {
                    if s.is_finite() { sq[i] += s; }
                }
            } else if first_call {
                if i < num_layers { block_without += 1; } else { lm_without += 1; }
            }
        }
    }
    if first_call {
        println!("[GRAD-DIAG] blocks: {block_with} have grad / {block_without} None | lm+emb: {lm_with} have grad / {lm_without} None");
    }
    sq.iter().map(|&s| s.sqrt()).collect()
}

/// Per-layer variance of expert weight gradient norms — the definitive H3 diagnostic.
/// Uses naming convention blocks.{L}.moe.experts.{E}.{c_fc|c_proj}.weight.
/// If variance is non-zero, DIV gradient is differentially flowing to experts.
/// If all experts have identical grad norms, gradient is uniform (Nash collapse in grad space).
fn expert_grad_variance(
    varmap: &VarMap,
    grads: &candle_core::backprop::GradStore,
    num_layers: usize,
    num_experts: usize,
) -> Vec<f32> {
    let all_vars = varmap.data().lock().unwrap();
    let mut layer_expert_sq: Vec<Vec<f32>> = vec![vec![0.0; num_experts]; num_layers];
    for (name, var) in all_vars.iter() {
        // Match single-stream:  blocks.{li}.moe.experts.{ei}.{c_fc|c_proj}.weight
        //   or  dual-stream:    blocks.{li}.{stream_a|stream_b}.moe.experts.{ei}.{c_fc|c_proj}.weight
        let parts: Vec<&str> = name.split('.').collect();
        let (li_str, ei_str) = if parts.len() >= 7
            && parts[0] == "blocks"
            && parts[2] == "moe"
            && parts[3] == "experts"
            && (parts[5] == "c_fc" || parts[5] == "c_proj")
            && parts.last() == Some(&"weight")
        {
            (parts[1], parts[4])
        } else if parts.len() >= 8
            && parts[0] == "blocks"
            && (parts[2] == "stream_a" || parts[2] == "stream_b")
            && parts[3] == "moe"
            && parts[4] == "experts"
            && (parts[6] == "c_fc" || parts[6] == "c_proj")
            && parts.last() == Some(&"weight")
        {
            (parts[1], parts[5])
        } else {
            continue;
        };
        if let (Ok(li), Ok(ei)) = (li_str.parse::<usize>(), ei_str.parse::<usize>()) {
            if li < num_layers && ei < num_experts {
                if let Some(g) = grads.get(var.as_tensor()) {
                    if let Ok(s) = g.sqr().and_then(|t| t.sum_all()).and_then(|t| t.to_scalar::<f32>()) {
                        if s.is_finite() { layer_expert_sq[li][ei] += s; }
                    }
                }
            }
        }
    }
    layer_expert_sq.iter().map(|expert_sq| {
        let norms: Vec<f32> = expert_sq.iter().map(|&s| s.sqrt()).collect();
        let mean = norms.iter().sum::<f32>() / norms.len() as f32;
        norms.iter().map(|&n| (n - mean).powi(2)).sum::<f32>() / norms.len() as f32
    }).collect()
}

/// Per-layer ratio: mean DIV-derived expert gradient norm vs expected weight-decay pull.
/// Returns (grad_mean, wd_equiv_mean, ratio) per layer.
/// Ratio < 1.0 means weight decay dominates → F32-direct cannot grow DIVF32.
/// Uses the same naming convention as expert_grad_variance.
fn expert_wd_ratio(
    varmap: &VarMap,
    grads: &candle_core::backprop::GradStore,
    num_layers: usize,
    num_experts: usize,
    wd: f64,
) -> Vec<(f32, f32, f32)> {
    let all_vars = varmap.data().lock().unwrap();
    let mut layer_expert_grad_sq:   Vec<Vec<f32>> = vec![vec![0.0; num_experts]; num_layers];
    let mut layer_expert_weight_sq: Vec<Vec<f32>> = vec![vec![0.0; num_experts]; num_layers];
    for (name, var) in all_vars.iter() {
        // Match single-stream:  blocks.{li}.moe.experts.{ei}.{c_fc|c_proj}.weight
        //   or  dual-stream:    blocks.{li}.{stream_a|stream_b}.moe.experts.{ei}.{c_fc|c_proj}.weight
        let parts: Vec<&str> = name.split('.').collect();
        let (li_str, ei_str) = if parts.len() >= 7
            && parts[0] == "blocks"
            && parts[2] == "moe"
            && parts[3] == "experts"
            && (parts[5] == "c_fc" || parts[5] == "c_proj")
            && parts.last() == Some(&"weight")
        {
            (parts[1], parts[4])
        } else if parts.len() >= 8
            && parts[0] == "blocks"
            && (parts[2] == "stream_a" || parts[2] == "stream_b")
            && parts[3] == "moe"
            && parts[4] == "experts"
            && (parts[6] == "c_fc" || parts[6] == "c_proj")
            && parts.last() == Some(&"weight")
        {
            (parts[1], parts[5])
        } else {
            continue;
        };
        if let (Ok(li), Ok(ei)) = (li_str.parse::<usize>(), ei_str.parse::<usize>()) {
            if li < num_layers && ei < num_experts {
                if let Some(g) = grads.get(var.as_tensor()) {
                    if let Ok(s) = g.sqr().and_then(|t| t.sum_all()).and_then(|t| t.to_scalar::<f32>()) {
                        if s.is_finite() { layer_expert_grad_sq[li][ei] += s; }
                    }
                }
                if let Ok(s) = var.as_tensor().sqr().and_then(|t| t.sum_all()).and_then(|t| t.to_scalar::<f32>()) {
                    if s.is_finite() { layer_expert_weight_sq[li][ei] += s; }
                }
            }
        }
    }
    (0..num_layers).map(|l| {
        let grad_norms: Vec<f32>   = layer_expert_grad_sq[l].iter().map(|&s| s.sqrt()).collect();
        let weight_norms: Vec<f32> = layer_expert_weight_sq[l].iter().map(|&s| s.sqrt()).collect();
        let mean_grad   = grad_norms.iter().sum::<f32>()   / num_experts as f32;
        let mean_weight = weight_norms.iter().sum::<f32>() / num_experts as f32;
        let wd_equiv    = mean_weight * wd as f32;  // expected weight pull per step ~ wd × ||w||
        let ratio       = if wd_equiv > 0.0 { mean_grad / wd_equiv } else { 0.0 };
        (mean_grad, wd_equiv, ratio)
    }).collect()
}

/// Scale up gradients for layers whose norm is below THRESHOLD.
/// Self-terminating: once a layer's norm rises past the threshold the
/// amplification stops automatically, so this doesn't need a manual off switch.
fn amplify_early_layers(
    varmap: &VarMap,
    grads: &mut candle_core::backprop::GradStore,
    layer_norms: &[f32],
    scale: f64,
) {
    // Layers whose per-layer grad norm falls below this are considered crystallized.
    // 0.005 catches L0–L5 at current training state (was 0.001, too narrow).
    const THRESHOLD: f32 = 0.005;

    let all_vars = varmap.data().lock().unwrap();
    for (name, var) in all_vars.iter() {
        let li = name.strip_prefix("blocks.")
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<usize>().ok());
        if let Some(i) = li {
            if i < layer_norms.len() && layer_norms[i] < THRESHOLD {
                if let Some(g) = grads.get(var.as_tensor()).cloned() {
                    if let Ok(scaled) = &g * scale {
                        grads.insert(var.as_tensor(), scaled);
                    }
                }
            }
        }
    }
}

/// Direct LR boost for cold layers, applied after Adam's update step.
/// Normalises each gradient tensor by its own L2 norm before scaling, so every
/// cold-layer parameter receives a step of magnitude `boost_lr` regardless of
/// raw gradient scale — equivalent to per-tensor signed SGD with lr=boost_lr.
fn apply_layer_lr_boost(
    varmap: &VarMap,
    grads: &candle_core::backprop::GradStore,
    layer_norms: &[f32],
    boost_lr: f64,
) {
    const THRESHOLD: f32 = 0.005;
    let all_vars = varmap.data().lock().unwrap();
    for (name, var) in all_vars.iter() {
        let li = name.strip_prefix("blocks.")
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<usize>().ok());
        if let Some(i) = li {
            if i < layer_norms.len() && layer_norms[i] < THRESHOLD {
                if let Some(g) = grads.get(var.as_tensor()) {
                    let _ = (|| -> candle_core::Result<()> {
                        let norm_sq = g.sqr()?.sum_all()?.to_scalar::<f32>()?;
                        let g_norm  = (norm_sq as f64 + 1e-12).sqrt();
                        let delta   = (g * (-boost_lr / g_norm))?;
                        var.set(&var.as_tensor().add(&delta)?)
                    })();
                }
            }
        }
    }
}

/// Emit a TELE line to the training log once per epoch.
/// The dashboard parses this to drive the live neural viz panels.
///
/// Format: TELE L=<layers> S=<sparsity per layer, comma> E=<expert activity, comma>
///
/// Sparsity: fraction of weights with |w| < 0.1 (i.e. ternary zero) per layer.
/// Expert activity: mean absolute weight in each expert's MLP, normalised 0–1.
fn emit_telemetry(varmap: &VarMap, config: &TransformerConfig, log_path: &str) {
    let num_layers = config.num_layers;
    let num_experts = config.num_experts;
    let all_vars = match varmap.data().lock() {
        Ok(v) => v,
        Err(_) => return,
    };

    let mut layer_zeros = vec![0u64; num_layers];
    let mut layer_total = vec![0u64; num_layers];
    let mut expert_sum  = vec![0.0f32; num_experts];
    let mut expert_cnt  = vec![0u64; num_experts];

    for (name, var) in all_vars.iter() {
        if !name.contains("weight") { continue; }

        let data: Vec<f32> = match var.as_tensor()
            .flatten_all()
            .and_then(|t| t.to_vec1::<f32>())
        {
            Ok(d) => d,
            Err(_) => continue,
        };

        // Per-layer sparsity: extract layer index from "blocks.N."
        let layer_idx = name.strip_prefix("blocks.")
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<usize>().ok());

        if let Some(li) = layer_idx {
            if li < num_layers {
                let thr = config.layer_threshold(li);
                layer_zeros[li] += data.iter().filter(|&&w| w.abs() < thr).count() as u64;
                layer_total[li] += data.len() as u64;
            }
        }

        // Per-expert activity: extract expert index from "experts.N."
        if name.contains("experts.") {
            let ei = name.split("experts.")
                .nth(1)
                .and_then(|s| s.split('.').next())
                .and_then(|s| s.parse::<usize>().ok());
            if let Some(e) = ei {
                if e < num_experts {
                    expert_sum[e] += data.iter().map(|w| w.abs()).sum::<f32>();
                    expert_cnt[e] += data.len() as u64;
                }
            }
        }
    }

    let sparsity: Vec<String> = (0..num_layers).map(|i| {
        if layer_total[i] > 0 {
            format!("{:.3}", layer_zeros[i] as f32 / layer_total[i] as f32)
        } else { "0.000".to_string() }
    }).collect();

    // Normalise expert activity to 0–1 relative to the most active expert.
    let acts: Vec<f32> = (0..num_experts).map(|e| {
        if expert_cnt[e] > 0 { expert_sum[e] / expert_cnt[e] as f32 } else { 0.0 }
    }).collect();
    let max_act = acts.iter().cloned().fold(0.0f32, f32::max).max(1e-9);
    let expert_act: Vec<String> = acts.iter()
        .map(|&a| format!("{:.3}", a / max_act))
        .collect();

    let line = format!("TELE L={} S={} E={}",
        num_layers,
        sparsity.join(","),
        expert_act.join(","),
    );

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "{}", line);
    }
}

/// Per-expert mean |weight| across ALL layers — the "substance" axis of flux health.
/// Mirrors the expert-activity computation inside emit_telemetry but returns the raw
/// (un-normalised) values for classify_flux. Acquires its own varmap lock, so it must
/// NOT be called while another varmap lock is held.
fn per_expert_abs_weight(varmap: &VarMap, num_experts: usize) -> Vec<f32> {
    let mut sum = vec![0.0f32; num_experts];
    let mut cnt = vec![0u64; num_experts];
    let all_vars = match varmap.data().lock() {
        Ok(v) => v,
        Err(_) => return vec![0.0; num_experts],
    };
    for (name, var) in all_vars.iter() {
        if !name.contains("weight") || !name.contains("experts.") { continue; }
        let ei = name.split("experts.")
            .nth(1)
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<usize>().ok());
        if let Some(e) = ei {
            if e < num_experts {
                if let Ok(d) = var.as_tensor().flatten_all().and_then(|t| t.to_vec1::<f32>()) {
                    sum[e] += d.iter().map(|w| w.abs()).sum::<f32>();
                    cnt[e] += d.len() as u64;
                }
            }
        }
    }
    (0..num_experts)
        .map(|e| if cnt[e] > 0 { sum[e] / cnt[e] as f32 } else { 0.0 })
        .collect()
}

/// Per-(layer, expert) mean |weight| of each expert's MLP — the substance axis
/// fed to MyceliumModule::record_substance for vestigial detection. Returns a
/// nested Vec indexed [layer][expert]. Acquires its own varmap lock, so it must
/// NOT be called while another varmap lock is held.
fn per_layer_expert_abs_weight(varmap: &VarMap, num_layers: usize, num_experts: usize) -> Vec<Vec<f32>> {
    let mut sum = vec![vec![0.0f32; num_experts]; num_layers];
    let mut cnt = vec![vec![0u64;  num_experts]; num_layers];
    let all_vars = match varmap.data().lock() {
        Ok(v) => v,
        Err(_) => return vec![vec![0.0; num_experts]; num_layers],
    };
    for (name, var) in all_vars.iter() {
        if !name.contains("weight") || !name.contains("experts.") { continue; }
        let li = name.strip_prefix("blocks.")
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<usize>().ok());
        let ei = name.split("experts.")
            .nth(1)
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<usize>().ok());
        if let (Some(l), Some(e)) = (li, ei) {
            if l < num_layers && e < num_experts {
                if let Ok(d) = var.as_tensor().flatten_all().and_then(|t| t.to_vec1::<f32>()) {
                    sum[l][e] += d.iter().map(|w| w.abs()).sum::<f32>();
                    cnt[l][e] += d.len() as u64;
                }
            }
        }
    }
    (0..num_layers)
        .map(|l| (0..num_experts)
            .map(|e| if cnt[l][e] > 0 { sum[l][e] / cnt[l][e] as f32 } else { 0.0 })
            .collect())
        .collect()
}

/// Generate a unit vector in R^dim, deterministic from seed, via Box-Muller over LCG.
fn deterministic_unit_vec(dim: usize, seed: usize) -> Vec<f64> {
    let mut state = (seed as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let mut v = Vec::with_capacity(dim);
    let mut i = 0usize;
    while i < dim {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let u1 = (state >> 11) as f64 / (1u64 << 53) as f64;
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let u2 = (state >> 11) as f64 / (1u64 << 53) as f64;
        let r = (-2.0 * u1.max(1e-300).ln()).sqrt();
        let theta = 2.0 * std::f64::consts::PI * u2;
        v.push(r * theta.cos());
        i += 1;
        if i < dim {
            v.push(r * theta.sin());
            i += 1;
        }
    }
    let norm: f64 = v.iter().map(|x| x * x).sum::<f64>().sqrt().max(1e-12);
    v.into_iter().map(|x| x / norm).collect()
}

/// Seed F32 shadow expert weights with per-expert Householder rotations + deterministic scaling.
///
/// For each expert (layer, e): generate unit vector v from seed=layer*100+e, apply
/// Householder reflection H=I-2vv^T in the hidden_size space to both c_fc and c_proj
/// weight matrices. Additionally scale by exp(amplitude*(2e/(E-1)-1)) so each expert
/// has a distinct mean-abs value, guaranteeing DIVF32 > 1e-3 after seeding.
/// Aborts if post-seed DIVF32 < 1e-3 for any layer.
fn seed_experts_orthogonal(
    varmap: &VarMap,
    num_layers: usize,
    num_experts: usize,
    hidden_size: usize,
    device: &Device,
) -> Result<()> {
    const SCALE_AMPLITUDE: f64 = 0.8; // exp range [0.449, 2.225] across 12 experts

    // Snapshot expert vars while holding the lock minimally.
    let expert_vars: Vec<_> = {
        let data = varmap.data().lock().unwrap();
        data.iter()
            .filter(|(name, _)| name.contains(".moe.experts."))
            .map(|(name, var)| (name.clone(), var.clone()))
            .collect()
    };

    let mut tensors_modified = 0usize;

    for layer in 0..num_layers {
        for expert in 0..num_experts {
            let seed = layer * 100 + expert;
            let v = deterministic_unit_vec(hidden_size, seed); // unit vec in R^hidden_size

            // Per-expert deterministic scale: exp(A*(2e/(E-1)-1)), E experts
            let t = if num_experts > 1 {
                2.0 * expert as f64 / (num_experts - 1) as f64 - 1.0
            } else { 0.0 };
            let scale = (SCALE_AMPLITUDE * t).exp();

            let prefix = format!("blocks.{}.moe.experts.{}.", layer, expert);

            for (name, var) in &expert_vars {
                if !name.starts_with(&prefix) { continue; }

                let tensor = var.as_tensor();
                let shape = tensor.shape().dims().to_vec();
                let mut flat = tensor.flatten_all()?.to_vec1::<f32>()?;

                if name.ends_with("c_fc.weight") && shape.len() == 2 {
                    // Shape [hidden*4, hidden] — rotate in "in" (column) space: W_new = W @ H
                    // H = I - 2v*v^T → W @ H = W - 2*(W@v)*v^T   [O(out*hidden) op]
                    let (out_dim, in_dim) = (shape[0], shape[1]);
                    debug_assert_eq!(in_dim, hidden_size);
                    // compute W@v for each output row
                    let mut wv = vec![0.0f64; out_dim];
                    for i in 0..out_dim {
                        for j in 0..in_dim {
                            wv[i] += flat[i * in_dim + j] as f64 * v[j];
                        }
                    }
                    // apply + scale
                    for i in 0..out_dim {
                        for j in 0..in_dim {
                            flat[i * in_dim + j] = ((flat[i * in_dim + j] as f64
                                - 2.0 * wv[i] * v[j]) * scale) as f32;
                        }
                    }
                } else if name.ends_with("c_proj.weight") && shape.len() == 2 {
                    // Shape [hidden, hidden*4] — rotate in "out" (row) space: W_new = H @ W
                    // H @ W = W - 2*v*(v^T@W)   [O(hidden*in) op]
                    let (out_dim, in_dim) = (shape[0], shape[1]);
                    debug_assert_eq!(out_dim, hidden_size);
                    // compute v^T @ W for each input column
                    let mut vtw = vec![0.0f64; in_dim];
                    for j in 0..in_dim {
                        for i in 0..out_dim {
                            vtw[j] += v[i] * flat[i * in_dim + j] as f64;
                        }
                    }
                    // apply + scale
                    for i in 0..out_dim {
                        for j in 0..in_dim {
                            flat[i * in_dim + j] = ((flat[i * in_dim + j] as f64
                                - 2.0 * v[i] * vtw[j]) * scale) as f32;
                        }
                    }
                } else {
                    // 1D tensors (bias, seed_bias): just scale for mean-abs spread
                    for x in flat.iter_mut() { *x = (*x as f64 * scale) as f32; }
                }

                let new_tensor = Tensor::from_vec(flat, shape.as_slice(), device)?;
                var.set(&new_tensor)?;
                tensors_modified += 1;
            }
        }
    }

    println!("[seed] applied orthogonal F32 perturbation to {} expert tensors, target DIVF32 variance: 0.05-0.10",
        tensors_modified);

    // Post-seed verification: DIVF32 must exceed 1e-3 at every layer.
    let mut abort = false;
    for layer in 0..num_layers {
        let signals: Vec<f32> = (0..num_experts).filter_map(|expert| {
            let fc_key   = format!("blocks.{}.moe.experts.{}.c_fc.weight",   layer, expert);
            let proj_key = format!("blocks.{}.moe.experts.{}.c_proj.weight", layer, expert);
            // look up in the already-cloned vars list
            let fc_abs = expert_vars.iter().find(|(n, _)| *n == fc_key)
                .and_then(|(_, v)| v.as_tensor().abs().ok()?.mean_all().ok()?.to_scalar::<f32>().ok())?;
            let proj_abs = expert_vars.iter().find(|(n, _)| *n == proj_key)
                .and_then(|(_, v)| v.as_tensor().abs().ok()?.mean_all().ok()?.to_scalar::<f32>().ok())?;
            Some((fc_abs + proj_abs) / 2.0)
        }).collect();

        if signals.len() == num_experts {
            let mean = signals.iter().sum::<f32>() / signals.len() as f32;
            let var  = signals.iter().map(|&s| (s - mean).powi(2)).sum::<f32>() / signals.len() as f32;
            println!("[seed] L{} DIVF32 post-seed: {:.3e}", layer, var);
            if var < 1e-3 {
                eprintln!("[seed] ABORT: L{} DIVF32={:.3e} < 1e-3 threshold — seeding insufficient", layer, var);
                abort = true;
            }
        }
    }
    if abort {
        return Err(candle_core::Error::Msg(
            "[seed] ABORTING: post-seed DIVF32 verification failed. Check expert weight scaling.".into()
        ));
    }

    Ok(())
}

// Net2Net safe-copy layer surgery — whitepaper §11.2 (EvolutionManager)
/// Fibonacci fusion layer positions for a model with `num_layers` blocks.
/// Returns indices in [2, 3, 5, 8, 13, 21, ...] that are < num_layers.
fn fibonacci_fusion_layers(num_layers: usize) -> Vec<usize> {
    let mut fibs = Vec::new();
    let (mut a, mut b) = (2usize, 3usize);
    while a < num_layers {
        fibs.push(a);
        let next = a + b;
        a = b;
        b = next;
    }
    fibs
}

/// Returns Ok(true) if surgery was performed, Ok(false) if it was safely aborted
/// (architecture mismatch) — in which case config + checkpoint are left untouched and
/// the caller must skip fib-promotion/layer-add and keep training at the current depth.
/// BRICK 2 — gently tilt a freshly-added layer's router toward the experts that
/// historically carried albert's best epochs. Row-scales the new layer's gate
/// weight (`*.moe.gate.weight`, shape [num_experts × hidden]) by `1 + scale·prior[e]`
/// per expert row. `prior` is the centered, unit-max-abs ATL-credit prior from the
/// EvolutionManager — so the scaling is mean-1 (no net gate inflation), bounded, and
/// fully learnable-away; load-balancing still pushes back against any drift toward
/// monoculture. No-op when scale ≤ 0 or the prior is empty/zero (the A/B control).
/// Returns the number of gate tensors nudged.
fn apply_atl_gate_nudge(
    new_tensors: &mut HashMap<String, Tensor>,
    prefixes:    &[String],
    prior:       &[f32],
    scale:       f32,
    device:      &Device,
) -> Result<usize> {
    if scale <= 0.0 || prior.is_empty() || prior.iter().all(|&v| v == 0.0) {
        return Ok(0);
    }
    let gate_keys: Vec<String> = new_tensors.keys()
        .filter(|k| k.ends_with(".moe.gate.weight")
                    && prefixes.iter().any(|p| k.starts_with(p)))
        .cloned()
        .collect();
    let mut touched = 0;
    for key in gate_keys {
        if let Some(t) = new_tensors.get(&key) {
            let dims = t.shape().dims().to_vec();
            // Gate weight is [num_experts, hidden] — one row per expert. Skip anything
            // whose row count doesn't match the prior (defensive — never corrupt).
            if dims.len() == 2 && dims[0] == prior.len() {
                let (rows, cols) = (dims[0], dims[1]);
                let mut flat = t.flatten_all()?.to_vec1::<f32>()?;
                for e in 0..rows {
                    let factor = 1.0 + scale * prior[e];
                    for c in 0..cols { flat[e * cols + c] *= factor; }
                }
                new_tensors.insert(key.clone(), Tensor::from_vec(flat, (rows, cols), device)?);
                touched += 1;
            }
        }
    }
    Ok(touched)
}

fn perform_surgery(
    config_path: &str, checkpoint_path: &str, best_path: &str, device: &Device, root: &str,
    atl_prior: &[f32], atl_seed_scale: f32,
) -> Result<bool> {
    println!("[{}] --- INITIATING NEURAL SURGERY: Net2Net Safe Copy ---", timestamp());

    let config_str = fs::read_to_string(config_path).expect("Unable to read config.json");
    let mut config_json: Value = serde_json::from_str(&config_str).expect("Invalid JSON in config file.");
    let old_layers = config_json["num_layers"].as_u64().unwrap() as usize;
    let new_layers = old_layers + 1;
    let num_streams = config_json["num_streams"].as_u64().unwrap_or(1) as usize;

    let mand = MandelbrotSurgery::new();

    // Surgery clones from the LATEST checkpoint — it always matches the current config's
    // architecture. It must NOT source from `best`: best can lag across surgeries, and a
    // stale pre-cord single-stream `best` WIPED the model at S14 (2026-05-29) because the
    // dual-stream clone found no stream tensors to copy and saved an unloadable checkpoint.
    let source = checkpoint_path;
    let tensors = candle_core::safetensors::load(source, device)?;
    let mut new_tensors: HashMap<String, Tensor> = tensors.iter()
        .map(|(k, t)| (k.clone(), t.clone()))
        .collect();

    if num_streams >= 2 {
        // Dual-stream depth surgery: add one block to both streams simultaneously.
        // Stream A new layer uses standard Mandelbrot latitude (target_layer).
        // Stream B new layer uses offset latitude (+1000) — distinct from stream A
        // at the same depth and from any single-stream layer that existed before cord surgery.
        let source_layer = old_layers - 1;
        let target_layer = old_layers;

        let sa_prefix  = format!("blocks.{}.stream_a.", source_layer);
        let sb_prefix  = format!("blocks.{}.stream_b.", source_layer);
        let exp_prefix = format!("blocks.{}.experts.",  source_layer);

        let new_sa_prefix  = format!("blocks.{}.stream_a.", target_layer);
        let new_sb_prefix  = format!("blocks.{}.stream_b.", target_layer);
        let new_exp_prefix = format!("blocks.{}.experts.",  target_layer);

        let source_keys: Vec<(String, Tensor)> = tensors.iter()
            .filter(|(k, _)| k.starts_with(&sa_prefix) || k.starts_with(&sb_prefix) || k.starts_with(&exp_prefix))
            .map(|(k, t)| (k.clone(), t.clone()))
            .collect();

        // GUARD: a dual-stream config but a source with no stream tensors to clone means
        // the source architecture does not match. Saving here would produce a checkpoint
        // that cannot reload into the dual-stream model (the catastrophic S14 wipe). Abort:
        // leave config + checkpoint untouched and let training continue unchanged.
        if source_keys.is_empty() {
            println!("[{}] *** SURGERY ABORTED: no stream_a/stream_b/experts tensors at layer {} in source '{}' \
                      — architecture mismatch. Refusing to save an unloadable checkpoint; training continues at {}L. ***",
                timestamp(), source_layer, source, old_layers);
            return Ok(false);
        }

        for (key, tensor) in &source_keys {
            let new_key = if key.starts_with(&sa_prefix) {
                key.replacen(&sa_prefix, &new_sa_prefix, 1)
            } else if key.starts_with(&sb_prefix) {
                key.replacen(&sb_prefix, &new_sb_prefix, 1)
            } else {
                key.replacen(&exp_prefix, &new_exp_prefix, 1)
            };
            new_tensors.insert(new_key, tensor.clone());
        }

        // Perturb stream A new layer at its natural depth latitude
        let sa_keys: Vec<String> = new_tensors.keys()
            .filter(|k| k.starts_with(&new_sa_prefix)).cloned().collect();
        for key in sa_keys {
            if let Some(t) = new_tensors.get(&key) {
                let shape = t.shape().clone();
                let flat  = t.flatten_all()?.to_vec1::<f32>()?;
                new_tensors.insert(key, Tensor::from_vec(mand.perturb(&flat, target_layer), &shape, device)?);
            }
        }

        // Perturb stream B new layer at offset latitude (+1000) to differ from stream A
        let sb_latitude = target_layer + 1000;
        let sb_keys: Vec<String> = new_tensors.keys()
            .filter(|k| k.starts_with(&new_sb_prefix)).cloned().collect();
        for key in sb_keys {
            if let Some(t) = new_tensors.get(&key) {
                let shape = t.shape().clone();
                let flat  = t.flatten_all()?.to_vec1::<f32>()?;
                new_tensors.insert(key, Tensor::from_vec(mand.perturb(&flat, sb_latitude), &shape, device)?);
            }
        }

        // ── Natural selection, brick 2 (flag-gated, default OFF) ──────────────
        // Gently tilt BOTH new stream routers toward the proven experts. Applied
        // after the Mandelbrot perturbation so the nudge rides on top of the broken
        // symmetry. Only touches a layer the plateau gate already chose to add.
        let nudged = apply_atl_gate_nudge(
            &mut new_tensors, &[new_sa_prefix.clone(), new_sb_prefix.clone()],
            atl_prior, atl_seed_scale, device,
        )?;
        if nudged > 0 {
            let prior_str: Vec<String> = atl_prior.iter().map(|v| format!("{:+.2}", v)).collect();
            println!("[{}] [atl-seed] gentle router nudge on {} gate tensor(s) at new layer {} \
                      (scale={:.3}, prior=[{}]).",
                timestamp(), nudged, target_layer, atl_seed_scale, prior_str.join(","));
        }

        // Check if new Fibonacci fusion layers emerged at this depth
        let old_fusion = fibonacci_fusion_layers(old_layers);
        let new_fusion = fibonacci_fusion_layers(new_layers);
        if new_fusion.len() > old_fusion.len() {
            let hidden_size = config_json["hidden_size"].as_u64().unwrap() as usize;
            for k in old_fusion.len()..new_fusion.len() {
                let gate_w = Tensor::randn(0.0f32, 0.01f32, (2usize, 2 * hidden_size), device)?;
                let gate_b = Tensor::zeros((2usize,), DType::F32, device)?;
                new_tensors.insert(format!("anastomosis.{}.gate.weight", k), gate_w);
                new_tensors.insert(format!("anastomosis.{}.gate.bias", k), gate_b);
                println!("[{}] New anastomosis gate {} at layer {} initialised.", timestamp(), k, new_fusion[k]);
            }
            config_json["fusion_layers"] = json!(new_fusion);
        }

        config_json["num_layers"] = json!(new_layers);
        fs::write(config_path, serde_json::to_string_pretty(&config_json).unwrap())?;
        println!("[{}] Dual-stream surgery: {}L → {}L | stream_a lat={:.4} stream_b lat={}",
            timestamp(), old_layers, new_layers,
            moe_llm_core::mandelbrot::layer_c_im(target_layer), sb_latitude);
    } else {
        // Single-stream surgery (original behaviour, unchanged).
        let source_layer = old_layers - 1;
        let target_layer = old_layers;

        for (name, tensor) in tensors.iter() {
            let prefix = format!("blocks.{}.", source_layer);
            if name.starts_with(&prefix) {
                let new_name = name.replacen(&prefix, &format!("blocks.{}.", target_layer), 1);
                new_tensors.insert(new_name, tensor.clone());
            }
        }

        let target_prefix = format!("blocks.{}.", target_layer);
        let perturb_keys: Vec<String> = new_tensors.keys()
            .filter(|k| k.starts_with(&target_prefix)).cloned().collect();
        let tensor_count = perturb_keys.len();
        for key in perturb_keys {
            if let Some(t) = new_tensors.get(&key) {
                let shape = t.shape().clone();
                let flat  = t.flatten_all()?.to_vec1::<f32>()?;
                new_tensors.insert(key, Tensor::from_vec(mand.perturb(&flat, target_layer), &shape, device)?);
            }
        }
        println!("[{}] Symmetry break: Mandelbrot perturbation applied to {} tensors in layer {} (c_im={:.4}).",
            timestamp(), tensor_count, target_layer,
            moe_llm_core::mandelbrot::layer_c_im(target_layer));

        // Natural selection, brick 2 (flag-gated, default OFF) — single-stream variant.
        let nudged = apply_atl_gate_nudge(
            &mut new_tensors, &[target_prefix.clone()], atl_prior, atl_seed_scale, device,
        )?;
        if nudged > 0 {
            let prior_str: Vec<String> = atl_prior.iter().map(|v| format!("{:+.2}", v)).collect();
            println!("[{}] [atl-seed] gentle router nudge on {} gate tensor(s) at new layer {} \
                      (scale={:.3}, prior=[{}]).",
                timestamp(), nudged, target_layer, atl_seed_scale, prior_str.join(","));
        }

        config_json["num_layers"] = json!(new_layers);
        fs::write(config_path, serde_json::to_string_pretty(&config_json).unwrap())?;
        println!("[{}] Surgery Complete: Layer {} cloned from Layer {}.", timestamp(), target_layer, source_layer);
    }

    candle_core::safetensors::save(&new_tensors, checkpoint_path)?;

    let archive_path = format!("{}/models/albert_v3.0.best.{}L.safetensors", root, old_layers);
    if std::path::Path::new(best_path).exists() {
        let _ = fs::rename(best_path, &archive_path);
        println!("[{}] Pre-surgery best archived to {}.", timestamp(), archive_path);
    }
    Ok(true)
}

/// Mycelial cord surgery: expand single-stream 256H model into dual-stream 2×256H.
///
/// Reads the best checkpoint, renames tensors to stream_a/stream_b/experts namespacing,
/// applies Mandelbrot perturbation to stream B to break inter-stream symmetry,
/// initialises anastomosis gate tensors at Fibonacci-indexed fusion layers,
/// and writes the new checkpoint + updated config.json.
///
/// Triggered once manually via `--cord-surgery`. Does not fire autonomously.
/// Restart training without the flag after this exits.
fn perform_cord_surgery(config_path: &str, checkpoint_path: &str, best_path: &str, device: &Device, root: &str) -> Result<()> {
    println!("[{}] --- INITIATING CORD SURGERY: Mycelial Dual-Stream Expansion ---", timestamp());

    let config_str = fs::read_to_string(config_path).expect("Unable to read config.json");
    let mut config_json: Value = serde_json::from_str(&config_str).expect("Invalid JSON in config file.");
    let num_layers  = config_json["num_layers"].as_u64().unwrap() as usize;
    let hidden_size = config_json["hidden_size"].as_u64().unwrap() as usize;
    let num_streams = config_json["num_streams"].as_u64().unwrap_or(1) as usize;

    if num_streams >= 2 {
        println!("[{}] Config already shows num_streams={}. Cord surgery already applied — aborting.", timestamp(), num_streams);
        return Ok(());
    }

    let fusion_layers = fibonacci_fusion_layers(num_layers);
    println!("[{}] {}L model → dual-stream | anastomosis at {:?}", timestamp(), num_layers, fusion_layers);

    let source = if std::path::Path::new(best_path).exists() { best_path } else { checkpoint_path };
    let tensors = candle_core::safetensors::load(source, device)?;
    let mut new_tensors: HashMap<String, Tensor> = HashMap::new();

    // Migrate every tensor in the checkpoint to the dual-stream naming convention:
    //   blocks.{i}.attn.*         → blocks.{i}.stream_a.attn.*  (+ stream_b copy)
    //   blocks.{i}.moe.gate.*     → blocks.{i}.stream_a.moe.gate.*  (+ stream_b copy)
    //   blocks.{i}.moe.experts.*  → blocks.{i}.experts.*   (shared, no stream prefix)
    //   blocks.{i}.ln1/ln2.*      → blocks.{i}.stream_a.ln1/ln2.*  (+ stream_b copy)
    //   embed.*, ln_f.*, lm_head.* → unchanged (shared)
    for (name, tensor) in tensors.iter() {
        let mut placed = false;
        for i in 0..num_layers {
            let block_pfx = format!("blocks.{}.", i);
            if name.starts_with(&block_pfx) {
                let rest = &name[block_pfx.len()..];
                if rest.starts_with("moe.experts.") {
                    // Shared experts: strip moe. prefix
                    let expert_suffix = &rest["moe.".len()..];
                    new_tensors.insert(format!("blocks.{}.{}", i, expert_suffix), tensor.clone());
                } else {
                    // Stream-specific: duplicate as stream_a (unchanged) and stream_b (to be perturbed)
                    new_tensors.insert(format!("blocks.{}.stream_a.{}", i, rest), tensor.clone());
                    new_tensors.insert(format!("blocks.{}.stream_b.{}", i, rest), tensor.clone());
                }
                placed = true;
                break;
            }
        }
        if !placed {
            new_tensors.insert(name.clone(), tensor.clone());
        }
    }

    // Apply Mandelbrot perturbation to all stream_b tensors.
    // Latitude is num_layers + 50 — well beyond any layer index, unique, deterministic.
    let stream_b_latitude = num_layers + 50;
    let mand = MandelbrotSurgery::new();
    let sb_keys: Vec<String> = new_tensors.keys()
        .filter(|k| k.contains(".stream_b.")).cloned().collect();
    let perturb_count = sb_keys.len();
    for key in sb_keys {
        if let Some(t) = new_tensors.get(&key) {
            let shape = t.shape().clone();
            let flat  = t.flatten_all()?.to_vec1::<f32>()?;
            new_tensors.insert(key, Tensor::from_vec(mand.perturb(&flat, stream_b_latitude), &shape, device)?);
        }
    }
    println!("[{}] Stream B: Mandelbrot perturbation applied to {} tensors (latitude {} → c_im={:.4}).",
        timestamp(), perturb_count, stream_b_latitude,
        moe_llm_core::mandelbrot::layer_c_im(stream_b_latitude));

    // Initialise anastomosis gate tensors: Linear(2*hidden → 2), weight~N(0,0.01), bias=0.
    // sigmoid(near-zero) ≈ 0.5 — minimal cross-stream influence at t=0. Gate learns to open
    // selectively as streams develop complementary specialisations.
    for (k, &fusion_layer) in fusion_layers.iter().enumerate() {
        let gate_w = Tensor::randn(0.0f32, 0.01f32, (2usize, 2 * hidden_size), device)?;
        let gate_b = Tensor::zeros((2usize,), DType::F32, device)?;
        new_tensors.insert(format!("anastomosis.{}.gate.weight", k), gate_w);
        new_tensors.insert(format!("anastomosis.{}.gate.bias",   k), gate_b);
        println!("[{}] Anastomosis {}: gate at layer {} (Linear({}, 2), w~N(0,0.01), b=0).",
            timestamp(), k, fusion_layer, 2 * hidden_size);
    }

    // Update config
    config_json["num_streams"]   = json!(2);
    config_json["fusion_layers"] = json!(fusion_layers);
    fs::write(config_path, serde_json::to_string_pretty(&config_json).unwrap())?;

    // Save new checkpoint
    candle_core::safetensors::save(&new_tensors, checkpoint_path)?;

    // Archive pre-cord best for rollback
    let archive_path = format!("{}/models/albert_v3.0.best.{}L.pre_cord.safetensors", root, num_layers);
    if std::path::Path::new(best_path).exists() {
        let _ = fs::rename(best_path, &archive_path);
        println!("[{}] Pre-cord best archived to {}.", timestamp(), archive_path);
    }

    println!("[{}] Cord Surgery Complete: single-stream → dual-stream 2×{}H | {} anastomosis layers.",
        timestamp(), hidden_size, fusion_layers.len());
    println!("[{}] Restart training without --cord-surgery to begin dual-stream training.", timestamp());
    Ok(())
}

fn perform_resurrection(checkpoint_path: &str, jobs: &[moe_llm_core::mycelium::ResurrectionJob], device: &Device) -> Result<()> {
    if jobs.is_empty() { return Ok(()); }
    let tensors = candle_core::safetensors::load(checkpoint_path, device)?;
    let mut new_tensors: HashMap<String, Tensor> = tensors.into_iter().collect();
    for job in jobs {
        let seed_prefix = format!("blocks.{}.moe.experts.{}.", job.layer, job.seed_expert);
        let dead_prefix  = format!("blocks.{}.moe.experts.{}.", job.layer, job.dead_expert);
        let seed_keys: Vec<String> = new_tensors.keys()
            .filter(|k| k.starts_with(&seed_prefix))
            .cloned()
            .collect();
        for seed_key in seed_keys {
            let dead_key = seed_key.replace(&seed_prefix, &dead_prefix);
            if let Some(t) = new_tensors.get(&seed_key) {
                let noise = Tensor::randn(0.0f32, job.noise_sigma, t.shape(), device)?;
                new_tensors.insert(dead_key, (t + noise)?);
            }
        }
        println!("[{}] MYCELIUM: Resurrected L{}E{} from L{}E{} (σ={:.3})",
            timestamp(), job.layer, job.dead_expert, job.layer, job.seed_expert, job.noise_sigma);
    }
    candle_core::safetensors::save(&new_tensors, checkpoint_path)?;
    Ok(())
}

fn train_cycle(
    tokens: &[u32],
    tokenizer: &BpeTokenizer,
    device: &Device,
    evolution_manager: &mut EvolutionManager,
    mycelium: &mut MyceliumModule,
    wald: &mut WaldModule,
    global_step: &mut usize,
    flags: &TrainFlags,
    spore_manager: &mut SporeManager,
) -> Result<bool> {
    let r = &flags.root;
    let checkpoint_path = format!("{r}/models/albert_v3.0.safetensors");
    let best_path       = format!("{r}/models/albert_v3.0.best.safetensors");
    let config_path     = format!("{r}/models/albert_v3.0.config.json");
    let meta_path       = format!("{r}/models/albert_v3.0.meta");
    let best_meta_path  = format!("{r}/models/albert_v3.0.best_loss");
    let best_epoch_path = format!("{r}/models/albert_v3.0.best_epoch");
    let evo_path        = format!("{r}/models/albert_v3.0.evolution");
    // Log path: prefer ~/.albert/training.log (where the dashboard server reads from).
    // Fall back to {root}/dashboard/training.log only if HOME is unavailable.
    let log_path_owned  = std::env::var("HOME")
        .map(|h| { let p = format!("{h}/.albert"); let _ = fs::create_dir_all(&p); format!("{p}/training.log") })
        .unwrap_or_else(|_| format!("{r}/dashboard/training.log"));
    let log_path        = log_path_owned.as_str();
    // Borrow as &str for the many call sites that take &str
    let checkpoint_path = checkpoint_path.as_str();
    let best_path       = best_path.as_str();
    let config_path     = config_path.as_str();
    let meta_path       = meta_path.as_str();
    let best_meta_path  = best_meta_path.as_str();
    let evo_path        = evo_path.as_str();

    let config_str = fs::read_to_string(config_path).expect("Unable to read config.json");
    let config_json: Value = serde_json::from_str(&config_str).expect("Invalid JSON in config file.");

    let mut config = TransformerConfig::default();
    config.vocab_size    = tokenizer.vocab_size();
    config.hidden_size   = config_json["hidden_size"].as_u64().unwrap() as usize;
    config.num_layers    = config_json["num_layers"].as_u64().unwrap() as usize;
    config.num_heads     = config_json["num_heads"].as_u64().unwrap() as usize;
    config.max_seq_len   = config_json["max_seq_len"].as_u64().unwrap() as usize;
    config.num_experts   = config_json["num_experts"].as_u64().unwrap() as usize;
    config.num_streams   = config_json["num_streams"].as_u64().unwrap_or(1) as usize;
    config.fusion_layers = config_json["fusion_layers"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_u64().map(|n| n as usize)).collect())
        .unwrap_or_default();

    println!("[{}] Arch: {}L · {}H · {}E · {}CTX | Vocab: {}",
        timestamp(), config.num_layers, config.hidden_size,
        config.num_experts, config.max_seq_len, config.vocab_size);

    let varmap = VarMap::new();
    let vb     = VarBuilder::from_varmap(&varmap, DType::F32, device);
    let model  = Transformer::new(&config, vb)?;

    // Load latest checkpoint if present.
    let num_tensors: usize = if std::path::Path::new(checkpoint_path).exists() {
        let loaded = load_checkpoint(&varmap, checkpoint_path, device)?;
        println!("[{}] Loaded {} tensors from checkpoint.", timestamp(), loaded);
        loaded
    } else {
        0
    };

    // Reset gate weights + expert noise when either:
    //   (a) --break-symmetry was passed explicitly, OR
    //   (b) the evolution manager detected near-uniform routing for 34+ consecutive epochs.
    // In case (b) the flag is consumed (cleared) here so subsequent restarts don't re-apply.
    let do_break = flags.break_symmetry || evolution_manager.consume_symmetry_break();
    if do_break {
        let gate_vars: Vec<_> = {
            let all_vars = varmap.data().lock().unwrap();
            all_vars.iter()
                .filter(|(name, _)| name.contains(".moe.gate.weight"))
                .map(|(name, var)| (name.clone(), var.clone()))
                .collect()
        };
        for (name, var) in &gate_vars {
            let shape = var.shape().clone();
            let fan_in = shape.dims()[1] as f64; // gate is [num_experts × hidden], fan_in = hidden
            let std = (2.0_f64 / fan_in).sqrt() as f32;
            let fresh = Tensor::randn(0.0f32, std, shape.dims(), device)?;
            var.set(&fresh)?;
            println!("[{}] Gate reset: {} → kaiming-uniform std={:.4}", timestamp(), name, std);
        }
        if !gate_vars.is_empty() {
            println!("[{}] Gate weights reset to kaiming-uniform — routing symmetry broken.", timestamp());
        }
    }

    // Expert weight perturbation — gated on the same do_break decision.
    if do_break {
        let expert_vars: Vec<_> = {
            let all_vars = varmap.data().lock().unwrap();
            all_vars.iter()
                .filter(|(name, _)| name.contains(".moe.experts."))
                .map(|(name, var)| (name.clone(), var.clone()))
                .collect()
        };
        let sigma = 0.15f32;
        for (_name, var) in &expert_vars {
            let noise = Tensor::randn(0.0f32, sigma, var.shape().dims(), device)?;
            let perturbed = (var.as_tensor() + noise)?;
            var.set(&perturbed)?;
        }
        if !expert_vars.is_empty() {
            println!("[{}] Expert symmetry break: σ={} noise applied to {} expert tensors.",
                timestamp(), sigma, expert_vars.len());
        }
    }

    // If the evolution manager's symmetry break flag was just consumed, persist the cleared
    // state immediately so a crash-restart doesn't re-apply the break unintentionally.
    if do_break {
        evolution_manager.save_state(evo_path);
    }

    // F32 shadow weight seeding — breaks Nash deadlock by placing each expert at a
    // distinct position in weight space (Householder rotation + scaling). Runs once
    // per binary invocation when --seed-experts is passed, before the epoch loop.
    if flags.seed_experts {
        seed_experts_orthogonal(&varmap, config.num_layers, config.num_experts, config.hidden_size, device)?;
    }

    // Gate diversity bias: fixed logit spread [−scale, +scale] across experts.
    // 0.0 (default) = disabled. Only active when --gate-diversity=F is passed.
    if flags.gate_diversity != 0.0 {
        set_gate_diversity_scale(flags.gate_diversity);
        println!("[{}] [gate-diversity] scale={:.3} — fixed asymmetric logit bias active.",
            timestamp(), flags.gate_diversity);
    }

    // Track best epoch-average loss across the entire training run.
    let mut best_epoch_loss: f32 = fs::read_to_string(best_meta_path)
        .ok()
        .and_then(|s| s.trim().parse::<f32>().ok())
        .unwrap_or(f32::MAX);
    // Epoch at which the all-time best was recorded — persisted across restarts.
    // Default 0 when file absent: since_best will read total_epochs (correct for fresh runs).
    let mut last_best_epoch: u32 = fs::read_to_string(&best_epoch_path)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    // Previous epoch average for delta computation in EPOCH_SUMMARY.
    let mut prev_avg_loss: f32 = best_epoch_loss;

    let mut total_epochs = if let Ok(c) = fs::read_to_string(meta_path) {
        c.trim().parse::<u32>().unwrap_or(0)
    } else { 0 };

    // Cosine LR: starts high, decays to near-zero over lr_cycle_steps global steps
    let base_lr        = 3e-4_f64;   // reset to known-good; BATCH_SIZE=13 (eff. 52) does not justify 5e-4
    let min_lr         = 2e-5_f64;
    let lr_cycle_steps = 500_usize;

    let mut opt = candle_nn::AdamW::new_lr(varmap.all_vars(), base_lr)?;
    let mut collapse_streak: u32 = 0;
    // WALD-driven early-layer amplification scale — updated each epoch.
    // Severity 0.0 → scale 4×; severity 1.0 → scale 48× (linear interpolation).
    let mut wald_amplify_scale: f64 = 8.0;

    let seq_len     = config.max_seq_len;
    let num_batches = flags.batches_per_epoch;

    // Per-layer grad norm EMA for burst detection. Initialized high (1.0) so early steps
    // don't false-trigger before EMA converges to the per-layer true baseline (~50 steps).
    let mut grad_norm_ema: Vec<f32> = vec![0.0_f32; config.num_layers]; // 0 = uninitialized; bootstrap to first observation
    // Safety circuit: how many TTL freeze events fired per layer this epoch.
    let mut epoch_burst_count: Vec<usize> = vec![0; config.num_layers];

    // Expert dominance tripwire: consecutive epoch count where any expert > 70% routing.
    let mut expert_dominance_streak: Vec<u8> = vec![0u8; config.num_experts];
    // LB ramp: epochs since LB was enabled in this binary run (used for warmup ramp).
    let mut lb_ramp_epoch: usize = 0;
    // MYCELIUM stability counter — reset to 0 on each train_cycle call (restart).
    // Surgery requires this to reach mycelium_stability_threshold before firing.
    // Resetting on restart forces re-stabilisation observation under the new gate,
    // preventing "changed the rule and it immediately fired" optics.
    let mut mycelium_consecutive_hot: usize = 0;
    let mut mycelium_last_hot_layer: Option<usize> = None;

    // Write arch metadata once per train_cycle so the dashboard can display it.
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "ARCH {}L {}H {}E {}CTX {}V",
            config.num_layers, config.hidden_size, config.num_experts,
            config.max_seq_len, config.vocab_size);
    }

    // Self-describing config banner — printed once at binary start so every log file
    // carries its own hyperparameters for SPRIND reviewers and future debugging.
    {
        let ema_window = (1.0 / GRAD_NORM_EMA_ALPHA) as usize;
        let initial_div_w = flags.div_weight_override
            .unwrap_or_else(|| div_loss_weight((total_epochs + 1) as usize));
        let lb_banner = if flags.lb_weight == 0.0 {
            "[lb] disabled — LB gradient will NOT flow this run".to_string()
        } else {
            format!("[lb] active weight={:.3e} ramp_epochs={}", flags.lb_weight, flags.lb_ramp_epochs)
        };
        let div_banner = if let Some(ow) = flags.div_weight_override {
            format!("[divloss] enabled weight={:.2e} (OVERRIDE — schedule bypassed)", ow)
        } else {
            format!("[divloss] enabled weight={:.2e} (decay {:.2e}->{:.2e} epochs {}-{})",
                initial_div_w, DIV_LOSS_WEIGHT_START, DIV_LOSS_WEIGHT_END,
                DIV_DECAY_START_EPOCH, DIV_DECAY_END_EPOCH - 1)
        };
        let banner = format!(
            "[ttlfreeze] enabled\n\
             [ttlfreeze]   ema_alpha={} (effective window ~{} steps)\n\
             [ttlfreeze]   burst_threshold={}x baseline\n\
             [ttlfreeze]   freeze_steps={}\n\
             [ttlfreeze]   max_bursts_per_epoch_per_layer={}\n\
             [ttlfreeze]   ema_init=bootstrap_to_first_observation\n\
             {}\n\
             {}",
            GRAD_NORM_EMA_ALPHA, ema_window,
            BURST_RATIO_THRESHOLD, TTL_FREEZE_GRAD_STEPS, MAX_BURSTS_PER_EPOCH,
            lb_banner, div_banner,
        );
        println!("{}", banner);
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "{}", banner);
        }
    }

    loop {
        let mut total_loss    = 0.0_f32;
        let mut counted_batches = 0u32; // only count non-skipped batches in avg
        total_epochs += 1;
        // Reset per-epoch TTL freeze safety counters at epoch boundary.
        epoch_burst_count.iter_mut().for_each(|c| *c = 0);
        let mut clipped_steps = 0u32;
        let mut skipped_steps = 0u32;
        // Mycelium epoch telemetry accumulators
        let mut last_tlight_states: Vec<String> = vec![String::new(); config.num_layers];
        let mut epoch_layer_norm_acc: Vec<f32>  = vec![0.0; config.num_layers + 2]; // +2: embed, lm_head
        let mut epoch_layer_norm_count: usize   = 0;
        // Cache the most recently computed per-layer norms so the GRAD log (which fires
        // every 10 batches) can emit real values even on non-step batches.
        let mut last_layer_norms: Vec<f32> = vec![0.0_f32; config.num_layers + 2]; // +2: embed, lm_head
        let mut last_norm: f32 = 0.0_f32;
        // Per-epoch routing accumulator for expert dominance tripwire.
        let mut epoch_route_acc: Vec<f32>  = vec![0.0; config.num_experts];
        let mut epoch_route_count: usize   = 0;
        // Per-epoch entropy accumulator for evolution symmetry-break detection.
        let mut epoch_entr_sum: f32  = 0.0;
        let mut epoch_entr_count: usize = 0;
        // Effective LB weight this epoch, applying ramp when re-enabling from disabled.
        if flags.lb_weight > 0.0 { lb_ramp_epoch += 1; }
        let effective_lb = if flags.lb_weight == 0.0 {
            0.0_f64
        } else if lb_ramp_epoch <= flags.lb_ramp_epochs {
            flags.lb_weight * (0.1 + 0.9 * (lb_ramp_epoch - 1) as f64
                / flags.lb_ramp_epochs.max(1) as f64)
        } else {
            flags.lb_weight
        };
        // Cascade evidence: rolling 10-step L0-L3 history, forward checks, and resolved results.
        let mut l0l3_history: std::collections::VecDeque<[f32; 4]> = std::collections::VecDeque::with_capacity(11);
        // (fire_step, check_step=fire+30, layer_idx, pre_L0L3_avg)
        let mut pending_cascade: Vec<(usize, usize, usize, [f32; 4])> = Vec::new();
        // (layer_idx, fire_step, pre_L0L3_avg, post_L0L3)
        let mut cascade_results: Vec<(usize, usize, [f32; 4], [f32; 4])> = Vec::new();

        let mut log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok();

        let epoch_start = Instant::now();
        let mut accum_grads: Option<GradStore> = None;
        let mut accum_exploded = false;
        // Snapshot the trainable vars once per epoch (stable within the batch loop;
        // surgery only mutates the set between epochs). Used to fold per-micro-batch
        // gradients into the accumulator without holding multiple forward graphs.
        let epoch_vars = varmap.all_vars();

        for batch_idx in 0..num_batches {
            let batch_start = Instant::now();

            let lr = cosine_lr(base_lr, min_lr, *global_step % lr_cycle_steps, lr_cycle_steps);
            opt.set_learning_rate(lr);

            let batch_size = flags.batch_size;
            let mut input_rows: Vec<Tensor> = Vec::with_capacity(batch_size);
            let mut target_rows: Vec<Tensor> = Vec::with_capacity(batch_size);
            for _ in 0..batch_size {
                let start = rand::random::<usize>() % (tokens.len() - seq_len - 1);
                input_rows.push(Tensor::new(&tokens[start..start + seq_len], device)?
                    .to_dtype(DType::U32)?);
                target_rows.push(Tensor::new(&tokens[start + 1..start + seq_len + 1], device)?
                    .to_dtype(DType::U32)?);
            }
            let input_tensor = Tensor::stack(&input_rows, 0)?;   // [BATCH_SIZE, seq_len]
            let target_tensor = Tensor::stack(&target_rows, 0)?; // [BATCH_SIZE, seq_len]

            // Gate div computation to optimizer-step batches only — avoids running all
            // 12 experts on every batch (144 extra forward passes × GRAD_ACCUM_STEPS = 4×).
            // Also skip entirely once div weight decays to zero (epoch >= DIV_DECAY_END_EPOCH).
            let is_step_batch = (batch_idx + 1) % GRAD_ACCUM_STEPS == 0
                || batch_idx + 1 == num_batches;
            set_div_enabled(is_step_batch && div_loss_weight(total_epochs as usize) > 0.0);

            clear_entropy_capture();
            clear_lb_capture();
            clear_tlight_capture();
            clear_div_capture();
            let logits      = model.forward(&input_tensor)?;
            let logits      = logits.reshape((batch_size * seq_len, config.vocab_size))?;
            let target_flat = target_tensor.flatten_all()?;
            let ce_loss     = loss::cross_entropy(&logits, &target_flat)?;

            // ── Auxiliary losses ──────────────────────────────────────────────
            // L1 is gated on loss < 8.0 — applying to a collapsed model makes recovery harder.
            // LB: controlled by --lb-weight/--lb-disable flags (effective_lb=0 skips gradient).
            let _aux_active     = false; // L1 disabled to save graph memory
            let _l1_lambda      = 0.0_f64;
            let _entropy_lambda = 0.0_f64;

            // Drain both thread-locals regardless — keeps accumulators clean next batch.
            let entropy_term   = take_entropy_capture();
            let lb_term        = take_lb_capture();

            // entropy_scalar/lb_scalar are diagnostic-only (ENTR/LB log lines below) and
            // each .to_scalar() forces a blocking GPU sync. They're only ever read on log
            // batches (same condition as the write site further down) — skip the sync on
            // every other batch instead of paying the stall for a value nobody reads.
            let is_log_batch = batch_idx % 10 == 0 || batch_idx == 5;
            let entropy_scalar = if is_log_batch {
                entropy_term.as_ref().and_then(|t| t.to_scalar::<f32>().ok()).unwrap_or(0.0)
            } else {
                0.0
            };
            let lb_scalar = if is_log_batch {
                lb_term.as_ref().and_then(|t| t.to_scalar::<f32>().ok()).unwrap_or(0.0)
            } else {
                0.0
            };

            let mut batch_loss = ce_loss.clone();

            // LB loss: gated on effective_lb > 0. When LB is disabled (--lb-disable),
            // lb_term is drained but not added to batch_loss — no gradient flows.
            if effective_lb > 0.0 {
                if let Some(lb) = lb_term {
                    batch_loss = (&batch_loss + (lb * effective_lb)?)?;
                }
            }

            // Divergence loss: always active while weight > 0. Continuous output-space force.
            // Minimizes neg-variance of L2-normalized expert outputs → maximizes diversity.
            let cur_div_weight = flags.div_weight_override
                .unwrap_or_else(|| div_loss_weight(total_epochs as usize));
            let div_log_vals     = take_div_log_capture();      // per-layer ternary output variance
            let div_f32_log_vals = take_div_f32_log_capture(); // per-layer F32 shadow weight variance
            if cur_div_weight > 0.0 {
                if let Some(div_term) = take_div_capture() {
                    // div_term is sum of neg-variance across layers; normalize by num_layers.
                    let div_scaled = (div_term * (cur_div_weight / config.num_layers as f64))?;
                    batch_loss = (&batch_loss + div_scaled)?;
                }
            } else {
                take_div_capture(); // drain even when weight=0 to keep accumulators clean
            }

            // ── Backward pass ─────────────────────────────────────────────────
            // We backward immediately into a thread-local GradStore or an
            // accumulator. Backwarding per micro-batch frees each forward graph right
            // away — peak memory stays at ONE graph instead of N. (The old approach
            // summed loss *tensors* and held all N dual-stream graphs at once, which
            // OOM'd the moment the whole body started training.) Skip backward for an
            // exploded micro-batch; the window is discarded at the step boundary.
            let mut scaled_node = None;
            if !accum_exploded {
                let scaled = (batch_loss.clone() * (1.0 / GRAD_ACCUM_STEPS as f64))?;
                let g = scaled.backward()?;
                accumulate_grads(&mut accum_grads, g, &epoch_vars)?;
                scaled_node = Some(scaled);
            }

            // Sync real_loss only AFTER backward to avoid blocking the GPU pipeline.
            let real_loss = ce_loss.to_scalar::<f32>().unwrap_or(f32::MAX);

            // Flag explosion — will flush and skip the whole accumulation window.
            if real_loss.is_nan() || real_loss.is_infinite() || real_loss > LOSS_EXPLOSION_THRESHOLD {
                accum_exploded = true;
                let crit = format!("[CRITICAL] loss={:.4} > {:.1} at step={} — explosion, skipping accumulation window",
                    real_loss, LOSS_EXPLOSION_THRESHOLD, *global_step);
                println!("[{}] {}", timestamp(), crit);
                if let Some(ref mut f) = log_file {
                    let _ = writeln!(f, "{}", crit);
                }
            }

            total_loss      += real_loss;
            counted_batches += 1;
            wald.record_batch(real_loss);

            // Default: empty norms for non-step batches (used in GRAD log below).
            let mut layer_norms = vec![0.0_f32; config.num_layers];
            let mut norm = 0.0_f32;
            let mut div_grad_vals: Vec<f32> = Vec::new();

            if is_step_batch {
                if accum_exploded {
                    skipped_steps += 1;
                    println!("[{}] [SKIP] Accum window ending batch {} — explosion, preserving weights.",
                        timestamp(), batch_idx);
                    accum_grads    = None;
                    accum_exploded = false;
                    *global_step  += 1;
                    continue;
                }

                // ── Gradient step ─────────────────────────────────────────────
                // backward() + clip + step + cold-layer LR boost, once per GRAD_ACCUM_STEPS.
                if let Some(mut grads) = accum_grads.take() {
                    // grads already hold the summed (mean) gradient over the window —
                    // each micro-batch was backwarded + folded in above.
                    // Capture expert grad variance before opt.step() consumes grads.
                    if is_step_batch && cur_div_weight > 0.0 {
                        div_grad_vals = expert_grad_variance(&varmap, &grads, config.num_layers, config.num_experts);
                        // WD ratio diagnostic: mean expert grad norm vs weight-decay pull.
                        // AdamW default wd=0.01. ratio < 1.0 = wd dominates → DIVF32 cannot grow.
                        let wd_ratios = expert_wd_ratio(&varmap, &grads, config.num_layers, config.num_experts, 0.01);
                        if let Some(ref mut f) = log_file {
                            let wd_str: Vec<String> = wd_ratios.iter()
                                .map(|(g, w, r)| format!("{:.2e}/{:.2e}/{:.2}", g, w, r))
                                .collect();
                            let _ = writeln!(f, "DIVWD step={} grad/wdequiv/ratio={}", *global_step, wd_str.join(","));
                        }
                    }
                    norm = global_grad_norm(&varmap, &grads);
                    layer_norms = per_layer_grad_norm(&varmap, &grads, config.num_layers);
                    last_norm = norm;
                    last_layer_norms.clone_from(&layer_norms);
                    for (i, &n) in layer_norms.iter().enumerate() {
                        if i < epoch_layer_norm_acc.len() { epoch_layer_norm_acc[i] += n; }
                    }
                    epoch_layer_norm_count += 1;

                    // Update rolling L0-L3 history and resolve any pending cascade checks.
                    if layer_norms.len() >= 4 {
                        let snap: [f32; 4] = [layer_norms[0], layer_norms[1], layer_norms[2], layer_norms[3]];
                        l0l3_history.push_back(snap);
                        if l0l3_history.len() > 10 { l0l3_history.pop_front(); }
                        let gs = *global_step;
                        pending_cascade.retain(|&(fs, cs, li, pre)| {
                            if gs >= cs {
                                cascade_results.push((li, fs, pre, snap));
                                false
                            } else {
                                true
                            }
                        });
                    }

                    // TTL burst detection — per-layer grad norm vs EMA baseline.
                    // When ratio > BURST_RATIO_THRESHOLD, freeze that layer's TTL logit modifiers
                    // for TTL_FREEZE_GRAD_STEPS optimizer steps so gate can learn without correction.
                    // Only iterate over transformer blocks — embed/lm_head (indices 18,19) have no TTL.
                    for (i, &n) in layer_norms.iter().take(config.num_layers).enumerate() {
                        if n > 0.0 {
                            if grad_norm_ema[i] == 0.0 {
                                // Bootstrap: first real observation sets the baseline, no burst check.
                                grad_norm_ema[i] = n;
                            } else {
                                let baseline = grad_norm_ema[i];
                                let ratio = n / baseline.max(1e-12);
                                if ratio > BURST_RATIO_THRESHOLD && epoch_burst_count[i] < MAX_BURSTS_PER_EPOCH {
                                    epoch_burst_count[i] += 1;
                                    let freeze_update_steps = TTL_FREEZE_GRAD_STEPS * GRAD_ACCUM_STEPS;
                                    model.freeze_ttl_layer(i, freeze_update_steps);
                                    let freeze_end_step = *global_step + TTL_FREEZE_GRAD_STEPS;
                                    // Schedule cascade evidence capture at burst+30.
                                    let pre_l0l3: [f32; 4] = {
                                        let hn = l0l3_history.len() as f32;
                                        if hn == 0.0 { [0.0; 4] } else {
                                            let mut avg = [0.0f32; 4];
                                            for h in &l0l3_history { for j in 0..4 { avg[j] += h[j] / hn; } }
                                            avg
                                        }
                                    };
                                    pending_cascade.push((*global_step, *global_step + 30, i, pre_l0l3));
                                    println!("[{}] TTLFREEZE layer={} step={} grad={:.2e} base={:.2e} ratio={:.1} lr={:.2e} freeze_end={} fires_this_epoch={}",
                                        timestamp(), i, *global_step, n, baseline, ratio, lr, freeze_end_step, epoch_burst_count[i]);
                                    if let Some(ref mut f) = log_file {
                                        let _ = writeln!(f, "TTLFREEZE step={} layer={} grad={:.6} baseline={:.6} ratio={:.2} lr={:.2e} freeze_end={}",
                                            *global_step, i, n, baseline, ratio, lr, freeze_end_step);
                                    }
                                    if epoch_burst_count[i] >= MAX_BURSTS_PER_EPOCH {
                                        println!("[{}] TTLFREEZE WARN layer={} reached {} fires/epoch — suppressing further freezes this epoch",
                                            timestamp(), i, MAX_BURSTS_PER_EPOCH);
                                        if let Some(ref mut f) = log_file {
                                            let _ = writeln!(f, "TTLFREEZE WARN step={} layer={} max_bursts_reached={}",
                                                *global_step, i, MAX_BURSTS_PER_EPOCH);
                                        }
                                    }
                                } else if ratio > BURST_RATIO_THRESHOLD {
                                    // Cap already hit — log skipped burst for observability.
                                    println!("[{}] TTLFREEZE SKIP layer={} step={} grad={:.2e} base={:.2e} ratio={:.1} cap={}/epoch",
                                        timestamp(), i, *global_step, n, baseline, ratio, MAX_BURSTS_PER_EPOCH);
                                    if let Some(ref mut f) = log_file {
                                        let _ = writeln!(f, "TTLFREEZE SKIP step={} layer={} grad={:.6} baseline={:.6} ratio={:.2}",
                                            *global_step, i, n, baseline, ratio);
                                    }
                                }
                                // Update EMA after burst check so baseline tracks the normal level.
                                grad_norm_ema[i] = GRAD_NORM_EMA_ALPHA * n + (1.0 - GRAD_NORM_EMA_ALPHA) * baseline;
                            }
                        }
                    }

                    if norm > MAX_GRAD_NORM && norm.is_finite() {
                        clipped_steps += 1;
                        let scale = (MAX_GRAD_NORM / norm) as f64;
                        for var in varmap.all_vars() {
                            if let Some(g) = grads.get(&var) {
                                grads.insert(&var, (g * scale)?);
                            }
                        }
                    }
                    opt.step(&grads)?;

                    // Explicitly synchronize to ensure memory is resolved before next micro-batch.
                    if device.is_cuda() {
                        device.synchronize()?;
                    }

                    // Cold-layer LR boost after Adam — bypasses second-moment normalization.
                    // wald_amplify_scale is updated each epoch from WALD severity (up to 47×).
                    apply_layer_lr_boost(&varmap, &grads, &layer_norms, lr * wald_amplify_scale);
                }
                accum_exploded = false;
            }

            let batch_ms   = batch_start.elapsed().as_millis();
            let elapsed_s  = epoch_start.elapsed().as_secs();
            let remaining_s = if batch_idx > 0 {
                elapsed_s * (num_batches as u64 - batch_idx as u64) / batch_idx as u64
            } else { 0 };

            let log_line = format!("Epoch {} (Global {}), Batch {}: loss = {:.4}",
                config.num_layers, total_epochs, batch_idx, real_loss);

            println!("[{}] Epoch {:>2}L (Global {:>4}) | {:>3}/{} | Loss: {:.4} | LR: {:.2e} | {:>3}ms | ETA {:02}:{:02}",
                timestamp(),
                config.num_layers,
                total_epochs,
                batch_idx + 1,
                num_batches,
                real_loss,
                lr,
                batch_ms,
                remaining_s / 60,
                remaining_s % 60,
            );

            if let Some(ref mut f) = log_file {
                let _ = writeln!(f, "{}", log_line);

                // GRAD — per-layer gradient norm, every 10 batches to keep log readable.
                // Uses last_layer_norms (cached from most recent step batch) so this never
                // emits zeros on non-step batches.
                // Dashboard parses "GRAD step=N n=X.XXXX L=n0,...,n17,embed,lm_head"
                // Skip batch 0 to avoid massive initialization sync spike.
                if (batch_idx % 10 == 0 || batch_idx == 0) && batch_idx > 0 {
                    let ln_str: Vec<String> = last_layer_norms.iter()
                        .map(|n| format!("{:.2e}", n)).collect();
                    let _ = writeln!(f, "GRAD step={} n={:.4} L={}", *global_step, last_norm, ln_str.join(","));
                }

                // GPUMEM — per-step GPU memory (diagnostic for the post-LayerNorm-fix
                // memory creep). Every 4 batches to keep overhead < ~1%. Ramp in `used`
                // = leak; sawtooth drift = fragmentation. Also mirrored to stdout/dashboard.
                if batch_idx % 4 == 0 {
                    if let Some((used, free, total)) = gpu_mem_mb() {
                        let _ = writeln!(f, "GPUMEM step={} used={}MB free={}MB total={}MB", *global_step, used, free, total);
                        println!("[mem] step={} GPU used={}MB free={}MB ({}MB total)", *global_step, used, free, total);
                    }
                }

                // ROUTE — expert routing weights, emitted every 10 batches to keep log lean.
                // Also at batch 5 for early gate-diversity baseline check.
                // Dashboard parses "ROUTE step=N E=w0,w1,...,w11"
                if batch_idx % 10 == 0 || batch_idx == 5 {
                    let routing = take_routing_capture(config.num_experts);
                    // Accumulate for epoch-level expert dominance tripwire.
                    for (e, &w) in routing.iter().enumerate() {
                        if e < epoch_route_acc.len() { epoch_route_acc[e] += w; }
                    }
                    epoch_route_count += 1;
                    let route_str: Vec<String> = routing.iter()
                        .map(|&w| format!("{:.3}", w)).collect();
                    let _ = writeln!(f, "ROUTE step={} E={}", *global_step, route_str.join(","));
                    // ENTR — routing entropy per MoE layer (nats). Max = ln(12) ≈ 2.485.
                    let entr_per_layer = if config.num_layers > 0 {
                        -entropy_scalar / config.num_layers as f32
                    } else { 0.0 };
                    epoch_entr_sum   += entr_per_layer;
                    epoch_entr_count += 1;
                    let _ = writeln!(f, "ENTR step={} avg={:.4}", *global_step, entr_per_layer);
                    // LB — load-balancing loss value. Should decrease as routing diversifies.
                    let _ = writeln!(f, "LB step={} val={:.4}", *global_step, lb_scalar);
                    // TLIGHT — ternary traffic light state per layer.
                    // G=green (underloaded, boosted), O=orange (on-target, partial output),
                    // R=red (overloaded, suppressed). One entry per MoeBlock per step.
                    let tlight_layers = take_tlight_capture();
                    if !tlight_layers.is_empty() {
                        let layer_strs: Vec<String> = tlight_layers.iter().enumerate()
                            .map(|(i, (g, o, r, s))| format!("L{}:{}(G{}/O{}/R{})", i, s, g, o, r))
                            .collect();
                        let _ = writeln!(f, "TLIGHT step={} {}", *global_step, layer_strs.join(" "));
                        // Update mycelium's last-seen tlight per layer for epoch summary.
                        for (i, (_g, _o, _r, s)) in tlight_layers.iter().enumerate() {
                            if i < last_tlight_states.len() {
                                last_tlight_states[i] = s.clone();
                            }
                        }
                    }
                }
                clear_routing_capture();
                clear_cord_captures();

                // CORD — dual-stream telemetry (zero-cost no-op in single-stream mode).
                if config.num_streams >= 2 {
                    let gate_acts = take_cord_gate_capture();
                    let cos_sims  = take_cord_cosim_capture();
                    if !gate_acts.is_empty() || !cos_sims.is_empty() {
                        let gate_str: Vec<String> = gate_acts.iter().map(|&v| format!("{:.3}", v)).collect();
                        let cos_str:  Vec<String> = cos_sims.iter().map(|&v| format!("{:.3}", v)).collect();
                        let _ = writeln!(f, "CORD step={} gate=[{}] cos=[{}]",
                            *global_step, gate_str.join(","), cos_str.join(","));
                    }
                }

                // DIV — per-layer normalized variance of expert outputs. Fires on every
                // optimizer step batch where div was active. 0=collapsed, ~1=diverse.
                // Outside the 10-batch block: batch_idx%10==0 and (batch_idx+1)%4==0
                // are mutually exclusive (gcd=2), so DIV would never fire inside it.
                if !div_log_vals.is_empty() {
                    let div_str: Vec<String> = div_log_vals.iter()
                        .map(|&v| format!("{:.4}", v)).collect();
                    let _ = writeln!(f, "DIV step={} w={:.2e} L={}", *global_step, cur_div_weight, div_str.join(","));
                }
                // DIVF32 — F32 shadow weight variance across experts per layer.
                // H3 diagnostic: if DIVF32 grows while DIV stays flat at 0.0036,
                // F32 weights are diverging but not crossing ternary thresholds.
                // If DIVF32 is also flat, DIV gradient is not flowing at all.
                if !div_f32_log_vals.is_empty() {
                    let f32_str: Vec<String> = div_f32_log_vals.iter()
                        .map(|&v| format!("{:.2e}", v)).collect();
                    let _ = writeln!(f, "DIVF32 step={} L={}", *global_step, f32_str.join(","));
                }
                // DIVGRAD — variance of expert weight gradient norms per layer.
                // Definitive H3 test: non-zero = DIV gradient differentially flowing;
                // all-zero/uniform = gradient not differentiating experts.
                if !div_grad_vals.is_empty() {
                    let grad_str: Vec<String> = div_grad_vals.iter()
                        .map(|&v| format!("{:.2e}", v)).collect();
                    let _ = writeln!(f, "DIVGRAD step={} L={}", *global_step, grad_str.join(","));
                }

                // TELE — sparsity snapshot every 30 batches on GPU (~60s).
                // Skipped on CPU: copying 82M params to Vec<f32> is expensive and can cause
                // swap thrashing on low-RAM machines. Epoch-end emit (below) keeps panels alive.
                // Skip batch 0 to avoid massive initialization sync spike.
                if batch_idx % 30 == 0 && batch_idx > 0 && !matches!(device, Device::Cpu) {
                    emit_telemetry(&varmap, &config, log_path);
                }

                let _ = f.flush();
            }

            // Explicitly drop large tensors to free memory for the next micro-batch.
            // This is critical for 24GB GPUs when activations take up ~10-12GB.
            drop(ce_loss);
            drop(batch_loss);
            drop(scaled_node);
            drop(logits);
            drop(input_tensor);
            drop(target_tensor);

            *global_step += 1;
        }

        let avg_loss = if counted_batches > 0 {
            total_loss / counted_batches as f32
        } else {
            f32::MAX
        };

        let epoch_s = epoch_start.elapsed().as_secs();
        let summary = format!(
            "=== Epoch {}L done | Avg Loss: {:.4} | Clipped: {} | Skipped: {} | {:02}:{:02} elapsed ===",
            config.num_layers, avg_loss, clipped_steps, skipped_steps, epoch_s / 60, epoch_s % 60
        );
        println!("[{}] {}", timestamp(), summary);

        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "{}", summary);
        }

        evolution_manager.add_loss(avg_loss);
        if epoch_entr_count > 0 {
            let epoch_avg_entr = epoch_entr_sum / epoch_entr_count as f32;
            evolution_manager.record_routing_entropy(epoch_avg_entr, config.num_experts);
        }

        // ── LB status log + expert dominance tripwire ─────────────────────────
        {
            let lb_line = if flags.lb_weight == 0.0 {
                format!("[lb] disabled epoch={}", total_epochs)
            } else {
                format!("[lb] active weight={:.3e} epoch={}", effective_lb, total_epochs)
            };
            println!("[{}] {}", timestamp(), lb_line);
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                let _ = writeln!(f, "{}", lb_line);
            }

            if epoch_route_count > 0 {
                let avg_routes: Vec<f32> = epoch_route_acc.iter()
                    .map(|&s| s / epoch_route_count as f32)
                    .collect();
                for (e, &avg_r) in avg_routes.iter().enumerate() {
                    if avg_r > 0.70 {
                        expert_dominance_streak[e] = expert_dominance_streak[e].saturating_add(1);
                        if expert_dominance_streak[e] >= 3 {
                            let warn = format!(
                                "[lb] WARNING: Expert {} dominated routing {:.1}% for {} consecutive epochs — collapse risk",
                                e, avg_r * 100.0, expert_dominance_streak[e]
                            );
                            println!("[{}] {}", timestamp(), warn);
                            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                                let _ = writeln!(f, "{}", warn);
                            }
                        }
                    } else {
                        expert_dominance_streak[e] = 0;
                    }
                }
            }
        }

        // ── Mycelium epoch recording ──────────────────────────────────────────
        let epoch_layer_norms: Vec<f32> = epoch_layer_norm_acc.iter()
            .map(|&s| if epoch_layer_norm_count > 0 { s / epoch_layer_norm_count as f32 } else { 0.0 })
            .collect();
        mycelium.record_epoch(&last_tlight_states, &epoch_layer_norms);
        // Substance axis (per-layer, per-expert mean |weight|) for vestigial detection.
        let le_mass = per_layer_expert_abs_weight(&varmap, config.num_layers, config.num_experts);
        mycelium.record_substance(&le_mass);
        let report = mycelium.generate_report();
        // Track consecutive epochs where the same layer holds the hot position.
        // This is the MYCELIUM stability signal used by the surgery gate.
        if mycelium_last_hot_layer == Some(report.hottest_layer) {
            mycelium_consecutive_hot += 1;
        } else {
            mycelium_consecutive_hot = 1; // reset; count the current epoch
            mycelium_last_hot_layer = Some(report.hottest_layer);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let pressure_str: Vec<String> = report.layer_pressure.iter()
                .map(|&p| format!("{:.5}", p)).collect();
            let _ = writeln!(f,
                "MYCELIUM epoch={} dead={} vestigial={} blooming={} hot=L{} cold=L{} pressure=[{}] myc_stable={}",
                total_epochs, report.dead_expert_count, report.vestigial_expert_count,
                report.blooming_expert_count,
                report.hottest_layer, report.coldest_layer, pressure_str.join(","),
                mycelium_consecutive_hot);
        }
        // ── Flux health: two-axis ternary liveness (observational only) ───────
        // Composes weight-mass (substance) x routing-mass (flow) to catch
        // "vestigial" experts — still routed but weight-starved — that the
        // single-axis TLIGHT dead detector above misses (weight-dead != TLIGHT-dead).
        // Pure telemetry: no weights touched, no resurrection triggered from it, so
        // genuinely dormant slots are left to re-germinate on their own.
        if epoch_route_count > 0 {
            let route_share: Vec<f32> = epoch_route_acc.iter()
                .map(|&s| s / epoch_route_count as f32)
                .collect();
            let weight_mass = per_expert_abs_weight(&varmap, config.num_experts);
            let flux = moe_llm_core::mycelium::classify_flux(&weight_mass, &route_share);
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                let _ = writeln!(f, "{}", flux.log_line(total_epochs as usize));
            }
        }

        if !report.resurrections.is_empty() {
            println!("[{}] MYCELIUM: {} dead expert(s) detected — performing resurrection.",
                timestamp(), report.resurrections.len());
            let _ = perform_resurrection(checkpoint_path, &report.resurrections, device);
            // Reload resurrected weights into the live model.
            if let Ok(n) = load_checkpoint(&varmap, checkpoint_path, device) {
                println!("[{}] MYCELIUM: Reloaded {} tensors after resurrection.", timestamp(), n);
            }
        }

        // ── Wald: loss-space coverage analysis ───────────────────────────────
        let wald_report = wald.end_epoch();
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "{}", format_wald_line(total_epochs as usize, *global_step, &wald_report));
        }
        // WALD feedback → early-layer gradient amplification.
        // When the dead zone is structural (stale N+ epochs) amplification stops
        // helping — drop scale to 1.0 (neutral) to avoid over-boosting a plateau.
        // Re-arms automatically when loss shifts enough to reset stale_count.
        let severity = wald_report.low_gap_severity();
        if wald_report.stale {
            wald_amplify_scale = 1.0;
            println!(
                "[{}] WALD: structural plateau ({} stable epochs, sev={:.3} mass={:.3}) \
                 → amplify OFF",
                timestamp(), wald_report.stale_count, severity, wald_report.mass_center,
            );
        } else if severity > 0.15 {
            let t = ((severity - 0.15) / 0.85).min(1.0) as f64;
            wald_amplify_scale = 8.0 + t * 40.0;
            if let Some(ref zone) = wald_report.dead_low {
                println!(
                    "[{}] WALD: dead_low={:.2}–{:.2} severity={:.3} → early-layer scale={:.1}×  \
                     (fill={:.1}% mass={:.3})",
                    timestamp(), zone.lo, zone.hi, severity, wald_amplify_scale,
                    wald_report.fill_pct, wald_report.mass_center,
                );
            }
        } else {
            wald_amplify_scale = 4.0;
            println!("[{}] WALD: no significant dead zone — early-layer scale={:.1}×", timestamp(), wald_amplify_scale);
        }

        // ── Checkpoint (always save latest) ──────────────────────────────────
        save_checkpoint(&varmap, checkpoint_path)?;
        // Atomic serving snapshot — write to .tmp then rename so albert_serve
        // never reads a partially-written file while training writes.
        {
            let serving_path = format!("{r}/models/albert_v3.0_serving.safetensors");
            let serving_tmp  = format!("{r}/models/albert_v3.0_serving.safetensors.tmp");
            if let Err(e) = fs::copy(checkpoint_path, &serving_tmp)
                .and_then(|_| fs::rename(&serving_tmp, &serving_path))
            {
                eprintln!("[serve-snapshot] Warning: atomic serving snapshot failed: {e}");
            }
        }
        fs::write(meta_path, total_epochs.to_string())?;
        evolution_manager.save_state(evo_path);

        // ── Best Checkpoint (save only when avg_loss improves) — LLB §11.6 ───
        if avg_loss < best_epoch_loss {
            let improvement = best_epoch_loss - avg_loss; // nats gained vs previous ATL
            best_epoch_loss = avg_loss;
            last_best_epoch = total_epochs;
            save_checkpoint(&varmap, best_path)?;
            fs::write(best_meta_path, avg_loss.to_string())?;
            fs::write(&best_epoch_path, total_epochs.to_string())?;

            // ── Natural selection, brick 1: credit the experts that carried this
            //    all-time-best epoch. Purely observational — no weight, optimizer,
            //    or gate state is touched here; this only populates the scorekeeper
            //    that Brick 2's (default-OFF) post-surgery nudge later reads.
            if epoch_route_count > 0 {
                let route_share: Vec<f32> = epoch_route_acc.iter()
                    .map(|&s| s / epoch_route_count as f32)
                    .collect();
                evolution_manager.record_atl_credit(&route_share, improvement);
                evolution_manager.save_state(evo_path); // persist credit immediately
                let cred = evolution_manager.atl_credit_telemetry();
                println!("[{}] ★ New best epoch loss: {:.4} (Δ{:.4}) — best saved. {}",
                    timestamp(), avg_loss, improvement, cred);
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                    let _ = writeln!(f, "ATL_BEST epoch={} loss={:.4} improvement={:.4} {}",
                        total_epochs, avg_loss, improvement, cred);
                }
            } else {
                println!("[{}] ★ New best epoch loss: {:.4} — best checkpoint saved.", timestamp(), avg_loss);
            }
        }

        // ── Spore ingestion — scan albert-spores for new collaborator checkpoints ─
        {
            let arch = (config.num_layers, config.hidden_size, config.num_experts, config.vocab_size);
            let candidates = spore_manager.scan_pending(best_epoch_loss);
            if !candidates.is_empty() {
                println!("[{}] [spore] {} candidate(s) found — blending into colony.",
                    timestamp(), candidates.len());
                for candidate in candidates {
                    match spore_manager.ingest(&varmap, device, candidate, arch) {
                        Ok(log_line) => {
                            println!("[{}] [spore] {}", timestamp(), log_line);
                            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                                let _ = writeln!(f, "{}", log_line);
                            }
                            // Persist blended weights immediately.
                            if let Err(e) = save_checkpoint(&varmap, checkpoint_path) {
                                eprintln!("[spore] Warning: checkpoint re-save failed: {e}");
                            }
                        }
                        Err(e) => eprintln!("[{}] [spore] Ingestion failed: {e}", timestamp()),
                    }
                }
            }
        }

        // ── Milestone stop: exit cleanly when a --stop-at-epoch target is reached ──────
        if let Some(stop_at) = flags.stop_at_epoch {
            if total_epochs >= stop_at {
                println!("[{}] Reached epoch {} milestone — checkpoint saved, exiting cleanly.",
                    timestamp(), total_epochs);
                println!("[{}] Restart albert-train (without --stop-at-epoch) to continue.", timestamp());
                if let Some(ref mut f) = log_file { let _ = f.flush(); }
                std::process::exit(0);
            }
        }

        // ── Hot-swap: file-triggered binary reload (safe — checkpoint already written) ──
        // Workflow: cargo build --release && touch models/.hot_reload
        // At the next epoch boundary the process flushes, exec()s the new binary,
        // which loads the fresh checkpoint and continues training from ep N+1.
        let hot_reload_trigger = format!("{}/models/.hot_reload", flags.root);
        if std::path::Path::new(&hot_reload_trigger).exists() {
            let _ = std::fs::remove_file(&hot_reload_trigger);
            println!("[{}] [HOT-SWAP] trigger detected — checkpoint fresh, launching new binary",
                timestamp());
            if let Some(ref mut f) = log_file { let _ = f.flush(); }
            drop(log_file.take()); // close log fd before exec
            let exe = std::env::current_exe().expect("hot-swap: current_exe");
            let args: Vec<String> = std::env::args().skip(1).collect();
            // exec() replaces the process image — only returns on failure
            eprintln!("[HOT-SWAP] exec failed: {:?}",
                std::process::Command::new(&exe).args(&args).exec());
            std::process::exit(1);
        }

        // ── Epoch summary (8-line pitch table row) ───────────────────────────
        {
            let ttlfreeze_total: usize = epoch_burst_count.iter().sum();
            let ttlfreeze_layers: Vec<String> = epoch_burst_count.iter().enumerate()
                .filter(|(_, c)| **c > 0)
                .map(|(i, c)| format!("L{}x{}", i, c))
                .collect();
            let freeze_str = if ttlfreeze_layers.is_empty() {
                "none".to_string()
            } else {
                ttlfreeze_layers.join(",")
            };
            let l03_pressure: Vec<String> = epoch_layer_norms.iter().take(4)
                .map(|&p| format!("{:.2e}", p)).collect();
            let since_best = total_epochs.saturating_sub(last_best_epoch);
            let summary_line = format!(
                "EPOCH_SUMMARY epoch={} loss_avg={:.4} (d{:+.4}) loss_best={:.4} since_best={} \
                 wald_sev={:.3} wald_fill={:.1}% \
                 ttlfreeze={} ({}) \
                 myc_L0-L3=[{}] hot=L{} cold=L{} tns={}",
                total_epochs, avg_loss, avg_loss - prev_avg_loss, best_epoch_loss, since_best,
                wald_report.low_gap_severity(), wald_report.fill_pct,
                ttlfreeze_total, freeze_str,
                l03_pressure.join("/"),
                report.hottest_layer, report.coldest_layer, num_tensors,
            );
            println!("[{}] {}", timestamp(), summary_line);
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                let _ = writeln!(f, "{}", summary_line);
            }
            // Compact epoch history — append-only across restarts; dashboard reads this
            // on startup to pre-seed epochLog for SMA-55/144/377/610 without needing
            // the full (large) training.log in the initial fetch window.
            let epoch_hist_path = log_path.replace("training.log", "epoch_history.log");
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&epoch_hist_path) {
                let _ = writeln!(f, "{}", summary_line);
            }
            prev_avg_loss = avg_loss;

            // Cascade evidence: L0-L3 avg norm at burst-10 vs burst+30, grouped by layer.
            if !cascade_results.is_empty() {
                let mut by_layer: std::collections::HashMap<usize, Vec<([f32; 4], [f32; 4])>> = std::collections::HashMap::new();
                for &(li, _fs, pre, post) in &cascade_results {
                    by_layer.entry(li).or_default().push((pre, post));
                }
                let mut layers_sorted: Vec<usize> = by_layer.keys().cloned().collect();
                layers_sorted.sort();
                for li in layers_sorted {
                    let events = &by_layer[&li];
                    let n = events.len() as f32;
                    let mut pre_avg = [0.0f32; 4];
                    let mut post_avg = [0.0f32; 4];
                    for (pre, post) in events {
                        for j in 0..4 { pre_avg[j] += pre[j] / n; post_avg[j] += post[j] / n; }
                    }
                    let pre_mean: f32 = pre_avg.iter().sum::<f32>() / 4.0;
                    let post_mean: f32 = post_avg.iter().sum::<f32>() / 4.0;
                    let pct = if pre_mean > 1e-12 { (post_mean / pre_mean - 1.0) * 100.0 } else { 0.0 };
                    let cascade_line = format!(
                        "TTLFREEZE CASCADE layer=L{} events={} L0-L3_pre={:.2e} post={:.2e} ({:+.0}%)",
                        li, events.len(), pre_mean, post_mean, pct
                    );
                    println!("[{}] {}", timestamp(), cascade_line);
                    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                        let _ = writeln!(f, "{}", cascade_line);
                    }
                }
            }
        }

        // Emit telemetry for the dashboard neural viz panels.
        emit_telemetry(&varmap, &config, log_path);

        // Write training_telemetry.json for the public /benchmarks/training API endpoint.
        // The KPI workflow uploads this file to the Fly.io volume every sync cycle.
        let telem_json = serde_json::json!({
            "model": "albert-moe-13",
            "version": "v2.0.0",
            "timestamp": timestamp(),
            "architecture": {
                "layers": config.num_layers,
                "hidden": config.hidden_size,
                "experts": config.num_experts,
                "ctx": config.max_seq_len,
                "vocab": config.vocab_size
            },
            "training": {
                "global_epoch": total_epochs,
                "avg_loss": avg_loss,
                "best_loss": best_epoch_loss,
                "clipped_steps": clipped_steps,
                "skipped_steps": skipped_steps
            }
        });
        let _ = fs::write("dashboard/training_telemetry.json", telem_json.to_string());

        // ── Collapse Detection & Rollback ─────────────────────────────────────
        // A post-surgery layer can destabilise the model — avg loss locks at
        // ln(vocab) ≈ 8.987 (uniform distribution). Detect 3 consecutive such
        // epochs and roll back to the best checkpoint before triggering surgery.
        if avg_loss > COLLAPSE_THRESHOLD {
            collapse_streak += 1;
            println!("[{}] ⚠ Collapse streak {}/{}: avg loss {:.4} above threshold {:.1}",
                timestamp(), collapse_streak, COLLAPSE_STREAK_LIMIT, avg_loss, COLLAPSE_THRESHOLD);

            if collapse_streak >= COLLAPSE_STREAK_LIMIT {
                // If no usable best checkpoint exists, or its recorded loss is also
                // above threshold, rolling back won't help — force surgery now.
                let best_exists = std::path::Path::new(best_path).exists();
                let best_recorded: f32 = fs::read_to_string(best_meta_path)
                    .ok().and_then(|s| s.trim().parse().ok())
                    .unwrap_or(f32::MAX);
                if !best_exists || best_recorded >= COLLAPSE_THRESHOLD {
                    // Max-layers guard: forced surgery must respect the layer cap,
                    // same as the normal should_evolve path.
                    if config.num_layers >= evolution_manager.max_layers {
                        println!("[{}] COLLAPSE→SURGERY suppressed: already at max_layers={} — \
                            continuing at current depth.", timestamp(), evolution_manager.max_layers);
                        collapse_streak = 0;
                        evolution_manager.reset_history();
                        continue;
                    }
                    println!("[{}] ★ COLLAPSE→SURGERY: best checkpoint ({:.4}) also above threshold \
                        — rolling back won't recover. Forcing layer surgery.",
                        timestamp(), best_recorded);
                    collapse_streak = 0;
                    // Return true to trigger surgery in the outer loop.
                    return Ok(true);
                }

                let rollback_src = if std::path::Path::new(best_path).exists() {
                    best_path
                } else {
                    checkpoint_path
                };
                let msg = format!("COLLAPSE_ROLLBACK streak={} avg={:.4} src={}",
                    collapse_streak, avg_loss, rollback_src);
                println!("[{}] ★ {}", timestamp(), msg);
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                    let _ = writeln!(f, "{}", msg);
                }

                // Restore best weights.
                if let Ok(n) = load_checkpoint(&varmap, rollback_src, device) {
                    println!("[{}] Rolled back {} tensors from {}.", timestamp(), n, rollback_src);
                }
                // Fresh optimizer — AdamW momentum is stale/corrupted after collapse.
                opt = candle_nn::AdamW::new_lr(varmap.all_vars(), base_lr)?;
                wald_amplify_scale = 8.0; // fresh optimizer — reset to strong default

                collapse_streak = 0;
                evolution_manager.reset_history(); // don't immediately re-trigger surgery
                continue; // skip should_evolve this epoch — give the model a clean epoch
            }
        } else {
            collapse_streak = 0; // healthy epoch resets the streak
        }

        // Authoritative gate telemetry — emit the REAL plateau-gate state every epoch
        // so the dashboard renders truth instead of a stale client-side estimate.
        {
            let (g_delta, g_thresh, g_win, g_filled) = evolution_manager.gate_telemetry();
            let g_delta_str = if g_delta.is_nan() { "nan".to_string() } else { format!("{:.4}", g_delta) };
            let gate_line = format!(
                "GATE epoch={} smoothed_delta={} threshold={:.4} window={} filled={} \
                 myc_stable={} myc_thresh={}",
                total_epochs, g_delta_str, g_thresh, g_win, g_filled,
                mycelium_consecutive_hot, evolution_manager.mycelium_stability_threshold,
            );
            println!("[{}] {}", timestamp(), gate_line);
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
                let _ = writeln!(f, "{}", gate_line);
            }
        }

        evolution_manager.check_generation_timeout();
        if evolution_manager.should_evolve(config.num_layers, mycelium_consecutive_hot) {
            evolution_manager.reset_history();
            return Ok(true);
        }
    }
}

/// Stage-aware corpus loader. Loads all data/corpus/stage_N/ dirs where N ≤ num_layers.
/// Each surgery increments num_layers, automatically unlocking richer data.
///
/// Stage plan:
///   stage_3  — Bible + Alice          (grammar, vocab, basic syntax)
///   stage_6  — Gutenberg novels       (complex narrative, wider vocabulary)
///   stage_7  — Simple Wikipedia       (factual, diverse topics)
///   stage_9  — qa_instruction.txt     (User:/Albert: instruction format)
///   stage_11 — Linux docs, EU AI Act  (technical/specialized language)
fn load_corpus(tokenizer: &BpeTokenizer, num_layers: usize, root: &str) -> Vec<u32> {
    let corpus_root = format!("{root}/data/corpus");
    let corpus_root = corpus_root.as_str();
    // Tokenize file-by-file so we never hold the full corpus text in RAM.
    // Concatenating 635MB of text before encoding spiked peak RAM to 3-4GB (OOM).
    let mut all_tokens: Vec<u32> = Vec::new();
    let mut stages_loaded: Vec<usize> = Vec::new();

    // Collect all stage_N subdirectories where N ≤ num_layers
    if let Ok(entries) = fs::read_dir(corpus_root) {
        let mut stage_dirs: Vec<(usize, std::path::PathBuf)> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                let n: usize = name.strip_prefix("stage_")?.parse().ok()?;
                Some((n, e.path()))
            })
            .filter(|(n, _)| *n <= num_layers)
            .collect();
        stage_dirs.sort_by_key(|(n, _)| *n);

        for (stage_n, dir) in &stage_dirs {
            if let Ok(files) = fs::read_dir(dir) {
                let mut paths: Vec<_> = files
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map(|x| x == "txt").unwrap_or(false))
                    .map(|e| e.path())
                    .collect();
                paths.sort();
                for path in &paths {
                    match fs::read_to_string(path) {
                        Ok(text) => {
                            println!("[{}] Corpus stage_{}: {} ({} chars)",
                                timestamp(), stage_n, path.file_name().unwrap().to_string_lossy(), text.len());
                            all_tokens.extend(tokenizer.encode(&text));
                        }
                        Err(e) => eprintln!("Warning: could not read {:?}: {}", path, e),
                    }
                }
                stages_loaded.push(*stage_n);
            }
        }
    }

    if all_tokens.is_empty() {
        panic!("No corpus found in {}/stage_N/ dirs for num_layers={}", corpus_root, num_layers);
    }

    println!("[{}] Active corpus stages: {:?} (model depth: {}L)",
        timestamp(), stages_loaded, num_layers);

    // v3.0 additional corpora — multilingual, academic, fulltext, chaos.
    // Loaded unconditionally when present; these dirs don't follow stage_N naming.
    let v3_dirs = ["multilingual", "academic", "fulltext", "chaos"];
    for dir_name in &v3_dirs {
        let dir = std::path::Path::new(corpus_root).join(dir_name);
        if !dir.exists() { continue; }
        let read_dir = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(e) => { eprintln!("Warning: could not read corpus dir {:?}: {}", dir, e); continue; }
        };
        let mut paths: Vec<_> = read_dir
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "txt").unwrap_or(false))
            .map(|e| e.path())
            .collect();
        paths.sort();
        let mut dir_bytes = 0usize;
        for path in &paths {
            match fs::read_to_string(path) {
                Ok(text) => {
                    dir_bytes += text.len();
                    all_tokens.extend(tokenizer.encode(&text));
                }
                Err(e) => eprintln!("Warning: could not read {:?}: {}", path, e),
            }
        }
        if dir_bytes > 0 {
            println!("[{}] Corpus {}: {} files · {:.1}MB",
                timestamp(), dir_name, paths.len(), dir_bytes as f64 / 1_048_576.0);
        }
    }

    all_tokens
}

/// Load tokenized corpus, using a binary cache to skip re-tokenization on restart.
/// Cache is stored as: 4 bytes (num_layers as u32 LE) + N×4 bytes (token ids).
/// Invalidated automatically when any corpus source file is newer than the cache,
/// or when num_layers changes (surgery / new stage unlocked).
fn load_corpus_cached(tokenizer: &BpeTokenizer, num_layers: usize, root: &str) -> Vec<u32> {
    let cache_path = format!("{root}/data/corpus_cache.bin");
    let cache_path = cache_path.as_str();

    // All dirs that contribute to the corpus — used for mtime freshness check.
    let watch_dirs = [
        format!("{root}/data/corpus"),
        format!("{root}/data/multilingual"),
        format!("{root}/data/academic"),
        format!("{root}/data/fulltext"),
        format!("{root}/data/chaos"),
    ];

    let cache_valid = (|| -> Option<bool> {
        let cache_mtime = fs::metadata(cache_path).ok()?.modified().ok()?;
        // Validate stored num_layers header
        let header_bytes = fs::read(cache_path).ok()?;
        if header_bytes.len() < 4 { return Some(false); }
        let stored_layers = u32::from_le_bytes(header_bytes[..4].try_into().ok()?) as usize;
        if stored_layers != num_layers { return Some(false); }
        // Check every corpus file is older than the cache
        for dir in &watch_dirs {
            if let Ok(rd) = fs::read_dir(dir) {
                for entry in rd.flatten() {
                    if let Ok(mtime) = entry.metadata().and_then(|m| m.modified()) {
                        if mtime > cache_mtime { return Some(false); }
                    }
                    // Recurse one level into stage_N subdirs
                    if entry.path().is_dir() {
                        if let Ok(sub) = fs::read_dir(entry.path()) {
                            for f in sub.flatten() {
                                if let Ok(mtime) = f.metadata().and_then(|m| m.modified()) {
                                    if mtime > cache_mtime { return Some(false); }
                                }
                            }
                        }
                    }
                }
            }
        }
        Some(true)
    })().unwrap_or(false);

    if cache_valid {
        if let Ok(bytes) = fs::read(cache_path) {
            if bytes.len() > 4 && bytes.len() % 4 == 0 {
                let tokens: Vec<u32> = bytes[4..].chunks_exact(4)
                    .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
                    .collect();
                println!("[{}] Corpus cache hit — {} tokens loaded instantly (skipped tokenization).",
                    timestamp(), tokens.len());
                return tokens;
            }
        }
        eprintln!("Warning: cache file corrupt, re-tokenizing.");
    }

    let tokens = load_corpus(tokenizer, num_layers, root);

    // Write cache: 4-byte header (num_layers) + token data
    let mut bytes: Vec<u8> = (num_layers as u32).to_le_bytes().to_vec();
    bytes.extend(tokens.iter().flat_map(|&t| t.to_le_bytes()));
    match fs::write(cache_path, &bytes) {
        Ok(_) => println!("[{}] Corpus cache saved to {} ({:.0}MB) — next boot will be instant.",
            timestamp(), cache_path, bytes.len() as f64 / 1_048_576.0),
        Err(e) => eprintln!("Warning: could not write corpus cache: {e}"),
    }

    tokens
}

fn main() -> Result<()> {
    let flags = parse_args();
    let _ = ThreadPoolBuilder::new().num_threads(8).build_global();
    println!("--- ALBERT EVOLUTIONARY ORCHESTRATOR v3.0 (Multilingual · Mandelbrot Surgery · Chaos Protocol) ---");

    // Print flag summary so every log knows what run configuration was used.
    println!("[flags] lb_weight={} lb_ramp={} seed_experts={} break_symmetry={} div_override={}",
        flags.lb_weight,
        flags.lb_ramp_epochs,
        flags.seed_experts,
        flags.break_symmetry,
        flags.div_weight_override.map(|v| format!("{:.2e}", v)).unwrap_or_else(|| "schedule".into()),
    );

    let device = Device::cuda_if_available(0).unwrap_or(Device::Cpu);
    println!("[{}] Device: {}", timestamp(), if matches!(device, Device::Cuda(_)) { "CUDA" } else { "CPU" });
    let r = &flags.root;
    let vocab_path      = format!("{r}/data/vocab_v3.json");
    let config_path     = format!("{r}/models/albert_v3.0.config.json");
    let checkpoint_path = format!("{r}/models/albert_v3.0.safetensors");
    let best_path       = format!("{r}/models/albert_v3.0.best.safetensors");
    let evo_state_path  = format!("{r}/models/albert_v3.0.evolution");
    let vocab_path      = vocab_path.as_str();
    let config_path     = config_path.as_str();
    let checkpoint_path = checkpoint_path.as_str();
    let best_path       = best_path.as_str();
    let evo_state_path  = evo_state_path.as_str();

    // Cord surgery: one-time manual migration from single-stream to dual-stream.
    // Run: albert-train --cord-surgery
    // Then restart normally (without the flag) to begin dual-stream training.
    if flags.cord_surgery {
        perform_cord_surgery(config_path, checkpoint_path, best_path, &device, r)?;
        return Ok(());
    }

    let tokenizer = BpeTokenizer::new(vocab_path);

    let mut global_step = 0_usize;

    let spore_state_path = format!("{r}/models/albert_v3.0.spore_state");
    let spores_dir = if flags.spores_dir == "none" {
        String::new() // disabled
    } else if flags.spores_dir.is_empty() {
        std::env::var("HOME")
            .map(|h| format!("{h}/projects/albert-spores/spores"))
            .unwrap_or_default()
    } else {
        flags.spores_dir.clone()
    };
    let mut spore_manager = SporeManager::new(spores_dir, spore_state_path);

    // Read initial arch from config — layer count sizes MyceliumModule; CTX seeds the
    // evolution manager's threshold table so gates are calibrated from the first epoch.
    let (initial_layers, initial_ctx): (usize, usize) = {
        let cfg: serde_json::Value = fs::read_to_string(config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::Value::Null);
        (
            cfg["num_layers"].as_u64().unwrap_or(3)   as usize,
            cfg["max_seq_len"].as_u64().unwrap_or(256) as usize,
        )
    };
    let mut evolution_manager = EvolutionManager::with_ctx(initial_ctx);
    evolution_manager.calibrate(initial_layers);
    if !evolution_manager.load_state(evo_state_path) {
        println!("[evolution] No saved state — using calibrated defaults (F{}={}L, window={} epochs)",
            evolution_manager.fib_index + 1, evolution_manager.max_layers, evolution_manager.history_len());
    }
    // Apply CTX-level threshold scaling.  Handles two cases:
    //   (a) Same CTX as saved state → refreshes mastery from table, no-op otherwise.
    //   (b) CTX bumped in config.json → scales plateau proportionally, updates mastery/floor.
    evolution_manager.recalibrate_ctx(initial_ctx);
    let mut mycelium = MyceliumModule::new(initial_layers, 12);
    mycelium.set_lb_off_mode(flags.lb_weight == 0.0);
    mycelium.set_vestigial_rescue(flags.vestigial_rescue, flags.vestigial_patience);
    println!("[{}] [mycelium] vestigial-rescue {} (patience={} epochs){}",
        timestamp(),
        if flags.vestigial_rescue { "ON" } else { "OFF (observational)" },
        flags.vestigial_patience,
        if flags.vestigial_rescue { " — stalled routed-but-starved experts are resurrection candidates" } else { "" });
    let mut wald     = WaldModule::new();

    loop {
        // Read current config — layer depth governs corpus selection; num_streams governs
        // whether cord surgery should fire before the next train cycle begins.
        let (num_layers, num_streams, num_experts) = {
            let cfg: Value = fs::read_to_string(config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| json!({}));
            (
                cfg["num_layers"].as_u64().unwrap_or(3) as usize,
                cfg["num_streams"].as_u64().unwrap_or(1) as usize,
                cfg["num_experts"].as_u64().unwrap_or(12) as usize,
            )
        };

        // Autonomous cord surgery: fires when the model has grown deep enough that
        // the width ceiling (256H) limits further improvement. Layer threshold 25 matches
        // the Stage 11 milestone in CORPUS_EXPANSION_ROADMAP.md. The EvolutionManager
        // continues governing depth growth after cord surgery — this is additive, not
        // a replacement for depth surgery.
        if num_streams < 2 && num_layers >= 25 {
            println!("[{}] [CORD] Autonomous trigger: {}L ≥ 25L threshold — width ceiling reached.",
                timestamp(), num_layers);
            perform_cord_surgery(config_path, checkpoint_path, best_path, &device, r)?;
            // Loop continues — next iteration loads the dual-stream model from checkpoint.
            continue;
        }

        let tokens = load_corpus_cached(&tokenizer, num_layers, &flags.root);
        println!("[{}] Total corpus: {} tokens ({}L model, stages ≤{})",
            timestamp(), tokens.len(), num_layers, num_layers);

        let needs_evolution = train_cycle(
            &tokens, &tokenizer, &device, &mut evolution_manager, &mut mycelium, &mut wald,
            &mut global_step, &flags, &mut spore_manager
        )?;
        if needs_evolution {
            // BRICK 2 input: the centered ATL-credit prior (all-zero, → no nudge, when
            // --atl-seed-scale is unset or too few best epochs have accumulated).
            let atl_prior = evolution_manager.atl_credit_prior(num_experts);
            if flags.atl_seed_scale > 0.0 {
                println!("[{}] [atl-seed] scale={:.3} active — {}",
                    timestamp(), flags.atl_seed_scale, evolution_manager.atl_credit_telemetry());
            }
            let surgery_done = perform_surgery(
                config_path, checkpoint_path, best_path, &device, &flags.root,
                &atl_prior, flags.atl_seed_scale,
            )?;
            if !surgery_done {
                // Surgery was safely aborted (architecture mismatch). Do NOT promote the
                // fib target or add a layer — re-enter the loop and keep training unchanged.
                println!("[{}] [surgery] aborted by safety guard — continuing training at current depth.", timestamp());
                continue;
            }
            let post_layers: usize = fs::read_to_string(config_path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v["num_layers"].as_u64())
                .unwrap_or(0) as usize;
            evolution_manager.promote_fib_target(post_layers);
            evolution_manager.save_state(evo_state_path);
            mycelium.on_layer_added();
            wald.on_surgery();
            // Log the MAND event so the dashboard can mark surgery epochs visually.
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open("dashboard/training.log") {
                let mand_line = format_mandelbrot_line(
                    0,  // epoch not tracked at outer-loop scope; MAND line in perform_surgery has the detail
                    global_step as usize,
                    post_layers.saturating_sub(1),
                    0,
                    1e-3, 64,
                );
                let _ = writeln!(f, "{}", mand_line);
            }
            global_step = 0;
            // Corpus reloaded at top of next loop iteration with updated num_layers.
        }
    }
}
