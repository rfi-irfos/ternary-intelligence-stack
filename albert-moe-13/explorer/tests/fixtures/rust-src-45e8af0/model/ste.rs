// Straight-Through Estimator for ternary quantization — whitepaper §5.1
use candle_core::{Result, Tensor};

/// Full ternarize with gamma computed from weights. Call sparingly.
pub fn ternarize_ste(w: &Tensor, threshold: f32) -> Result<Tensor> {
    let gamma = w.abs()?.mean_all()?;
    ternarize_ste_with_gamma(w, threshold, &gamma)
}

/// Ternarize using a pre-computed gamma scalar. Hot path — no mean_all().
// STE trick: diff.detach() passes gradients through the quantization step unchanged (§5.1).
pub fn ternarize_ste_with_gamma(w: &Tensor, threshold: f32, gamma: &Tensor) -> Result<Tensor> {
    let dtype = w.dtype();
    let pos_mask = w.gt(threshold)?;
    let neg_mask = w.lt(-threshold)?;
    let quantized = pos_mask.to_dtype(dtype)?.broadcast_sub(&neg_mask.to_dtype(dtype)?)?;
    let quantized = quantized.broadcast_mul(gamma)?;
    let diff = quantized.broadcast_sub(w)?;
    Ok(w.broadcast_add(&diff.detach())?)
}

#[cfg(test)]
mod grad_tests {
    use super::*;
    use candle_core::{Device, Tensor, Var};

    fn norm(t: &Tensor) -> f32 {
        t.sqr().unwrap().sum_all().unwrap().to_scalar::<f32>().unwrap().sqrt()
    }

