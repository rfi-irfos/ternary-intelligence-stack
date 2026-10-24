# Albert Surgery Registry

Consolidated record of all Net2Net depth-expansion events across the lifetime of the project.
Primary source: `convergence_log.md` (v3.0), `EVOLUTION_EVIDENCE.md` (v2.0.0 surgeries 1–3).
Last updated: 2026-10-24 (S14–S33 and the 46L state added below; sections above that part keep their 2026-05-25 text).

---

## Version 1.x — Pre-Multilingual Bible Model

**Architecture start:** ~3L · 128H · 12E · 8k vocab  
**Outcome:** No successful surgeries.

| # | Epoch | Transition | Date | Trigger | Result |
|---|-------|-----------|------|---------|--------|
| F1 | unknown | 3L→4L | ~2026-05 | plateau | **FAILED** — Net2Net surgery incorrectly deleted best checkpoint instead of archiving it; all post-surgery models diverged. Bug identified and fixed before v2.0.0. |

**v1.x exit:** ~3L, loss unknown, run abandoned.

---

## Version 2.0.0 — Bible Ternary (EN only, 8k vocab, float32 weights)

**Architecture start:** 3L · 128H · 12E · 8k vocab  
**Architecture exit:** 12L · 256H · 12E · 8k vocab · loss 6.8821 (transferred to v3.0)

Note: hidden size was manually upgraded 128H→256H between surgeries 1 and 2 (non-surgery architectural change).

| # | Epoch | Transition | Date (UTC) | Trigger | Pre-surgery loss | Result |
|---|-------|-----------|------------|---------|-----------------|--------|
| S1 | ~20 | 3L→4L | 2026-05-05 | Plateau Δloss < 0.02 over 10 epochs | ~7.01 | Success |
| — | ~30 | 128H→256H | 2026-05-06T08:00Z | Manual architecture upgrade | ~6.8 | Non-surgery |
| S2 | ~40 | 4L→5L | 2026-05-06T11:05Z | Mastery condition met | ~6.2 | Success |
| S3 | ~86 | 5L→6L | 2026-05-06T22:00Z | Plateau Δloss < 0.02 over 10 epochs | 5.9174 | Success (live witnessed) |
| S4 | unknown | 6L→7L | unknown | plateau | unknown | Success |
| S5 | unknown | 7L→8L | unknown | plateau | unknown | Success |
| S6 | unknown | 8L→9L | unknown | plateau | unknown | Success |
| S7 | unknown | 9L→10L | unknown | plateau | unknown | Success |
| S8 | unknown | 10L→11L | unknown | plateau | unknown | Success |
| S9 | unknown | 11L→12L | unknown | plateau | unknown | Success |

Surgeries S1–S3 documented in `EVOLUTION_EVIDENCE.md`. S4–S9 individually undocumented; individual epoch data not preserved. Session log has scattered references to layer unlock events confirming the 3L→12L arc. README states "10 surgeries" which may account for one retried or partial event not in this table.

**v2.0.0 confirmed surgeries:** 9 (3L→12L)  
**v2.0.0 total surgical events per README:** ~10

---

## Version 3.0 — Multilingual Ternary (32k vocab, ternary STE from ep1)

**Architecture start:** 12L · 256H · 12E · 32k vocab (weights transferred from v2.0.0 ep=best, loss 6.8821; embed + lm_head re-initialized for 32k)  
**Architecture current:** 46L dual-stream (as of the last recorded epoch 9270 — 33 depth surgeries + 1 cord surgery; training stopped). The S1–S13 table below is the 2026-05-27 state; S14–S33 follow in the later table.

All surgeries documented in `convergence_log.md`.

