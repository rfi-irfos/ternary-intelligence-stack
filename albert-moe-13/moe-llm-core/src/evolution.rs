// EvolutionManager — Generational Fibonacci cycling for Net2Net layer surgery
//
// Albert's architectural growth follows the Fibonacci sequence — the same mathematical
// structure underlying leaf phyllotaxis, nautilus spirals, and orbital mechanics.
// Each depth milestone earns proportionally longer patience before the next surgery fires:
// a 21-layer model waits 21 epochs; a 144-layer model waits 144.
//
// GENERATIONAL CYCLING — modelled after natural seasons
// -------------------------------------------------------
// Growth is not linear accumulation. It is a spiral: same shape at every scale,
// always higher. Each generation runs a full Fibonacci arc of ARC_LENGTH surgeries
// (Spring → Summer → Autumn → Winter), then DIES and REBIRTHS from a higher base
// with a tighter standard. The model must prove DEEPER stability to earn each new spring.
//
//   Gen 1 (base F₄=13): windows 13→21→34→55→89→144, threshold 0.020
//         ↓ GENERATION_COMPLETE — death + rebirth
//   Gen 2 (base F₅=21): windows 21→34→55→89→144→233, threshold 0.015
//         ↓ GENERATION_COMPLETE
//   Gen 3 (base F₆=34): windows 34→55→89→144→233→377, threshold 0.011
//   ...
//
// fib_index governs window/cooldown and cycles within each generation's arc.
// max_layers is a SEPARATE forward-only ceiling so generational resets never
// cap growth below current depth.
//
// Two surgery triggers:
//   Mastery  — loss drops below mastery_threshold (capacity catastrophically exhausted).
//              Fires immediately; no history window or stability required.
//   Plateau  — loss delta < plateau_threshold over the full Fibonacci window
//              AND MYCELIUM hot-layer stable ≥ mycelium_stability_threshold epochs.
//
// Generation timeout (stuck-generation fallback):
//   After GENERATION_TIMEOUT_MULTIPLIER × final_arc_window epochs without surgery,
//   the generation force-advances (no layer added) to prevent eternal autumn.
//
// Fibonacci sequence extended to 24 terms. No architectural ceiling — the hardware
// is the only limit.
//
// CURRICULUM EXHAUSTION — mastery stops being free once there's nothing left to unlock
// -------------------------------------------------------------------------------------
// Mastery fires the instant loss dips below mastery_threshold, with no window or
// stability check. That is sound while the stage-aware corpus curriculum is still
// unlocking new material at each depth: mastery genuinely means "earned the next
// stage". Once depth has outgrown every stage_N directory (train_bible's main loop
// diffs stage_bounds against known_stages every cycle), more depth on the same fixed
// corpus tends to push loss below mastery_threshold anyway, and the gate rewards that
// as if it were earned growth. set_curriculum_exhausted() lets the caller report that
// state; promote_fib_target() responds by ratcheting mastery_threshold down by
// MASTERY_DECAY (floored at MASTERY_FLOOR) every curriculum-exhausted surgery — growth
// still happens, but gets exponentially harder to justify without new content, instead
// of firing on every mild loss dip. mastery_decay_ratio() exposes how far that ratchet
// has moved, so the training loop can macro-decay its LR schedule in lockstep: without
// that, the cosine warm-restart amplitude never shrinks, and the model can never
// actually settle into a minimum, no matter how long it trains on the same corpus.

use std::collections::VecDeque;
use std::fs;

/// Fibonacci depth milestones. Extended to 24 terms — no coded ceiling.
const FIB_TARGETS: &[usize] = &[
    3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610,
    987, 1597, 2584, 4181, 6765, 10946, 17711, 28657,
    46368, 75025, 121393, 196418,
];

/// Number of surgeries per generation before the cycle resets.
const ARC_LENGTH: usize = 6;

/// Absolute plateau_threshold floor — last-resort backstop if no CTX table entry matches.
const MIN_PLATEAU_THRESHOLD: f32 = 0.004;

/// Multiplicative decay applied to plateau_threshold at each generation boundary.
const THRESHOLD_DECAY: f32 = 0.75;

/// Multiplicative decay applied to mastery_threshold after each surgery that fires
/// while curriculum_exhausted is set — see the CURRICULUM EXHAUSTION note above.
const MASTERY_DECAY: f32 = 0.9;

/// Absolute floor for mastery_threshold — keeps MASTERY_DECAY from ratcheting toward
/// zero over many curriculum-exhausted surgeries in a row.
const MASTERY_FLOOR: f32 = 1.0;

/// CTX-level calibration table.
///
/// Each row: (max_seq_len, mastery_threshold, plateau_threshold_init, min_plateau_threshold).
/// The entry with the largest seq_len ≤ the active CTX is selected.
///
/// Rationale: longer context lowers per-token cross-entropy mechanically (each prediction has
/// more past tokens to condition on), so the same absolute loss value means different things
/// at different CTX widths.  At 128-CTX a loss of 5.0 is genuine mastery; at 512-CTX the
/// model hits 4.0 partly just from having more context.  The table keeps the surgery gate
/// semantics stable across CTX bumps.
///
/// min_plateau_threshold scales down with CTX because longer sequences average over more token
/// positions per batch, reducing the epoch-to-epoch noise floor.
const CTX_LEVEL_TABLE: &[(usize, f32, f32, f32)] = &[
    //  CTX       mastery   plateau_init  min_plateau
    //  ─────── small / current ─────────────────────
    (      64,    6.5,      0.025,        0.012),
    (     128,    5.0,      0.022,        0.010),
    (     256,    4.5,      0.020,        0.008),  // ← live today
    (     512,    4.0,      0.018,        0.007),
    (    1024,    3.5,      0.016,        0.006),
    (    2048,    3.0,      0.014,        0.005),
    (    4096,    2.5,      0.012,        0.004),
    //  ─────── long-context ────────────────────────
    //  Each doubling gains ~0.3 nats mastery but gains shrink as model capacity
    //  (not context) becomes the binding constraint for a 256H model.
    //  min_plateau keeps falling: more positions per batch → lower noise floor.
    (    8192,    2.2,      0.011,        0.004),
    (   16384,    2.0,      0.010,        0.003),
    (   32768,    1.8,      0.009,        0.003),
    (   65536,    1.6,      0.008,        0.002),
    (  131072,    1.5,      0.007,        0.002),
    (  262144,    1.4,      0.006,        0.002),
    (  524288,    1.3,      0.005,        0.001),
    ( 1048576,    1.2,      0.005,        0.001),  // ← 1M ctx end-goal
];

