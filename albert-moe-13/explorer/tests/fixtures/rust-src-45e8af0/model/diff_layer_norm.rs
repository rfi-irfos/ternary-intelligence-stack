// Differentiable LayerNorm built from primitive candle ops.
//
// WHY THIS EXISTS:
// candle_nn::LayerNorm::forward takes a fused fast-path when the input is
// contiguous + affine (has bias) + remove_mean — it dispatches to
// candle_nn::ops::layer_norm, whose CustomOp3 implements no `bwd`. On that path
// the INPUT gradient is silently dropped (None), so every layer upstream of a
// norm receives no gradient. In this model ln1/ln2/ln_f all get contiguous
// inputs (attention emits .contiguous() tensors), so the whole backbone froze
// and only lm_head trained. Reproduced + guarded in model/ste.rs::grad_tests.
//
// This implementation uses only primitive, autograd-tracked ops and is
// numerically identical to candle_nn::LayerNorm's own slow/fallback path
// (size N, biased variance, eps inside the sqrt), so checkpoints load unchanged
// (same "weight"/"bias" var names + shapes) and outputs match — it just keeps
// the gradient flowing to the input.
use candle_core::{DType, Result, Tensor, D};
use candle_nn::{Init, VarBuilder};

#[derive(Clone, Debug)]
pub struct DiffLayerNorm {
    weight: Tensor,
    bias: Tensor,
    eps: f64,
}

impl DiffLayerNorm {
    pub fn new(size: usize, eps: f64, vb: VarBuilder) -> Result<Self> {
        let weight = vb.get_with_hints(size, "weight", Init::Const(1.0))?;
        let bias = vb.get_with_hints(size, "bias", Init::Const(0.0))?;
        Ok(Self { weight, bias, eps })
    }

    pub fn forward(&self, x: &Tensor) -> Result<Tensor> {
        let x_dtype = x.dtype();
        // Match candle: accumulate norm stats in F32 for half-precision inputs.
        let internal = match x_dtype {
            DType::F16 | DType::BF16 => DType::F32,
            d => d,
        };
        let h = x.dim(D::Minus1)?;
        let xc = x.to_dtype(internal)?;
        let mean = (xc.sum_keepdim(D::Minus1)? / h as f64)?;
        let xc = xc.broadcast_sub(&mean)?;
        let var = (xc.sqr()?.sum_keepdim(D::Minus1)? / h as f64)?;
        let x_normed = xc.broadcast_div(&(var + self.eps)?.sqrt()?)?;
        let x_normed = x_normed.to_dtype(x_dtype)?;
        x_normed.broadcast_mul(&self.weight)?.broadcast_add(&self.bias)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use candle_core::{Device, Var};
    use candle_nn::VarMap;

    // The whole point: input gradient must survive (candle_nn::LayerNorm drops it).
    #[test]
    fn diff_layer_norm_passes_input_grad() {
        let dev = Device::Cpu;
        let h = 16;
        let vm = VarMap::new();
        let vb = VarBuilder::from_varmap(&vm, DType::F32, &dev);
        let ln = DiffLayerNorm::new(h, 1e-5, vb).unwrap();
        let x = Var::from_tensor(&Tensor::randn(0f32, 1.0, (1, 4, h), &dev).unwrap()).unwrap();
        let y = ln.forward(x.as_tensor()).unwrap();
        let loss = y.sqr().unwrap().sum_all().unwrap();
        let grads = loss.backward().unwrap();
        let gx = grads.get(x.as_tensor());
        let n = gx.as_ref().map(|g| g.sqr().unwrap().sum_all().unwrap().to_scalar::<f32>().unwrap().sqrt());
        println!("[DIFF-LN] grad_X some={} norm={:?}", gx.is_some(), n);
        assert!(gx.is_some() && n.unwrap() > 0.0, "DiffLayerNorm must pass input gradient");
    }
}