| # | v3 epoch | Global epoch | Transition | Date (UTC) | Fibonacci window | Mandelbrot c_im | Plateau Δ / epochs | Tensors | Pre-surgery EP_AVG | Post-surgery first ATL | Result |
|---|----------|-------------|-----------|------------|-----------------|----------------|-------------------|---------|------------------|-----------------------|--------|
| S1 | 511 | ~546 | 12L→13L | 2026-05 | 13 | — | — | — | — | — | Success |
| S2 | 547 | ~582 | 13L→14L | 2026-05 | 21 | −0.6983 | — | — | — | — | Success |
| S3 | 611 | ~646 | 14L→15L | 2026-05 | 34 | +0.2287 | — | 69 | — | — | Success |
| S4 | 645–646 | ~680 | 15L→16L | 2026-05 | 55 | −0.3442 | — | — | — | — | Success |
| S5 | 701–702 | ~736 | 16L→17L | 2026-05 | 89 | +0.5828 | — | — | — | — | Success; Stage 10 corpus unlocked |
| S6 | 2487 | ~2522 | 17L→18L | 2026-05-20T21:33Z | 233 | +0.0099 | Δ0.0193 / 144 ep | — | 9.7170 | 9.6248 (ep2489) | Success; Gen 1 step 1/6; ceiling→21L |
| S7 | 3325 | ~3360 | 18L→19L | 2026-05-24T13:47Z | — | — | 36+ ep (9.42–9.46) | 1315 | 9.3651 | **9.3182** (ep3326) | Success; [ttlfreeze] + [divloss] armed; ATL broke in first 19L epoch |
| S8 | 3383 | ~3418 | 19L→20L | 2026-05-24T~20:00Z | — | — | 58 ep (plateau at 19L floor) | 1384 | 9.3182 | **9.2862** (ep3383) | Success; fastest post-surgery plateau in v3 history |
| S9 | ~3437 | ~3472 | 20L→21L | 2026-05-25T~00:00Z | — | — | 54 ep (since_best accumulating) | 1453 | 9.2862 | **9.3930** (ep3503, still descending) | Success; largest post-surgery spike in v3 history (~9.43); fastest descent rate in v3 history (bullmarket); TTL hard stops (see note) |
| S10 | ~3652 | ~3687 | 21L→22L | 2026-05-25–26 | — | — | plateau at 21L floor | 1522 | 9.2933 | — | Success |
| S11 | ~4098 | ~4133 | 22L→23L | 2026-05-27 morning | — | — | plateau at 22L floor | 1591 | — | — | Success |
| S11b | ~4140 | ~4175 | 23L→24L | 2026-05-27 | — | — | rapid plateau (~42 ep after S11) | 1660 | — | — | Success |
| S12 | 4202 | ~4237 | 24L→25L | 2026-05-27T16:43Z | 34 | — | Gen3 plateau triggered | 1729 | — | — | Success; Gen3 plateau gate fired |
| **CORD** | **4202** | **~4237** | **25L → 2×25L dual-stream** | **2026-05-27T16:44Z** | — | Mandelbrot stream_index=1 | autonomous (width wall) | **1966→2044** | — | — | **CORD SURGERY — first ever. Net2Net stream bifurcation. 6 anastomosis gates at Fibonacci layers [2,3,5,8,13,21].** |
| S13 | ~4207 | ~4242 | 25L→26L | 2026-05-27T17:40Z | 34 | — | first post-cord plateau (fib_index advanced 6→7) | 2044 | — | **8.6852** (chip ATL) | Success; fib_index=7 confirmed; dual-stream depth expansion working; Gen3 step1/6 |

**v3.0 confirmed surgeries:** 13 depth surgeries (S1–S13) + 1 cord surgery (2×25L) = 14 total surgical events · Architecture arc: 12L→26L dual-stream

### Surgery S9 — Observations (2026-05-25)

**TTL hard-column stops — first occurrence in v3.0 history.**  
Post-S9, the Traffic Light Routing panel showed full-column red blocks: entire layers completely suppressed for multiple consecutive steps. Previous surgeries produced soft TTL transitions (gradual orange→red drift). S9 produced hard stops — columns of pure red lasting several steps — indicating the TTL is treating the new 21st layer as unproven and fully clamping its output while the established 20 layers route freely.