/// After this multiple of the final arc window elapses with no surgery, force-advance the
/// generation without adding a layer (prevents eternal autumn).
const GENERATION_TIMEOUT_MULTIPLIER: usize = 3;

// ── Natural-selection scorekeeper (per-expert ATL credit) ───────────────────
// Albert already has mutation (AdamW reset + Net2Net surgery), variation (12
// experts + load-balancing + entropy), implicit selection (gradient), and
// whole-organism selection (collapse→rollback to best). The missing piece was
// explicit per-expert *fitness credit*: a record of which experts were carrying
// the load each time the colony hit a new all-time-best epoch (ATL). This is a
// pure scorekeeper — recording it changes no training behaviour. It is read only
// by the flag-gated, default-OFF post-surgery gate-seeding nudge (Brick 2), which
// gently tilts a newly-added layer's router toward the proven experts while
// load-balancing still pushes back against monoculture.

/// Exponential forgetting applied to ATL credit before each new best-ATL epoch is
/// folded in. <1.0 lets the scorekeeper track the model's *current* expert usage
/// rather than its whole history — early-training routing is not late-training
/// routing. 0.9 ≈ a ~7-best half-life.
const ATL_CREDIT_DECAY: f32 = 0.9;

/// Minimum best-ATL epochs that must accumulate before the credit prior is trusted
/// enough to seed a surgery. Below this the prior returns all-zero (no nudge).
const ATL_CREDIT_MIN_EVENTS: usize = 8;

pub struct EvolutionManager {
    pub loss_history:                 VecDeque<f32>,
    pub plateau_threshold:            f32,
    pub mastery_threshold:            f32,
    pub cooldown_remaining:           usize,
    /// Minimum consecutive epochs the MYCELIUM hot-layer must remain stable before
    /// plateau surgery is allowed to fire.
    pub mycelium_stability_threshold: usize,
    /// Position in the current generation's arc — determines history_len and surgery_cooldown.
    /// Resets to gen_base_fib_index at each generation boundary.
    pub fib_index:                    usize,
    /// Forward-only layer ceiling. Advances to the next Fibonacci value above the
    /// current layer count after each surgery. Never decreases on generational reset.
    pub max_layers:                   usize,
    /// Consecutive epochs where routing entropy was near-uniform (≥95% of max entropy).
    near_uniform_streak:              usize,
    /// Set when near_uniform_streak reaches 34; consumed by consume_symmetry_break().
    symmetry_break_pending:           bool,
    /// Set by the caller each cycle via set_curriculum_exhausted() — true when the most
    /// recent corpus load unlocked no new stage_N directory. Consulted only by
    /// promote_fib_target(), which ratchets mastery_threshold down while this holds.
    curriculum_exhausted:             bool,

    // ── Generational state ────────────────────────────────────────────────────
    /// 1-indexed current generation number.
    pub generation:             usize,
    /// fib_index at the start of the current generation's arc.
    gen_base_fib_index:         usize,
    /// Surgeries completed in this generation (0..ARC_LENGTH).
    gen_step:                   usize,
    /// Epochs elapsed since this generation started.
    gen_epochs:                 usize,
    /// Epochs elapsed since the last surgery fired (for timeout detection).
    gen_epochs_no_surgery:      usize,
    /// plateau_threshold at the start of this generation (for GENERATION_COMPLETE log).
    gen_start_threshold:        f32,
    /// First loss recorded this generation (for GENERATION_COMPLETE log).
    gen_start_loss:             Option<f32>,

    // ── CTX-level calibration ─────────────────────────────────────────────────
    /// The max_seq_len (context window) this manager is calibrated for.
    /// Persisted so recalibrate_ctx() can compute the correct scaling ratio on CTX bump.
    pub ctx:                    usize,
    /// Per-CTX plateau threshold floor — derived from CTX_LEVEL_TABLE.
    /// Replaces the old global MIN_PLATEAU_THRESHOLD constant so the floor
    /// stays meaningful as CTX grows (longer sequences have lower noise floors).
    min_plateau_threshold:      f32,

    // ── Per-expert ATL credit (natural-selection scorekeeper) ──────────────────
    /// Accumulated fitness credit per expert index, earned when the colony hits a
    /// new all-time-best epoch loss. Sized lazily to num_experts on first record.
    /// OBSERVATIONAL — never read by the training step, only by Brick 2's nudge.
    pub expert_atl_credit:      Vec<f32>,
    /// Number of best-ATL epochs that have contributed credit (lifetime counter).
    pub atl_credit_events:      usize,
}

impl EvolutionManager {
    /// Look up (mastery, plateau_init, min_plateau) for a given context window.
    /// Returns the entry with the largest seq_len ≤ max_seq_len, or the first entry
    /// if max_seq_len is smaller than all table entries.
    fn ctx_entry(max_seq_len: usize) -> (f32, f32, f32) {
        CTX_LEVEL_TABLE.iter()
            .rfind(|&&(c, _, _, _)| c <= max_seq_len)
            .or_else(|| CTX_LEVEL_TABLE.first())
            .map(|&(_, mastery, plateau_init, min_plateau)| (mastery, plateau_init, min_plateau))
            .unwrap_or((4.5, 0.020, 0.008))
    }

    /// Create a fresh EvolutionManager calibrated for `max_seq_len`.
    pub fn with_ctx(max_seq_len: usize) -> Self {
        let (mastery, plateau_init, min_plateau) = Self::ctx_entry(max_seq_len);
        Self {
            loss_history:                 VecDeque::with_capacity(256),
            plateau_threshold:            plateau_init,
            mastery_threshold:            mastery,
            cooldown_remaining:           0,
            mycelium_stability_threshold: 5,
            fib_index:                    0,
            max_layers:                   FIB_TARGETS[0],
            near_uniform_streak:          0,
            symmetry_break_pending:       false,
            curriculum_exhausted:         false,
            generation:                   1,
            gen_base_fib_index:           0,
            gen_step:                     0,
            gen_epochs:                   0,
            gen_epochs_no_surgery:        0,
            gen_start_threshold:          plateau_init,
            gen_start_loss:               None,
            ctx:                          max_seq_len,
            min_plateau_threshold:        min_plateau,
            expert_atl_credit:            Vec::new(),
            atl_credit_events:            0,
        }
    }

