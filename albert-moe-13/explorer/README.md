# albert. 3D Explorer

Browser 3D exhibit of albert. (46 layers, dual stream, ternary MoE). Vite + three.js + TypeScript.

Scene: 46 glass slabs in a row along +X. Per slab, stream A lane (y=-1.8, yellow), stream B lane
(y=+1.8, mint), a shared 12-expert bank between them, and a gate arc on fusion slabs.

## Commands (run on the Colony, not the ZBook)

    colony-run -- 'cd albert-moe-13/explorer && npm ci && npx vitest run && npm run build'

Data: `public/data/architecture.json` (see `tools/build_architecture.py`).

## Measured traces

`public/data/trace/{kjv,de,ternary}.json` are real `forward_prefill` runs of the real checkpoint
(prompts in `tools/prompts.json`), recorded by the `albert_trace` binary
(`moe-llm-core`, feature `trace`). Router `weights` are the softmax top-3 probabilities; the model
also multiplies by the traffic-light `output_scales` (stored per event). `num_layers` (46) comes from
the checkpoint tensor names, not from the config (38).

Regenerate everything (Colony only, needs about 2.5 GB available memory: check `free -m` first):

    tools/regenerate.sh /path/to/albert_v3.0.best.safetensors

This runs `tools/build_architecture.py`, then `tools/run_traces.sh` (one fresh process per prompt),
then `npx vitest run tests/trace.test.ts`, which runs `validateTrace` on every trace file
(layer count and checkpoint SHA-256 must equal `architecture.json`).

## Citation snapshots

`tests/content.test.ts` checks the cited Rust line ranges against `tests/fixtures/rust-src-45e8af0/`
(the sources at the commit the panel links pin), not against the working tree. Refresh with
`tools/snapshot_rust_src.sh [COMMIT]` after changing `COMMIT` or the cited files in `src/content/components.ts`.
`decodeToken` / `decodeTokens` (src/data/trace.ts) turn the raw byte-level BPE pieces in a trace into display text.
