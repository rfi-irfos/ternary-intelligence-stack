use candle_core::{Result, Tensor};
use candle_nn::{Module, VarBuilder};
use std::cell::RefCell;

thread_local! {
    static CORD_GATE_ACC: RefCell<Vec<f32>> = RefCell::new(Vec::new());
    static CORD_COSIM_ACC: RefCell<Vec<f32>> = RefCell::new(Vec::new());
}

pub fn clear_cord_captures() {
    CORD_GATE_ACC.with(|a| a.borrow_mut().clear());
    CORD_COSIM_ACC.with(|a| a.borrow_mut().clear());
}

pub fn take_cord_gate_capture() -> Vec<f32> {
    CORD_GATE_ACC.with(|a| std::mem::take(&mut *a.borrow_mut()))
}

pub fn take_cord_cosim_capture() -> Vec<f32> {
    CORD_COSIM_ACC.with(|a| std::mem::take(&mut *a.borrow_mut()))
}

/// Push cosine similarity between stream A and B hidden states for this layer.
/// Called from Transformer::forward() after each block pair.
pub fn capture_cosim(h_a: &Tensor, h_b: &Tensor) {
    let cos = compute_cosim(h_a, h_b).unwrap_or(1.0);
    CORD_COSIM_ACC.with(|a| a.borrow_mut().push(cos));
}

fn compute_cosim(h_a: &Tensor, h_b: &Tensor) -> Result<f32> {
    let a_flat = h_a.detach().flatten_all()?;
    let b_flat = h_b.detach().flatten_all()?;
    let dot = (&a_flat * &b_flat)?.sum_all()?;
    let norm_a = (&a_flat * &a_flat)?.sum_all()?.sqrt()?;
    let norm_b = (&b_flat * &b_flat)?.sum_all()?.sqrt()?;
    let denom = (&norm_a * &norm_b)?;
    (dot / denom)?.to_scalar::<f32>()
}

/// Bidirectional gated cross-stream fusion layer.
///
/// At Fibonacci-indexed positions in the layer stack, the two streams exchange
/// information through a learned gate: `h_a' = h_a + g_a * h_b` and vice versa.
///
/// Gate init (from cord surgery checkpoint): weight ~ N(0, 0.01), bias = 0.
/// At t=0, sigmoid(0) ≈ 0.5 with near-zero influence. Streams begin effectively
/// independent; the gate opens selectively as specialisations emerge.
pub struct AnastomosisLayer {
    gate: candle_nn::Linear,
}

impl AnastomosisLayer {
    pub fn new(hidden_size: usize, vb: VarBuilder) -> Result<Self> {
        let gate = candle_nn::linear(2 * hidden_size, 2, vb.pp("gate"))?;
        Ok(Self { gate })
    }

    /// `h_a`, `h_b`: `[B, S, H]`
    /// Returns `(h_a', h_b')` with learned gating of cross-stream flow.
    pub fn forward(&self, h_a: &Tensor, h_b: &Tensor) -> Result<(Tensor, Tensor)> {
        let combined = Tensor::cat(&[h_a, h_b], 2)?;           // [B, S, 2H]
        let g = candle_nn::ops::sigmoid(&self.gate.forward(&combined)?)?; // [B, S, 2]

        let mean_gate = g.mean_all()?.to_scalar::<f32>().unwrap_or(0.5);
        CORD_GATE_ACC.with(|a| a.borrow_mut().push(mean_gate));

        let g_a = g.narrow(2, 0, 1)?;    // [B, S, 1] — gate for B→A
        let g_b = g.narrow(2, 1, 1)?;    // [B, S, 1] — gate for A→B

        let h_a_new = (h_a + &h_b.broadcast_mul(&g_a)?)?;
        let h_b_new = (h_b + &h_a.broadcast_mul(&g_b)?)?;
        Ok((h_a_new, h_b_new))
    }
}
