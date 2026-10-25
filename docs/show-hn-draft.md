<!-- Entwurf, von Simeon am 2026-10-25 selbst auf Hacker News gepostet (der Text im Post weicht leicht ab). -->

# Show HN: Xperience albert.

## Titel (80 Zeichen max, ohne Werbesprache)

1. `Show HN: Walk through a ternary mixture-of-experts model in 3D, in your browser`
2. `Show HN: A 3D explorer for a ternary dual-stream MoE language model (46 layers)`

URL: https://albert.rfi-irfos.com/

## Erster Kommentar (vom Autor, direkt nach dem Post)

Hi HN. This is a browser explorer for albert., a language model we train from scratch at RFI-IRFOS in Graz. Its weights are -1, 0 or +1.

You fly through the layers, follow one word from input to output, and see which experts take part. It runs in the browser, no account, no install. Source is in the repo under `albert-moe-13/explorer/`.

The model:

- two streams, 46 layers per stream
- 12 shared experts per layer
- 7 gates that exchange information between the streams
- 331,140,622 parameters

It grew in depth through surgeries (adding layers to a trained model); each one is in the surgery registry with its epoch and loss, and the explorer shows that history.

Every number in the explorer carries a label: structure, measured or illustrative. Where the docs give no number, it says so. Training is stopped at the moment; the checkpoint and the numbers come from the data files.

Controls: mouse or touch to orbit, W/A/S/D and Q/E to fly, Shift for faster. English and German.

What I would like to hear: where the explanation of routing is unclear, and what would help you read a ternary MoE faster.

Repo: https://github.com/rfi-irfos/ternary-intelligence-stack

## Hinweise zum Posten

- Kein Hochvoten-Aufruf, keine Bitte um Teilen. Das gilt auf HN als Regelverstoß.
- Der Link ist die Projekt-URL, der Text steht im ersten Kommentar.
- Beste Zeit: Wochentag, Vormittag US-Ostküste (Erfahrungswert, kein Beleg).
- Rechne mit Fragen zu: Qualität des Modells, Vergleich mit anderen ternären Modellen (BitNet), "ternär" im Training gegen Inferenz. Antworte mit Zahlen aus `MODEL_CARD.md`, erfinde keine Benchmarks.
