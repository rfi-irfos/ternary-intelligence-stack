# Xperience albert. — interactive 3D explorer

A museum-style 3D model card of albert. in the browser: 46 layers in one row, two streams,
12 shared experts per layer, and recorded token runs of the real model. Built with three.js,
Vite and TypeScript. Mouse first, German and English (DE | EN switch in the top bar).

> Status: built on branch `feat/albert-explorer`, not public yet. The live URL follows at launch
> (see `docs/launch-links.md` in the repository root).

<!-- Screenshots: added later by the maintainers. -->
*Screenshot placeholder: lobby, overview row, layer step view.*

## What you see

46 glass slabs in a row along +X, one per layer. Per slab: stream A lane (y=-1.8, yellow),
stream B lane (y=+1.8, mint), a shared 12-expert bank between them, and a gate arc on fusion
slabs (layers 2, 3, 5, 8, 13, 21, 34). Embedding at one end, LM head at the other.

## Controls

- Drag to rotate, wheel to zoom, click a part to select it and read its panel.
- Click empty space: everything folds back. Esc: one level up.
- Play ("Watch albert think") runs a recorded sentence through all layers. Space plays and
  pauses, left and right arrows step.
- Keys 1, 2, 3 switch the panel depth (Intuition, Technical, Researcher; 2 and 3 switch to
  Advanced mode).
- Top bar: DE | EN and Simple | Advanced. Both are stored in `localStorage` and apply
  without a reload. Full description in "Interface" below.

## How the data is built

Nothing is invented. The structure comes from the real checkpoint, the runs from recorded
forward passes of the real model.

| File | What it holds | Made by |
|---|---|---|
| `public/data/architecture.json` | 46 layers, 2 streams, 12 shared experts, gate layers, parameter count, checkpoint date and SHA-256 | `tools/build_architecture.py`, reads the checkpoint header |
| `public/data/trace/{kjv,de,ternary}.json` | recorded `forward_prefill` runs of three sentences (router weights, selected experts, norms, logits) | `albert_trace` binary (`moe-llm-core`, feature `trace`) via `tools/run_traces.sh`; prompts in `tools/prompts.json` |
| `public/data/weights/{L0..L45,embed,lm_head}.json` | per-layer weight views for the Tensors tab | `tools/build_weights.py` |
| `public/assets/*.glb` | four small module meshes (slab, fusion slab, embedding, LM head), geometry only | `blender/build_modules.py` (Blender, background mode) |
| `src/data/{architecture,trace,weights,labeled,words}.ts` | typed loaders and validators for the files above (`validateTrace` checks layer count and checkpoint hash) | hand-written |
| `src/content/*.ts` | texts, cited Rust line ranges, known caveats (`CAVEATS.md` is generated from `src/content/caveats.ts`) | hand-written |

The scene layout (positions, lanes, camera paths) is generated in code (`src/scene`); the
module meshes come from Blender.

## Honesty notes

- **Real:** layer count, stream count, expert count, parameter count (read from the checkpoint
  header); the three recorded sentence runs. Real values carry a dot in the UI.
- **Illustrative ("Zur Veranschaulichung" / "For illustration"):** shapes, colours, camera
  paths, the sound and the sketches in the layer steps. They explain; they measure nothing.
  The quick pass shows every recorded step, only faster. Where no trace exists the UI says
  "no trace (illustrative)".
- **Checkpoint:** the explorer shows the checkpoint file of 2026-09-23 (46 layers). The config
  file in the repository still says 38 layers; the checkpoint is ground truth. The Modal volume
  was not checked for a newer checkpoint.
- **Known caveats** about the model and the code (for example that the training forward pass
  skips the anastomosis gates) are listed in [CAVEATS.md](CAVEATS.md).

## Run and build

Needs any machine with Node 20+ and npm. Heavy runs (the full build with tests, trace
regeneration) are done on the team's Colony server; a laptop is fine for the dev server.

    cd albert-moe-13/explorer
    npm ci
    npm run dev        # Vite dev server
    npm run build      # tsc --noEmit, then vite build into dist/
    npm run preview    # serve the production build locally

Other scripts: `npm test` (vitest), `npm run budgets` (asset budgets, after a build), `npm run e2e` (Playwright), `npm run caveats` (regenerate `CAVEATS.md`).

Without WebGL 2 the app redirects to `fallback.html`, which the build writes from `public/data/architecture.json` and
`src/content/caveats.ts` (the source of `CAVEATS.md`): plain tables in DE and EN.

## Tests

- `npm test` runs `vitest run` over `tests/**/*.test.ts` (scene, UI, i18n, data validation,
  citation checks against the pinned Rust sources in `tests/fixtures/`).
- `tools/test_build_architecture.py` and `tools/test_build_weights.py` test the Python data
  builders (pytest).
