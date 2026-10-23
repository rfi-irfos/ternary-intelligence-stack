//! Trace hooks must not change logits, and must record the expected events.
use candle_core::{DType, Device, Tensor};
use candle_nn::{VarBuilder, VarMap};
use moe_llm_core::model::{Transformer, TransformerConfig};

fn tiny_config() -> TransformerConfig {
    TransformerConfig {
        vocab_size: 64,
        hidden_size: 32,
        num_layers: 4,
        num_heads: 2,
        max_seq_len: 16,
        threshold: 0.02,
        num_experts: 12,
        num_streams: 2,
        fusion_layers: vec![1, 2],
        activation_checkpoint_interval: 0,
    }
}

/// NOTE: this LCG builder must stay identical to the one in examples/logits_hash.rs.
/// Deterministic model: candle's CPU RNG cannot be seeded, so every variable is
/// overwritten with values from a fixed LCG (sorted by name).
fn seeded_model() -> Transformer {
    let dev = Device::Cpu;
    let varmap = VarMap::new();
    let vb = VarBuilder::from_varmap(&varmap, DType::F32, &dev);
    let model = Transformer::new(&tiny_config(), vb).unwrap();
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let data = varmap.data().lock().unwrap();
    let mut names: Vec<&String> = data.keys().collect();
    names.sort();
    for name in names {
        let var = &data[name];
        let n = var.elem_count();
        let vals: Vec<f32> = (0..n)
            .map(|_| {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                (((state >> 40) as f32) / (1u64 << 24) as f32 - 0.5) * 0.4
            })
            .collect();
        var.set(&Tensor::from_vec(vals, var.shape().clone(), &dev).unwrap()).unwrap();
    }
    drop(data);
    moe_llm_core::model::enter_eval_mode(); // no Gumbel noise: forward is deterministic
    model
}

fn run(record: bool) -> (Vec<f32>, Vec<moe_llm_core::trace::TraceEvent>) {
    let model = seeded_model();
    let ids = Tensor::from_vec(vec![3u32, 17, 5, 60, 22, 9, 41, 1], (1, 8), &Device::Cpu).unwrap();
    if record {
        moe_llm_core::trace::begin();
    }
    let logits = model.forward_prefill(&ids).unwrap();
    let events = moe_llm_core::trace::take();
    (logits.flatten_all().unwrap().to_vec1::<f32>().unwrap(), events)
}

#[cfg(feature = "trace")]
#[test]
fn recording_is_bit_identical_and_complete() {
    use moe_llm_core::trace::TraceEvent as E;
    let (off, ev_off) = run(false);
    let (on, events) = run(true);
    assert!(ev_off.is_empty());
    assert_eq!(off.len(), on.len());
    assert!(off.iter().zip(&on).all(|(a, b)| a.to_bits() == b.to_bits()), "logits differ");

    let count = |f: fn(&E) -> bool| events.iter().filter(|e| f(e)).count();
    assert_eq!(count(|e| matches!(e, E::Router { .. })), 4 * 2);
    assert_eq!(count(|e| matches!(e, E::Attention { .. })), 4 * 2 * 2);
    assert_eq!(count(|e| matches!(e, E::Gate { .. })), 2);
    assert_eq!(count(|e| matches!(e, E::Final { .. })), 1);
    assert_eq!(count(|e| matches!(e, E::Residual { .. })), 4 * 2 * 2 + 2 * 2);
    let mut pairs: Vec<(usize, char)> = events.iter().filter_map(|e| match e {
        E::Router { layer, stream, .. } => Some((*layer, *stream)),
        _ => None,
    }).collect();
    pairs.sort();
    let want: Vec<(usize, char)> = (0..4).flat_map(|l| ['a', 'b'].map(|s| (l, s))).collect();
    assert_eq!(pairs, want);
    for e in &events {
        match e {
            E::Router { logits, top3, weights, a3_clamped, output_scales, .. } => {
                assert_eq!(output_scales.len(), 12);
                assert_eq!((logits.len(), logits[0].len()), (8, 12));
                assert_eq!((top3.len(), weights.len(), a3_clamped.len()), (8, 8, 8));
            }
            E::Attention { weights, .. } => assert_eq!((weights.len(), weights[0].len()), (8, 8)),
            E::Gate { layer, g_a, g_b } => {
                assert!(*layer == 1 || *layer == 2);
                assert_eq!((g_a.len(), g_b.len()), (8, 8));
            }
            _ => {}
        }
    }
}

/// forward() after forward_prefill, recording still on, must add no events.
#[cfg(feature = "trace")]
#[test]
fn forward_after_prefill_adds_no_events() {
    let model = seeded_model();
    let ids = Tensor::from_vec(vec![3u32, 17, 5, 60, 22, 9, 41, 1], (1, 8), &Device::Cpu).unwrap();
    moe_llm_core::trace::begin();
    model.forward_prefill(&ids).unwrap();
    model.forward(&ids).unwrap();
    // prefill only: 8 router + 16 attention + 2 gate + 20 residual + 1 final
    assert_eq!(moe_llm_core::trace::take().len(), 8 + 16 + 2 + 20 + 1);
}

#[cfg(not(feature = "trace"))]
#[test]
fn no_events_without_feature() {
    let (_, events) = run(true);
    assert!(events.is_empty());
}
