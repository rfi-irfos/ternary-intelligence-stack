# Stale-claims audit (2026-10-24)

For Simeon. Written during the docs-consistency pass for the albert. explorer (task 18). Line numbers are for the checkout of branch `feat/albert-explorer` at the time of the pass.

Method: `grep` sweep for old layer counts, slot counts, epochs and "live" wording (`42L`, `33L`, `792`, `1,008`, `21L`, `32L`, `768`, `ep~7xxx`, "training live/active", `224M`, `58M`) over all `.md`, `.html`, `.toml`, `.yaml`, `.txt`, `.rs`, `.py`, `.tern` files, then a spot check of version, tool and file counts against the tree. Nothing was verified against live services (crates.io, Fly, ternlang.com, GitHub, HuggingFace, OSF).

Ground truth for albert. (read on the Colony 2026-10-24, see `albert-moe-13/docs/SURGERY_REGISTRY.md`): checkpoint header of `albert_v3.0.best.safetensors` (file dated 2026-09-23): 46 layers, 3606 tensors, 331,140,622 parameters, 1,324,935,080 bytes; `~/.albert/epoch_history.log` last epoch 9270, loss_avg 3.9353, loss_best 3.8420; training stopped.

## A. albert. current-state claims fixed in this pass

| File | What changed |
|---|---|
| `README.md` (root) | Section 2 "Current state"; Explorer quick link; Convergence Log link text ("Live" removed) |
| `MODEL_CARD.md` | Header, overview table, evaluation table (rows added, S6 transition corrected to 17L->18L), limitations, scaling questions, oversight text |
| `albert-moe-13/README.md` | Top quick link, architecture table, derived counts (1,104 slots, 276 activations, 92 TTL rows), surgery log S30-S33, S29 time note, training-state block, GPU table, layout |
| `albert-moe-13/docs/convergence_log.md`, `SURGERY_REGISTRY.md` | S30-S33 added, current-state lines, records table, post-S29 loss table |
| `albert-moe-13/models/README.md` | Active checkpoint table and version history row |
| `albert-moe-13/docs/architecture.md` (lines 37, 39, 91, 93) | Current state, slot and activation counts |
| `albert-moe-13/docs/SPARSESKIP_METHODOLOGY.md` (line 9) | Slot count |
| `ternlang-root/README.md` (lines 166-175, 182-183) | Training progress table, status line, research dimensions |

## B. albert. claims found but NOT changed

Left alone because they are dated records, code, or public web pages that need a deploy.

