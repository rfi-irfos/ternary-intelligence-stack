# Albert MoE-13 — Convergence Log

Empirical training-loss history for native ternary training from random initialization. The tracked metric is **EP-AVG ATL** — the all-time-low of the per-epoch average loss. Intra-batch ("chip") lows are noted separately where recorded.

Last updated: 2026-10-24 (S30–S33 and the last recorded state added from `epoch_history.log` and the 5-minute watch recorder; the sections below the next one keep their original dates).

## Current state (last recorded: epoch 9270, training stopped)

- **46L dual-stream** · 2×256H · 12 experts/stream · Top-3 routing · 512 ctx · 32k vocab · 7 anastomosis gates at layers [2,3,5,8,13,21,34] · 331,140,622 parameters (checkpoint header of `albert_v3.0.best.safetensors`, 46 layers, 3606 tensors; checkpoint file dated 2026-09-23, header read 2026-10-24).
- **Last recorded epoch 9270: loss_avg 3.9353, loss_best 3.8420** (`~/.albert/epoch_history.log`, last write 2026-09-23 03:40 local). Lowest `loss_avg` in the whole file (epochs 3499–9270): **3.8420 at ep9265**.
- **Training stopped** (Modal workspace paused). The 5-minute recorder repeats ep9270 until 2026-10-12T14:55Z.
- Depth surgeries S30–S33 (42L→46L) are listed in the ledger below. They were found on 2026-10-24; the S29 and later transitions are reconstructed from the +78 tensors per layer in the log's `tns` field.
- Metric naming: from this entry on, values carry the names used in `epoch_history.log` (`loss_avg`, `loss_best`). The older "EP-AVG ATL" values below equal `loss_avg` (for example 5.6077 at ep6700 is the `loss_avg` of that epoch).

## State on 2026-06-15 (historical)

- **32L dual-stream @ 128 ctx** · 2×256H · 12 experts/stream · Top-3 routing · 32k vocab · RoPE. (Just expanded from 31L — S19 below.)
- Re-loading the 451,418,681-token corpus to resume at 32L on Modal · Gen 1 step 1/6 · ceiling 34L (next Fibonacci ceiling 55L) · BATCH=1.
- **NEW EP-AVG ATL 5.6077 @ ~ep6700** (2026-06-15) — the 31L descent leg broke clean through 6.0 → 5.9 → 5.8 → 5.7 since S18 (was 5.8693 @ ep6487, 6.4126 @ ep6300 pre-S18). chip-ATL **1.2637** (held, distinct metric). All 12 experts alive (INF 100 / MEM 94 / LNG 79 / GEN 71 / ABS 59 …), dead_low=none, severity 0.000, mass ~5.9, fill ~45%.
- **★ S19 SURGERY fired ~ep6709 (2026-06-15T~09:09Z): Net2Net layer expansion 31L → 32L (both streams).** Plateau gate: smoothed Δ0.0160 over 55 epochs < 0.0200 threshold (early_mean 5.6508, late_mean 5.6347), MYCELIUM stable 10 ep, Gen 1 step 1/6. Earned via plateau, NOT injected. WATCH: the new **L0 grad-norm spiked to 0.757** (vs 0.03–0.05 elsewhere) — the freshly-inserted layer differentiating off its Net2Net identity init, CLIP-bounded; expected to settle as it embeds. (obs-log FN180.)
- Architecture grew **12L → 32L** via 19 layer-adding surgeries (S1–S19, with an interstitial S11b) + **1 cord surgery** (25L → dual-stream 2×25L, ep4202, 2026-05-27).

## All-time records

| Metric | Value | Epoch | Arch |
|---|---|---|---|
| **Best EP-AVG ATL** (epoch-average aggregate), updated 2026-10-24: lowest `loss_avg` in `epoch_history.log` | **3.8420** | ep9265 | 46L dual-stream (after S33) |
| Best EP-AVG ATL as of 2026-06-15 (superseded) | 5.6077 | ~ep6700 | 31L dual-stream (pre-S19) |
| **Best chip ATL** (best single intra-batch loss) | **1.2637** | ~ep6300 | 30L — distinct metric from EP-AVG; the gap between them is expected; value as of 2026-06-15, not re-checked after ep6700 |
| v2.0.0 best (3L, 8k vocab) | 6.9542 | ep11 | 3L single-stream |

Random baseline: `ln(32000) = 10.373` — expected starting loss with no prior knowledge over a 32k vocabulary.

## Surgery ledger (12L → 46L, + 1 cord; rows S1–S19 as of 2026-06-15, S30–S33 added 2026-10-24)

Reconciled from three sources: contemporaneous doc entries, the live dashboard annotations, and **checkpoint-mtime ground truth** — the per-layer `best.NNL.safetensors` archives, each written the instant its surgery fired. **✓ = mtime-verified.** Note: the dashboard's early "April" date labels are a month-typo artifact and are NOT used here — the first surgery (12→13L) is mtime-stamped 2026-05-13, so nothing in the run predates mid-May.

