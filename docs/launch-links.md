# Launch-day links: Xperience albert. explorer

**NOT YET LIVE. Do not publish before Simeon's go.**
The explorer exists on branch `feat/albert-explorer` (`albert-moe-13/explorer`). No public URL exists today. The planned host is `albert.ternlang.com` (GitHub Pages inside this repo, per the design note of 2026-10-23). Nothing below is true until that URL answers.

Placeholder used below: `<LIVE_URL>`. On launch day replace it with the real URL (planned: `https://albert.ternlang.com`) after checking that it loads.

## 1. Root `README.md`

The relative quick link is already in place (Documentation list, under the albert. line):

```
- **[Xperience albert.](albert-moe-13/explorer/README.md)** — interactive 3D explorer of albert.'s architecture (46 layers, in the browser)
```

Launch-day replacement (live link, same position):

```
- **[Xperience albert.](<LIVE_URL>)** — interactive 3D explorer of albert.'s architecture (46 layers, in the browser) · [how it is built](albert-moe-13/explorer/README.md)
```

Optional badge line for the badge block at the top:

```
[![Xperience albert.](https://img.shields.io/badge/Xperience-albert.-yellow)](<LIVE_URL>)
```

Also change in section "2. albert." the line "**Explore it:** ... (built, not public yet)" to:

```
**Explore it:** [Xperience albert.](<LIVE_URL>) is an interactive 3D explorer of the 46 layers, in the browser.
```

## 2. `albert-moe-13/README.md`

Top of the file, the line starting "**Xperience albert.**" currently says "Not public yet: the live URL follows at launch." Launch-day text:

```
**Xperience albert.** — [interactive 3D explorer of albert.'s architecture (46 layers, in the browser)](<LIVE_URL>). A museum-style walk through the real checkpoint structure, with recorded traces of the real model. Build notes: [explorer/README.md](explorer/README.md).
```

## 3. `albert-moe-13/explorer/README.md`

Replace the "Status" quote near the top with:

```
> Live: <LIVE_URL>
```

## 4. `MODEL_CARD.md` and the HuggingFace model card

In `MODEL_CARD.md` the paragraph starting "**Xperience albert.**" currently links the explorer README. Launch-day text (same text for both):

```
**Xperience albert.** — [interactive 3D explorer of albert.'s architecture (46 layers, in the browser)](<LIVE_URL>). A museum-style walk through the real checkpoint structure with recorded traces of the real model.
```

HuggingFace model card (`https://huggingface.co/rfi-irfos/albert`): the full text for Simeon to paste is `docs/hf-model-card-draft.md` (same facts as `MODEL_CARD.md`, links made absolute, front matter kept). On launch day, replace the HTML comment `<!-- LAUNCH DAY: ... -->` in the Xperience paragraph with the link text above. Do not upload before Simeon's go.

## 5. Repository description and topics (suggestion for GitHub, not applied)

Description (suggestion):

```
Ternary Intelligence Stack: ternlang compiler and runtime, albert. ternary MoE language model (46 layers), Xperience albert. 3D explorer.
```

Topics (suggestion): `ternary`, `mixture-of-experts`, `ternary-weights`, `net2net`, `three-js`, `model-card`, `interpretability`, `rust`, `candle`.

## 6. External places that must change together

Edit none of them until the go. Change them in one pass so no place shows a different layer count or state.

| Place | What to change |
|---|---|
| HuggingFace model card `rfi-irfos/albert` | Paste `docs/hf-model-card-draft.md` (46L, 1,104 slots, 331,140,622 parameters, last recorded epoch 9270, stopped) and add the live link |
| ternlang.com page (source in this repo: `ternlang-root/ternlang-web/index.html`, `talk.html`) | Still shows "26L dual-stream, 187.5M params, 13 autonomous surgeries" (see `docs/stale-claims-audit.md`). Update the numbers, then add the explorer link |
| `ternlang-api` description string (`ternlang-root/ternlang-api/src/main.rs:1167`, "134M params, 22L") | Update with the numbers; needs a deploy of the API on Fly |
| OSF whitepaper mention (https://osf.io/cyn28 and DOI 10.17605/OSF.IO/TZ7DC, linked from both READMEs) | Check whether the text names a layer count or state; update the OSF record or add a note if it does. Not checked in this pass (external) |
| GitHub repository description and topics | Section 5 |
| `albert.ternlang.com` DNS and GitHub Pages | Needs the CNAME and the Pages build; the `CNAME` file in the repo root holds `ternlang.com`; a project subdomain needs its own Pages setup (check before changing) |