    // Does gradient reach (a) the weight and (b) the layer INPUT through STE + matmul?
    // A broken grad_X is the fingerprint of "only lm_head trains, body is None".
    #[test]
    fn ste_propagates_grad_to_weight_and_input() {
        let dev = Device::Cpu;
        let w = Var::from_tensor(&Tensor::randn(0f32, 1.0, (8, 8), &dev).unwrap()).unwrap();
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (4, 8), &dev).unwrap()).unwrap();
        let gamma = w.as_tensor().abs().unwrap().mean_all().unwrap().detach();
        let w_t = ternarize_ste_with_gamma(w.as_tensor(), 0.05, &gamma).unwrap();
        let y = x.as_tensor().matmul(&w_t.t().unwrap()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        let grads = loss.backward().unwrap();
        let gw = grads.get(w.as_tensor());
        let gx = grads.get(x.as_tensor());
        let frac = { let v = w_t.flatten_all().unwrap().to_vec1::<f32>().unwrap();
            v.iter().filter(|&&z| z != 0.0).count() as f32 / v.len() as f32 };
        println!("[STE] ternary nonzero frac={:.3} | grad_W some={} norm={:?} | grad_X some={} norm={:?}",
            frac, gw.is_some(), gw.as_ref().map(|g| norm(g)), gx.is_some(), gx.as_ref().map(|g| norm(g)));
        assert!(gw.is_some() && norm(&gw.unwrap()) > 0.0, "grad_W missing/zero");
        assert!(gx.is_some() && norm(&gx.unwrap()) > 0.0, "grad_X missing/zero — body would be frozen");
    }

    // ── Per-submodule grad_X probes ──────────────────────────────────────────
    // Each feeds an input Var through one submodule at toy size and checks whether
    // gradient propagates back to the INPUT. A None/zero grad_X here is the break
    // that freezes everything below it in the full model.
    use candle_nn::{VarBuilder, VarMap};
    use candle_core::DType;
    use crate::model::{attention::Attention, moe::MoeBlock, anastomosis::AnastomosisLayer,
                       transformer::Block, config::TransformerConfig};

    fn vb_pair(dev: &Device) -> (VarMap, VarBuilder<'static>) {
        let vm = VarMap::new();
        let vb = VarBuilder::from_varmap(&vm, DType::F32, dev);
        (vm, vb)
    }
    fn grad_x_report(name: &str, x: &Var, grads: &candle_core::backprop::GradStore) {
        let gx = grads.get(x.as_tensor());
        let n = gx.as_ref().map(|g| norm(g));
        println!("[{name}] grad_X some={} norm={:?}", gx.is_some(), n);
        assert!(gx.is_some() && n.unwrap() > 0.0, "{name}: grad_X None/zero — break here");
    }

    #[test]
    fn probe_attention_grad_x() {
        let dev = Device::Cpu; let h = 16;
        let (_vm, vb) = vb_pair(&dev);
        let attn = Attention::new(h, 2, vb.pp("attn"), 0.005).unwrap();
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let y = attn.forward(x.as_tensor()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        grad_x_report("ATTN", &x, &loss.backward().unwrap());
    }

    #[test]
    fn probe_moe_grad_x() {
        let dev = Device::Cpu; let h = 16;
        let (_vm, vb) = vb_pair(&dev);
        let moe = MoeBlock::new(h, 4, vb.pp("moe"), 0.005).unwrap();
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let y = moe.forward(x.as_tensor()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        grad_x_report("MOE", &x, &loss.backward().unwrap());
    }

    #[test]
    fn probe_anastomosis_grad_x() {
        let dev = Device::Cpu; let h = 16;
        let (_vm, vb) = vb_pair(&dev);
        let anast = AnastomosisLayer::new(h, vb.pp("anast")).unwrap();
        let xa = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let xb = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let (ya, yb) = anast.forward(xa.as_tensor(), xb.as_tensor()).unwrap();
        let loss = (ya.sqr().unwrap().sum_all().unwrap() + yb.sqr().unwrap().sum_all().unwrap()).unwrap();
        let grads = loss.backward().unwrap();
        grad_x_report("ANAST_A", &xa, &grads);
        grad_x_report("ANAST_B", &xb, &grads);
    }

    #[test]
    fn probe_full_block_grad_x() {
        let dev = Device::Cpu; let h = 16;
        let (_vm, vb) = vb_pair(&dev);
        let cfg = TransformerConfig { hidden_size: h, num_heads: 2, num_experts: 4,
            num_layers: 1, num_streams: 1, fusion_layers: vec![], ..Default::default() };
        let block = Block::new(&cfg, vb.pp("blk"), 0.005).unwrap();
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let y = block.forward(x.as_tensor()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        grad_x_report("BLOCK", &x, &loss.backward().unwrap());
    }

    // Two stacked STE layers: gradient must reach the BOTTOM (body) layer's weight.
    #[test]
    fn ste_grad_reaches_bottom_of_stack() {
        let dev = Device::Cpu;
        let w1 = Var::from_tensor(&Tensor::randn(0f32, 1.0, (8, 8), &dev).unwrap()).unwrap();
        let w2 = Var::from_tensor(&Tensor::randn(0f32, 1.0, (8, 8), &dev).unwrap()).unwrap();
        let x = Tensor::randn(0f32, 1.0, (4, 8), &dev).unwrap();
        let g1 = w1.as_tensor().abs().unwrap().mean_all().unwrap().detach();
        let g2 = w2.as_tensor().abs().unwrap().mean_all().unwrap().detach();
        let w1t = ternarize_ste_with_gamma(w1.as_tensor(), 0.05, &g1).unwrap();
        let w2t = ternarize_ste_with_gamma(w2.as_tensor(), 0.05, &g2).unwrap();
        let h = x.matmul(&w1t.t().unwrap()).unwrap();
        let y = h.matmul(&w2t.t().unwrap()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        let grads = loss.backward().unwrap();
        let gb = grads.get(w1.as_tensor());
        let gt = grads.get(w2.as_tensor());
        println!("[STACK] bottom some={} norm={:?} | top some={} norm={:?}",
            gb.is_some(), gb.as_ref().map(|g| norm(g)), gt.is_some(), gt.as_ref().map(|g| norm(g)));
        assert!(gt.is_some() && norm(&gt.unwrap()) > 0.0, "top layer not learning");
        assert!(gb.is_some() && norm(&gb.unwrap()) > 0.0, "BOTTOM layer None/zero — grad doesn't reach body");
    }

    // Faithful replication of train_bible's [GRAD-DIAG] on a TINY dual-stream model.
    // None-vs-Some is structural (value-independent), so this reproduces the live
    // "blocks: 0 have grad / N None" signature locally if the break is in the model graph.
    fn run_full_diag(num_streams: usize, fusion_layers: Vec<usize>) -> (usize, usize, usize, usize) {
        use crate::model::transformer::Transformer;
        use candle_nn::loss::cross_entropy;
        let dev = Device::Cpu;
        let cfg = TransformerConfig {
            vocab_size: 32, hidden_size: 16, num_layers: 2, num_heads: 2,
            max_seq_len: 8, threshold: 0.005, num_experts: 4, num_streams, fusion_layers,
            activation_checkpoint_interval: 0,
        };
        let vm = VarMap::new();
        let vb = VarBuilder::from_varmap(&vm, DType::F32, &dev);
        let model = Transformer::new(&cfg, vb).unwrap();
        let ids = Tensor::from_vec(vec![1u32, 5, 9, 13], (1, 4), &dev).unwrap();
        let logits = model.forward(&ids).unwrap().reshape((4, cfg.vocab_size)).unwrap();
        let target = Tensor::from_vec(vec![2u32, 6, 10, 14], 4, &dev).unwrap();
        let loss = cross_entropy(&logits, &target).unwrap();
        let grads = loss.backward().unwrap();
        let (mut blk_with, mut blk_none, mut emb_with, mut lm_with) = (0, 0, 0, 0);
        for (name, var) in vm.data().lock().unwrap().iter() {
            let has = grads.get(var.as_tensor()).is_some();
            if name.starts_with("blocks.") || name.starts_with("blocks_b.") {
                if has { blk_with += 1 } else { blk_none += 1 }
            } else if name.starts_with("embed") && has { emb_with += 1 }
            else if name.starts_with("lm_head") && has { lm_with += 1 }
        }
        println!("[FULL-DIAG streams={num_streams}] blocks: {blk_with} have grad / {blk_none} None | emb_with={emb_with} lm_with={lm_with}");
        (blk_with, blk_none, emb_with, lm_with)
    }

    #[test]
    fn probe_layernorm_input_grad() {
        let dev = Device::Cpu; let h = 16;
        let (_vm, vb) = vb_pair(&dev);
        let ln = candle_nn::layer_norm(h, 1e-5, vb.pp("ln")).unwrap();
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let y = candle_nn::Module::forward(&ln, x.as_tensor()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        let grads = loss.backward().unwrap();
        let gx = grads.get(x.as_tensor());
        println!("[LN] grad_X some={} norm={:?}", gx.is_some(), gx.as_ref().map(|g| norm(g)));
        // stacked: STE-linear -> LN -> sum; does the linear weight below LN get grad?
        let w = Var::from_tensor(&Tensor::randn(0f32, 1.0, (h, h), &dev).unwrap()).unwrap();
        let g = w.as_tensor().abs().unwrap().mean_all().unwrap().detach();
        let wt = ternarize_ste_with_gamma(w.as_tensor(), 0.05, &g).unwrap();
        let xin = Tensor::randn(0f32, 1.0, (4, h), &dev).unwrap();
        let lin = xin.matmul(&wt.t().unwrap()).unwrap();
        let lny = candle_nn::Module::forward(&ln, &lin.reshape((1,4,h)).unwrap()).unwrap();
        let loss2 = lny.sqr().unwrap().sum_all().unwrap();
        let grads2 = loss2.backward().unwrap();
        let gw = grads2.get(w.as_tensor());
        println!("[LN->below] linear weight under LN: some={} norm={:?}", gw.is_some(), gw.as_ref().map(|g| norm(g)));
    }

    #[test]
    fn manual_layernorm_restores_input_grad() {
        let dev = Device::Cpu; let h = 16;
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let w = Tensor::ones(h, DType::F32, &dev).unwrap();
        let b = Tensor::zeros(h, DType::F32, &dev).unwrap();
        let eps = 1e-5f64;
        // Hand-rolled LayerNorm with basic differentiable ops (never the fused kernel).
        let xt = x.as_tensor();
        let mean = (xt.sum_keepdim(candle_core::D::Minus1).unwrap() / h as f64).unwrap();
        let xc = xt.broadcast_sub(&mean).unwrap();
        let var = (xc.sqr().unwrap().sum_keepdim(candle_core::D::Minus1).unwrap() / h as f64).unwrap();
        let xn = xc.broadcast_div(&(var + eps).unwrap().sqrt().unwrap()).unwrap();
        let y = xn.broadcast_mul(&w).unwrap().broadcast_add(&b).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        let grads = loss.backward().unwrap();
        let gx = grads.get(x.as_tensor());
        println!("[MANUAL-LN] grad_X some={} norm={:?}", gx.is_some(), gx.as_ref().map(|g| norm(g)));
        assert!(gx.is_some() && norm(&gx.unwrap()) > 0.0, "manual LN must pass input grad");
    }

    #[test]
    fn bisect_single_vs_dual_stream() {
        let single = run_full_diag(1, vec![]);
        let dual   = run_full_diag(2, vec![1]);
        println!("SINGLE blk_with={} blk_none={} | DUAL blk_with={} blk_none={}",
            single.0, single.1, dual.0, dual.1);
        // Hard regression guard: every block weight must receive a gradient, and
        // the embedding + lm_head must too. A future gradient wall (e.g. a fused
        // norm/op without backward) trips this immediately.
        assert!(single.1 == 0 && single.0 > 0, "single-stream: {} block weights have NO gradient (wall regressed)", single.1);
        assert!(dual.1 == 0 && dual.0 > 0, "dual-stream: {} block weights have NO gradient (wall regressed)", dual.1);
        assert!(single.2 == 1 && single.3 == 1 && dual.2 == 1 && dual.3 == 1, "embedding/lm_head lost gradient");
    }
}