| Surgery | Transition | Epoch | Date | Anchor |
|---|---|---|---|---|
| S1 | 12L→13L | ~ep511 | 2026-05-13 | **✓ checkpoint mtime (06:46)** |
| S2–S5 | 13L→17L | ep547–702 | 2026-05-13/14 | doc |
| S6 | 17L→18L | ep2487 | 2026-05-20 | doc |
| S7 | 18L→19L | ep3325 | 2026-05-24 | doc |
| S8 | 19L→20L | ep3383 | 2026-05-24 | doc |
| S9 | 20L→21L | ~ep3470 | 2026-05-25 | doc — largest post-surgery spike in run history |
| S10 | 21L→22L | ~ep3652 | 2026-05-25 | doc |
| S11 | 22L→23L | ~ep4098 | 2026-05-27 | doc + dashboard |
| S11b | 23L→24L | ~ep4140 | 2026-05-27 | doc + dashboard |
| S12 + cord | 24L→25L, then 25L→2×25L | ep4202 | 2026-05-27 | doc + dashboard — first dual-stream |
| S13 | 25L→26L | ep4207 | 2026-05-27 | doc + dashboard |
| S14 | 26L→27L | ~ep4280 | 2026-05-29 | dashboard |
| S15 | 27L→28L | ~ep4350 | 2026-05-29 | dashboard |
| S16 | 28L→29L | ~ep4740 | 2026-05-31 | **✓ checkpoint mtime (05:24)** |
| S17 | 29L→30L | ep5610 | 2026-06-06 | **✓ checkpoint mtime (21:08)** |
| S18 | 30L→31L | ep6339 | 2026-06-13 | dashboard + obs-log FN179 — Gen 1 step 1/6, plateau-gated (Δ-0.0101/34ep < 0.0200); pre-surgery best archived |
| S19 | 31L→32L | ~ep6709 | 2026-06-15 | dashboard + obs-log FN180 — Gen 1 step 1/6, plateau-gated (Δ0.0160/55ep < 0.0200, late_mean 5.6347); new L0 grad-norm 0.757 = inserted layer warming off identity init |
| S20–S29 | 32L→42L | ~ep7000–ep8906 | 2026-06-21 to 2026-09-19 | not in this ledger; see the surgery log in `albert-moe-13/README.md` (S29 = 41L→42L, loss_avg 3.9625 before, 5.1015 after, ep8906→8907) |
| S30 | 42L→43L | ep8937→8938 | 2026-09-19, between 13:55Z and 14:00Z | `epoch_history.log` (tns 3294→3372) + 5-min recorder. loss_avg 3.9972 → 4.1694 |
| S31 | 43L→44L | ep8941→8942 | 2026-09-19, between 15:00Z and 15:05Z | same sources (tns 3372→3450). loss_avg 3.9978 → 4.1686 |
| S32 | 44L→45L | ep8957→8958 | 2026-09-19, between 18:50Z and 18:55Z | same sources (tns 3450→3528). loss_avg 3.9947 → 4.2715 |
| S33 | 45L→46L | ep8986→8987 | 2026-09-20, between 01:05Z and 01:10Z | same sources (tns 3528→3606). loss_avg 3.9810 → 5.1995. Last surgery; checkpoint header shows 46 layers |

The recorder gives a five-minute window, not an exact event time. Known discrepancy: the README gives S29 as 2026-09-19 02:58:32 CEST, the recorder shows the S29 jump between 03:20Z and 03:25Z (05:20–05:25 CEST), about 2.4 h later. The loss value 3.9625 agrees in both sources. The checkpoint header has 3606 tensors, equal to the log's final `tns` value (re-read 2026-10-24; an earlier note counted 3605).

---

## v3.0 — Active Training Run (2026-05-16, ongoing)

Architecture: **30L dual-stream** · 2×256H · 12 experts/stream · Top-3 routing · **128 ctx** · 32,000 vocab (ByteLevel BPE, multilingual EN/DE/FR/ES/PT/IT/NL/PL) · 6 anastomosis gates at Fibonacci layers [2,3,5,8,13,21]
Corpus: Stage 10 corpus active — stages [3,6,7,8,9,10] · 10% chaos layer invariant enforced · 451,418,681 tokens cache-loaded  
Optimizer: AdamW, cosine LR, GRAD_ACCUM=4, BATCH=1 (post-cord)  
Hardware: **Modal.com T4 GPU** · Training **active (ep~6205, live)** · 128CTX · BATCH=1 (post-cord)  
Weights: transferred from v2.0.0 best checkpoint (loss 6.8821); 13 depth surgeries + 1 cord surgery applied

Random baseline: `ln(32000) = 10.373` — the expected starting loss for a model with no prior knowledge over a 32k vocabulary.

### Understanding the vocabulary transfer plateau

