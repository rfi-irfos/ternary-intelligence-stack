# Known caveats

Generated from `src/content/caveats.ts` by `npm run caveats`. Do not edit by hand.

## A1. Anastomosis is skipped in the training forward pass

Transformer::forward runs stream A fully, then stream B, then averages. The code comment says this "approximates the interleaved fusion". Only forward_prefill and forward_decode apply the gates. generate() also calls forward, so it skips them too.

Evidence: transformer.rs:184-215, 282-295; train_bible.rs:1582 calls model.forward

## A2. Gate weights sit at initialisation scale

RMS 0.010-0.012 against an init of N(0, 0.01); biases within +-0.009; gate 6 (layer 34) has bias exactly 0. This is consistent with A1. At inference sigma(~0) is about 0.5, so each stream adds about half of the other at 7 layers, a mixing the training path never saw.

Evidence: checkpoint read 2026-10-23

## A3. "Safety gate" on experts 0-3 raises, not suppresses

For experts 0-3 with a negative logit, the logit is multiplied to 0 before the top-3 softmax, which increases their weight. Docs describe it as suppression to zero.

Evidence: moe.rs:310-326

## A4. seed_bias dominates the expert input

Source comment: seed std is about 0.7 against a layer-norm output std of about 0.003; about 29.6 % of the inner neurons are seed-saturated.

Evidence: mlp.rs:12, 40-42

## A5. Traffic-light state and its output scales are runtime state

They are not in the checkpoint. Any traffic-light colours shown must come from a trace or a log and be labelled with their source.

Evidence: moe.rs:240-250, 346

## A6. Config says 38 layers, the checkpoint has 46

Surgeries S30-S33 (42 to 46 layers) are undocumented. The explorer reads the checkpoint; the config is not used for counts.

Evidence: models/albert_v3.0.config.json

## A7. The explorer shows the 2026-09-23 checkpoint

It may not be the newest one (the Modal volume was not checked). The site states its checkpoint date and hash.

Evidence: decision 2026-10-23

## A8. The serving binary builds the model from the config depth (38)

It does not take the depth from the checkpoint (46). Whether blocks 38-45 are then silently ignored is not yet verified. If so, the deployed albert. runs a different depth than it was trained with.

Evidence: albert_serve.rs:194, builder check 2026-10-23

## A9. Traffic-light state persists across calls in one process

It has no reset, and its modifiers are off for the first 50 calls (warm-up). Routing therefore depends on call history.

Evidence: moe.rs:303-304, traffic_light.rs:36, 124, 208