- `npm run e2e` runs the Playwright suite in `e2e/*.spec.ts` against a separate build (`VITE_E2E=1`, which adds
  the `window.__albert` test hook; the normal build has none). Colony only: `npx playwright install chromium`
  once, WebGL 2 comes from SwiftShader. It covers smoke, layout rects at 390 / 1280 / 1920 px, the sidebar
  at 280 px and at its widest, axe-core on every surface, reduced motion, context loss and the fallback page.

## Performance

Budgets are checked by `npm run budgets` after `npm run build` (`tools/check_budgets.mjs`, pure size logic
tested in `tests/budgets.test.ts`). It prints the measured numbers on every run and exits 1 on a failure:

- initial load (JS and CSS that `index.html` pulls in, plus `architecture.json`, gzip level 9): at most 5 MB
- whole `dist/` (raw): at most 40 MB
- any `.glb` (raw): at most 6 MB

Measured on the Colony (build of 2026-10-24, output of the script):

    initial files: assets/index-CD1M-htu.js, assets/index-Cm8I_CIW.css, data/architecture.json
    PASS  initial JS+CSS+architecture.json (gzip): 281.0 KB (limit 5.00 MB)
    PASS  dist/ total: 9.14 MB (limit 40.00 MB)
    PASS  glb assets/embed.glb: 3.6 KB (limit 6.00 MB)
    PASS  glb assets/lm_head.glb: 3.6 KB (limit 6.00 MB)
    PASS  glb assets/slab.glb: 52.5 KB (limit 6.00 MB)
    PASS  glb assets/slab_fusion.glb: 68.6 KB (limit 6.00 MB)
    budgets: PASS

All budgets hold with a wide margin, so nothing was split out for them. The traces, weights and
glb files are fetched when needed and are not part of the initial load. Most of the 9 MB is the
three recorded runs and the weight views in `dist/data`.

### Reading `?debug=1`

Add `?debug=1` to the URL (for example `http://127.0.0.1:4173/?debug=1`). A small box appears at the
bottom left, above the timeline (under the top bar on screens up to 720 px wide, where it steps aside while the settings menu is open).
Labels are English in both languages; it is a technical tool. Without `?debug=1` the code is not loaded:
no DOM, no listener, no per-frame work.

| Row | Meaning |
|---|---|
| FPS | frames per second, average over the last second |
| Draw calls | GPU draw calls of the whole frame (all passes: bloom source, final), from `renderer.info` |
| Triangles | triangles drawn in the whole frame, from `renderer.info` |
| Quality | the active preset (High, Medium or Low) |
| Canvas | drawing buffer size in pixels |
| Pixel ratio | the ratio the renderer uses, and the ratio the device reports |

The overlay refreshes four times a second. To measure a preset, choose it in the settings gear
(Advanced mode) first; the choice is stored and `Auto` runs the probe again.

### Quality probe

Without a saved choice, a desktop starts on High and measures the render work time of frames
(`src/scene/look.ts`, `createProbe`, `chooseQuality`): 8 warm-up frames are skipped, then 30 frames are
timed (CPU plus a one-pixel GPU read-back, not the vsync interval). Median up to 12 ms gives High, up to 22 ms
gives Medium, above that Low. It stops early when the median of the first 5 frames is above 44 ms. No usable
sample counts as a weak device and gives Low. A phone (touch and short side up to 600 px) starts on Low without a probe.
A saved choice always wins. The thresholds are unchanged: they have no data from real hardware yet.
The Colony runs SwiftShader (software WebGL), whose frame times say nothing about a laptop GPU, so they are not used to tune anything.
The probe prints its median and pick to the console at debug level (`[albert] quality probe: ...`).

### Reference hardware

Reference-hardware fps (Medium >= 50 fps, draw calls < 200): **not measured yet, Simeon measures on the ZBook.**
Open the preview with `?debug=1`, set Medium, and write the FPS and Draw calls rows here for the
overview, an opened layer and a running token pass.

## Project layout

| Path | Content |
|---|---|
| `src/scene` | tower layout, modules, materials, palette, explode views, backdrop |
| `src/ui` | top bar, player, panel, sidebar, lobby, coach marks, strings (DE/EN) |
| `src/camera`, `src/flow`, `src/layer`, `src/intro`, `src/audio` | camera rig, token flow animation, layer step views, intro, sound |
| `src/data`, `src/content` | data loaders and validators, texts and caveats |
| `public/data`, `public/assets`, `public/fonts` | architecture, traces, weights, glb meshes, self-hosted fonts |
| `tools`, `blender`, `e2e`, `tests` | data builders, Blender module script, headless checks, vitest suites |

## Licence

Part of the Ternary Intelligence Stack. Licence: the repository licence (LGPL-3.0 for the
community tier; see `LICENSE` in the repository root and the Licensing section of the root
README). Fonts keep their own SIL Open Font Licence 1.1 (see "Fonts").

---

## Details

### Team build command

On this team the full check runs on the Colony, not on the ZBook:

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