v3.0 begins from a weight transfer of the v2.0.0 best checkpoint (loss 6.8821 over 8k vocab). The
semantic knowledge encoded in L0–L11 is intact. However, `embed` and `lm_head` are **re-initialized
from scratch** for the 32k token space — meaning the model must re-learn the full mapping from its
internal representations to 32,000 output tokens before any of that semantic knowledge can surface
in the loss curve.

This produces a plateau near the random baseline (`ln(32000) = 10.373`) that persists for many epochs.
This is not a failure of convergence — it is the cost of vocabulary transfer. The model is not starting
from zero; it is re-routing existing knowledge through a new output space. Once the embed/lm_head
alignment crosses a threshold, descent accelerates sharply and the carried-over semantic structure
becomes visible in the loss.

The EvolutionManager's `min_loss_for_plateau` guard (`= 8.4`) deliberately suppresses Net2Net surgery
during this phase. Growing the architecture while the output projection is still random would add
uninitialised capacity on top of a model that cannot yet use its existing capacity. Surgery is
correct only after the vocabulary transfer plateau breaks.

**Training started 2026-05-10. Surgery log and key milestones below.**

| Epoch | Architecture | Loss (avg) | Notes |
|-------|-------------|-----------|-------|
| Ep 1 (G35) | 12L | ~10.373 | Random baseline; vocab transfer plateau begins |
| Ep 12 (G46) | 12L | 10.3412 | Embed/lm_head alignment break; L6–L11 gradients activating |
| Ep 511 | **12L → 13L** | — | Net2Net surgery (Fibonacci window=13) |
| Ep 547 | **13L → 14L** | — | Net2Net surgery (Mandelbrot c_im=−0.6983, window=21) |
| Ep 611 | **14L → 15L** | — | Net2Net surgery (Mandelbrot c_im=0.2287, 69 tensors, window=34) |
| Ep 645–646 | **15L → 16L** | — | Net2Net surgery (Mandelbrot c_im=−0.3442, window→55) |
| Ep 701–702 | **16L → 17L** | — | Net2Net surgery (Mandelbrot c_im=0.5828, window→89); Stage 10 corpus unlocked |
| Ep 786 | 17L | 10.2199 | Previous all-time best; 22+ ATBs in overnight cascade |
| Ep 849 | 17L | 10.2050 | Former epoch ATL (now surpassed) |
| Ep 1155 | 17L | ~10.22 | New batch ATL: 10.1738; descent accelerating |
| Ep 1185 | 17L | ~10.21 | **New batch ATL: 10.1600**; hot layer shift L8→L10 (structural) |
| Ep 1189 | 17L | **10.1993** | **EPOCH ATL — first sub-10.20** |
| Ep 1390 | 17L | **10.1212** | Epoch ATL; hot layer shift L10→L5 |
| Ep 1435 | 17L | **10.1113** | Epoch ATL; **batch ATL: 10.0556** |
| Ep 1445 | 17L | — | **Batch ATL: 10.0396** — current intra-batch record |
| Ep 1455 | 17L | **10.1060** | Epoch ATL |
| Ep 1474 | 17L | **10.0982** | **EPOCH ATL — first sub-10.10**; surgery gate gap 0.298 nats |
| Ep 1482 | 17L | **10.0917** | Epoch ATL (2026-05-16); active descent streak |
| Ep ~1550 | 17L | — | AdamW buffer reset (accidental restart); 4× wider batch swings, steeper descent; buffers re-narrow over ~150 ep |
| Ep ~1670 | 17L | ~10.00 | Estimated first sub-10.0 epoch avg (interpolated from ep1482→ep2041 arc) |
| Ep ~1870 | 17L | ~9.90 | Estimated first sub-9.9 epoch avg |
| Ep 2041 | 17L | **9.8172** | Epoch ATL (2026-05-19T07:13Z); entered surgery alert zone |
| Ep 2049 | 17L | **9.8161** | Epoch ATL |
| Ep 2051 | 17L | **9.8109** | Epoch ATL; sub-9.82 |
| Ep 2059 | 17L | **9.8065** | Epoch ATL |
| Ep 2073 | 17L | **9.8033** | Epoch ATL (10:05Z) |
| Ep 2075 | 17L | **9.8024** | Epoch ATL |
| Ep 2080 | 17L | **9.7997** | **EPOCH ATL — FIRST SUB-9.8 · SURGERY LOSS GATE CLEARED** (2026-05-19T10:40Z) |
| Ep 2084 | 17L | **9.7976** | Epoch ATL (2026-05-19T11:00Z); plateau gate begins accumulating |
| Ep 2085–2108 | 17L | 9.800–9.810 | Plateau zone: tight oscillation; WALD 58+ stable epochs sev=0.950; since_best peaked at 19 |
| Ep 2109 | 17L | **9.7975** | Epoch ATL; alternating descent phase begins (LR cycle peak bites through attractor) |
| Ep 2111 | 17L | **9.7927** | Epoch ATL (d−0.0094); myc_L0-L3 stable |
| Ep 2114 | 17L | **9.7891** | Epoch ATL (d−0.0084); **batch ATL: 9.6235** (prev 9.6282); myc_L3 first uptick 1.61→1.68×10⁻⁹ |
| Ep 2116 | 17L | **9.7884** | **Current epoch ATL** (2026-05-19T13:40Z); 5 new ATLs in 7 epochs |
| Ep 2117–2120 | 17L | 9.791–9.794 | Consolidation: descent decelerating; drops shrinking (−0.0094/−0.0084/−0.0016); since_best=4; WALD sev=0.953 |

