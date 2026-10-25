<!-- Veröffentlicht am 2026-10-25 als Release v3.2.0 "Xperience albert." (Text ohne diese Zeile und ohne die Überschrift). -->

# v3.2.0 — Xperience albert.

Today, we open the door to something many of you have been following with us for quite some time.

**Xperience albert.** is a 3D walk through a language model, live at **https://albert.rfi-irfos.com/**. You fly through its layers, follow a single word from input to output, and see which parts of the model take part along the way. It runs in your browser, with no account and no installation.

## What you are looking at

albert. is a ternary dual-stream mixture-of-experts model, trained from scratch at RFI-IRFOS in Graz. Its weights are −1, 0 or +1, and the ternary constraint has been active since the first epoch.

- 46 layers per stream, 2 streams
- 12 shared experts per layer
- 7 exchange gates between the streams
- 331,140,622 parameters

The model grew in depth. Every depth surgery is written down in the surgery registry with its epoch and its loss, and the explorer shows this history.

## For everyone, for study

Press play and watch a sentence travel through the model. Switch to the advanced view for the real tensors, the parameter counts and the routing, down to the single layer. Every number carries a label: **structure**, **measured** or **illustrative**. Where the documentation gives a number, we cite it. Where it gives none, we say so.

German and English are complete. The explorer works with mouse, keyboard and touch.

## Notes

- albert. is a research model and still changing. The numbers in the explorer come from the data files and follow them.
- Source: `albert-moe-13/explorer/` in this repository. Hosting: GitHub Pages, deployed by `.github/workflows/albert-explorer-pages.yml`.

RFI-IRFOS
