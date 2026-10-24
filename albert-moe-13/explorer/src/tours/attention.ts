import type { TourStep } from './engine';
import { tx } from './text';

/** 4. Inside attention: Q, K, V, RoPE, scores, softmax. Layer 12 (0-based) is "Ebene 13". */
export const attentionSteps: TourStep[] = [
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    text: tx(
      ['Attention lets every word look at the words before it. It decides which of them matter right now.',
        'Attention lässt jedes Wort auf die Wörter vor ihm schauen. Sie entscheidet, welche davon gerade wichtig sind.'],
      ['One attention block per layer and stream: {heads} heads of width {headDim}, Q K V and O projections, RoPE, causal mask.',
        'Ein Attention-Block je Ebene und Strom: {heads} Köpfe der Breite {headDim}, Projektionen Q, K, V und O, RoPE, kausale Maske.'],
      ['Tensors in L12.json: stream_a.attn.q_proj.weight, k_proj, v_proj, o_proj, each [{hidden} × {hidden}] with its own γ. {heads} heads × {headDim} = {hidden}: every head reads its own {headDim}-wide slice of Q, K and V.',
        'Tensoren in L12.json: stream_a.attn.q_proj.weight, k_proj, v_proj, o_proj, je [{hidden} × {hidden}] mit eigenem γ. {heads} Köpfe × {headDim} = {hidden}: Jeder Kopf liest seinen eigenen {headDim} breiten Ausschnitt von Q, K und V.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    figure: { kind: 'matmul', layer: 12, stream: 'A', matrix: 'q' },
    text: tx(
      ['Each word makes three things: a question (Q), a key (K) and a content (V). The calculation uses only −1, 0 and +1. Below is a real corner of the Q matrix.',
        'Jedes Wort macht drei Dinge: eine Frage (Q), einen Schlüssel (K) und einen Inhalt (V). Die Rechnung nutzt nur −1, 0 und +1. Unten siehst du eine echte Ecke der Q-Matrix.'],
      ['Q = x W_q, K = x W_k, V = x W_v with ternary W and a scale γ. Below: the real top-left 4x4 corner of W_q in layer {layer}. The input x is an example.',
        'Q = x W_q, K = x W_k, V = x W_v mit ternärem W und einer Skala γ. Unten: die echte 4x4-Ecke oben links von W_q in Ebene {layer}. Die Eingabe x ist ein Beispiel.'],
      ['y_j = γ · Σ_i W[j][i] · x_i with W[j][i] in {−1, 0, +1}. The file L12.json stores per matrix γ, the shares of −1, 0 and +1 and a 32 × 32 tile; the figure shows its top-left 4 × 4 corner. x is a fixed example vector, not a recorded activation.',
        'y_j = γ · Σ_i W[j][i] mit W[j][i] in {−1, 0, +1}. Die Datei L12.json speichert je Matrix γ, die Anteile von −1, 0 und +1 und eine Kachel von 32 × 32; die Abbildung zeigt deren 4x4-Ecke oben links. x ist ein fester Beispielvektor (illustrativ); gemessene Werte zeigen erst die Vorhersage-Momente.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    text: tx(
      ['RoPE turns Q and K by an angle that depends on the position. This way the model knows how far apart two words are.',
        'RoPE dreht Q und K um einen Winkel, der von der Position abhängt. So weiß das Modell, wie weit zwei Wörter auseinanderliegen.'],
      ['RoPE rotates dimension i together with i + {half} by the angle position × 10000^(−2i/{headDim}) (rotate_half pairing).',
        'RoPE dreht die Dimension i zusammen mit i + {half} um den Winkel Position × 10000^(−2i/{headDim}) (Paarung rotate_half).'],
      ['Pairs (x_i, x_(i+{half})) are rotated by θ_i = pos · 10000^(−2i/{headDim}) for i = 0 … {half} − 1: x_i′ = x_i cos θ_i − x_(i+{half}) sin θ_i and x_(i+{half})′ = x_(i+{half}) cos θ_i + x_i sin θ_i. The angle between two positions depends only on their distance.',
        'Die Paare (x_i, x_(i+{half})) werden um θ_i = pos · 10000^(−2i/{headDim}) für i = 0 … {half} − 1 gedreht: x_i′ = x_i cos θ_i − x_(i+{half}) sin θ_i und x_(i+{half})′ = x_(i+{half}) cos θ_i + x_i sin θ_i. Der Winkel zwischen zwei Positionen hängt nur von ihrem Abstand ab.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    text: tx(
      ['Q and K give a score for every earlier word. A mask hides later words. Softmax turns the scores into shares that add up to 100 %.',
        'Q und K ergeben eine Punktzahl für jedes frühere Wort. Eine Maske verdeckt spätere Wörter. Softmax macht aus den Punktzahlen Anteile, die zusammen 100 % ergeben.'],
      ['scores = Q Kᵀ / √{headDim}, causal mask, softmax per head ({heads} heads), then the weighted sum of V.',
        'Punktzahlen = Q Kᵀ / √{headDim}, kausale Maske, Softmax je Kopf ({heads} Köpfe), danach die gewichtete Summe von V.'],
      ['a_(t,s) = exp(q_t · k_s / √{headDim}) / Σ_(u ≤ t) exp(q_t · k_u / √{headDim}) for s ≤ t, else 0; out_t = Σ_s a_(t,s) v_s. Scale √{headDim}: the dot product of two {headDim}-wide vectors grows with the width.',
        'a_(t,s) = exp(q_t · k_s / √{headDim}) / Σ_(u ≤ t) exp(q_t · k_u / √{headDim}) für s ≤ t, sonst 0; out_t = Σ_s a_(t,s) v_s. Die Skala √{headDim} gleicht aus, dass das Skalarprodukt zweier {headDim} breiter Vektoren mit der Breite wächst.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    action: { predict: 'attention', layer: 12, head: 0 },
    text: tx(
      ['Guess first: which earlier word does the word on screen look at most? Then compare with the recorded run.',
        'Rate zuerst: Auf welches frühere Wort schaut das Wort auf dem Bildschirm am meisten? Danach vergleichst du mit dem aufgezeichneten Durchlauf.'],
      ['Prediction: the answer is the argmax over earlier keys of the recorded attention row (stream A, head 0, layer {layer}).',
        'Vorhersage: Die Antwort ist das Argmax über frühere Schlüssel in der aufgezeichneten Attention-Zeile (Strom A, Kopf 0, Ebene {layer}).'],
      ['The attention event of the trace holds one weight row per position and head. The answer is argmax_s a_(t,s) over s < t for t = last token, stream A, head 0, layer {layer} (index {index}). The first token has no earlier key.',
        'Das Attention-Ereignis des Traces enthält je Position und Kopf eine Gewichtszeile. Die Antwort ist argmax_s a_(t,s) über s < t für t = letztes Token, Strom A, Kopf 0, Ebene {layer} (Index {index}). Beim ersten Token fehlen frühere Schlüssel; dort entfällt die Antwort.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'], action: 'free',
    text: tx(
      ['The heads join into one result. It is added to the word. Press Play in the dock to see this step for every word.',
        'Die Köpfe werden zu einem Ergebnis zusammengeführt. Es wird zum Wort addiert. Drücke Play im Dock, um diesen Schritt für jedes Wort zu sehen.'],
      ['The O projection ({hidden} × {hidden}, ternary) merges the heads. The result is added to the residual stream.',
        'Die O-Projektion ({hidden} × {hidden}, ternär) führt die Köpfe zusammen. Das Ergebnis wird zum Residualstrom addiert.'],
    ),
  },
];
