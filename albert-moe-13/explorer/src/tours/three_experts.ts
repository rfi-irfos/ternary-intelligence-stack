import type { TourStep } from './engine';
import { BANK, L, tx } from './text';

/** 3. Why only three experts? Sparse MoE routing, @sparseskip, load. Layer 12 (0-based) is "Ebene 13". */
export const threeSteps: TourStep[] = [
  {
    camera: 'L12', highlight: BANK,
    text: tx(
      ['{experts} experts wait here. For each word only {topk} of them calculate. The others rest, so albert. saves work.',
        'Hier warten {experts} Experten. Für jedes Wort rechnen nur {topk} davon. Die anderen ruhen, so spart albert. Arbeit.'],
      ['Sparse mixture of experts: per token and stream only the top-{topk} of {experts} experts compute. The weights of the rest stay unused for that token.',
        'Dünn besetzte Expertenmischung (Sparse MoE): Je Token und Strom rechnen nur die Top-{topk} von {experts} Experten. Die Gewichte der übrigen bleiben für dieses Token ungenutzt.'],
    ),
  },
  {
    camera: 'L12.A.router', highlight: ['L12.A.router'],
    text: tx(
      ['In front of the experts sits the router. It gives every expert a score for the current word.',
        'Vor den Experten sitzt der Router. Er gibt jedem Experten eine Punktzahl für das aktuelle Wort.'],
      ['The router is an F32 linear layer [{experts} × {hidden}] with a temperature. Its {experts} logits decide the top-{topk}.',
        'Der Router ist eine lineare F32-Schicht [{experts} × {hidden}] mit Temperatur. Seine {experts} Logits entscheiden über die Top-{topk}.'],
    ),
  },
  {
    camera: 'L12', highlight: BANK,
    action: {
      predict: 'experts', layer: 12, stream: 'A',
      prompt: L('Which {topk} experts will the router of layer {layer} (stream A) pick for the word on screen? Click {topk} cabinets, here or in the scene.',
        'Welche {topk} Experten wählt der Router in Ebene {layer} (Strom A) für das Wort auf dem Bildschirm? Klicke {topk} Schränke an, hier oder in der Szene.'),
    },
    text: tx(
      ['Your turn to guess first. Afterwards you compare your pick with the recorded run.',
        'Du darfst zuerst raten. Danach vergleichst du mit dem aufgezeichneten Durchlauf.'],
      ['Prediction: the answer is the recorded top-3 of the router event for this layer, stream and token. Nothing is recomputed.',
        'Vorhersage: Die Antwort ist die aufgezeichnete Top-3 des Router-Ereignisses für diese Ebene, diesen Strom und dieses Token. Nichts wird neu gerechnet.'],
    ),
  },
  {
    camera: 'L12.A.router', highlight: ['L12.A.router', ...BANK],
    text: tx(
      ['The chosen experts do not count equally. Their weights add up to 100 %. The strongest expert shapes the result most.',
        'Die gewählten Experten zählen verschieden. Ihre Gewichte ergeben zusammen 100 %. Der stärkste Experte prägt das Ergebnis am meisten.'],
      ['The weights are a softmax over the top-{topk} logits after the A3 clamp for experts 0 to 3 (caveat A3), before the traffic-light output scales.',
        'Die Gewichte sind eine Softmax über die Top-{topk}-Logits nach der A3-Begrenzung für die Experten 0 bis 3 (Befund A3), vor den Ampel-Ausgabeskalen.'],
    ),
  },
  {
    camera: 'L12', highlight: BANK,
    text: tx(
      ['Inside a chosen expert, a weight of 0 adds zero. The model skips such numbers while it calculates.',
        'In einem gewählten Experten steuert ein Gewicht von 0 genau 0 bei. Das Modell überspringt solche Zahlen beim Rechnen.'],
      ['@sparseskip: zeros in the ternary sign matrix contribute zero to the dot product, and the hot path needs no branch (ternary_linear.rs).',
        '@sparseskip: Nullen in der ternären Vorzeichenmatrix steuern 0 zum Skalarprodukt bei. Eine Verzweigung entfällt im heißen Pfad (ternary_linear.rs).'],
    ),
  },
  {
    camera: 'L12.B.router', highlight: ['L12.B.router'], action: 'free',
    text: tx(
      ['Stream B has its own router. It may pick other experts than stream A. Press Play in the dock and watch the choices change from word to word.',
        'Strom B hat einen eigenen Router. Er kann andere Experten wählen als Strom A. Drücke Play im Dock und sieh, wie sich die Wahl von Wort zu Wort ändert.'],
      ['One router per stream over the same shared pool. The traffic-light state scales expert outputs at runtime (caveat A5).',
        'Ein Router je Strom über denselben gemeinsamen Pool. Der Ampelzustand skaliert die Experten-Ausgaben zur Laufzeit (Befund A5).'],
    ),
  },
];
