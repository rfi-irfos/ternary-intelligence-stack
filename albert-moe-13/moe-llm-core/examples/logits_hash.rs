//! Prints an FNV-1a 64-bit hash of the tiny seeded model's prefill logits (bytes).
//! Used to prove the model is bit-identical with and without the `trace` feature
//! and against origin/main. Model construction mirrors tests/trace_parity.rs.
use candle_core::{DType, Device, Tensor};
use candle_nn::{VarBuilder, VarMap};
use moe_llm_core::model::{Transformer, TransformerConfig};

fn main() {
    let cfg = TransformerConfig {
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
    };
    let dev = Device::Cpu;
    let varmap = VarMap::new();
    let vb = VarBuilder::from_varmap(&varmap, DType::F32, &dev);
    let model = Transformer::new(&cfg, vb).unwrap();
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let data = varmap.data().lock().unwrap();
    let mut names: Vec<&String> = data.keys().collect();
    names.sort();
    for name in names {
        let var = &data[name];
        let vals: Vec<f32> = (0..var.elem_count())
            .map(|_| {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                (((state >> 40) as f32) / (1u64 << 24) as f32 - 0.5) * 0.4
            })
            .collect();
        var.set(&Tensor::from_vec(vals, var.shape().clone(), &dev).unwrap()).unwrap();
    }
    drop(data);
    moe_llm_core::model::enter_eval_mode();
    let ids = Tensor::from_vec(vec![3u32, 17, 5, 60, 22, 9, 41, 1], (1, 8), &dev).unwrap();
    let logits = model.forward_prefill(&ids).unwrap().flatten_all().unwrap().to_vec1::<f32>().unwrap();
    let mut h: u64 = 0xcbf29ce484222325;
    for v in &logits {
        for b in v.to_bits().to_le_bytes() {
            h = (h ^ b as u64).wrapping_mul(0x100000001b3);
        }
    }
    println!("logits_fnv1a64={h:016x} n={}", logits.len());
}