    /// Convenience constructor — defaults to CTX=256 to preserve backward compatibility.
    pub fn new() -> Self { Self::with_ctx(256) }

    /// Recalibrate thresholds when the active context window changes.
    ///
    /// Safe to call every restart: if `new_ctx == self.ctx` it is a no-op except
    /// refreshing mastery from the table (handles table edits without bumping CTX).
    ///
    /// On a CTX bump the current `plateau_threshold` is scaled proportionally to the
    /// new baseline (preserving generational decay) and clamped to [new_min, new_init].
    pub fn recalibrate_ctx(&mut self, new_ctx: usize) {
        let (new_mastery, new_plateau_init, new_min) = Self::ctx_entry(new_ctx);
        if new_ctx == self.ctx {
            self.mastery_threshold    = new_mastery;
            self.min_plateau_threshold = new_min;
            return;
        }
        let (_, old_plateau_init, _) = Self::ctx_entry(self.ctx);
        let ratio  = new_plateau_init / old_plateau_init.max(1e-9);
        let scaled = (self.plateau_threshold * ratio)
            .max(new_min)
            .min(new_plateau_init);
        println!(
            "[evolution] CTX recalibrated {}→{}  mastery {:.2}→{:.2}  \
             plateau {:.4}→{:.4} (×{:.3})  floor {:.4}→{:.4}",
            self.ctx, new_ctx,
            self.mastery_threshold, new_mastery,
            self.plateau_threshold, scaled, ratio,
            self.min_plateau_threshold, new_min,
        );
        self.ctx                   = new_ctx;
        self.mastery_threshold     = new_mastery;
        self.plateau_threshold     = scaled;
        self.gen_start_threshold   = scaled;
        self.min_plateau_threshold = new_min;
    }

    /// Calibrate Fibonacci position to the current model depth after loading a checkpoint.
    /// Call once after EvolutionManager::new() when resuming from an existing model.
    pub fn calibrate(&mut self, current_layers: usize) {
        let idx = FIB_TARGETS.iter()
            .position(|&f| f > current_layers)
            .unwrap_or(FIB_TARGETS.len() - 1);
        self.fib_index          = idx;
        self.gen_base_fib_index = idx;
        self.max_layers         = FIB_TARGETS[idx];
        self.gen_start_threshold = self.plateau_threshold;
        println!(
            "[evolution] Calibrated to {}L — ceiling F{}={}L, window={} epochs \
             gen={} step={}/{} threshold={:.4}",
            current_layers, idx + 1, self.max_layers, self.history_len(),
            self.generation, self.gen_step, ARC_LENGTH, self.plateau_threshold,
        );
    }

    /// Plateau detection window — equals FIB_TARGETS[fib_index].
    pub fn history_len(&self) -> usize {
        FIB_TARGETS[self.fib_index.min(FIB_TARGETS.len() - 1)]
    }

    /// Post-surgery cooldown — equals FIB_TARGETS[fib_index].
    pub fn surgery_cooldown(&self) -> usize {
        FIB_TARGETS[self.fib_index.min(FIB_TARGETS.len() - 1)]
    }

    /// Authoritative plateau-gate state for live telemetry — no side effects.
    /// Mirrors the quarter-means math in `should_evolve()` so the dashboard can
    /// render the REAL gate every epoch instead of a divergent client-side
    /// estimate. Returns (smoothed_delta, threshold, window, filled).
    /// `smoothed_delta` is NaN until the window is full.
    pub fn gate_telemetry(&self) -> (f32, f32, usize, usize) {
        let window = self.history_len();
        let filled = self.loss_history.len().min(window);
        let delta = if self.loss_history.len() >= window && window > 0 {
            let quarter = (self.loss_history.len() / 4).max(1);
            let first_mean: f32 = self.loss_history.iter().take(quarter).sum::<f32>()
                / quarter as f32;
            let last_mean: f32 = self.loss_history.iter().rev().take(quarter).sum::<f32>()
                / quarter as f32;
            first_mean - last_mean
        } else {
            f32::NAN
        };
        (delta, self.plateau_threshold, window, filled)
    }

    /// Record the average loss for a completed epoch and decrement cooldown.
    pub fn add_loss(&mut self, loss: f32) {
        let cap = self.history_len();
        if self.loss_history.len() >= cap {
            self.loss_history.pop_front();
        }
        self.loss_history.push_back(loss);
        if self.cooldown_remaining > 0 { self.cooldown_remaining -= 1; }
        self.gen_epochs           += 1;
        self.gen_epochs_no_surgery += 1;
        if self.gen_start_loss.is_none() {
            self.gen_start_loss = Some(loss);
        }
    }

    /// Check whether the current generation has timed out (no surgery for too long).
    /// If so, force-advance the generation WITHOUT adding a layer — prevents eternal autumn.
    /// Call once per epoch, before should_evolve.
    pub fn check_generation_timeout(&mut self) -> bool {
        let final_arc_idx = (self.gen_base_fib_index + ARC_LENGTH - 1)
            .min(FIB_TARGETS.len() - 1);
        let timeout = GENERATION_TIMEOUT_MULTIPLIER * FIB_TARGETS[final_arc_idx];
        if self.gen_epochs_no_surgery >= timeout {
            let final_loss = self.loss_history.back().copied().unwrap_or(0.0);
            println!(
                "[evolution] GENERATION_TIMEOUT gen={} step={}/{} \
                 ({} epochs without surgery, timeout={}) — forced generation advance, no layer added.",
                self.generation, self.gen_step, ARC_LENGTH,
                self.gen_epochs_no_surgery, timeout,
            );
            self.advance_generation(final_loss, None);
            return true;
        }
        false
    }

