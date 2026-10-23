// albert_trace: one traced forward pass of the real albert. checkpoint for the 3D explorer.
//
//   albert_trace --checkpoint P --config C --tokenizer T --prompt-id ID --prompt TEXT \
//                --commit SHA --out FILE [--date ISO]
//
// Writes { provenance, events, top_k, top_k_training_path } as JSON. Needs `--features trace`.
// Checks: num_layers comes from the checkpoint tensor names (not the config), and every
// checkpoint tensor must be requested by the model (an unused tensor is an error).

#![cfg(feature = "trace")]

use candle_core::{safetensors::MmapedSafetensors, DType, Device, IndexOp, Shape, Tensor};
use candle_nn::{var_builder::SimpleBackend, Init, VarBuilder};
use moe_llm_core::model::{enter_eval_mode, Transformer, TransformerConfig};
use moe_llm_core::tokenizer::BpeTokenizer;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashSet};
use std::io::Read;
use std::sync::{Arc, Mutex};

const TTL_RULE: &str = "fresh process; warm-up, modifiers inactive";
const ROUTER_NOTE: &str = "softmax top-3 probabilities before traffic-light output scales";
const TOP_K: usize = 5;

// ---- checkpoint names -------------------------------------------------------

/// Number of layers = distinct `blocks.N.` prefixes; N must run 0..n without gaps.
fn num_layers_from_checkpoint(names: &[String]) -> Result<usize, String> {
    let mut idx = BTreeSet::new();
    for n in names {
        if let Some(rest) = n.strip_prefix("blocks.") {
            let num = rest.split('.').next().unwrap_or("");
            idx.insert(num.parse::<usize>().map_err(|_| format!("bad block index in tensor name {n}"))?);
        }
    }
    if idx.is_empty() {
        return Err("checkpoint has no blocks.N tensors".into());
    }
    if idx.iter().copied().ne(0..idx.len()) {
        return Err(format!("block indices are not contiguous from 0: {idx:?}"));
    }
    Ok(idx.len())
}

fn unused_tensors(all: &[String], requested: &HashSet<String>) -> Result<(), String> {
    let mut unused: Vec<&String> = all.iter().filter(|n| !requested.contains(*n)).collect();
    unused.sort();
    if unused.is_empty() {
        Ok(())
    } else {
        let shown: Vec<&str> = unused.iter().take(10).map(|s| s.as_str()).collect();
        Err(format!("{} checkpoint tensors never requested by the model, e.g. {shown:?}", unused.len()))
    }
}

/// Backend that delegates to the mmapped checkpoint and remembers every requested name.
struct Recording {
    inner: Box<dyn SimpleBackend>,
    seen: Arc<Mutex<HashSet<String>>>,
}

impl SimpleBackend for Recording {
    fn get(&self, s: Shape, name: &str, h: Init, dtype: DType, dev: &Device) -> candle_core::Result<Tensor> {
        self.seen.lock().unwrap().insert(name.to_string());
        self.inner.get(s, name, h, dtype, dev)
    }
    fn contains_tensor(&self, name: &str) -> bool {
        self.inner.contains_tensor(name)
    }
}

// ---- SHA-256 (streaming; no new dependency) ----------------------------------

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256_block(h: &mut [u32; 8], block: &[u8]) {
    let mut w = [0u32; 64];
    for i in 0..16 {
        w[i] = u32::from_be_bytes([block[4 * i], block[4 * i + 1], block[4 * i + 2], block[4 * i + 3]]);
    }
    for i in 16..64 {
        let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
        let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
    }
    let mut v = *h;
    for i in 0..64 {
        let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
        let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
        let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
        let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
        let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
        let t2 = s0.wrapping_add(maj);
        v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
    }
    for i in 0..8 {
        h[i] = h[i].wrapping_add(v[i]);
    }
}

