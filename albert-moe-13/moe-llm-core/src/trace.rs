//! Read-only trace hooks for the albert. 3D explorer (feature `trace`).
//!
//! With the feature OFF every item here is a no-op and `trace_event!` expands to
//! nothing, so the model is bit-identical to a build without this module.
//! With the feature ON but `begin()` not called, hooks return immediately.
//! Hooks only clone / `to_vec` existing tensors; they never feed values back.
use serde::Serialize;

/// One recorded observation. Positions are batch element 0, in sequence order.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub enum TraceEvent {
    Router {
        layer: usize,
        stream: char,
        /// `[S][E]` gate logits after temperature and traffic-light modifiers.
        logits: Vec<Vec<f32>>,
        top3: Vec<[u32; 3]>,
        weights: Vec<[f32; 3]>,
        /// True if any top-3 slot with expert index < 4 had a logit < 0 before the safety gate.
        a3_clamped: Vec<bool>,
    },
    Attention { layer: usize, stream: char, head: usize, weights: Vec<Vec<f32>> },
    Gate { layer: usize, g_a: Vec<f32>, g_b: Vec<f32> },
    Residual { layer: usize, stream: char, phase: &'static str, norm: Vec<f32> },
    Final { merged_norm: Vec<f32> },
}

#[cfg(feature = "trace")]
mod imp {
    use super::TraceEvent;
    use candle_core::Tensor;
    use std::cell::RefCell;

    thread_local! {
        static REC: RefCell<Option<Vec<TraceEvent>>> = const { RefCell::new(None) };
        static SITE: RefCell<(usize, char)> = const { RefCell::new((0, 'a')) };
    }

    pub fn begin() { REC.with(|r| *r.borrow_mut() = Some(Vec::new())); }
    pub fn take() -> Vec<TraceEvent> {
        REC.with(|r| r.borrow_mut().take().unwrap_or_default())
    }
    pub fn set_site(layer: usize, stream: char) { SITE.with(|s| *s.borrow_mut() = (layer, stream)); }
    pub fn site() -> (usize, char) { SITE.with(|s| *s.borrow()) }
    pub fn recording() -> bool { REC.with(|r| r.borrow().is_some()) }
    pub fn push(ev: TraceEvent) {
        REC.with(|r| { if let Some(v) = r.borrow_mut().as_mut() { v.push(ev); } });
    }

    /// Rows of a tensor flattened to `[N, width]` (batch element 0 first for `[1, S, W]`).
    pub fn rows(t: &Tensor, width: usize) -> Vec<Vec<f32>> {
        let flat = t.detach().flatten_all().and_then(|f| f.to_dtype(candle_core::DType::F32))
            .and_then(|f| f.to_vec1::<f32>()).unwrap_or_default();
        flat.chunks(width.max(1)).map(|c| c.to_vec()).collect()
    }

    /// L2 norm per position of a `[B, S, H]` hidden state.
    pub fn l2_norms(t: &Tensor) -> Vec<f32> {
        let h = t.dims().last().copied().unwrap_or(1);
        rows(t, h).iter().map(|r| r.iter().map(|v| v * v).sum::<f32>().sqrt()).collect()
    }

    pub fn residual(phase: &'static str, t: &Tensor) {
        if !recording() { return; }
        let (layer, stream) = site();
        push(TraceEvent::Residual { layer, stream, phase, norm: l2_norms(t) });
    }
}

#[cfg(feature = "trace")]
pub use imp::*;

#[cfg(not(feature = "trace"))]
mod noop {
    use super::TraceEvent;
    pub fn begin() {}
    pub fn take() -> Vec<TraceEvent> { Vec::new() }
    pub fn set_site(_layer: usize, _stream: char) {}
}
#[cfg(not(feature = "trace"))]
pub use noop::*;

/// Runs the block only when the `trace` feature is on AND recording has begun.
/// Expands to nothing without the feature.
#[macro_export]
macro_rules! trace_event {
    ($($body:tt)*) => {
        #[cfg(feature = "trace")]
        { if $crate::trace::recording() { $($body)* } }
    };
}
