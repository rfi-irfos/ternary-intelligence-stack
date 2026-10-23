#[derive(Clone, Debug)]
pub struct TransformerConfig {
    pub vocab_size: usize,
    pub hidden_size: usize,
    pub num_layers: usize,
    pub num_heads: usize,
    pub max_seq_len: usize,
    pub threshold: f32,
    pub num_experts: usize,
    /// Number of parallel streams (1 = single-stream, 2 = mycelial cord dual-stream).
    pub num_streams: usize,
    /// Layer indices where anastomosis gates fuse the two streams (Fibonacci positions).
    /// Empty when num_streams == 1.
    pub fusion_layers: Vec<usize>,
    /// Gradient activation checkpointing interval. If > 0, every N layers activations
    /// are not saved; instead inputs are saved and forward is recomputed during backward.
    /// 0 = disabled (default). Typical values: 2-4 for memory savings of ~30-50%.
    pub activation_checkpoint_interval: usize,
}

impl Default for TransformerConfig {
    fn default() -> Self {
        Self {
            vocab_size: 32000,
            hidden_size: 64,
            num_layers: 2,
            num_heads: 4,
            max_seq_len: 64,
            threshold: 0.02,
            num_experts: 8,
            num_streams: 1,
            fusion_layers: vec![],
            activation_checkpoint_interval: 0,
        }
    }
}

impl TransformerConfig {
    /// Per-layer ternary threshold: early layers stay dense (small threshold = more weights active),
    /// deeper layers grow sparse (larger threshold = more weights zeroed → faster inference).
    /// Range: 0.01 (layer 0) → up to 0.05 (deepest layer).
    pub fn layer_threshold(&self, layer_idx: usize) -> f32 {
        let base = 0.01_f32;
        let top  = self.threshold.max(0.03);
        let step = if self.num_layers > 1 {
            (top - base) / (self.num_layers - 1) as f32
        } else {
            0.0
        };
        (base + step * layer_idx as f32).min(0.05)
    }
}
