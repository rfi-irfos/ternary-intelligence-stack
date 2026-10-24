# Albert MoE-13 — Checkpoint Registry

Training artifacts for the Albert MoE-13 ternary language model.

---

## Active Checkpoint

**`albert_v3.0`** — current training state (launched 2026-05-10)

| Field | Value |
|-------|-------|
| Format | `.safetensors` (float32 weights, HuggingFace standard) |
| Config | `albert_v3.0.config.json` |
| Epoch counter | `albert_v3.0.meta` (plain text integer) |
| Architecture | **Dual-stream 2×256H** · **46L** per stream · 4H/stream · **1,104 total expert-routing slots** (12E/layer × 46L × 2 streams, independent per-stream routing gate) · 7 anastomosis gates (layers [2,3,5,8,13,21,34]) · **512CTX** · 32000V (source: checkpoint header 2026-09-23 and `albert_v3.0.config.json`; the config's `num_layers` still says 38, the checkpoint is ground truth) |
| Global Epoch | **9270** (last recorded, training stopped; `epoch_history.log` last write 2026-09-23; `albert_v3.0.meta` here still holds the older value 8869) |
| Sync | run `albert-train modal pull` to sync checkpoint |
| Best chip loss | **1.2637** (post-S18, 2026-06-14) |
| Best epoch avg | **3.8420** (ep9265, 46L; lowest `loss_avg` in `epoch_history.log`). Last recorded epoch 9270: loss_avg 3.9353, loss_best 3.8420 |
| Evolution state | as of 2026-06-15: fib_index=7 · window=34 · Gen3 step1/6 (not re-verified after S33) |
| Corpus | 451,418,681 tokens — multilingual: Wikipedia CC BY-SA + Europarl + Gutenberg + chaos layer (EN/DE/FR/ES/PT/IT/NL/PL) |
| Tensors | **3606** (dual-stream blocks: stream_a/stream_b per layer; shared experts; 7 anastomosis gates; embed; lm_head) |
| Parameters | **331,140,622** (sum of tensor shapes in the checkpoint header) |
| Safetensors size | **1,324,935,080 bytes (~1.32 GB)**, F32 (`albert_v3.0.best.safetensors`) |

The checkpoint is overwritten at the end of every 300-batch epoch. The `.meta` file stores the global epoch count across all training sessions. Training runs on Modal T4 GPU; use `albert-train pull` to sync the latest checkpoint back to local `models/`.

---

## Config Schema

`albert_v3.0.config.json`:
```json
{
  "hidden_size": 256,
  "num_layers": 26,
  "num_heads": 4,
  "max_seq_len": 256,
  "num_experts": 12,
  "vocab_size": 32000,
  "num_streams": 2,
  "fusion_layers": [2, 3, 5, 8, 13, 21]
}
```

`num_layers` is updated in-place by the `EvolutionManager` when Net2Net surgery fires. `num_streams: 2` and `fusion_layers` were added by cord surgery (ep4202). Single-stream checkpoints (`num_streams` absent or `1`) are backwards-compatible. The training binary reads this file on each `train_cycle` start, so the growing architecture is always picked up correctly.

---

## Version History

| Version | Architecture | Key Event | Global Epoch |
|---------|-------------|-----------|--------------|
| v3.0 current | **2×256H dual-stream · 46L** · 4H/stream · **1,104 expert-routing slots** (12E/layer × 46L × 2 streams) · 7 anastomosis gates | Training stopped at ep9270; **33 depth surgeries** + 1 cord surgery complete; lowest loss_avg **3.8420** (ep9265) | **9270** (stopped) |
| v3.0 cord | **2×256H dual-stream · 25L** | Cord surgery ep4202 — first ever autonomous bifurcation to dual-stream; Stream B Mandelbrot-perturbed | ep4202 (2026-05-27T16:44Z) |
| v3.0 | 256H · **12L→25L** · 4H · 12E · 32000V | Multilingual launch; 12L weights transferred from v2.0.0; 32k ByteLevel BPE vocab; 13 depth surgeries | 0→4202 |
| v2.0.0 · 12L | 256H · **12L** · 4H · 12E · 8000V | Max depth reached; layer crystallization (L0-L3 frozen, L11 hot); TTL cycling reds self-resolving | 454→477 (archived) |
| v2.0.0 · 5L–11L | 256H · 5L→11L · 4H · 12E | Autonomous surgery chain; EvolutionManager max_layers=12 cap enforced on all paths | ~385–454 |
| v2.0.0 · 5L | 256H · **5L** · 4H · 12E | Net2Net surgery 4L→5L; TTL routing + anti-stagnation burst; lb_lambda=0.03 | ~381–385 |
| v2.0.0 · 4L | 256H · 4L · 4H · 12E | 256H upgrade; TTL routing (TARGET fix); LB loss λ 0.01→0.02→0.03 | ~340–381 |
| v1.3.6 | 96H · 3L · 8E | Stable foundation; STE + top-3 MoE routing | ~200–340 |
| v1.3.5 | 96H · 3L · 8E | Initial 13-node MoE | 0–200 |

Archived snapshots in `models/registry/` include config, report, and evolution metadata.

---

## Surgery Log

### v3.0 (current)

| Event | Global Epoch | From | To | Notes |
|-------|-------------|------|----|-------|
| **S19** | **~ep6500** | 2×256H · 31L | 2×256H · **32L** | 2026-06-15 · current depth; EP-AVG ATL descending |
| S18 | ep6339 | 2×256H · 30L | 2×256H · **31L** | 2026-06-14 |
| S17 | ~ep5610 | 2×256H · 29L | 2×256H · **30L** | 2026-06-06 |
| S16 | ~58xx | 2×256H · 28L | 2×256H · **29L** | Depth surgery; fib_index advancement |
| S15 | ~54xx | 2×256H · 27L | 2×256H · **28L** | Depth surgery; continued Gen3 descent |
| S14 | ~50xx | 2×256H · 26L | 2×256H · **27L** | First post-S13 depth surgery; Gen3 step2/6 |
| S13 | ~4242 | 2×256H · 25L | 2×256H · **26L** | First post-cord depth surgery; both streams; fib_index 6→7; chip ATL 8.6852 |
| CORD | ~4237 | 256H · 25L | **2×256H dual-stream · 25L** | Autonomous cord surgery — single-stream bifurcation; 6 anastomosis gates; 1966→2044 tensors |
| S12 | ~4237 | 256H · 24L | 256H · **25L** | Gen3 plateau triggered 2026-05-27T16:43Z |
| S11b | ~4175 | 256H · 23L | 256H · **24L** | 2026-05-27; rapid plateau ~42ep after S11 |
| S11 | ~4133 | 256H · 22L | 256H · **23L** | 2026-05-27 morning |
| S10 | ~3687 | 256H · 21L | 256H · **22L** | Best 9.2933 pre-surgery |
| S9 | ~3472 | 256H · 20L | 256H · **21L** | Largest post-surgery spike in v3 history; TTL hard-column stops |
| S8 | ~3418 | 256H · 19L | 256H · **20L** | Only 58 epochs after S7 |
| S7 | ~3360 | 256H · 18L | 256H · **19L** | 2026-05-24T13:47Z; 1315 tensors |
| S6 | ~2522 | 256H · 17L | 256H · **18L** | 2026-05-20T21:33Z; Gen1 step1/6 |
| S1–S5 | ep511–702 | 256H · 12L | 256H · **17L** | Fibonacci + Mandelbrot windows |

### v2.0.0 (archived)

| Event | Global Epoch | From | To | Notes |
|-------|-------------|------|----|-------|
| 11L → 12L | ~454 | 256H · 11L | 256H · 12L | Max depth reached; transferred to v3.0 at ep477 |
| 10L → 11L | ~445 | 256H · 10L | 256H · 11L | Autonomous plateau surgery |
| 5L → 6L through 9L→10L | ~395–435 | — | — | Autonomous surgery chain |
| 4L → 5L | ~381 | 256H · 4L | 256H · 5L | Net2Net layer copy |
| 3L → 4L | ~340 | 256H · 3L | 256H · 4L | First 256H surgery |
| 128H → 256H | ~200 | 128H · 3L | 256H · 3L | Hidden size expansion |

---

## Checkpoint Loading

The training binary loads with shape matching:

```rust
for (name, var) in all_vars.iter() {
    if let Some(tensor) = checkpoint_data.get(name) {
        let _ = var.set(tensor);
    }
}
```

**Architecture change (e.g. surgery):** new layer weights are copied from the deepest existing layer before saving. On next load, all shapes match — 689 tensors for 12L.

---

## v3.0 — Active (launched 2026-05-10)

v2.0.0 archived at Global Epoch 477+, best loss 6.8821. v3.0 launched 2026-05-10:

1. Archived `bible_ternary_v2.0.0.safetensors` (preserved in `models/registry/`)
2. 687 vocabulary-agnostic tensors transferred: `blocks.*`, `ln_f.*`, `pos_embed.weight`
3. `embed.weight` and `lm_head.weight` rebuilt at 32,000 tokens (ByteLevel BPE, multilingual)
4. Active checkpoint: `albert_v3.0.safetensors`

The transfer preserved the 12L architecture, routing specialisation, and expert differentiation from v2.0.0. Only the vocabulary interface was replaced.

---

## Serialization Format

Checkpoints use [SafeTensors](https://github.com/huggingface/safetensors) — header-based, memory-mapped, cross-framework compatible. Weights stored in float32 for training; ternary quantization applied at runtime via STE.

Future: `.trit` packed format (5 trits/byte) for hardware deployment.

---

## See Also

- [Main README](../README.md)
- [Benchmark Suite](../bench/install.sh) — one-line installer, exports CSV
- [Architecture](../docs/architecture.md)
- [Roadmap](../docs/roadmap.md)