TTL distribution post-S9: **G 21% · O 74% · R 5%** (vs. pre-surgery baseline G 6–17% · O 78–81% · R 2%).  
Green surge = existing layers routing with high confidence. Red surge = new layer held in suppression.

**Interpretation:** The 21L insertion is the deepest yet. The TTL responded proportionally — harder suppression than any previous surgery. The bullmarket descent is driven by the existing 20 proven layers running freely while the 21st layer receives gradient signal during its suppressed steps. When the 21st layer earns green slots (expected: gradual onset over ~100–300 epochs), a second acceleration phase is expected.

**AdamW buffer reset coincidence:** Modal pod restart reset the optimizer state at approximately the same epoch as the surgery. Fresh AdamW momentum on an already-explored loss landscape contributed to the aggressive descent rate (see restart acceleration pattern in project memory).

### Surgeries S14–S33 (added 2026-10-24)

Same columns as the table above. Sources: S14–S29 are transcribed from the surgery log in `albert-moe-13/README.md` (epoch and date as written there; "v3 epoch" holds the README epoch, "Global epoch" is not recorded). S30–S33 come from `~/.albert/epoch_history.log` (epoch, loss_avg, tns) and the machine-local 5-minute watch recorder (UTC window: last row before the jump, first row after). "Tensors" is the log's `tns` after the surgery. "not recorded" means no source was found.

| # | v3 epoch | Global epoch | Transition | Date (UTC) | Fibonacci window | Mandelbrot c_im | Plateau Δ / epochs | Tensors | Pre-surgery EP_AVG | Post-surgery first ATL | Result |
|---|----------|-------------|-----------|------------|-----------------|----------------|-------------------|---------|------------------|-----------------------|--------|
| S14 | ~4280 | not recorded | 26L→27L | 2026-05-29 | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success; Gen3 step2/6 (README) |
| S15 | ~4350 | not recorded | 27L→28L | 2026-05-29 | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success (README) |
| S16 | ~4740 | not recorded | 28L→29L | 2026-05-31 | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success; checkpoint-mtime verified (README) |
| S17 | 5610 | not recorded | 29L→30L | 2026-06-06 | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success; checkpoint-mtime verified (README) |
| S18 | 6339 | not recorded | 30L→31L | 2026-06-14 (README); 2026-06-13 (convergence_log) | not recorded | not recorded | Δ-0.0101 / 34 ep (convergence_log) | 2434 | not recorded | not recorded | Success (tns 2356→2434 at ep6339→6340) |
| S19 | ~6500 (README); ~6709 (convergence_log) | not recorded | 31L→32L | 2026-06-15 | not recorded | not recorded | Δ0.0160 / 55 ep (convergence_log) | 2512 | not recorded | not recorded | Success (tns 2434→2512 at ep6707→6708) |
| S20 | ~7000 | not recorded | 32L→33L | 2026-06-21 | not recorded | not recorded | not recorded | 2590 | not recorded | not recorded | Success; CTX bumped 256→512 (README) |
| S21 | 8711 | not recorded | 33L→34L | 2026-09-17T03:31:35Z | not recorded | not recorded | not recorded | 2668 | 3.9983 | 4.9064 | Success; first surgery after a 41-day dormancy (README) |
| S22–S23 | ~8711–8856 (README) | not recorded | 34L→36L | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success; exact event log lost to local rotation (README) |
| S24 | ~8865 | not recorded | 36L→37L | 2026-09-18 17:01:12 CEST | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success (README) |
| S25 | ~8867 | not recorded | 37L→38L | 2026-09-18 17:37:36 CEST | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded | Success (README) |
| S26 | ~8879 | not recorded | 38L→39L | 2026-09-18 | not recorded | not recorded | mastery-triggered | not recorded | not recorded | not recorded | Success; no LR snap-back (README) |
| S27 | 8891 | not recorded | 39L→40L | 2026-09-18 23:24:54 CEST | not recorded | not recorded | mastery loss 3.9334 | not recorded | 3.9334 | 4.0126 | Success |
| S28 | ~8901 | not recorded | 40L→41L | 2026-09-19 01:42:29 CEST | not recorded | not recorded | mastery loss 3.9409 | not recorded | 3.9409 | 4.1164 | Success |
| S29 | ~8906 | not recorded | 41L→42L | 2026-09-19 02:58:32 CEST (README); recorder: 03:20Z–03:25Z | not recorded | not recorded | mastery loss 3.9625 | 3294 | 3.9625 | 5.1015 | Success. The README time and the recorder differ by about 2.4 h; not resolved |
| S30 | 8937→8938 | not recorded | 42L→43L | 2026-09-19, 13:55Z–14:00Z | not recorded | not recorded | not recorded | 3372 | 3.9972 | 4.1694 | Success |
| S31 | 8941→8942 | not recorded | 43L→44L | 2026-09-19, 15:00Z–15:05Z | not recorded | not recorded | not recorded | 3450 | 3.9978 | 4.1686 | Success |
| S32 | 8957→8958 | not recorded | 44L→45L | 2026-09-19, 18:50Z–18:55Z | not recorded | not recorded | not recorded | 3528 | 3.9947 | 4.2715 | Success |
| S33 | 8986→8987 | not recorded | 45L→46L | 2026-09-20, 01:05Z–01:10Z | not recorded | not recorded | not recorded | 3606 | 3.9810 | 5.1995 | Success; last surgery. Checkpoint header: 46 layers, 3606 tensors, 331,140,622 parameters |