| Ep 2192 | 17L | **9.7641** | Epoch ATL (2026-05-19T~20:13Z); decisive break after 22-epoch oscillation shelf |
| Ep 2196 | 17L | **9.7633** | Epoch ATL (2026-05-19T~20:35Z); **batch ATL 9.5820** (ep2194) |
| Ep 2292 | 17L | **9.7170** | Epoch ATL (2026-05-20T~06:20Z); **batch ATL 9.4925** |
| Ep 2487 | 17L→**18L** | **SURGERY** | **17L→18L Net2Net surgery** (2026-05-20T~21:33Z). Mandelbrot c_im=0.0099. Plateau Δ0.0193/144ep. Gen 1 step 1/6. Window→233. Ceiling→21L. Pre-surgery best archived. |
| Ep 2489 | 18L | **9.6248** | **EPOCH ATL — first 18L ATL, no spike** (2026-05-20T~21:40Z). Batch ATL **9.3866** — single-epoch drop of −0.0313. LNG 0%→55%, CMP 100%, INT differentiating. |
| Ep 2530 | 18L | **9.6130** | Epoch ATL (2026-05-21T01:38Z). d−0.0099. cold=L0 event (embedding layer briefest coldest layer). |
| Ep 2533 | 18L | **9.6116** | Epoch ATL (01:54Z). d−0.0049. |
| Ep 2534 | 18L | **9.6100** | Epoch ATL (01:59Z). d−0.0017. |
| Ep 2537 | 18L | **9.5970** | Epoch ATL (02:14Z). d−0.0201 — large drop. |
| Ep 2545 | 18L | **9.5969** | Epoch ATL (02:55Z). d−0.0053. hot=L10, cold=L7 (embedding layer returns to normal). |
| Ep 2546 | 18L | **9.5926** | Epoch ATL (03:00Z). d−0.0043. |
| Ep 2548 | 18L | **9.5912** | Epoch ATL (03:10Z). d−0.0038. |
| Ep 2550 | 18L | **9.5910** | Epoch ATL (03:20Z). d−0.0114. |
| Ep 2556 | 18L | **9.5871** | Epoch ATL (03:51Z). d−0.0101. |
| Ep 2564 | 18L | **9.5855** | Epoch ATL (04:32Z). d−0.0069. **Simeon downloaded weights proactively (Modal budget 80%).** |
| Ep 2576 | 18L | **9.5800** | Epoch ATL (05:32Z). d−0.0236. **Bounce phase resolved (11 epochs). Probe trigger 9.58 reached.** wald_sev 0.948. |