    /// Returns true if the architecture should grow by one layer.
    ///
    /// Mastery fires immediately at any depth.
    /// Plateau fires when: (1) full Fibonacci window filled, (2) smoothed loss delta within
    /// threshold (quarter-window means, noise-resistant), AND (3) MYCELIUM hot-layer stable
    /// ≥ mycelium_stability_threshold epochs.
    pub fn should_evolve(&self, current_layers: usize, mycelium_stable_epochs: usize) -> bool {
        if current_layers >= self.max_layers { return false; }

        let latest = match self.loss_history.back() {
            Some(&v) => v,
            None     => return false,
        };

        // Mastery: capacity gap is catastrophic — fire immediately.
        if latest < self.mastery_threshold {
            println!(
                "--- MASTERY EVOLUTION TRIGGERED (loss {:.4} < {:.4}, \
                 next ceiling: F{}={}L) ---",
                latest, self.mastery_threshold,
                self.fib_index + 1, self.max_layers,
            );
            return true;
        }

        let history_len = self.history_len();
        if self.loss_history.len() < history_len { return false; }

        if self.cooldown_remaining > 0 {
            println!(
                "[evolution] Fibonacci cooldown ({} epochs remaining, \
                 gen={} step={}/{}) — skipping",
                self.cooldown_remaining, self.generation, self.gen_step, ARC_LENGTH,
            );
            return false;
        }

        // Robust plateau: compare the mean of the earliest quarter of the window against
        // the mean of the most recent quarter. Single-point first-vs-last was too sensitive
        // to epoch-to-epoch oscillation (~0.030 nats) relative to the plateau threshold
        // (~0.015 after gen-2 decay), causing the gate to stall indefinitely on a true
        // structural plateau. Quarter-means smooth the noise while still detecting genuine
        // descent (model actually improving → first_mean << last_mean → diff > threshold).
        let quarter = (self.loss_history.len() / 4).max(1);
        let first_mean: f32 = self.loss_history.iter().take(quarter).sum::<f32>()
            / quarter as f32;
        let last_mean: f32 = self.loss_history.iter().rev().take(quarter).sum::<f32>()
            / quarter as f32;
        // diff > 0 → improvement (older was worse); diff < 0 → model got worse (also plateau).
        let diff = first_mean - last_mean;

        if diff < self.plateau_threshold {
            if mycelium_stable_epochs < self.mycelium_stability_threshold {
                println!(
                    "[evolution] Plateau detected (smoothed Δ{:.4} over {} epochs, \
                     early_mean={:.4} late_mean={:.4}) but MYCELIUM \
                     hot-layer only stable {}/{} epochs — routing hierarchy not yet \
                     crystallised. Surgery suppressed.",
                    diff, history_len, first_mean, last_mean,
                    mycelium_stable_epochs, self.mycelium_stability_threshold,
                );
                return false;
            }
            println!(
                "--- FIBONACCI PLATEAU TRIGGERED (smoothed Δ{:.4} over {} epochs, \
                 early_mean={:.4} late_mean={:.4}, threshold={:.4}, \
                 MYCELIUM stable {} epochs, gen={} step={}/{}, \
                 next ceiling: F{}={}L) ---",
                diff, history_len, first_mean, last_mean, self.plateau_threshold,
                mycelium_stable_epochs,
                self.generation, self.gen_step, ARC_LENGTH,
                self.fib_index + 1, self.max_layers,
            );
            return true;
        }

        false
    }

    /// Record whether the most recent corpus load unlocked any new stage_N directory.
    /// Call once per outer-loop iteration, before promote_fib_target — see the
    /// CURRICULUM EXHAUSTION note at the top of this file.
    pub fn set_curriculum_exhausted(&mut self, exhausted: bool) {
        self.curriculum_exhausted = exhausted;
    }

    /// Ratio of the current (possibly curriculum-exhaustion-decayed) mastery_threshold
    /// to the CTX table's un-decayed baseline for the active context window. 1.0 while
    /// growth still earns new corpus content; shrinks toward MASTERY_FLOOR/baseline once
    /// promote_fib_target has ratcheted mastery_threshold down. The training loop uses
    /// this to macro-decay the LR schedule in lockstep with slowing growth.
    pub fn mastery_decay_ratio(&self) -> f32 {
        let (baseline_mastery, _, _) = Self::ctx_entry(self.ctx);
        (self.mastery_threshold / baseline_mastery.max(1e-6)).clamp(0.0, 1.0)
    }

    /// Advance to the next position in the generational arc. Call after every successful surgery.
    /// `new_layers` is the layer count AFTER the surgery (used to update max_layers).
    pub fn promote_fib_target(&mut self, new_layers: usize) {
        let final_loss = self.loss_history.back().copied().unwrap_or(0.0);

        if self.curriculum_exhausted {
            let old_mastery = self.mastery_threshold;
            self.mastery_threshold = (self.mastery_threshold * MASTERY_DECAY).max(MASTERY_FLOOR);
            println!(
                "[evolution] Curriculum exhausted — mastery threshold tightened {:.4}→{:.4} \
                 (this surgery's growth wasn't backed by new corpus material)",
                old_mastery, self.mastery_threshold,
            );
        }

        self.gen_step             += 1;
        self.gen_epochs_no_surgery = 0;

        // Advance fib_index within the current generation's arc.
        let arc_end = (self.gen_base_fib_index + ARC_LENGTH).min(FIB_TARGETS.len() - 1);
        if self.fib_index + 1 < arc_end {
            self.fib_index += 1;
        }

        // max_layers advances to the next Fibonacci ceiling above the new layer count.
        // This is always forward-only — never decreases on generational reset.
        self.max_layers = FIB_TARGETS.iter()
            .find(|&&f| f > new_layers)
            .copied()
            .unwrap_or(usize::MAX);

        if self.gen_step >= ARC_LENGTH {
            // Generation complete — death and rebirth.
            self.advance_generation(final_loss, Some(new_layers));
        } else {
            println!(
                "[evolution] Gen {} step {}/{} → window={} epochs, ceiling={}L, threshold={:.4}",
                self.generation, self.gen_step, ARC_LENGTH,
                self.history_len(), self.max_layers, self.plateau_threshold,
            );
        }
    }

