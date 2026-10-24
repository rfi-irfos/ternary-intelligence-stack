import type { L10n } from './engine';
import { L } from './text';

/**
 * The three questions of the residual step. Each is answerable from the step text next to it, uses no
 * measured number, and is never scored: the explanation shows after the pick, whatever the pick was.
 * Placeholders ({hidden}, {layers}) come from architecture.json.
 */
export interface QuizQuestion { q: L10n; options: L10n[]; correct: number; why: L10n }

export const residualQuiz: QuizQuestion[] = [
  {
    q: L('What happens to the size of the pack from layer to layer?', 'Was geschieht von Ebene zu Ebene mit der Größe des Pakets?'),
    options: [
      L('It grows with every layer.', 'Es wächst mit jeder Ebene.'),
      L('It stays {hidden} numbers.', 'Es bleibt bei {hidden} Zahlen.'),
      L('It shrinks with every layer.', 'Es schrumpft mit jeder Ebene.'),
    ],
    correct: 1,
    why: L('The size stays {hidden} numbers in all {layers} layers. A layer adds to the pack and the pack keeps its length.',
      'Die Größe bleibt in allen {layers} Ebenen bei {hidden} Zahlen. Eine Ebene addiert zum Paket und das Paket behält seine Länge.'),
  },
  {
    q: L('What does a layer do with its result?', 'Was macht eine Ebene mit ihrem Ergebnis?'),
    options: [
      L('It replaces the pack with the result.', 'Sie ersetzt das Paket durch das Ergebnis.'),
      L('It adds the result to the pack.', 'Sie addiert das Ergebnis zum Paket.'),
      L('It drops the result.', 'Sie verwirft das Ergebnis.'),
    ],
    correct: 1,
    why: L('The result is added: x ← x + result. What the pack held before stays in it.',
      'Das Ergebnis wird addiert: x ← x + Ergebnis. Was das Paket vorher enthielt, bleibt darin.'),
  },
  {
    q: L('How often does one layer add to the pack, in one stream?', 'Wie oft addiert eine Ebene in einem Strom zum Paket?'),
    options: [
      L('Once.', 'Einmal.'),
      L('Twice: after attention and after the experts.', 'Zweimal: nach der Attention und nach den Experten.'),
      L('Three times.', 'Dreimal.'),
    ],
    correct: 1,
    why: L('Twice. First x ← x + attention(ln1(x)), then x ← x + experts(ln2(x)).',
      'Zweimal. Zuerst x ← x + Attention(ln1(x)), danach x ← x + Experten(ln2(x)).'),
  },
];