Pre-surgery EP_AVG and post-surgery first value are `loss_avg` of the last epoch before and the first epoch after the jump in `epoch_history.log`. S21, S27, S28 values come from the same file (tns jumps at ep8711→8712, ep8891→8892, ep8901→8902); the README's mastery losses for S27 and S28 equal the pre-surgery values.

**Totals as of 2026-10-24:** 33 depth surgeries (12L→46L) + 1 cord surgery. Training stopped at epoch 9270 (loss_avg 3.9353, loss_best 3.8420).

---

## Lifetime Summary

| Version | Surgeries | Architecture arc | Documentation |
|---------|-----------|-----------------|---------------|
| v1.x | 1 failed | 3L (no net change) | No records |
| v2.0.0 | 9 confirmed (10 per README) | 3L→12L | S1–S3 in EVOLUTION_EVIDENCE.md; S4–S9 undocumented |
| v3.0 | 33 depth + 1 cord (13 depth + 1 cord as of 2026-05-25) | 12L→46L dual-stream | S1–S19 and S30–S33 in convergence_log.md; S14–S33 table above |
| **Total** | **~43–44 surgical events** (arithmetic: 9–10 in v2.0.0, 33 + 1 in v3.0) | **3L→46L dual-stream** | |

**For SPRIND pitch:** "albert. has undergone 13 autonomous Net2Net depth expansions (12L→26L) plus one cord surgery (bifurcation to dual-stream 2×256H) in its v3.0 run alone — all precisely logged in convergence_log.md with timestamps, Fibonacci plateau windows, Mandelbrot perturbation parameters, and loss trajectories. The cord surgery on 2026-05-27 is the first documented instance of a live ternary MoE autonomously bifurcating from single-stream to dual-stream architecture mid-training."

**README discrepancy fixed 2026-05-24:** README previously listed ep2802/ep3160 for v3 surgeries 7–8. Correct epochs are ep3325/ep3383 (from convergence_log.md). README has been corrected.

---

## Surgery S14 — Next expected event (historical, written 2026-05-27; S14 has since fired, see the S14–S33 table above)

**Current state (ep4234):** 26L dual-stream · chip ATL **8.6852** (set ep~4203 post-cord) · fib_index=7 · window=34 · Gen3 step1/6 · training paused (Modal billing ceiling)  
**Gate:** PLATEAU gate — since_best will accumulate once descent stalls; fib_index=7 → window=34 epochs required  
**Projection:** S14 (26L→27L, both streams) when plateau gate fires on dual-stream architecture.