fn sha256_reader<R: Read>(mut r: R) -> std::io::Result<String> {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut buf = vec![0u8; 1 << 20];
    let mut pending: Vec<u8> = Vec::with_capacity(128);
    let mut total: u64 = 0;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        let mut data = &buf[..n];
        if !pending.is_empty() {
            let take = (64 - pending.len()).min(data.len());
            pending.extend_from_slice(&data[..take]);
            data = &data[take..];
            if pending.len() == 64 {
                sha256_block(&mut h, &pending);
                pending.clear();
            }
        }
        let full = data.len() / 64 * 64;
        for c in data[..full].chunks_exact(64) {
            sha256_block(&mut h, c);
        }
        pending.extend_from_slice(&data[full..]);
    }
    pending.push(0x80);
    while pending.len() % 64 != 56 {
        pending.push(0);
    }
    pending.extend_from_slice(&(total * 8).to_be_bytes());
    for c in pending.chunks_exact(64) {
        sha256_block(&mut h, c);
    }
    Ok(h.iter().map(|x| format!("{x:08x}")).collect())
}

// ---- small helpers -------------------------------------------------------------

/// UTC `YYYY-MM-DDTHH:MM:SSZ` from the system clock (civil-from-days algorithm).
fn utc_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = ((secs / 86400) as i64, secs % 86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn top_k(logits: &Tensor, names: &tokenizers::Tokenizer) -> Result<Value, String> {
    let e = |x: candle_core::Error| x.to_string();
    let probs = candle_nn::ops::softmax(logits, 0).map_err(e)?.to_vec1::<f32>().map_err(e)?;
    let mut order: Vec<usize> = (0..probs.len()).collect();
    order.sort_by(|&a, &b| probs[b].total_cmp(&probs[a]));
    Ok(Value::Array(
        order.iter().take(TOP_K).map(|&i| {
            json!({ "token_id": i, "token": names.id_to_token(i as u32).unwrap_or_default(), "prob": probs[i] })
        }).collect(),
    ))
}

struct Args {
    checkpoint: String,
    config: String,
    tokenizer: String,
    prompt_id: String,
    prompt: String,
    commit: String,
    out: String,
    date: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut m = std::collections::HashMap::new();
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let key = k.strip_prefix("--").ok_or_else(|| format!("unexpected argument {k}"))?.to_string();
        m.insert(key, it.next().ok_or_else(|| format!("missing value for {k}"))?);
    }
    let mut get = |k: &str| m.remove(k).ok_or_else(|| format!("missing --{k}"));
    Ok(Args {
        checkpoint: get("checkpoint")?,
        config: get("config")?,
        tokenizer: get("tokenizer")?,
        prompt_id: get("prompt-id")?,
        prompt: get("prompt")?,
        commit: get("commit")?,
        out: get("out")?,
        date: get("date").ok(),
    })
}

// ---- main ----------------------------------------------------------------------

