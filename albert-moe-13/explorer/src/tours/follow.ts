import type { TourStep } from './engine';
import { BANK, tx } from './text';

/** 2. Follow a token: the forward pass end to end. */
export const followSteps: TourStep[] = [
  {
    camera: 'embed', highlight: ['embed'],
    text: tx(
      ['Your word starts as a pack of {hidden} numbers. Every layer will change this pack a little.',
        'Dein Wort beginnt als Paket aus {hidden} Zahlen. Jede Ebene verändert dieses Paket ein wenig.'],
      ['The embedding row of the token id: {hidden} values in F32. This vector is the start of the residual stream in A and in B.',
        'Die Einbettungszeile der Token-ID: {hidden} Werte in F32. Dieser Vektor ist der Start des Residualstroms in A und in B.'],
    ),
  },
  {
    camera: 'L0', highlight: ['L0'],
    text: tx(
      ['The word enters layer {layer}. Every layer does the same in three parts: look back, choose, calculate.',
        'Das Wort betritt Ebene {layer}. Jede Ebene tut dasselbe in drei Teilen: zurückschauen, auswählen, rechnen.'],
      ['Per layer and stream: ln1, attention, residual add, ln2, router, experts, residual add. Fusion layers add the gate.',
        'Je Ebene und Strom: ln1, Attention, Residual-Addition, ln2, Router, Experten, Residual-Addition. Fusionsebenen fügen das Tor hinzu.'],
    ),
  },
  {
    camera: 'L12.A.attn', highlight: ['L12.A.attn'],
    text: tx(
      ['First the word looks at the words before it and takes what matters.',
        'Zuerst schaut das Wort auf die Wörter vor ihm und holt sich, was wichtig ist.'],
      ['Attention: {heads} heads of width {headDim}, RoPE, causal mask. The result is added to the residual stream.',
        'Attention: {heads} Köpfe der Breite {headDim}, RoPE, kausale Maske. Das Ergebnis wird zum Residualstrom addiert.'],
      ['Tensors in L12.json, stream A: stream_a.attn.q_proj.weight, k_proj, v_proj, o_proj, each [{hidden} × {hidden}] ternary with its own γ. Stream B has stream_b.attn.* of the same shapes. Output: x ← x + O(softmax(Q Kᵀ / √{headDim}) V).',
        'Tensoren in L12.json, Strom A: stream_a.attn.q_proj.weight, k_proj, v_proj, o_proj, je [{hidden} × {hidden}] ternär mit eigenem γ. Strom B hat stream_b.attn.* in denselben Formen. Ausgabe: x ← x + O(softmax(Q Kᵀ / √{headDim}) V).'],
    ),
  },
  {
    camera: 'L12.A.router', highlight: ['L12.A.router'],
    text: tx(
      ['The switch (the router) chooses {topk} of {experts} experts for this word.',
        'Der Schalter (der Router) wählt {topk} von {experts} Experten für dieses Wort.'],
      ['The router scores all {experts} experts with an F32 gate, keeps the top-{topk} and takes a softmax over their logits.',
        'Der Router bewertet alle {experts} Experten mit einem F32-Gate, behält die Top-{topk} und bildet die Softmax über ihre Logits.'],
      ['Tensor stream_a.moe.gate.weight, [{experts} × {hidden}] F32 (stream B: stream_b.moe.gate.weight). logits = W_g x; keep the {topk} largest l_i; w_i = exp(l_i) / Σ_j exp(l_j) over those {topk}.',
        'Tensor stream_a.moe.gate.weight, [{experts} × {hidden}] F32 (Strom B: stream_b.moe.gate.weight). Logits = W_g x; die {topk} größten l_i bleiben; w_i = exp(l_i) / Σ_j exp(l_j) über diese {topk}.'],
    ),
  },
  {
    camera: 'L12', highlight: BANK,
    text: tx(
      ['The chosen experts calculate. Their results are added up, each with its own weight.',
        'Die gewählten Experten rechnen. Ihre Ergebnisse werden addiert, jedes mit eigenem Gewicht.'],
      ['Each expert: seed_bias, c_fc (ternary, {hidden} to {ffn}), GELU, c_proj ({ffn} to {hidden}). The outputs are summed with the softmax shares.',
        'Jeder Experte: seed_bias, c_fc (ternär, {hidden} auf {ffn}), GELU, c_proj ({ffn} auf {hidden}). Die Ausgaben werden mit den Softmax-Anteilen summiert.'],
      ['Tensors per expert e in L12.json: experts.e.c_fc.weight [{ffn} × {hidden}], experts.e.c_proj.weight [{hidden} × {ffn}] (both ternary), experts.e.seed_bias (F32). Output: Σ_i w_i · c_proj(GELU(c_fc(x) + seed_bias)) over the {topk} chosen experts.',
        'Tensoren je Experte e in L12.json: experts.e.c_fc.weight [{ffn} × {hidden}], experts.e.c_proj.weight [{hidden} × {ffn}] (beide ternär), experts.e.seed_bias (F32). Ausgabe: Σ_i w_i · c_proj(GELU(c_fc(x) + seed_bias)) über die {topk} gewählten Experten.'],
    ),
  },
  {
    camera: 'L13.gate', highlight: ['L13.gate'],
    text: tx(
      ['In some layers stream A and stream B swap a little. A valve controls how much.',
        'In manchen Ebenen tauschen Strom A und Strom B etwas aus. Ein Ventil steuert, wie viel.'],
      ['Anastomosis: A += g_a * B and B += g_b * A with g = sigmoid(W_g x + b). The inference path applies it (see caveat A1).',
        'Austausch-Tor: A += g_a * B und B += g_b * A mit g = sigmoid(W_g x + b). Der Inferenzpfad wendet es an (siehe Befund A1).'],
    ),
  },
  {
    camera: 'ln_f', highlight: ['ln_f'],
    text: tx(
      ['After the last layer both streams are joined into one.',
        'Nach der letzten Ebene werden beide Ströme zu einem vereint.'],
      ['Merge as a mean, h = (h_a + h_b) / 2, then ln_f in F32.',
        'Vereinigung als Mittelwert, h = (h_a + h_b) / 2, danach ln_f in F32.'],
    ),
  },
  {
    camera: 'lm_head', highlight: ['lm_head'], action: 'free',
    text: tx(
      ['From this pack albert. scores every word as the next word. Press Play in the dock to watch exactly this path.',
        'Aus diesem Paket bewertet albert. jedes Wort als nächstes Wort. Drücke Play im Dock, um genau diesen Weg zu sehen.'],
      ['lm_head turns the merged vector into {vocab} logits. Play in the dock follows the recorded run op by op.',
        'lm_head macht aus dem vereinten Vektor {vocab} Logits. Play im Dock folgt dem aufgezeichneten Durchlauf Schritt für Schritt.'],
      ['logits z = lm_head(h), z has {vocab} entries; p_i = exp(z_i) / Σ_j exp(z_j). The recorded trace holds the events of one run (router, attention, gate, residual) per position.',
        'Logits z = lm_head(h), z hat {vocab} Einträge; p_i = exp(z_i) / Σ_j exp(z_j). Der aufgezeichnete Trace enthält die Ereignisse eines Durchlaufs (Router, Attention, Tor, Residual) je Position.'],
    ),
  },
];
