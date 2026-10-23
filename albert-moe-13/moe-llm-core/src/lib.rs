//! LLM integration core for the MoE-13 ternary inference engine.
pub mod model;
pub mod trace;
pub mod tokenizer;
pub mod evolution;
pub mod mycelium;
pub mod spore;
pub mod wald;
pub mod ste;
pub mod mandelbrot;
#[cfg(feature = "cuda")]
pub mod cuda_kernel;
