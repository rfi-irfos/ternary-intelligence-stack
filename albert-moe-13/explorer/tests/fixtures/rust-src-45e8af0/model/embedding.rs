use candle_core::{Result, Tensor};
use candle_nn::{Embedding, Module, VarBuilder};

pub struct EmbeddingLayer {
    embeddings: Embedding,
}

impl EmbeddingLayer {
    pub fn new(vocab_size: usize, hidden_size: usize, vb: VarBuilder) -> Result<Self> {
        let embeddings = candle_nn::embedding(vocab_size, hidden_size, vb.pp("weight"))?;
        Ok(Self { embeddings })
    }

    pub fn forward(&self, x: &Tensor) -> Result<Tensor> {
        self.embeddings.forward(x)
    }
}