| File:line | Claim | Why it looks stale | What would verify or fix it |
|---|---|---|---|
| `albert-moe-13/docs/FOOTPRINT.md:3,23-26` | "Measured 2026-05-31 ... 28L dual-stream checkpoint"; no packed 28L `.trit` | Own date, 28L figures; checkpoint is now 46L | Re-run the footprint script on the 46L checkpoint (Colony) |
| `albert-moe-13/README.md:99-100` | "~850 MB at 21L", packed footprint "from the 21L architecture" | Footnoted as not re-run | Same re-run as FOOTPRINT.md |
| `albert-moe-13/README.md:329,331` | "~2.1-2.6 s/batch" and "~5-6 GB free" measured at 42L | Not re-measured at 46L (the text now says so) | A short 46L run on Modal |
| `albert-moe-13/docs/convergence_log.md` section "State on 2026-06-15" and the v3.0 header block ("30L dual-stream", "Training active (ep~6205, live)", "128 ctx", "6 anastomosis gates") | Whole block describes June | Kept as history, headed "(historical)" only for the first part | Rename the "v3.0 - Active Training Run" heading and header lines, or leave as dated history |
| `albert-moe-13/docs/convergence_log.md`, ledger rows S20-S29 | Not in this ledger | Pointer to the README surgery log added | Add rows from the README log if wanted |
| `albert-moe-13/docs/convergence_log.md`, S22/S23 | README says "exact event log lost" | `epoch_history.log` shows `tns` jumps at ep8792->8793 (+80 tensors) and ep8809->8810 (+78), which look like those two surgeries (34L->35L, 35L->36L) | Confirm against `albert_watch_log.md`, then fill both rows (not done: derived, not recorded) |
| `albert-moe-13/docs/roadmap.md:23,49` | "Status (2026-05-24): Global Epoch 3414 ... 20L->21L surgery gate armed" | Dated May | Replace with current status or mark historical |
| `albert-moe-13/docs/MYCELIAL_CORD_ARCHITECTURE.md:6` | "Dual-stream 26L training underway" | Status line is from 2026-05-27 | Update status line |
| `albert-moe-13/docs/EVOLUTION_EVIDENCE.md:12` | Surgery count in intro | Not read in full | Check count against registry |
| `albert-moe-13/docs/architecture.md:138,168,214` | "extended through 30L", "12L to 30L across seventeen more surgeries", "All stages active at 30L", "128-token windows" | June text | Update counts to 33 surgeries / 46L and context to 512 |
| `albert-moe-13/CORPUS_EXPANSION_ROADMAP.md:27,98,195-201` | Targets "40L+" for stage 13 and later | Current depth already 46L; the unlock rule (loss_avg <= 3.0 and 4-stream) may still be valid | Check the roadmap premise with Simeon |
| `albert-moe-13/models/albert_v3.0.config.json` | `num_layers` 38 | Checkpoint header says 46 (explorer CAVEATS A6, A8) | Decide which file is the real config; the serving binary builds depth from this value (CAVEATS A8, unverified) |
| `albert-moe-13/models/albert_v3.0.meta`, `albert_v3.0.best_loss` | epoch 8869, best_loss 3.9395423 | Older state files | Sync from the Colony or remove from the tree |
| `ternlang-root/docs/ROADMAP.md:136-149` | Section "3.0 CURRENT METRICS (2026-05-25)": 21L, 256CTX, epoch ATL 9.2862, "ep3503+" | Whole table dated May | Replace with the current numbers (this document's ground truth) |
| `ternlang-root/TRAINING.md:95,108` | "Next gate: 20L->21L armed" | May status | Update or mark historical |
| `ternlang-root/BENCHMARKS.md:507,566-581,659-665,707,862` | 28L re-measure notice, "18L (current)", "58M total ternary params", "Current state (2026-05-24): ep3414 20L" | May figures | Re-measure on 46L; the parameter count is 331,140,622 now |
| `ternlang-root/README.md:186` | "dead=0 across full v3.0 run through 32L" | Stops at 32L, source not found | Check the mycelium health logs |
| `ternlang-root/ternlang-web/index.html:13,19,37,540,710,724` | "26L dual-stream, 187.5M params, 13 autonomous surgeries" (meta tags, JSON-LD, hero) | Public page, May state | Edit the page and redeploy ternlang.com; see `docs/launch-links.md` |
| `ternlang-root/ternlang-web/talk.html:912` | Example arch string "2x26L ..." | Only a code comment, likely an example | Check |
| `ternlang-root/ternlang-api/src/main.rs:1167` | "134M params, 22L" in an API description string | Code, May state | Change string, rebuild, deploy to Fly |
| `MODEL_CARD.md` (Training Data table) | "Wikipedia (15 languages ...)" while README says 8 languages (EN/DE/FR/ES/PT/IT/NL/PL) | Two documents disagree | Check the real corpus languages in `DATA_PROVENANCE.md` |
| `MODEL_CARD.md` (benchmark table, ep1553 to ep2116 rows) | Several "(est)" and "pending" cells | Old rows, never completed | Fill or mark historical |
| `MODEL_CARD.md` context cell | 512 tokens, "raised at S20 per the README log" while `convergence_log.md` (2026-06-15) says 128 ctx and the config says 512 | The sources disagree on when the change happened | Read the S20 training log |
| `albert-moe-13/explorer/CAVEATS.md` A6 | "42 layers is the officially documented state: the TIS session_log and convergence_log record the depth up to 42" | Docs now record 46 (this pass) | Regenerate `CAVEATS.md` from `src/content/caveats.ts` after editing A6 there (code change, not done here) |
| `ternlang-root/docs/session_log.md` (entries before 2026-10-24) | Dated entries, correct as history | None | Leave |
| `ternlang-root/docs/session_log.md`, 2026-09-19 entry | Describes "six surgeries (36L->42L)" in 42 hours | Surgeries S30-S33 happened the same day after it | Covered by the new 2026-10-24 entry |

## C. Other components (not albert.): stale-looking claims, state NOT verified

I did not guess any of these. Each row says what would verify it.

### Ternlang (compiler, language, MCP, API, web)

| File:line | Claim | Why it looks stale | What would verify it |
|---|---|---|---|
| `README.md:10` and `ternlang-root/README.md:9` | MCP badge "34 tools" with anchors `#mcp-server--v040-34-tools` / `#mcp-server--v110-34-tools` | `ternlang-root/ternlang-mcp/README.md:16` says "All 19 tools"; `ternlang-root/ternlang-mcp/src/main.rs` has 40 distinct `"name"` entries (some may not be tools); root README anchor does not exist in the root README | Count registered tools in `ternlang-mcp/src/main.rs` and fix all three places |
| `README.md:7` | Tests badge "138 CI, 5 crates" | `ternlang-root/README.md:6` says "88+ passing" and `:669` says "138+ CI tests passing - v1.3.7"; about 197 `#[test]` attributes under `ternlang-root` | Run `cargo test --workspace` on the Colony and read the count |
| `ternlang-root/README.md:4` (badge), `:669`, `ternlang-root/docs/ROADMAP.md:126,147` | "v1.3.7", "38 crates at v1.3.7" | Workspace version in `ternlang-root/Cargo.toml:24` is 1.5.0; root `README.md` badge says v1.5.0 | Compare with crates.io and the workspace members |
| `README.md:11,102`, `ternlang-root/README.md:10-11` | "3.9k+ .tern programs", "28k+ open and 2.5k+ premium stdlib", "28,500+ stdlib modules" | This checkout holds 1,542 `.tern` files in total, 899 files under `ternlang-root/stdlib`, 289 under `examples` paths | The numbers may count generated or private content; count in the authoritative repo or reword |
| `README.md` (links) | Documentation links use `github.com/rfi-irfos/...`; `albert-moe-13/README.md`, `MODEL_CARD.md` use `github.com/eriirfos-eng/...` | Two org names for the same repo | Confirm which org owns the repo; redirects may hide the problem |
| `README.md:12-14` | Crate badges moe-core, moe-platform, moe-runtime | Crate versions in the tree: 2.0.0 (`albert-moe-13/crates/*/Cargo.toml`) | Compare with crates.io |
| `README.md:9` | "API live" badge to `ternlang-api.fly.dev/health` | Not checked | Request the URL |
| `ternlang-root/docs/ROADMAP.md:3` | Header "v1.3.7 (Ecosystem) / v3.0 (albert. model)", date 2026-05-22 | Old header; `docs/GLOBAL-INDEX.md` says "TIS-v3.0" | Update with the release owner |

### Agent Albert CLI, Rusty Penguin

| File:line | Claim | Why it looks stale | What would verify it |
|---|---|---|---|
| `README.md` sections 3 and 4 | `cargo install albert-cli`; Rusty Penguin boots from an ISO, runs DOOM, TLS 1.3 stack | Both live in other repositories (`rfi-irfos/agent-albert-cli`, `rfi-irfos/rusty-penguin`); not in this tree | Check each repository's own README and `SESSION_LOG.md`, and `cargo search albert-cli` |
| `docs/SPRIND_PITCH_CHECKLIST.md:47` | "83-125 tok/s CPU demo, Live" | The albert. README gives 83 tok/s (root) and 84.4 tok/s (benchmark); range 83-125 unexplained | Re-run `moe-test --bench` and cite one run |

### Docs and misc

| File | Claim | Why it looks stale | What would verify it |
|---|---|---|---|
| `docs/GLOBAL-INDEX.md` | Module table "TIS-v3.0" | Not compared with the directory listing (`ternlang-root` has 60+ crate directories) | Diff the table against `Cargo.toml.members` |
| `Cargo.toml.members`, `Cargo.toml.new`, `ternlang-build.Cargo.toml` (repo root) | Three extra Cargo manifests next to `Cargo.toml` | Possible leftovers | Ask the owner which one is in use |
| `FLEET_REVIEW_2026-08-19.md`, `LEADERSHIP.md`, `CONTRIBUTORS.md` | Dated review and team lists | Not read | Compare with the team table in `README.md` |
| `docs/reviewer-response-2026-05-22.md`, `docs/release_notes.md` | May-dated | Not read | Treat as history |

## D. Notes

- The `session_log.md` entries of 2026-10-24 point to this file.
- Search patterns can miss stale claims phrased without a layer number (for example "hundreds of epochs", "live dashboard"). The sweep is a floor, not a guarantee.