    /// Complete the current generation and begin the next.
    /// Called by promote_fib_target (arc complete) and check_generation_timeout (forced).
    fn advance_generation(&mut self, final_loss: f32, layer_count: Option<usize>) {
        // Build window list for the archaeological log.
        let windows: Vec<String> = (0..ARC_LENGTH)
            .map(|i| {
                FIB_TARGETS[(self.gen_base_fib_index + i).min(FIB_TARGETS.len() - 1)]
                    .to_string()
            })
            .collect();

        let new_threshold = (self.plateau_threshold * THRESHOLD_DECAY)
            .max(self.min_plateau_threshold);

        // One-line archaeological record — readable at Gen 10 looking back.
        println!(
            "GENERATION_COMPLETE gen={} surgeries={} epochs={} \
             windows=[{}] threshold={:.3}→{:.3} final_loss={:.4}{}",
            self.generation,
            self.gen_step,
            self.gen_epochs,
            windows.join(","),
            self.gen_start_threshold,
            new_threshold,
            final_loss,
            layer_count
                .map(|l| format!(" layer_count={}L", l))
                .unwrap_or_default(),
        );

        // ── Rebirth ──────────────────────────────────────────────────────────
        self.generation          += 1;
        self.gen_base_fib_index  += 1;
        self.fib_index            = self.gen_base_fib_index.min(FIB_TARGETS.len() - 1);
        self.gen_step             = 0;
        self.gen_epochs           = 0;
        self.gen_epochs_no_surgery = 0;
        self.gen_start_loss       = None;
        self.gen_start_threshold  = new_threshold;
        self.plateau_threshold    = new_threshold;

        println!(
            "[evolution] ↻ Rebirth — Gen {} begins: base=F{}={}, \
             window={} epochs, ceiling={}L, threshold={:.4}",
            self.generation,
            self.gen_base_fib_index + 1,
            FIB_TARGETS[self.gen_base_fib_index.min(FIB_TARGETS.len() - 1)],
            self.history_len(),
            self.max_layers,
            self.plateau_threshold,
        );
    }

    /// Lazily size the per-expert credit vector. No-op once correctly sized.
    fn ensure_credit_slots(&mut self, num_experts: usize) {
        if self.expert_atl_credit.len() != num_experts {
            self.expert_atl_credit = vec![0.0; num_experts];
        }
    }

    /// BRICK 1 — fold a new all-time-best epoch into per-expert ATL credit.
    ///
    /// `route_share[e]` = the fraction of routing mass expert e carried during the
    /// best epoch (epoch_route_acc / epoch_route_count, aggregated across layers).
    /// `improvement` = how far the ATL dropped, in nats; a bigger leap earns
    /// proportionally more credit, bounded so a single jump can't dominate forever
    /// and a noise-tiny best still registers. Pure bookkeeping — no side effects on
    /// weights, optimizer, or the surgery gate.
    pub fn record_atl_credit(&mut self, route_share: &[f32], improvement: f32) {
        self.ensure_credit_slots(route_share.len());
        // Forget a little of the past so credit tracks the model's *current* shape.
        for c in self.expert_atl_credit.iter_mut() { *c *= ATL_CREDIT_DECAY; }
        // Weight this best by the size of the leap: 1.0× floor, 3.0× ceiling.
        let weight = (1.0 + improvement.max(0.0) * 4.0).min(3.0);
        for (e, &share) in route_share.iter().enumerate() {
            if e < self.expert_atl_credit.len() {
                self.expert_atl_credit[e] += share * weight;
            }
        }
        self.atl_credit_events += 1;
    }

    /// BRICK 2 input — ATL credit centered to zero mean and scaled to unit max-abs,
    /// for use as a gentle routing prior on a freshly-added layer's gate.
    ///
    /// Returns an all-zero vector (→ no nudge) until ATL_CREDIT_MIN_EVENTS best
    /// epochs have accumulated. Centering guarantees the nudge neither inflates nor
    /// deflates the gate overall — it only re-tilts *between* experts, leaving
    /// load-balancing free to counter any drift toward monoculture.
    pub fn atl_credit_prior(&self, num_experts: usize) -> Vec<f32> {
        if self.expert_atl_credit.len() != num_experts
            || self.atl_credit_events < ATL_CREDIT_MIN_EVENTS {
            return vec![0.0; num_experts];
        }
        let mean = self.expert_atl_credit.iter().sum::<f32>() / num_experts as f32;
        let centered: Vec<f32> = self.expert_atl_credit.iter().map(|&c| c - mean).collect();
        let max_abs = centered.iter().fold(0.0_f32, |m, &v| m.max(v.abs()));
        if max_abs <= 1e-6 { return vec![0.0; num_experts]; }
        centered.iter().map(|&v| v / max_abs).collect()
    }