| Ep 2860 | 18L | ~9.52 | **CLIFF 1** — sharp descent from ~9.61 base. Server-side ATL broke to 9.5236. |
| Ep 2887 | 18L | — | **Weight pull** — training paused mid-epoch (WiFi interruption; LAN cable installed). Restart from ep2887 checkpoint. Gap ep2888–2889 in CSV. |
| Ep 2890+ | 18L | ~9.50 | **CLIFF 2** — AdamW buffer reset on restart produced second cliff, floor ~9.50. ATL chip 9.1370. |
| Ep 2922 | 18L | **9.4992** | **9.50 FLOOR BROKEN** (2026-05-22T~19:11Z) — first server-side epoch-avg below 9.50 in entire v3.0 run. LOG expert surged 0%→28%; L10 gradient awakening. WALD fires (n=1508) preceded break. |
| Ep 2927 | 18L | **9.4891** | Epoch ATL (d−0.0080 — largest single-epoch ATL drop post-surgery-6). Routing diversifying: CTX 15%, GEN 13%, SYN 10%, INF 10% waking. |
| Ep 2938 | 18L | **9.4873** | Epoch ATL. Post-ATL bounce peak only +0.019 nats — tightest bounce in post-surgery-6 record. |
| Ep 3015 | 18L | — | ATL chip **9.0935** (intra-batch low). |
| Ep 3124 | 18L | **9.4131** | EP_AVG ATL. Hard plateau begins — since_best accumulating, EP_AVG pinned 9.42–9.46. |
| Ep 3263 | 18L | **9.3651** | **EP_AVG ATL** — broke 139-epoch plateau (9.4131 held since ep3124). ATL chip **9.0095** (was 9.0935). |
| Ep 3325 | 18L→**19L** | **SURGERY 7** | **18L→19L Net2Net surgery** (2026-05-24T13:47Z). Plateau Δ held 9.42–9.46 for 36+ epochs. 1315 tensors. [ttlfreeze] armed (ema_alpha=0.02), [divloss] 1e-3 weight override, gate-diversity 0.300. Pre-surgery best archived as `albert_v3.0.best.18L.safetensors`. |
| Ep 3326 | 19L | **9.3182** | **EP_AVG ATL — new record, first 19L epoch** (2026-05-24T~14:00Z). Improvement 0.047 nats over prior best. ATL chip **8.9190** (was 9.0095). WALD fired 6.2% (18 batches, expected post-surgery volatility). LR stepped down ~1.84e-4 → 1.13e-4. Expert reactivation: SYN/CTX back to 4%, PLN 79%, CMP 83%, INT 100%. |
| Ep 3383 | 19L→**20L** | **SURGERY 8** | **19L→20L Net2Net surgery** (2026-05-24T~20:00Z). Only **58 epochs** after surgery 7 — plateau formed almost immediately at 19L floor, governor fired. 1384 tensors. |
| Ep 3412 | 20L | — | ATL chip **8.8540** (−1.36% from prior 8.9190). 20L settling. Surgery gate: MYC_STABLE 31/≥5, PLATEAU 0.0054/<0.020 w=144, since_best=16. ~128 epochs of runway before next surgery consideration. EP_AVG ATL 9.3327. CMP 100%, PLN 77%, INT 68%. |
| Ep 3434 | 20L | **9.2934** | Closest 20L approach to ATL during plateau phase (since_best=51). |
| Ep 3454 | 20L | — | **WALD fired 8.3% · n=1500.** Loss-space coverage shift. INT routing surges 74%→91% (integration function waking). Cliff descent beginning. |
| Ep 3456 | 20L | **9.2847** | **EP_AVG ATL — new record** (2026-05-24T~23:57Z). Beats ep3383 9.2862 by 0.0015 nats. Chip ATL 8.8540 tied. CMP 100%, PLN 79%, INT 91%, TTL G15/O79/R5. Loss curve breaking downward at session close. |
| Ep ~3470 | 20L→**21L** | **SURGERY 9** | **20L→21L Net2Net surgery** (2026-05-25T~00:00Z). Pre-surgery EP_AVG best 9.2847. 1453 tensors. Mandelbrot perturbation applied to new layer. |
| Ep ~3470–3503 | 21L | **~9.43 peak** | **LARGEST POST-SURGERY SPIKE IN FULL TRAINING HISTORY** — unprecedented disruption. Loss spiked from ~9.29 to ~9.43, a +0.14 nat reversal. Every previous surgery (S1–S8 in v3.0; all surgeries in v2.0.0) produced zero visible spike — loss continued descending through the surgery event without interruption. S9 broke this pattern completely. Cause uncertain: candidate factors are (1) corpus complexity at 1.6 GB active stages making Mandelbrot perturbation more disruptive to established 20L representations, (2) first TTL hard-column stops in v3.0 history coinciding exactly with this event (routing suppressed the new 21st layer with full-column red blocks — never seen before S9), (3) possible depth threshold above which Net2Net is no longer transparent. |
| Ep 3503+ | 21L | **9.3930** | First post-spike epoch avg stabilising. TTL: G6/O80/R2 — hard stops releasing, orange dominant (recovery mode). PLN 100%, CMP 100%, INT 76% carrying the descent. Bullmarket phase begins. |
| Ep 3519 | 21L | — | EP AVG 9.3454 · T-610 9.3399. Recovery steepening. PLN 100%, CMP 100%. TTL G6/O80/R2. |
| Ep 3520 | 21L | **9.3326** | **BEST avg since S9 spike** — gold star event. EP AVG 9.3326, T-610 9.3399. First post-spike milestone; still 0.048 nats above pre-S9 ATL of 9.2847. Chip ATL 8.8540 unchanged (held from 20L). TTL G6/O75/R4. PLN 97%, CMP 100%, INT 84%. **Multi-epoch bullmarket recovery confirmed** — widest divergence from ATL followed by steepest return slope in full training history. |