fn run() -> Result<(), String> {
    let a = parse_args()?;
    let e = |x: candle_core::Error| x.to_string();

    let cfg_json: Value = serde_json::from_str(&std::fs::read_to_string(&a.config).map_err(|x| x.to_string())?)
        .map_err(|x| x.to_string())?;
    let sha = sha256_reader(std::fs::File::open(&a.checkpoint).map_err(|x| x.to_string())?).map_err(|x| x.to_string())?;

    // SAFETY: the checkpoint file is not modified while mapped.
    let mmap = unsafe { MmapedSafetensors::new(&a.checkpoint) }.map_err(e)?;
    let names: Vec<String> = mmap.tensors().into_iter().map(|(n, _)| n).collect();
    let num_layers = num_layers_from_checkpoint(&names)?;

    let tokenizer = BpeTokenizer::new(&a.tokenizer);
    let raw_tok = tokenizers::Tokenizer::from_file(&a.tokenizer).map_err(|x| x.to_string())?;
    let usz = |k: &str, d: usize| cfg_json[k].as_u64().map(|v| v as usize).unwrap_or(d);
    let config = TransformerConfig {
        vocab_size: tokenizer.vocab_size(),
        hidden_size: usz("hidden_size", 256),
        num_layers,
        num_heads: usz("num_heads", 4),
        max_seq_len: usz("max_seq_len", 256),
        threshold: cfg_json["threshold"].as_f64().map(|v| v as f32).unwrap_or(0.02),
        num_experts: usz("num_experts", 12),
        num_streams: 2,
        fusion_layers: cfg_json["fusion_layers"].as_array()
            .map(|v| v.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect())
            .unwrap_or_default(),
        activation_checkpoint_interval: 0,
    };
    let tau_schedule: Vec<f32> = (0..num_layers).map(|i| config.layer_threshold(i)).collect();

    let seen = Arc::new(Mutex::new(HashSet::new()));
    let backend = Recording { inner: Box::new(mmap), seen: seen.clone() };
    let device = Device::Cpu;
    let vb = VarBuilder::from_backend(Box::new(backend), DType::F32, device.clone());
    let model = Transformer::new(&config, vb).map_err(e)?;
    unused_tensors(&names, &seen.lock().unwrap())?;
    model.prepare_inference().map_err(e)?;
    enter_eval_mode();
    model.clear_kv_cache();

    let ids = tokenizer.encode(&a.prompt);
    if ids.is_empty() {
        return Err("prompt encodes to zero tokens".into());
    }
    let ids_t = Tensor::new(ids.as_slice(), &device).map_err(e)?.to_dtype(DType::U32).map_err(e)?.unsqueeze(0).map_err(e)?;

    moe_llm_core::trace::begin();
    let prefill = model.forward_prefill(&ids_t).map_err(e);
    // take() immediately after forward_prefill, before any forward() call.
    let events = moe_llm_core::trace::take();
    let prefill = prefill?;
    let last = ids.len() - 1;
    let top = top_k(&prefill.i((0, last)).map_err(e)?, &raw_tok)?;

    // Training path: forward(), no anastomosis (A1). Logits only, no events.
    let train = model.forward(&ids_t).map_err(e)?;
    let top_train = top_k(&train.i((0, last)).map_err(e)?, &raw_tok)?;

    let tokens: Vec<String> = ids.iter().map(|&i| raw_tok.id_to_token(i).unwrap_or_default()).collect();
    let out = json!({
        "provenance": {
            "prompt_id": a.prompt_id,
            "prompt": a.prompt,
            "token_ids": ids,
            "tokens": tokens,
            "checkpoint_sha256": sha,
            "git_commit": a.commit,
            "num_layers": num_layers,
            "tau_schedule": tau_schedule,
            "ttl_rule": TTL_RULE,
            "mode": "eval",
            "path": "forward_prefill",
            "router_weights_note": ROUTER_NOTE,
            "date": a.date.unwrap_or_else(utc_now),
        },
        "events": events,
        "top_k": top,
        "top_k_training_path": top_train,
    });
    let file = std::fs::File::create(&a.out).map_err(|x| x.to_string())?;
    serde_json::to_writer(std::io::BufWriter::new(file), &out).map_err(|x| x.to_string())?;
    eprintln!("albert_trace: {} events, {} layers, sha256 {sha}, wrote {}", events_len(&out), num_layers, a.out);
    Ok(())
}

fn events_len(v: &Value) -> usize {
    v["events"].as_array().map(|a| a.len()).unwrap_or(0)
}

fn main() {
    if let Err(msg) = run() {
        eprintln!("albert_trace: error: {msg}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_names(layers: usize) -> Vec<String> {
        let mut v = vec!["embed.weight".to_string(), "ln_f.weight".to_string()];
        for i in 0..layers {
            v.push(format!("blocks.{i}.stream_a.ln1.weight"));
            v.push(format!("blocks.{i}.stream_b.ln1.weight"));
            v.push(format!("blocks.{i}.experts.0.c_fc.weight"));
        }
        v
    }

    #[test]
    fn num_layers_from_checkpoint_counts_block_prefixes() {
        assert_eq!(num_layers_from_checkpoint(&synthetic_names(46)), Ok(46));
        let mut gap = synthetic_names(3);
        gap.retain(|n| !n.starts_with("blocks.1."));
        assert!(num_layers_from_checkpoint(&gap).is_err());
        assert!(num_layers_from_checkpoint(&["embed.weight".to_string()]).is_err());
    }

    #[test]
    fn unused_tensors_is_error() {
        let all = synthetic_names(2);
        let mut seen: HashSet<String> = all.iter().cloned().collect();
        assert!(unused_tensors(&all, &seen).is_ok());
        seen.remove("embed.weight");
        let err = unused_tensors(&all, &seen).unwrap_err();
        assert!(err.contains("embed.weight"), "{err}");
    }

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(
            sha256_reader(&b"abc"[..]).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_reader(&b""[..]).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let million_a = vec![b'a'; 1_000_000];
        assert_eq!(
            sha256_reader(&million_a[..]).unwrap(),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[test]
    fn utc_now_has_iso_shape() {
        let d = utc_now();
        assert_eq!(d.len(), 20);
        assert!(d.starts_with("20") && d.ends_with('Z'));
    }
}