    /// One-line telemetry of current ATL-credit standings (highest-credited first).
    pub fn atl_credit_telemetry(&self) -> String {
        if self.expert_atl_credit.is_empty() {
            return "ATL_CREDIT events=0 (no best-ATL epoch recorded yet)".to_string();
        }
        let total: f32 = self.expert_atl_credit.iter().sum::<f32>().max(1e-9);
        let mut idx: Vec<usize> = (0..self.expert_atl_credit.len()).collect();
        idx.sort_by(|&a, &b| {
            self.expert_atl_credit[b]
                .partial_cmp(&self.expert_atl_credit[a])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let parts: Vec<String> = idx.iter()
            .map(|&e| format!("E{}={:.0}%", e, 100.0 * self.expert_atl_credit[e] / total))
            .collect();
        format!("ATL_CREDIT events={} share=[{}]", self.atl_credit_events, parts.join(" "))
    }

    /// Reset loss history and start the Fibonacci-scaled post-surgery cooldown.
    pub fn reset_history(&mut self) {
        self.loss_history.clear();
        self.cooldown_remaining = self.surgery_cooldown();
    }

    /// Record epoch routing entropy. Near-uniform means entropy ≥ 95% of ln(num_experts).
    /// After 34 consecutive near-uniform epochs, schedules an autonomous symmetry break.
    pub fn record_routing_entropy(&mut self, entropy: f32, num_experts: usize) {
        let max_entropy = (num_experts as f32).ln();
        if max_entropy <= 0.0 { return; }
        if entropy / max_entropy >= 0.95 {
            self.near_uniform_streak += 1;
            if self.near_uniform_streak >= 34 && !self.symmetry_break_pending {
                self.symmetry_break_pending = true;
                println!(
                    "[evolution] near-uniform routing for {} consecutive epochs \
                     (entropy {:.3}/{:.3}) — symmetry break scheduled for next restart",
                    self.near_uniform_streak, entropy, max_entropy,
                );
            }
        } else {
            self.near_uniform_streak = 0;
        }
    }

    /// Returns true if an autonomous symmetry break was scheduled, clearing the flag.
    pub fn consume_symmetry_break(&mut self) -> bool {
        if self.symmetry_break_pending {
            self.symmetry_break_pending = false;
            self.near_uniform_streak    = 0;
            println!("[evolution] consuming symmetry-break flag — gate reset will fire this run");
            true
        } else {
            false
        }
    }

    /// Persist state to a sidecar file. Call after every checkpoint save and surgery.
    pub fn save_state(&self, path: &str) {
        let mut content = format!(
            "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{:.6}\n",
            self.fib_index,
            self.cooldown_remaining,
            self.generation,
            self.gen_base_fib_index,
            self.gen_step,
            self.gen_epochs,
            self.gen_epochs_no_surgery,
            self.plateau_threshold,
        );
        // CTX-level calibration — tagged so old binaries ignore them gracefully.
        content.push_str(&format!("ctx:{}\n", self.ctx));
        content.push_str(&format!("mt:{:.6}\n", self.mastery_threshold));
        // Persist loss_history so it survives restarts — without this the plateau ring
        // resets to empty on every Modal restart, forcing a 144-epoch refill before the
        // gate can ever fire (and if Modal restarts more often than that, it never fires).
        if !self.loss_history.is_empty() {
            let hist: Vec<String> = self.loss_history.iter()
                .map(|v| format!("{:.6}", v))
                .collect();
            content.push_str(&format!("h:{}\n", hist.join(",")));
        }
        // Persist per-expert ATL credit so the natural-selection scorekeeper survives
        // Modal restarts (tagged lines — order-independent, backward-compatible).
        if !self.expert_atl_credit.is_empty() {
            let cr: Vec<String> = self.expert_atl_credit.iter()
                .map(|v| format!("{:.6}", v))
                .collect();
            content.push_str(&format!("c:{}\n", cr.join(",")));
            content.push_str(&format!("ce:{}\n", self.atl_credit_events));
        }
        if let Err(e) = fs::write(path, &content) {
            eprintln!("[evolution] Warning: could not save state to {}: {}", path, e);
        }
    }

    /// Restore state from a sidecar file. Backward-compatible with the old 2-line format.
    /// Returns true on success; caller falls back to calibrate() values if false.
    pub fn load_state(&mut self, path: &str) -> bool {
        let content = match fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let mut lines = content.lines();

        macro_rules! next_parsed {
            ($t:ty) => {
                match lines.next().and_then(|s| s.trim().parse::<$t>().ok()) {
                    Some(v) => v,
                    None    => return false,
                }
            };
        }

        let fib_index:   usize = next_parsed!(usize);
        let cooldown:    usize = next_parsed!(usize);

        if fib_index >= FIB_TARGETS.len() { return false; }
        self.fib_index          = fib_index;
        self.cooldown_remaining = cooldown;
        self.max_layers         = FIB_TARGETS[fib_index];

        // Extended fields — optional (old checkpoints only have 2 lines).
        if let Some(gen_val) = lines.next().and_then(|s| s.trim().parse::<usize>().ok()) {
            self.generation = gen_val;
        }
        if let Some(base) = lines.next().and_then(|s| s.trim().parse::<usize>().ok()) {
            self.gen_base_fib_index = base.min(FIB_TARGETS.len() - 1);
        }
        if let Some(step) = lines.next().and_then(|s| s.trim().parse::<usize>().ok()) {
            self.gen_step = step;
        }
        if let Some(ep) = lines.next().and_then(|s| s.trim().parse::<usize>().ok()) {
            self.gen_epochs = ep;
        }
        if let Some(no_surg) = lines.next().and_then(|s| s.trim().parse::<usize>().ok()) {
            self.gen_epochs_no_surgery = no_surg;
        }
        if let Some(thr) = lines.next().and_then(|s| s.trim().parse::<f32>().ok()) {
            self.plateau_threshold   = thr;
            self.gen_start_threshold = thr;
        }

        // Optional tagged tail lines — parsed by PREFIX so they're order-independent
        // and old 2-line / h-only checkpoints still load cleanly:
        //   h:   loss_history (resumes the plateau window mid-flight across restarts)
        //   c:   per-expert ATL credit (the natural-selection scorekeeper)
        //   ce:  best-ATL event count
        //   ctx: active context window (max_seq_len)
        //   mt:  mastery_threshold at save time
        for line in lines {
            let trimmed = line.trim();
            if let Some(hist_str) = trimmed.strip_prefix("h:") {
                self.loss_history.clear();
                for tok in hist_str.split(',') {
                    if let Ok(v) = tok.trim().parse::<f32>() {
                        self.loss_history.push_back(v);
                    }
                }
            } else if let Some(cred_str) = trimmed.strip_prefix("c:") {
                self.expert_atl_credit = cred_str.split(',')
                    .filter_map(|tok| tok.trim().parse::<f32>().ok())
                    .collect();
            } else if let Some(ev_str) = trimmed.strip_prefix("ce:") {
                if let Ok(v) = ev_str.trim().parse::<usize>() {
                    self.atl_credit_events = v;
                }
            } else if let Some(ctx_str) = trimmed.strip_prefix("ctx:") {
                if let Ok(v) = ctx_str.trim().parse::<usize>() {
                    self.ctx = v;
                    // Restore the per-CTX floor from the table for the saved CTX.
                    let (_, _, min_p) = Self::ctx_entry(v);
                    self.min_plateau_threshold = min_p;
                }
            } else if let Some(mt_str) = trimmed.strip_prefix("mt:") {
                if let Ok(v) = mt_str.trim().parse::<f32>() {
                    self.mastery_threshold = v;
                }
            }
        }

        println!(
            "[evolution] Restored — F{}={}L, window={} epochs, cooldown={}, \
             gen={} step={}/{}, plateau={:.4}, mastery={:.2}, ctx={}",
            self.fib_index + 1, self.max_layers, self.history_len(),
            self.cooldown_remaining, self.generation, self.gen_step, ARC_LENGTH,
            self.plateau_threshold, self.mastery_threshold, self.ctx,
        );
        true
    }
}

impl Default for EvolutionManager {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn em_at(layers: usize) -> EvolutionManager {
        let mut em = EvolutionManager::new();
        em.calibrate(layers);
        em
    }

    fn fill_flat(em: &mut EvolutionManager, loss: f32) {
        for _ in 0..em.history_len() { em.add_loss(loss); }
    }

    #[test]
    fn plateau_fires_when_mycelium_stable_enough() {
        let mut em = em_at(12);
        fill_flat(&mut em, 10.27);
        assert!(em.should_evolve(12, 5));
    }

    #[test]
    fn plateau_suppressed_when_mycelium_not_yet_stable() {
        let mut em = em_at(12);
        fill_flat(&mut em, 10.27);
        assert!(!em.should_evolve(12, 4));
    }

    #[test]
    fn no_plateau_no_fire_regardless_of_stability() {
        let mut em = em_at(12);
        for i in 0..em.history_len() { em.add_loss(10.50 - i as f32 * 0.02); }
        assert!(!em.should_evolve(12, 10));
    }

    #[test]
    fn mastery_fires_without_mycelium_stability() {
        let mut em = em_at(12);
        em.add_loss(4.0);
        assert!(em.should_evolve(12, 0));
    }

    #[test]
    fn cooldown_blocks_surgery() {
        let mut em = em_at(12);
        fill_flat(&mut em, 10.27);
        em.reset_history();
        assert!(!em.should_evolve(12, 10));
    }

    #[test]
    fn already_at_max_layers_never_fires() {
        let mut em = em_at(12);
        fill_flat(&mut em, 10.27);
        assert!(!em.should_evolve(13, 10));
    }

    #[test]
    fn generation_advances_after_arc_length_surgeries() {
        let mut em = em_at(12);
        assert_eq!(em.generation, 1);
        for i in 0..ARC_LENGTH {
            fill_flat(&mut em, 10.0 - i as f32 * 0.1);
            em.promote_fib_target(13 + i);
            em.reset_history();
        }
        assert_eq!(em.generation, 2);
        assert_eq!(em.gen_step, 0);
    }

    #[test]
    fn plateau_threshold_tightens_each_generation() {
        let mut em = em_at(12);
        let t0 = em.plateau_threshold;
        for i in 0..ARC_LENGTH {
            fill_flat(&mut em, 10.0 - i as f32 * 0.1);
            em.promote_fib_target(13 + i);
            em.reset_history();
        }
        assert!(em.plateau_threshold < t0);
        assert!(em.plateau_threshold >= em.min_plateau_threshold);
    }

    #[test]
    fn threshold_floors_at_minimum() {
        let mut em = em_at(12);
        // Run many generations — threshold must never fall below per-CTX floor.
        for g in 0..20 {
            for i in 0..ARC_LENGTH {
                fill_flat(&mut em, 9.0 - (g * ARC_LENGTH + i) as f32 * 0.01);
                em.promote_fib_target(13 + g * ARC_LENGTH + i);
                em.reset_history();
            }
        }
        assert!(em.plateau_threshold >= em.min_plateau_threshold);
        assert!(em.plateau_threshold >= MIN_PLATEAU_THRESHOLD); // absolute global floor
    }

    // ── Curriculum exhaustion → mastery decay + LR macro-decay ─────────────────

    #[test]
    fn mastery_decay_ratio_starts_at_one() {
        let em = EvolutionManager::with_ctx(512);
        assert!((em.mastery_decay_ratio() - 1.0).abs() < 1e-5);
    }

    #[test]
    fn curriculum_exhausted_tightens_mastery_on_promote() {
        let mut em = em_at(12);
        let before = em.mastery_threshold;
        em.set_curriculum_exhausted(true);
        em.add_loss(9.84);
        em.promote_fib_target(13);
        assert!(em.mastery_threshold < before,
            "mastery should tighten: {} !< {}", em.mastery_threshold, before);
        assert!((em.mastery_threshold - before * 0.9).abs() < 1e-4);
    }

    #[test]
    fn curriculum_not_exhausted_leaves_mastery_untouched() {
        let mut em = em_at(12);
        let before = em.mastery_threshold;
        em.set_curriculum_exhausted(false);
        em.add_loss(9.84);
        em.promote_fib_target(13);
        assert!((em.mastery_threshold - before).abs() < 1e-6);
    }

    #[test]
    fn mastery_decay_floors_and_ratio_shrinks() {
        let mut em = em_at(12);
        em.set_curriculum_exhausted(true);
        for i in 0..40 {
            em.add_loss(9.0 - i as f32 * 0.01);
            em.promote_fib_target(13 + i);
        }
        assert!(em.mastery_threshold >= MASTERY_FLOOR - 1e-4);
        assert!(em.mastery_decay_ratio() < 1.0);
        assert!(em.mastery_decay_ratio() > 0.0);
    }

    // ── CTX calibration ─────────────────────────────────────────────────────────

    #[test]
    fn with_ctx_sets_correct_thresholds() {
        let em256 = EvolutionManager::with_ctx(256);
        assert!((em256.mastery_threshold - 4.5).abs() < 1e-5);
        assert!((em256.plateau_threshold  - 0.020).abs() < 1e-5);
        assert!((em256.min_plateau_threshold - 0.008).abs() < 1e-5);

        let em512 = EvolutionManager::with_ctx(512);
        assert!((em512.mastery_threshold - 4.0).abs() < 1e-5);
        assert!((em512.plateau_threshold  - 0.018).abs() < 1e-5);
        assert!((em512.min_plateau_threshold - 0.007).abs() < 1e-5);

        // Value between table entries → floor entry is used
        let em300 = EvolutionManager::with_ctx(300);
        assert!((em300.mastery_threshold - 4.5).abs() < 1e-5, "300 CTX should use 256 entry");
    }

    #[test]
    fn recalibrate_ctx_scales_plateau_proportionally() {
        let mut em = EvolutionManager::with_ctx(256);
        // Simulate Gen-3 decay: 0.020 × 0.75² ≈ 0.01125
        em.plateau_threshold = 0.01125;

        em.recalibrate_ctx(512);
        // ratio = 0.018 / 0.020 = 0.9 → scaled = 0.01125 × 0.9 = 0.010125
        let expected = 0.01125_f32 * (0.018 / 0.020);
        assert!((em.plateau_threshold - expected).abs() < 1e-5,
            "scaled plateau {:.6} ≠ expected {:.6}", em.plateau_threshold, expected);
        assert!((em.mastery_threshold - 4.0).abs() < 1e-5);
        assert_eq!(em.ctx, 512);
    }

    #[test]
    fn recalibrate_ctx_noop_when_same() {
        let mut em = EvolutionManager::with_ctx(256);
        em.plateau_threshold = 0.011;
        em.recalibrate_ctx(256);
        // plateau must not change
        assert!((em.plateau_threshold - 0.011).abs() < 1e-5);
        // mastery must be refreshed from table
        assert!((em.mastery_threshold - 4.5).abs() < 1e-5);
    }

    #[test]
    fn recalibrate_ctx_clamps_to_new_init() {
        // If somehow threshold is above new_init, clamp down.
        let mut em = EvolutionManager::with_ctx(128);
        em.plateau_threshold = 0.022; // at init value for 128
        em.recalibrate_ctx(64); // going DOWN — new_init = 0.025
        // ratio = 0.025/0.022 ≈ 1.136 → scaled = 0.022 × 1.136 ≈ 0.025 (clamped to new_init)
        assert!(em.plateau_threshold <= 0.025 + 1e-5);
        assert!(em.plateau_threshold >= em.min_plateau_threshold);
    }

    #[test]
    fn save_load_roundtrip_preserves_ctx_and_mastery() {
        let mut em = EvolutionManager::with_ctx(512);
        em.add_loss(9.84);
        em.promote_fib_target(18);
        em.reset_history();

        let path = "/tmp/evo_test_ctx_roundtrip.txt";
        em.save_state(path);

        let mut em2 = EvolutionManager::new(); // defaults to ctx=256
        assert!(em2.load_state(path));
        assert_eq!(em2.ctx, 512);
        assert!((em2.mastery_threshold - 4.0).abs() < 1e-4,
            "mastery should restore to 4.0 for ctx=512, got {}", em2.mastery_threshold);
        assert!((em2.plateau_threshold - em.plateau_threshold).abs() < 1e-5);
    }

    #[test]
    fn max_layers_never_decreases_on_generational_reset() {
        let mut em = em_at(12);
        let mut last_max = em.max_layers;
        for i in 0..ARC_LENGTH + 2 {
            fill_flat(&mut em, 10.0 - i as f32 * 0.1);
            em.promote_fib_target(13 + i);
            em.reset_history();
            assert!(em.max_layers >= last_max,
                "max_layers decreased on gen boundary: {} < {}", em.max_layers, last_max);
            last_max = em.max_layers;
        }
    }

    #[test]
    fn generation_timeout_advances_without_surgery() {
        let mut em = em_at(12);
        em.add_loss(10.5); // start gen_start_loss
        let final_arc_idx = (em.gen_base_fib_index + ARC_LENGTH - 1).min(FIB_TARGETS.len() - 1);
        let timeout = GENERATION_TIMEOUT_MULTIPLIER * FIB_TARGETS[final_arc_idx];
        // Simulate timeout epochs without surgery
        em.gen_epochs_no_surgery = timeout;
        let gen_before = em.generation;
        let fired = em.check_generation_timeout();
        assert!(fired);
        assert_eq!(em.generation, gen_before + 1);
        assert_eq!(em.gen_step, 0);
    }

    #[test]
    fn save_load_roundtrip() {
        let mut em = em_at(17);
        em.add_loss(9.84);
        em.promote_fib_target(18);
        em.reset_history();

        let path = "/tmp/evo_test_state.txt";
        em.save_state(path);

        let mut em2 = EvolutionManager::new();
        assert!(em2.load_state(path));
        assert_eq!(em2.fib_index,          em.fib_index);
        assert_eq!(em2.generation,         em.generation);
        assert_eq!(em2.gen_base_fib_index, em.gen_base_fib_index);
        assert_eq!(em2.gen_step,           em.gen_step);
        assert!((em2.plateau_threshold - em.plateau_threshold).abs() < 1e-5);
    }

    // ── Natural-selection scorekeeper (ATL credit) ──────────────────────────────

    #[test]
    fn atl_credit_accumulates_toward_carrying_experts() {
        let mut em = em_at(12);
        // Expert 2 carries most load on every best epoch; expert 0 carries none.
        let share = vec![0.0, 0.05, 0.60, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.0, 0.0, 0.0];
        for _ in 0..10 { em.record_atl_credit(&share, 0.01); }
        assert_eq!(em.atl_credit_events, 10);
        // The heavy carrier must end with the most credit.
        let argmax = (0..12).max_by(|&a, &b|
            em.expert_atl_credit[a].partial_cmp(&em.expert_atl_credit[b]).unwrap()).unwrap();
        assert_eq!(argmax, 2);
    }

    #[test]
    fn atl_prior_is_zero_until_enough_events_then_centered() {
        let mut em = em_at(12);
        let share = vec![0.0, 0.0, 0.6, 0.0, 0.1, 0.1, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0];
        // Below the min-events threshold → no nudge.
        for _ in 0..(ATL_CREDIT_MIN_EVENTS - 1) { em.record_atl_credit(&share, 0.0); }
        assert!(em.atl_credit_prior(12).iter().all(|&v| v == 0.0));
        // Cross the threshold → a real, zero-mean, unit-max-abs prior.
        em.record_atl_credit(&share, 0.0);
        let prior = em.atl_credit_prior(12);
        let mean: f32 = prior.iter().sum::<f32>() / 12.0;
        assert!(mean.abs() < 1e-5, "prior must be zero-mean, got {mean}");
        assert!(prior.iter().any(|&v| v != 0.0), "prior must be non-trivial past threshold");
        let max_abs = prior.iter().fold(0.0_f32, |m, &v| m.max(v.abs()));
        assert!((max_abs - 1.0).abs() < 1e-5, "prior must be unit max-abs, got {max_abs}");
        // Heaviest carrier (expert 2) gets the most positive nudge.
        let argmax = (0..12).max_by(|&a, &b| prior[a].partial_cmp(&prior[b]).unwrap()).unwrap();
        assert_eq!(argmax, 2);
    }

    #[test]
    fn atl_credit_survives_save_load() {
        let mut em = em_at(12);
        let share = vec![0.0, 0.1, 0.5, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.0, 0.0, 0.0];
        for _ in 0..9 { em.record_atl_credit(&share, 0.02); }
        let path = "/tmp/evo_test_state_credit.txt";
        em.save_state(path);

        let mut em2 = EvolutionManager::new();
        assert!(em2.load_state(path));
        assert_eq!(em2.atl_credit_events, em.atl_credit_events);
        assert_eq!(em2.expert_atl_credit.len(), 12);
        for (a, b) in em2.expert_atl_credit.iter().zip(em.expert_atl_credit.iter()) {
            assert!((a - b).abs() < 1e-4, "credit drifted across save/load: {a} vs {b}");
        }
    }
}