| Ep ~3652 | 21L→**22L** | **SURGERY 10** | **21L→22L Net2Net surgery**. Plateau at 21L floor. Pre-surgery EP_AVG best **9.2933**. 1522 tensors. |
| Ep ~4098 | 22L→**23L** | **SURGERY 11** | **22L→23L Net2Net surgery** (2026-05-27 morning). Plateau at 22L floor. 1591 tensors. |
| Ep ~4140 | 23L→**24L** | **SURGERY 11b** | **23L→24L Net2Net surgery** (2026-05-27). Rapid plateau ~42 epochs after S11. 1660 tensors. |
| Ep 4202 | 24L→**25L** | **SURGERY 12** | **24L→25L Net2Net surgery** (2026-05-27T16:43Z). Gen3 plateau gate fired. fib_index=6 · window=34. 1729 tensors. |
| Ep 4202 | 25L → **2×25L** | **CORD SURGERY** | **MYCELIAL CORD — first ever, autonomous, 2026-05-27T16:44Z.** Single-stream 256H bifurcated to dual-stream 2×256H. Stream B initialized as Mandelbrot-perturbed copy of Stream A (stream_index=1). 6 anastomosis gates at Fibonacci layers [2,3,5,8,13,21], F32, init~0. 1966→2044 tensors. No prior art. |
| Ep ~4203 | dual-stream 25L | — | First post-cord epoch. Epoch-ATL **9.3241** (ep4203). Chip ATL **8.7123** — new all-time low, set in first dual-stream epoch. BATCH=1 post-cord. |
| Ep ~4207 | 25L→**26L** | **SURGERY 13** | **25L→26L Net2Net surgery** (2026-05-27T17:40Z). First depth surgery on dual-stream architecture — both streams expanded simultaneously. fib_index advanced 6→7 · window=34. Chip ATL **8.6852** — new all-time low post-S13. Gen3 step1/6. 2044 tensors. |
| Ep 4211 | dual-stream 26L | TRAINING PAUSE | Modal billing ceiling hit (2026-05-27T18:49Z). Training paused at ep4211/ep4234. Weights at ep4234 on Modal volume. Training will resume on Modal once billing settled. |

**Records at ep4211** (end of the table above — the pre-Gen3-descent state): EP-AVG ATL **9.2847** (ep3456, 20L); chip ATL **8.6852** (ep~4203, 26L). **Both were superseded by the Gen3 descent that follows** — the run went on to EP-AVG ATL **6.4339** (ep6132, 30L) and chip ATL **1.2637** (live). See the records table at the top of this doc.

**Surgery governor status:** 12L→30L complete (18 layer-adding surgeries + 1 cord). 30L dual-stream active. fib_index=7 · window=34 · Gen3 step1/6. Next: S18 (30L→31L, both streams) when the plateau gate fires.

### Post-S13: Gen3 continued descent (ep4234 → ep6132)

Training resumed after the Modal billing ceiling cleared. This leg carries the architecture from 26L to **30L dual-stream** across four depth surgeries (S14–S17). Two structural events dominate it:

