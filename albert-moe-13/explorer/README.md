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

## Interface

Two switches in the top bar, both stored in `localStorage` and applied without a reload or a
camera move:

- **DE | EN** (`albert.lang`): the default comes from `navigator.language` (`de…` gives DE, any
  other language gives EN); it also sets `<html lang>`. Every UI string lives in
  `src/ui/strings.ts` as `strings[lang][mode]`.
- **Simple | Advanced** (`albert.mode`, default Simple). The mode and the panel depth are one
  concept:

  | Mode     | Depths shown                     | What changes it                                  |
  |----------|----------------------------------|--------------------------------------------------|
  | Simple   | Intuition only                   | Switching to Simple sets the depth to Intuition. |
  | Advanced | Intuition, Technical, Researcher | Switching to Advanced moves Intuition to Technical; choosing Technical or Researcher (panel buttons, keys 2 and 3) switches to Advanced. Intuition inside Advanced stays Advanced. |

  Simple shows five controls: Play ("Watch albert think"), the sentence (its words as chips, the
  followed word marked, plus "Choose another sentence" with the three sentences in full), DE | EN
  with Simple | Advanced, Guided tours and Overview. Above them one headline says what the bar
  does; under them the current step reads as a sentence ("Step 3 of 655 · Layer 12 of 46 · The
  switch picks 3 of 12 experts"), and before the first Play a hint explains the run. The rail is
  labelled "Layer 0" and "Layer 45", keyed "red = exchange gate between the two streams", and
  shows the travelling word with a marker and a progress line.
  Back/forward appear only when a started run is paused. The colour key is a passive legend
  (hover previews a role), the layer rail is the timeline (numbers on hover), and "Step inside"
  sits on the selection card. Three coach marks show on the first visit only (`albert.coach`).
  Advanced adds the Tools drawer (speed, camera mode, jump to layer, kind and next-of-kind, the
  token pickers and scrubber), the settings gear (quality, Auto by default), the panel depth
  switch and the panel tabs (Overview, Computation, Tensors, Notes), plus ids, logits, output
  scales and caveat codes. `tests/ui.test.ts` checks the Simple count (at most 5 control groups).

Colours come from `src/scene/palette.ts` (scene roles) and `src/style/theme.ts` (UI neutrals);
`src/style/tokens.css` mirrors both as CSS custom properties, and `tests/tokens.test.ts` keeps them
equal.

## Fonts

Self-hosted under `public/fonts/`, no font package dependency. Only these three families are used.

| Family | Use | Files | Source | Licence |
|--------|-----|-------|--------|---------|
| Inter 4.1 (rsms) | UI, weights 400/500/600, tabular numbers | `inter/Inter-Regular.woff2`, `Inter-Medium.woff2`, `Inter-SemiBold.woff2` (from `web/` in the zip) | https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip, sha256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e` | SIL Open Font License 1.1, `inter/LICENSE.txt` |
| Space Grotesk 2.0.0 | Title, headings and scene labels, weights 500/700 | `space-grotesk/SpaceGrotesk-Medium.woff2`, `SpaceGrotesk-Bold.woff2` (from `woff2/static/` in the zip) | https://github.com/floriankarsten/space-grotesk/releases/download/2.0.0/SpaceGrotesk-2.0.0.zip, sha256 `53b415577d4139248555300710bea0d268c7a5be67b93de53b716a9736cabffd` | SIL Open Font License 1.1, `space-grotesk/OFL.txt` |
| STIX Two Text 2.13 b171 | Formulas only | `stix-two/STIXTwoText-Regular.woff2` (from `fonts/static_otf_woff2/`) | https://codeload.github.com/stipub/stixfonts/tar.gz/refs/tags/v2.13b171, sha256 `1e76b9ab0bb08372ff73ad5b58d9116260e9058d1fce4b83fe1e213c3b9c947f` | SIL Open Font License 1.1, `stix-two/OFL.txt` |
