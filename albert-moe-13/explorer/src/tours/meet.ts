import type { TourStep } from './engine';
import { BANK, tx } from './text';

/** 1. Meet albert.: the whole row, the counts, the two streams. Layer 12 (0-based) is "Ebene 13" on screen. */
export const meetSteps: TourStep[] = [
  {
    camera: 'overview', highlight: [],
    text: tx(
      ['albert. is a language model. Here you see it as a long row of {layers} layers. Each word travels through the row from left to right.',
        'albert. ist ein Sprachmodell. Hier siehst du es als lange Reihe aus {layers} Ebenen. Jedes Wort läuft von links nach rechts hindurch.'],
      ['{layers} layers, {streams} streams (A and B), {experts} shared experts per layer, {params} parameters. All counts are read from architecture.json.',
        '{layers} Ebenen, {streams} Ströme (A und B), {experts} gemeinsame Experten je Ebene, {params} Parameter. Alle Zahlen stammen aus architecture.json.'],
    ),
  },
  {
    camera: 'embed', highlight: ['embed'],
    text: tx(
      ['On the far left a word becomes a list of numbers. The model can calculate with numbers.',
        'Ganz links wird ein Wort zu einer Liste aus Zahlen. Mit Zahlen kann das Modell rechnen.'],
      ['embed: a [{vocab} × {hidden}] table in F32. A token id picks one row of {hidden} values. Both streams start from this vector.',
        'embed: eine Tabelle [{vocab} × {hidden}] in F32. Eine Token-ID wählt eine Zeile mit {hidden} Werten. Beide Ströme starten mit diesem Vektor.'],
    ),
  },
  {
    camera: 'L12', highlight: ['shaft.A', 'shaft.B'],
    text: tx(
      ['From here the word runs on two tracks, stream A and stream B. Each track calculates on its own.',
        'Von hier läuft das Wort auf zwei Bahnen weiter: Strom A und Strom B. Jede Bahn rechnet für sich.'],
      ['Two streams run through all {layers} layers. Each has its own attention, norms and router. The {experts} experts are shared.',
        'Zwei Ströme laufen durch alle {layers} Ebenen. Jeder hat eigene Attention, eigene Normen und einen eigenen Router. Die {experts} Experten sind gemeinsam.'],
    ),
  },
  {
    camera: 'L12', highlight: BANK,
    text: tx(
      ['Every layer has a pool of {experts} experts. For each word only {topk} of them work.',
        'Jede Ebene hat einen Pool aus {experts} Experten. Für jedes Wort arbeiten nur {topk} davon.'],
      ['Every layer holds {experts} experts. A router per stream picks the top-{topk} for each token (sparse mixture of experts).',
        'Jede Ebene enthält {experts} Experten. Ein Router je Strom wählt die Top-{topk} für jedes Token (dünn besetzte Expertenmischung, Sparse MoE).'],
    ),
  },
  {
    camera: 'L13.gate', highlight: ['L13.gate'],
    text: tx(
      ['In {gateCount} places the two streams swap a little. A valve controls the swap. It sits in layers {gates}.',
        'An {gateCount} Stellen tauschen die zwei Ströme etwas aus. Ein Ventil steuert den Austausch. Es sitzt in den Ebenen {gates}.'],
      ['{gateCount} anastomosis gates sit at layers {gates} (as numbered in the dock). The checkpoint counts them from 0: {gatesIndex}.',
        '{gateCount} Austausch-Tore sitzen in den Ebenen {gates} (so nummeriert das Dock). Der Checkpoint zählt ab 0: {gatesIndex}.'],
    ),
  },
  {
    camera: 'lm_head', highlight: ['lm_head'],
    text: tx(
      ['On the far right albert. scores all {vocab} words of its vocabulary. The best score becomes the guess for the next word.',
        'Ganz rechts bewertet albert. alle {vocab} Wörter seines Wortschatzes. Die beste Punktzahl wird der Tipp für das nächste Wort.'],
      ['lm_head: a ternary [{vocab} × {hidden}] projection to next-token scores.',
        'lm_head: eine ternäre Projektion [{vocab} × {hidden}] auf die Punktzahlen des nächsten Tokens.'],
    ),
  },
  {
    camera: 'overview', highlight: [], action: 'free',
    text: tx(
      ['Now the scene is yours. Click a part, turn the camera or pick another tour.',
        'Jetzt gehört die Szene dir. Klicke ein Teil an, drehe die Kamera oder wähle eine andere Tour.'],
      ['Free exploration: click any part to open it, or press Play in the dock to follow a word. Other tours are in the Tour menu.',
        'Freies Erkunden: Ein Klick öffnet jedes Teil. Mit Play im Dock folgst du einem Wort. Weitere Touren stehen im Tour-Menü.'],
    ),
  },
];
