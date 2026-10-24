import type { TourStep } from './engine';
import { tx } from './text';

/** 7. From embedding to prediction: token ID to logits. */
export const predictionSteps: TourStep[] = [
  {
    camera: 'embed', highlight: ['embed'],
    text: tx(
      ['A sentence is cut into small pieces, the tokens. Every token has a number, its ID.',
        'Ein Satz wird in kleine Stücke zerlegt, die Tokens. Jedes Token hat eine Nummer, seine ID.'],
      ['The tokenizer maps text to ids from a vocabulary of {vocab} entries (byte-level BPE).',
        'Der Tokenizer bildet Text auf IDs aus einem Wortschatz mit {vocab} Einträgen ab (Byte-Level-BPE).'],
    ),
  },
  {
    camera: 'embed', highlight: ['embed'],
    text: tx(
      ['The ID picks a row from a big table. The row is a pack of {hidden} numbers, the embedding.',
        'Die ID wählt eine Zeile aus einer großen Tabelle. Die Zeile ist ein Paket aus {hidden} Zahlen, die Einbettung.'],
      ['Embedding lookup: row[id] of a [{vocab} × {hidden}] F32 table. Both streams start with this vector.',
        'Einbettung per Nachschlagen: Zeile[id] einer F32-Tabelle [{vocab} × {hidden}]. Beide Ströme starten mit diesem Vektor.'],
    ),
  },
  {
    camera: 'L23', highlight: ['L23'],
    text: tx(
      ['The pack runs through all {layers} layers. Each layer changes it a little. It keeps its size.',
        'Das Paket läuft durch alle {layers} Ebenen. Jede Ebene verändert es ein wenig. Seine Größe bleibt gleich.'],
      ['Residual stream: x ← x + attention(ln1(x)), then x ← x + experts(ln2(x)). The width stays {hidden} in every layer.',
        'Residualstrom: x ← x + Attention(ln1(x)), danach x ← x + Experten(ln2(x)). Die Breite bleibt in jeder Ebene {hidden}.'],
    ),
  },
  {
    camera: 'L23', highlight: ['L23'], quiz: 'residual',
    text: tx(
      ['The pack is a running total. A layer adds its result to it and keeps what was there. A layer adds twice in each stream: once after attention and once after the experts. The size stays {hidden} numbers.',
        'Das Paket ist eine laufende Summe. Eine Ebene addiert ihr Ergebnis dazu und behält, was schon da war. Eine Ebene addiert in jedem Strom zweimal: einmal nach der Attention und einmal nach den Experten. Die Größe bleibt bei {hidden} Zahlen.'],
      ['Residual stream, per layer and stream: x ← x + attention(ln1(x)), then x ← x + experts(ln2(x)). Two additions per layer and stream. The width stays {hidden} in all {layers} layers.',
        'Residualstrom, je Ebene und Strom: x ← x + Attention(ln1(x)), danach x ← x + Experten(ln2(x)). Zwei Additionen je Ebene und Strom. Die Breite bleibt in allen {layers} Ebenen {hidden}.'],
    ),
  },
  {
    camera: 'ln_f', highlight: ['ln_f'],
    text: tx(
      ['At the end both streams are joined and the numbers are rescaled one last time.',
        'Am Ende werden beide Ströme vereint und die Zahlen ein letztes Mal neu skaliert.'],
      ['Merge as a mean, h = (h_a + h_b) / 2, then ln_f in F32.',
        'Vereinigung als Mittelwert, h = (h_a + h_b) / 2, danach ln_f in F32.'],
    ),
  },
  {
    camera: 'lm_head', highlight: ['lm_head'],
    text: tx(
      ['The last step gives every word of the vocabulary a score: {vocab} scores in total.',
        'Der letzte Schritt gibt jedem Wort des Wortschatzes eine Punktzahl: insgesamt {vocab} Punktzahlen.'],
      ['logits = lm_head(h): a ternary [{vocab} × {hidden}] projection. A softmax turns the logits into probabilities.',
        'Logits = lm_head(h): eine ternäre Projektion [{vocab} × {hidden}]. Eine Softmax macht aus den Logits Wahrscheinlichkeiten.'],
    ),
  },
  {
    camera: 'lm_head', highlight: ['lm_head'], action: 'free', figure: { kind: 'topk' },
    text: tx(
      ['These are albert.’s five best guesses for the next word, measured in the recorded run.',
        'Das sind die fünf besten Tipps von albert. für das nächste Wort, gemessen im aufgezeichneten Durchlauf.'],
      ['The top 5 of the inference path (forward_prefill, last position) from the recorded trace. Probabilities are softmax values.',
        'Die Top 5 des Inferenzpfads (forward_prefill, letzte Position) aus dem aufgezeichneten Trace. Die Wahrscheinlichkeiten sind Softmax-Werte.'],
    ),
  },
];
