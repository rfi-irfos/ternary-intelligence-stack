import type { TourStep } from './engine';
import { tx } from './text';

/** 5. Ternary computation: {-1, 0, +1}, gamma, tau, STE, what is F32 and what is not. All matrix numbers are read from L{n}.json. */
export const ternarySteps: TourStep[] = [
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    figure: { kind: 'matmul', layer: 12, stream: 'A', matrix: 'q' },
    text: tx(
      ['Ternary means: every weight is −1, 0 or +1. Calculating becomes adding, subtracting and skipping. These are the first 4 × 4 weights of a real matrix.',
        'Ternär heißt: Jedes Gewicht ist −1, 0 oder +1. Rechnen wird zu Addieren, Abziehen und Überspringen. Das sind die ersten 4 × 4 Gewichte einer echten Matrix.'],
      ['Weights are signs in {−1, 0, +1}: y = γ · (W x). The dot product needs adds and subtracts only. W below is read from the layer {layer} weight file.',
        'Gewichte sind Vorzeichen in {−1, 0, +1}: y = γ · (W x). Das Skalarprodukt braucht nur Additionen und Subtraktionen. W unten stammt aus der Gewichtsdatei der Ebene {layer}.'],
      ['Tensor stream_a.attn.q_proj.weight, [{hidden} × {hidden}] = {hidden} × {hidden} signs. W[j][i] = sign(w_ji) · [|w_ji| > τ], τ = {tau} for this layer. The 4 × 4 corner is read from the stored 32 × 32 tile; γ comes from the same file.',
        'Tensor stream_a.attn.q_proj.weight, [{hidden} × {hidden}] = {hidden} × {hidden} Vorzeichen. W[j][i] = sign(w_ji) · [|w_ji| > τ], τ = {tau} in dieser Ebene. Die 4x4-Ecke stammt aus der gespeicherten Kachel von 32 × 32; γ stammt aus derselben Datei.'],
    ),
  },
  {
    camera: 'L12.expert.0', highlight: ['L12.expert.0'],
    figure: { kind: 'matmul', layer: 12, stream: 'A', matrix: 'c_fc', expert: 0 },
    text: tx(
      ['A scale number γ belongs to every matrix. It gives the results their size back. Each matrix has its own γ.',
        'Zu jeder Matrix gehört eine Skalenzahl γ. Sie gibt den Ergebnissen ihre Größe zurück. Jede Matrix hat ihr eigenes γ.'],
      ['γ = mean(|w|) of the F32 latent weights; the model uses w_t = γ · sign(w) · [|w| > τ]. Shown: c_fc of expert 0 in layer {layer}.',
        'γ = mean(|w|) der latenten F32-Gewichte; das Modell nutzt w_t = γ · sign(w) · [|w| > τ]. Gezeigt: c_fc von Experte 0 in Ebene {layer}.'],
      ['Tensor experts.0.c_fc.weight, [{ffn} × {hidden}], {ffn} × {hidden} raw weights, one γ for the whole matrix. Dequantised weight w_t = γ · t with t in {−1, 0, +1}, so y = γ · (T x) needs one multiplication per output row.',
        'Tensor experts.0.c_fc.weight, [{ffn} × {hidden}], {ffn} × {hidden} rohe Gewichte, ein γ für die ganze Matrix. Entquantisiertes Gewicht w_t = γ · t mit t in {−1, 0, +1}, also braucht y = γ · (T x) eine Multiplikation je Ausgabezeile.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    figure: { kind: 'fractions', layer: 12, stream: 'A' },
    text: tx(
      ['The chart shows how often −1, 0 and +1 occur in the real matrices of this layer.',
        'Das Diagramm zeigt, wie oft −1, 0 und +1 in den echten Matrizen dieser Ebene vorkommen.'],
      ['Share of −1, 0 and +1 per matrix, counted over the full matrix in the checkpoint. The threshold τ of layer {layer} is {tau}.',
        'Anteil von −1, 0 und +1 je Matrix, gezählt über die ganze Matrix im Checkpoint. Der Schwellwert τ der Ebene {layer} ist {tau}.'],
      ['Fields per matrix in L12.json: frac_neg, frac_zero, frac_pos with frac_neg + frac_zero + frac_pos = 1, counted over all entries of the matrix (not over the 32 × 32 tile). τ of layer {layer} = {tau}.',
        'Felder je Matrix in L12.json: frac_neg, frac_zero, frac_pos mit frac_neg + frac_zero + frac_pos = 1, gezählt über alle Einträge der Matrix (die ganze Matrix; die Kachel von 32 × 32 zeigt nur einen Ausschnitt). τ der Ebene {layer} = {tau}.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    text: tx(
      ['During training the weights stay normal decimal numbers (F32). Each time the model makes the ternary form from them. A trick called STE passes the learning signal through.',
        'Beim Training bleiben die Gewichte normale Dezimalzahlen (F32). Das Modell macht daraus jedes Mal die ternäre Form. Ein Trick namens STE leitet das Lernsignal hindurch.'],
      ['Training keeps F32 latent weights and ternarises them in the forward pass (threshold τ). The straight-through estimator (ste.rs) passes the gradient as if the rounding were the identity.',
        'Das Training hält latente F32-Gewichte und ternarisiert sie im Vorwärtsschritt (Schwellwert τ). Der Straight-Through-Estimator (ste.rs) reicht den Gradienten durch, als wäre das Runden die Identität.'],
      ['Forward: t = sign(w) · [|w| > τ]. Backward: ∂L/∂w := ∂L/∂t (straight-through), so w keeps receiving updates even where t is 0.',
        'Vorwärts: t = sign(w) · [|w| > τ]. Rückwärts: ∂L/∂w := ∂L/∂t (Straight-Through), so erhält w auch dort Updates, wo t gleich 0 ist.'],
    ),
  },
  {
    camera: 'L12.A.router', highlight: ['L12.A.ln1', 'L12.A.ln2', 'L12.A.router'],
    text: tx(
      ['Some parts stay in normal numbers (F32): the embedding, the layer norms, the router gate and the seed_bias of the experts.',
        'Einige Teile bleiben in normalen Zahlen (F32): die Einbettung, die Layer Norms, das Router-Gate und der seed_bias der Experten.'],
      ['F32: embed, ln1, ln2, ln_f, router gate (moe.rs:202), seed_bias. Ternary: q, k, v, o, expert c_fc and c_proj, lm_head.',
        'F32: embed, ln1, ln2, ln_f, Router-Gate (moe.rs:202), seed_bias. Ternär: q, k, v, o, c_fc und c_proj der Experten, lm_head.'],
    ),
  },
  {
    camera: 'lm_head', highlight: ['lm_head'], action: 'free',
    text: tx(
      ['The last step, the scores for all words, is ternary too. Now explore which parts are ternary: click any matrix to see its real weights.',
        'Der letzte Schritt, die Punktzahlen für alle Wörter, ist ebenfalls ternär. Erkunde jetzt, welche Teile ternär sind: Ein Klick auf eine Matrix zeigt ihre echten Gewichte.'],
      ['lm_head is a ternary [{vocab} × {hidden}] projection. Click any matrix to see its tile, γ and the share of −1, 0 and +1 in the side panel.',
        'lm_head ist eine ternäre Projektion [{vocab} × {hidden}]. Ein Klick auf eine Matrix zeigt Kachel, γ und den Anteil von −1, 0 und +1 im Seitenpanel.'],
    ),
  },
];