1. **Context reduced 256→128 (memory-forced):** a depth surgery's added activation memory pushed the run past the **L4's VRAM** and the GPU timed out, so context was dropped 256→128 to fit. This was a hardware constraint, not a learning-rate preference. RoPE makes the change checkpoint-safe; **restoring 256 ctx — via 2× L4 on Modal for throughput/headroom, or tighter memory management — is the plan** once GPU capacity allows.
2. **The backbone-trains cliff (ep~4453):** until ~ep4450 albert trained only its `lm_head` — the whole transformer body received zero gradient (candle's fused LayerNorm has no backward). The `DiffLayerNorm` fix unfroze the body, and EP-AVG ATL plunged from **9.3758 (ep4441) → 8.4266 (ep4534)** — a ~1-nat cliff in under 100 epochs — then descended steadily to the 6.4339 floor. This is the single largest structural improvement in v3.0 history.

EP-AVG ATL values below are **real**, recovered from the canonical `~/.albert/epoch_history.log` (ep3499→6190). Surgery epochs S14–S17 are not separately timestamped in that log; they fired across ~ep4900–6100 carrying 26L→27→28→29→30L, so per-row architecture is left coarse rather than guessed.

| Epoch | Architecture | EP-AVG ATL | Event |
|-------|-------------|-----------|-------|
| ep~4300 | dual-stream 26L | ~9.40 | **Context reduced 256→128 ctx** — activation-memory relief, sharper gradients |
| ep4441 | dual-stream 26L | 9.3758 | Last ATL of the frozen-body (lm_head-only) era |
| ep~4453 | dual-stream 26L | — | **BACKBONE-TRAINS CLIFF** — `DiffLayerNorm` fix unfreezes the transformer body |
| ep4534 | dual-stream 26L | **8.4266** | Post-cliff floor — ~1-nat drop from ep4441; body now learning |
| ep4612 | dual-stream 26L | 8.2829 | Steady descent begins |
| ep4915 | dual-stream 26→30L¹ | 8.1207 | Sub-8.13 |
| ep5185 | — | 8.0338 | Approaching 8.0 |
| ep5436 | — | 7.9678 | **Sub-8.0** |
| ep5733 | — | 7.8344 | |
| ep5802 | — | 7.3856 | Rapid descent leg (7.83→7.39 in ~70 ep) |
| ep5873 | — | 7.1402 | Sub-7.2 |
| ep5921 | — | 6.9507 | **Sub-7.0** |
| ep5998 | — | 6.7609 | |
| ep6068 | dual-stream 30L | 6.5989 | 30L dual-stream reached |
| ep6132 | dual-stream 30L | **6.4339** | **Best EP-AVG ATL — current all-time best** |

¹ S14–S17 (26L→27→28→29→30L) fired somewhere across ep~4900–6100; exact surgery epochs were not preserved in `epoch_history.log`.

**Current checkpoint (ep6191; resumed training at ep6192, 2026-06-12):** 30L dual-stream · 221,661,708 params · 2,356 tensors · ~845 MB safetensors · fib_index=7 · window=34 · Gen3 step1/6. Training resumed after a ~1-week Anthropic billing-migration gap; checkpoints verified clean (no NaN/Inf).

---

### Post-S29 descent and 42L→46L surgeries (ep8906 → ep9270, added 2026-10-24)

Every 10th epoch from `epoch_history.log` (real values, no interpolation; ep9110 is not in the file). `layers` is derived from the tensor count `tns` (3294 = 42L, 3372 = 43L, 3450 = 44L, 3528 = 45L, 3606 = 46L; +78 tensors per layer). Rows at the surgery epochs (ep8906/8907, 8937/8938, 8941/8942, 8957/8958, 8986/8987) are in the ledger above.

| Epoch | loss_avg | loss_best | layers |
|---|---|---|---|
| 8910 | 4.6287 | 3.9334 | 42 |
| 8920 | 4.1763 | 3.9334 | 42 |
| 8930 | 4.0751 | 3.9334 | 42 |
| 8940 | 4.0426 | 3.9334 | 43 |
| 8950 | 4.2417 | 3.9334 | 44 |
| 8960 | 4.2782 | 3.9334 | 45 |
| 8970 | 4.0996 | 3.9334 | 45 |
| 8980 | 4.0908 | 3.9334 | 45 |
| 8990 | 4.5878 | 3.9334 | 46 |
| 9000 | 4.2339 | 3.9334 | 46 |
| 9010 | 4.3481 | 3.9334 | 46 |
| 9020 | 4.1794 | 3.9334 | 46 |
| 9030 | 4.1997 | 3.9334 | 46 |
| 9040 | 4.1588 | 3.9334 | 46 |
| 9050 | 4.2497 | 3.9251 | 46 |
| 9060 | 4.1635 | 3.9251 | 46 |
| 9070 | 4.0234 | 3.9251 | 46 |
| 9080 | 3.9090 | 3.9090 | 46 |
| 9090 | 4.0171 | 3.9090 | 46 |
| 9100 | 4.0192 | 3.9090 | 46 |
| 9120 | 4.1887 | 3.9090 | 46 |
| 9130 | 4.1004 | 3.9090 | 46 |
| 9140 | 4.0966 | 3.9090 | 46 |
| 9150 | 4.0686 | 3.9090 | 46 |
| 9160 | 4.0163 | 3.8755 | 46 |
| 9170 | 3.9911 | 3.8755 | 46 |
| 9180 | 3.9752 | 3.8755 | 46 |
| 9190 | 4.0709 | 3.8755 | 46 |
| 9200 | 4.0990 | 3.8755 | 46 |
| 9210 | 4.0472 | 3.8755 | 46 |
| 9220 | 4.0257 | 3.8579 | 46 |
| 9230 | 4.0230 | 3.8579 | 46 |
| 9240 | 4.0820 | 3.8579 | 46 |
| 9250 | 4.0213 | 3.8579 | 46 |
| 9260 | 3.9943 | 3.8579 | 46 |
| **9270** | **3.9353** | **3.8420** | 46 (last recorded; training stopped) |

The README's earlier "best loss 3.9334 (ep8891)" is `loss_best` up to ep9040; later values are lower (3.9251 at ep9044, 3.8420 at ep9265).

---

### Alternating Descent Phase — Governor Validation Finding (2026-05-19)

Following the loss gate clear at ep2080, albert. entered a brief plateau zone (ep2085–ep2108, range 9.800–9.810). Three surgery timing scenarios had been computed assuming the plateau would persist: surgery at ~ep2150, ~ep2200, and ~ep2300.

At ep2109, the model began an **alternating descent phase**: large drops every ~2 epochs separated by small consolidation bounces, driven by the cosine LR cycle peaking at a moment when the 9.80 attractor no longer held. Five new epoch ATLs in seven epochs (ep2109→ep2116), net drop 9.7976→9.7884. All three scenarios were invalidated.

**Whitepaper finding (governor validation):** "The plateau gate demonstrated robustness against premature surgery triggering: at ep2120, despite crossing the loss threshold (9.7997 < 9.80) at ep2081, the model continued descending through the projected plateau zone, invalidating three pre-computed surgery timing scenarios. The governor correctly withheld surgery while the model was still actively learning — a validation of the design principle that architecture should grow only when learning has genuinely exhausted current capacity."

Supporting data:
- myc_L3 showed first activity uptick (1.61→1.68×10⁻⁹) at ep2114, coinciding with the descent acceleration — the mycelium network's own signal confirmed productive gradient flow
- WALD sev 0.950→0.953, stable; no escalation
- Drop magnitudes shrinking (−0.0094, −0.0084, −0.0016) into the consolidation zone — model self-reporting deceleration before any gate fires
- This is the **sixth documented case** of the surgery governor correctly withholding surgery during active learning (prior: ep791 non-firing; surgeries 1–5 each fired only after confirmed plateau)

### Net2Net surgery outcomes

**S1–S8:** All eight surgeries completed with no visible spike. Loss resumed descent or immediately set a new ATL within 1–3 epochs of each surgery. The Fibonacci-gated plateau detector correctly suppressed surgery during active descent and fired only when the model had stalled — this is the intended behavior of the surgery governor (see `docs/EVOLUTION_EVIDENCE.md`).

**S9 (20L→21L, ep~3470):** Exception — largest post-surgery disruption in full training history. Loss spiked ~+0.14 nats (9.29→9.43) before entering a multi-epoch bullmarket recovery. S9 is the only surgery in v3.0 (and in all known training history) to produce a measurable spike. See `token-probes/albert_observation_log.md` § "Surgery 9 Anomaly" for full analysis and candidate causes.

Each surgery used a Mandelbrot-parameterised perturbation signal for weight initialization of the new layer, providing a deterministic, reproducible plasticity impulse derived from the model's current loss at the time of insertion.

---

## v2.0.0 — 3L Training Run (2026-05-07, superseded by v3.0)

Architecture: 3 layers · 256 hidden · 12 experts · 4 heads · 128 ctx · 8000 vocab  
Optimizer: AdamW, cosine LR 3e-4 → 1e-5 / 500 steps  
Hardware: HP ZBook (CPU-only)

| Epoch | Avg Loss | Δ vs prev | Clipped batches | Notes |
|-------|----------|-----------|-----------------|-------|
| 1  | 7.8687 | — | 300/300 | Start from random init |
| 2  | 7.5978 | −0.271 | 300/300 | |
| 3  | 7.3676 | −0.230 | 300/300 | |
| 4  | 7.2316 | −0.136 | 300/300 | |
| 5  | 7.1496 | −0.082 | 300/300 | |
| 6  | 7.0899 | −0.060 | 300/300 | |
| 7  | 7.0059 | −0.084 | 300/300 | |
| 8  | 6.9892 | −0.017 | 300/300 | Clipping tapering |
| 9  | 6.9757 | −0.013 | 256/300 | |
| 10 | 6.9916 | +0.016 | 88/300  | |
| 11 | **6.9542** | **−0.037** | 30/300 | **3L capacity ceiling — best epoch avg** |
| 12 | 6.9821 | +0.028 | 10/300  | Clipping nearly gone |
| 13 | 7.0777 | +0.096 | 1/300   | Divergence begins — LR overshooting minimum |
| 14 | 7.0665 | −0.011 | 7/300   | |
| 15 | 7.1131 | +0.047 | 3/300   | |
| 16 | 7.2306 | +0.118 | 0/300   | |
| 17 | 7.2632 | +0.033 | 1/300   | |
| 18 | 7.4088 | +0.146 | 1/300   | |
| 19 | 7.4606 | +0.052 | 0/300   | |
| 20 | 7.6036 | +0.143 | 0/300   | |
| 21 | 7.7064 | +0.103 | 0/300   | |
| 22 | 7.8589 | +0.153 | 0/300   | EvolutionManager plateau/divergence window |
| 23 | 7.9890 | +0.130 | 0/300   | |
| 24 | 8.0392 | +0.050 | 0/300   | |
| 25 | 8.1024 | +0.063 | 0/300   | Surgery expected to fire ~ep 25–30 |

**Best single-batch loss observed:** 5.5471 (epoch ~11, batch-level minimum)  
**Best epoch average:** 6.9542 (epoch 11)

### Interpretation

The training curve shows three phases consistent with 3L capacity dynamics:

1. **Rapid descent (ep 1–8):** All batches clipped — model making large gradient updates, learning fast. Loss drops 7.87 → 6.99 (−0.88 in 8 epochs).
2. **Capacity ceiling (ep 9–11):** Clipping tapers as gradients normalize. Model finds its 3L minimum at 6.9542.
3. **Divergence (ep 12+):** Without clipping dampening the effective LR, the optimizer overshoots the minimum. Loss rises steadily. This is the expected signal for EvolutionManager surgery to 4L.

This pattern — descent, plateau, divergence — is the intended behavior. The EvolutionManager detects the divergence and fires Net2Net surgery, copying the 3L best checkpoint into a 4L architecture for the next training phase.

---

## v1.x — Previous runs

Previous runs reached loss ~6.10 at 3L before an architecture bug (Net2Net surgery deleting the best checkpoint instead of archiving it) caused all post-surgery models to diverge to random baseline (8.987). This was diagnosed and fixed on 2026-05-07. See `ternlang-root/docs/session_log.md` entry `2026-05-07 · 22:00` for full root cause analysis.
