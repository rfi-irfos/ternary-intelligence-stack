import type { Architecture } from '../data/architecture';
import type { CaveatId } from './caveats';
import type { Depth } from '../ui/depth';
import { type ComponentId, parseId } from '../scene/ids';
import type { Lang } from '../ui/strings';

/** origin/main commit this explorer was built from; source links pin it, never a branch name. */
export const COMMIT = '45e8af03a3ee85b3adf7bdea74215c641d94fa5d';
const REPO = 'https://github.com/rfi-irfos/ternary-intelligence-stack';

/** `path` is relative to albert-moe-13/moe-llm-core/src/ (e.g. model/moe.rs); `lines` like "197-381". */
export function sourceUrl(path: string, lines: string): string {
  const [a, b] = lines.split('-');
  const anchor = b ? `#L${a}-L${b}` : `#L${a}`;
  return `${REPO}/blob/${COMMIT}/albert-moe-13/moe-llm-core/src/${path}${anchor}`;
}

export type ComponentType =
  | 'slab' | 'bank' | 'embed' | 'ln1' | 'ln2' | 'attn' | 'head' | 'matrix' | 'router' | 'expert'
  | 'seed_bias' | 'gelu' | 'anastomosis' | 'ln_f' | 'lm_head' | 'shaft';

/** Walkthrough ids; the tour player arrives in a later task. */
export type TourId = 'attention' | 'router' | 'expert' | 'anastomosis';

export interface SourceRef {
  file: string;
  lines: string;
  tokens: string[];
}

/** A content text in both UI languages; the English text is the reviewed original, German its translation. */
export interface L10n {
  en: string;
  de: string;
}

/**
 * Text fields may hold placeholders like {layers}; resolveText fills them from the loaded architecture so
 * no model count is typed into prose. Known: layers streams experts top_k hidden ffn heads head_dim vocab
 * attentions routers physical_experts slots fusion_count fusion_list.
 * Prose fields are { en, de } pairs; formulas, tensor names and code ids are not translated.
 */
export interface ComponentContent {
  title: L10n;
  text: Record<Depth, L10n>;
  formula: string;
  inputs: L10n;
  outputs: L10n;
  /** `tokens` must all appear inside the cited range (tests/content.test.ts keeps the citations honest). */
  source: SourceRef[];
  caveats: CaveatId[];
  tour?: TourId;
}

export const COMPONENTS: Record<ComponentType, ComponentContent> = {
  slab: {
    title: { en: 'Layer block', de: 'Ebenenblock' },
    text: {
      intuition: {
        en: 'One layer of albert. Two copies of the text so far, stream A and stream B, each get read by attention and then ' +
          'passed through a team of experts. The two streams have their own attention and routers but use the same experts.',
        de: 'Eine Ebene von albert. Zwei Kopien des bisherigen Textes, Strom A und Strom B, werden jeweils von der Aufmerksamkeit ' +
          'gelesen und dann an ein Team von Experten weitergegeben. Beide Ströme haben eine eigene Aufmerksamkeit und eigene Weichen, ' +
          'nutzen aber dieselben Experten.',
      },
      technical: {
        en: 'A pre-norm block per stream: x = x + Attn(ln1(x)), then x = x + MoE(ln2(x)). Each layer builds stream A and ' +
          'stream B with their own attention, norms and router. Both read the same expert weights, so the model has {attentions} ' +
          'attentions, {routers} routers and {physical_experts} physical experts ({slots} routing slots).',
        de: 'Ein Pre-Norm-Block je Strom: x = x + Attn(ln1(x)), danach x = x + MoE(ln2(x)). Jede Ebene baut Strom A und Strom B ' +
          'mit eigener Attention, eigenen Normen und eigenem Router. Beide lesen dieselben Expertengewichte; das Modell hat also ' +
          '{attentions} Attention-Blöcke, {routers} Router und {physical_experts} physische Experten ({slots} Routing-Plätze).',
      },
      researcher: {
        en: 'transformer.rs:74-99 defines the block; transformer.rs:126-131 builds stream_a and stream_b per layer over ' +
          'one shared blocks.<i>.experts. Both streams start from the same embedding and end as their mean ' +
          '(h = (h_a + h_b) / 2, then ln_f, then lm_head; transformer.rs:206-208, 237-239). Ternary threshold tau is ' +
          'set per layer (config.rs:42-51); this checkpoint has {layers} layers (A6).',
        de: 'transformer.rs:74-99 definiert den Block; transformer.rs:126-131 baut je Ebene stream_a und stream_b über ' +
          'ein gemeinsames blocks.<i>.experts. Beide Ströme starten im selben Embedding und enden als ihr Mittelwert ' +
          '(h = (h_a + h_b) / 2, dann ln_f, dann lm_head; transformer.rs:206-208, 237-239). Die ternäre Schwelle tau ist ' +
          'je Ebene gesetzt (config.rs:42-51); dieser Checkpoint hat {layers} Ebenen (A6).',
      },
    },
    formula: 'x ← x + Attn(ln1(x));  x ← x + MoE(ln2(x))   (per stream)',
    inputs: { en: 'two residual streams h_A, h_B', de: 'zwei Residualströme h_A, h_B' },
    outputs: { en: 'updated h_A, h_B (same shape)', de: 'aktualisierte h_A, h_B (gleiche Form)' },
    source: [
      { file: 'model/transformer.rs', lines: '74-99', tokens: ['ln1.forward', 'ln2.forward'] },
      { file: 'model/transformer.rs', lines: '126-131', tokens: ['new_stream', 'stream_a', 'stream_b'] },
      { file: 'model/config.rs', lines: '42-51', tokens: ['layer_threshold', 'max(0.03)'] },
    ],
    caveats: ['A6', 'A7', 'A8'],
  },
  bank: {
    title: { en: 'Shared expert bank', de: 'Gemeinsame Experten-Bank' },
    text: {
      intuition: {
        en: 'A pool of small expert networks that both streams use. Each stream picks its own favourites from the pool.',
        de: 'Ein Vorrat kleiner Expertennetze, den beide Ströme nutzen. Jeder Strom sucht sich darin seine eigenen Favoriten aus.',
      },
      technical: {
        en: 'The experts of a layer are stored once and read by both streams. Each stream routes into the bank independently, ' +
          'which gives {streams} × {experts} routing slots over {experts} physical experts per layer.',
        de: 'Die Experten einer Ebene sind einmal gespeichert und werden von beiden Strömen gelesen. Jeder Strom routet unabhängig ' +
          'in die Bank; das ergibt {streams} × {experts} Routing-Plätze über {experts} physische Experten je Ebene.',
      },
      researcher: {
        en: 'Both stream_a and stream_b read the same blocks.<i>.experts weights (transformer.rs:126-131). Routing: moe.rs:197-381. ' +
          'Experts with zero load in a batch are not executed (@sparseskip).',
        de: 'stream_a und stream_b lesen dieselben Gewichte blocks.<i>.experts (transformer.rs:126-131). Routing: moe.rs:197-381. ' +
          'Experten ohne Last in einem Batch werden nicht ausgeführt (@sparseskip).',
      },
    },
    formula: 'MoE_s(x) = Σ_{e ∈ top3_s(x)} softmax(top-3 logits)_e · scale_e · Expert_e(x)',
    inputs: { en: 'ln2 output of stream A or B', de: 'Ausgabe von ln2 aus Strom A oder B' },
    outputs: { en: 'weighted sum of the selected expert outputs', de: 'gewichtete Summe der Ausgaben der gewählten Experten' },
    source: [
      { file: 'model/transformer.rs', lines: '126-131', tokens: ['vb_experts', 'stream_b'] },
      { file: 'model/moe.rs', lines: '197-381', tokens: ['pub fn forward', 'expert_seeds'] },
    ],
    caveats: [],
    tour: 'expert',
  },
  embed: {
    title: { en: 'Embedding', de: 'Einbettung' },
    text: {
      intuition: {
        en: 'A lookup table. Each token ID pulls out one row of numbers that stands for that token.',
        de: 'Eine Nachschlagetabelle. Jede Token-ID holt eine Zeile Zahlen heraus, die für dieses Token steht.',
      },
      technical: {
        en: 'A [{vocab} × {hidden}] table, kept in F32 (not ternary). Both streams start from the same embedding output.',
        de: 'Eine Tabelle [{vocab} × {hidden}], in F32 gespeichert (nicht ternär). Beide Ströme starten mit derselben Ausgabe des Embeddings.',
      },
      researcher: {
        en: 'EmbeddingLayer wraps candle_nn::embedding (embedding.rs:9-16). F32 weights. Stream A and stream B both start ' +
          'from this output (transformer.rs:184-215). Positions are not in this table: they come from RoPE in attention, ' +
          'which has no weights.',
        de: 'EmbeddingLayer kapselt candle_nn::embedding (embedding.rs:9-16). F32-Gewichte. Strom A und Strom B starten beide ' +
          'mit dieser Ausgabe (transformer.rs:184-215). Positionen stehen nicht in dieser Tabelle: sie kommen über RoPE in der ' +
          'Attention, die dafür keine Gewichte hat.',
      },
    },
    formula: 'h⁰ = E[token]',
    inputs: { en: 'token ids', de: 'Token-IDs' },
    outputs: { en: 'h⁰ for stream A and stream B (identical)', de: 'h⁰ für Strom A und Strom B (identisch)' },
    source: [
      { file: 'model/embedding.rs', lines: '9-16', tokens: ['candle_nn::embedding'] },
      { file: 'model/transformer.rs', lines: '184-215', tokens: ['self.embedding.forward', 'blocks_b'] },
    ],
    caveats: [],
  },
  ln1: {
    title: { en: 'LayerNorm 1', de: 'Layer Norm 1' },
    text: {
      intuition: {
        en: 'Rescales the numbers of one stream so attention sees them on a steady scale.',
        de: 'Bringt die Zahlen eines Stroms auf eine einheitliche Größenordnung, damit die Aufmerksamkeit sie gleichmäßig sieht.',
      },
      technical: {
        en: 'LayerNorm in F32 (weight and bias), applied before attention: Attn(ln1(x)). Each stream has its own.',
        de: 'Layer Norm in F32 (Gewicht und Bias), vor der Attention angewendet: Attn(ln1(x)). Jeder Strom hat seine eigene.',
      },
      researcher: {
        en: 'DiffLayerNorm with eps 1e-5 (diff_layer_norm.rs:21-34). Each stream block builds ln1 and ln2 with it at transformer.rs:53-54 ' +
          '(single-stream constructor: 31-32). Pre-norm placement: ln1 is applied at transformer.rs:75. Not ternary.',
        de: 'DiffLayerNorm mit eps 1e-5 (diff_layer_norm.rs:21-34). Jeder Strom-Block baut damit ln1 und ln2 in transformer.rs:53-54 ' +
          '(Konstruktor für einen Strom: 31-32). Pre-Norm: ln1 wird in transformer.rs:75 angewendet. Nicht ternär.',
      },
    },
    formula: 'ln(x) = (x − mean) / std · weight + bias',
    inputs: { en: 'residual stream x', de: 'Residualstrom x' },
    outputs: { en: 'normalised x', de: 'normiertes x' },
    source: [
      { file: 'model/diff_layer_norm.rs', lines: '21-34', tokens: ['pub struct DiffLayerNorm', 'eps'] },
      { file: 'model/transformer.rs', lines: '53-54', tokens: ['pp("ln1")', '1e-5'] },
      { file: 'model/transformer.rs', lines: '75', tokens: ['ln1.forward'] },
    ],
    caveats: [],
  },
  ln2: {
    title: { en: 'LayerNorm 2', de: 'Layer Norm 2' },
    text: {
      intuition: {
        en: 'Rescales one stream again, before it goes to the router and the experts.',
        de: 'Bringt einen Strom noch einmal auf eine einheitliche Größenordnung, bevor er zur Weiche und zu den Experten geht.',
      },
      technical: {
        en: 'LayerNorm in F32, applied before the MoE: MoE(ln2(x)). Each stream has its own.',
        de: 'Layer Norm in F32, vor dem MoE angewendet: MoE(ln2(x)). Jeder Strom hat seine eigene.',
      },
      researcher: {
        en: 'Same DiffLayerNorm as ln1 (diff_layer_norm.rs:21-34), applied at transformer.rs:93. Its output std is about 0.003 according to the ' +
          'source comment in mlp.rs:40-42, which is why seed_bias dominates the expert input (A4).',
        de: 'Dieselbe DiffLayerNorm wie ln1 (diff_layer_norm.rs:21-34), angewendet in transformer.rs:93. Laut Quellkommentar in ' +
          'mlp.rs:40-42 liegt die Standardabweichung ihrer Ausgabe bei etwa 0,003; deshalb dominiert seed_bias die Eingabe der Experten (A4).',
      },
    },
    formula: 'ln(x) = (x − mean) / std · weight + bias',
    inputs: { en: 'residual stream x after attention', de: 'Residualstrom x nach der Attention' },
    outputs: { en: 'normalised x, read by the router and the experts', de: 'normiertes x, gelesen von Router und Experten' },
    source: [
      { file: 'model/diff_layer_norm.rs', lines: '21-34', tokens: ['pub struct DiffLayerNorm', 'eps'] },
      { file: 'model/transformer.rs', lines: '53-54', tokens: ['pp("ln2")', '1e-5'] },
      { file: 'model/transformer.rs', lines: '93', tokens: ['ln2.forward', 'moe.forward'] },
    ],
    caveats: ['A4'],
  },
  attn: {
    title: { en: 'Attention', de: 'Aufmerksamkeit (Attention)' },
    text: {
      intuition: {
        en: 'Each word looks back at the earlier words and decides which ones matter. Each head looks for something different.',
        de: 'Jedes Wort schaut auf die früheren Wörter zurück und entscheidet, welche wichtig sind. Jeder Kopf sucht dabei etwas anderes.',
      },
      technical: {
        en: '{heads} heads of {head_dim} dimensions with a causal mask and RoPE on Q and K. Q, K, V and O are ternary matrices. ' +
          'RoPE has no weights, so no position tensor exists in the checkpoint.',
        de: '{heads} Köpfe mit je {head_dim} Dimensionen, kausaler Maske und RoPE auf Q und K. Q, K, V und O sind ternäre Matrizen. ' +
          'RoPE hat keine Gewichte; daher gibt es im Checkpoint keinen Positionstensor.',
      },
      researcher: {
        en: 'attention.rs:77-120: q/k/v projections, reshape to [heads, head_dim], apply_rope (84-89), scores / sqrt(head_dim) + mask, ' +
          'softmax, O projection. Ternary: q_proj, k_proj, v_proj, o_proj (w_t = γ · sign(w) · [|w| > τ]). "No positional ' +
          'embeddings" must not be repeated as "no positional information": RoPE supplies position.',
        de: 'attention.rs:77-120: Projektionen q/k/v, Umformen zu [heads, head_dim], apply_rope (84-89), Scores / sqrt(head_dim) + Maske, ' +
          'Softmax, O-Projektion. Ternär: q_proj, k_proj, v_proj, o_proj (w_t = γ · sign(w) · [|w| > τ]). „Keine Positions-Embeddings“ ' +
          'heißt nicht „keine Positionsinformation“: RoPE liefert die Position.',
      },
    },
    formula: 'Attn(x) = O · concat_h softmax(RoPE(Q_h) RoPE(K_h)ᵀ / √d_head + mask) V_h',
    inputs: { en: 'ln1 output', de: 'Ausgabe von ln1' },
    outputs: { en: 'attention output added to the residual stream', de: 'Ausgabe der Attention, zum Residualstrom addiert' },
    source: [
      { file: 'model/attention.rs', lines: '77-120', tokens: ['q_proj.forward', 'softmax'] },
      { file: 'model/attention.rs', lines: '84-89', tokens: ['apply_rope', 'self.head_dim'] },
    ],
    caveats: [],
    tour: 'attention',
  },
  head: {
    title: { en: 'Attention head', de: 'Attention-Kopf' },
    text: {
      intuition: {
        en: 'One of {heads} readers. Each head looks at the earlier words in its own way.',
        de: 'Einer von {heads} Lesern. Jeder Kopf schaut auf seine eigene Art auf die früheren Wörter.',
      },
      technical: {
        en: 'A head is a {head_dim}-wide slice of the Q, K and V outputs. It has no weights of its own; the slice comes from the shared Q, K and V matrices.',
        de: 'Ein Kopf ist ein {head_dim} breiter Ausschnitt der Ausgaben von Q, K und V. Er hat keine eigenen Gewichte; der Ausschnitt ' +
          'stammt aus den gemeinsamen Matrizen Q, K und V.',
      },
      researcher: {
        en: 'Reshape to [batch, heads, seq, head_dim] and RoPE at attention.rs:84-89.',
        de: 'Umformen zu [batch, heads, seq, head_dim] und RoPE in attention.rs:84-89.',
      },
    },
    formula: 'head_h = softmax(RoPE(Q_h) RoPE(K_h)ᵀ / √d_head + mask) V_h',
    inputs: { en: 'Q_h, K_h, V_h slices', de: 'Ausschnitte Q_h, K_h, V_h' },
    outputs: { en: 'head output, concatenated and sent to O', de: 'Ausgabe des Kopfes, aneinandergehängt und an O weitergegeben' },
    source: [{ file: 'model/attention.rs', lines: '84-89', tokens: ['apply_rope', 'self.num_heads'] }],
    caveats: [],
  },
  matrix: {
    title: { en: 'Weight matrix', de: 'Gewichtsmatrix' },
    text: {
      intuition: {
        en: 'A grid of numbers the model learned. Ternary matrices only hold three values: −1 (cold blue), 0 (dark) and +1 (warm).',
        de: 'Ein Raster aus Zahlen, die das Modell gelernt hat. Ternäre Matrizen kennen nur drei Werte: −1 (kaltes Blau), 0 (dunkel) und +1 (warm).',
      },
      technical: {
        en: 'The checkpoint stores F32 latent weights. When the model runs, each ternary matrix is turned into γ · sign(w) · [|w| > τ] ' +
          'with γ = mean(|w|) per matrix. The router gate stays F32. The tile shows a cut-out of the matrix, not all of it.',
        de: 'Der Checkpoint speichert latente F32-Gewichte. Beim Rechnen wird jede ternäre Matrix zu γ · sign(w) · [|w| > τ] ' +
          'mit γ = mean(|w|) je Matrix. Das Router-Gate bleibt F32. Die Kachel zeigt einen Ausschnitt der Matrix, nicht die ganze.',
      },
      researcher: {
        en: 'γ = w.abs().mean_all() at ste.rs:5-8 and, refreshed every 20 calls, in TernaryLinear::get_gamma (ternary_linear.rs:386-392); ' +
          'the threshold and sign step is ste.rs:12-20. τ per layer = 0.01 + (top − 0.01) · i / (num_layers − 1), capped at 0.05, with ' +
          'top = max(config.threshold, 0.03) (config.rs:42-51). Router gate: F32 "for routing resolution" (moe.rs:202). ' +
          'Tile cells are checkpoint values (structure).',
        de: 'γ = w.abs().mean_all() in ste.rs:5-8 und, alle 20 Aufrufe aufgefrischt, in TernaryLinear::get_gamma (ternary_linear.rs:386-392); ' +
          'Schwelle und Vorzeichen stehen in ste.rs:12-20. τ je Ebene = 0,01 + (top − 0,01) · i / (num_layers − 1), höchstens 0,05, mit ' +
          'top = max(config.threshold, 0,03) (config.rs:42-51). Router-Gate: F32 „für die Auflösung beim Routing“ (Quellkommentar, moe.rs:202). ' +
          'Die Zellen der Kachel sind Checkpoint-Werte (Struktur).',
      },
    },
    formula: 'w_t = γ · sign(w) · [|w| > τ],   γ = mean(|w|)',
    inputs: { en: 'F32 latent weights from the checkpoint', de: 'latente F32-Gewichte aus dem Checkpoint' },
    outputs: { en: 'ternary weights used in the matmul', de: 'ternäre Gewichte für die Matrixmultiplikation' },
    source: [
      { file: 'model/ste.rs', lines: '5-8', tokens: ['abs', 'mean_all'] },
      { file: 'model/ste.rs', lines: '12-20', tokens: ['gt(threshold)', 'lt(-threshold)', 'broadcast_mul(gamma)'] },
      { file: 'model/ternary_linear.rs', lines: '386-392', tokens: ['abs', 'mean_all', 'GAMMA_REFRESH'] },
      { file: 'model/moe.rs', lines: '202', tokens: ['F32 linear for routing resolution'] },
    ],
    caveats: [],
  },
  router: {
    title: { en: 'Router', de: 'Weiche (Router)' },
    text: {
      intuition: {
        en: 'A switchboard. For every word it picks the {top_k} experts that should handle it, and gives each a share of the vote.',
        de: 'Ein Stellwerk. Für jedes Wort wählt es die {top_k} Experten, die es bearbeiten sollen, und gibt jedem ein Stimmgewicht.',
      },
      technical: {
        en: 'An F32 linear layer scores all experts, scaled by a router temperature. The top {top_k} are chosen by sequential argmax. ' +
          'Output = Σ softmax(top-{top_k} logits) · traffic-light scale · expert output. In training a diversity bias and Gumbel noise are added.',
        de: 'Eine lineare F32-Schicht bewertet alle Experten, geteilt durch eine Router-Temperatur. Die besten {top_k} werden per ' +
          'schrittweisem Argmax gewählt. Ausgabe = Σ softmax(Top-{top_k}-Logits) · Ampel-Skala · Expertenausgabe. Im Training kommen ' +
          'ein Diversitäts-Bias und Gumbel-Rauschen dazu.',
      },
      researcher: {
        en: 'moe.rs:197-381: logits = gate(x) / ROUTER_TEMP, plus traffic-light logit modifiers. Experts 0-3: a negative logit is multiplied ' +
          'to 0 before the softmax, which raises their weight (A3, moe.rs:310-326). Traffic-light state is runtime state (A5) and ' +
          'persists across calls with a 50-call warm-up (A9).',
        de: 'moe.rs:197-381: logits = gate(x) / ROUTER_TEMP, dazu Logit-Modifikatoren der Ampel. Experten 0-3: ein negativer Logit wird vor ' +
          'der Softmax mit 0 multipliziert, was ihr Gewicht erhöht (A3, moe.rs:310-326). Der Ampelzustand ist Laufzeitzustand (A5) und ' +
          'bleibt über Aufrufe hinweg erhalten, mit einer Aufwärmphase von 50 Aufrufen (A9).',
      },
    },
    formula: 'p = softmax(top3(gate(x) / T)),   out = Σ_i p_i · scale_i · Expert_i(x)',
    inputs: { en: 'ln2 output of this stream', de: 'Ausgabe von ln2 dieses Stroms' },
    outputs: { en: '{top_k} expert choices with weights', de: '{top_k} gewählte Experten mit Gewichten' },
    source: [
      { file: 'model/moe.rs', lines: '197-381', tokens: ['pub fn forward', 'gate_logits'] },
      { file: 'model/moe.rs', lines: '310-326', tokens: ['safety_threshold', 'apply_safety'] },
    ],
    caveats: ['A3', 'A5', 'A9'],
    tour: 'router',
  },
  expert: {
    title: { en: 'Expert', de: 'Experte' },
    text: {
      intuition: {
        en: 'A small two-step network. Its input is first shifted by a fixed vector (seed_bias) that is far larger than the input itself.',
        de: 'Ein kleines zweistufiges Netz. Seine Eingabe wird zuerst um einen festen Vektor (seed_bias) verschoben, der viel größer ist als die Eingabe selbst.',
      },
      technical: {
        en: 'c_proj(GELU(c_fc(x + seed_bias))): {hidden} → {ffn} → {hidden}, with ternary c_fc and c_proj. seed_bias is added to the input ' +
          'before c_fc. The fixed seed_bias dominates the expert\'s input: its spread is about 0.7 against about 0.003 for the normalised ' +
          'input (source comment, mlp.rs:40-42).',
        de: 'c_proj(GELU(c_fc(x + seed_bias))): {hidden} → {ffn} → {hidden}, mit ternären c_fc und c_proj. seed_bias wird vor c_fc zur ' +
          'Eingabe addiert. Der feste seed_bias dominiert die Eingabe des Experten: seine Streuung liegt bei etwa 0,7, die der normierten ' +
          'Eingabe bei etwa 0,003 (Quellkommentar, mlp.rs:40-42).',
      },
      researcher: {
        en: 'The seed is added at moe.rs:369-370; the MLP is mlp.rs:85-89. Source comment: seed std about 0.7 against LN output ' +
          'std about 0.003, and about 29.6 % of inner neurons are seed-saturated (A4, mlp.rs:12, 40-42).',
        de: 'Der Seed wird in moe.rs:369-370 addiert; das MLP steht in mlp.rs:85-89. Quellkommentar: Standardabweichung des Seeds etwa 0,7 ' +
          'gegenüber etwa 0,003 für die Ausgabe der Layer Norm, und etwa 29,6 % der inneren Neuronen sind vom Seed gesättigt (A4, mlp.rs:12, 40-42).',
      },
    },
    formula: 'E(x) = c_proj(GELU(c_fc(x + seed_bias)))',
    inputs: { en: 'ln2 output of stream A or B (selected by the router)', de: 'Ausgabe von ln2 aus Strom A oder B (vom Router gewählt)' },
    outputs: { en: 'expert output, weighted by the router', de: 'Ausgabe des Experten, vom Router gewichtet' },
    source: [
      { file: 'model/mlp.rs', lines: '85-89', tokens: ['c_fc.forward', 'c_proj.forward'] },
      { file: 'model/moe.rs', lines: '369-370', tokens: ['expert_seeds', 'broadcast_add'] },
    ],
    caveats: ['A4'],
    tour: 'expert',
  },
  seed_bias: {
    title: { en: 'seed_bias', de: 'seed_bias' },
    text: {
      intuition: {
        en: 'A fixed offset added to every input of this expert. It is far larger than the input itself, so the expert mostly sees the offset.',
        de: 'Ein fester Versatz, der zu jeder Eingabe dieses Experten addiert wird. Er ist viel größer als die Eingabe selbst; der Experte sieht also vor allem den Versatz.',
      },
      technical: {
        en: 'An F32 vector of {hidden} values per expert, added to the expert input. It stays F32 (not ternary). The fixed seed_bias ' +
          'dominates the expert\'s input: its spread is about 0.7 against about 0.003 for the normalised input (mlp.rs:40-42).',
        de: 'Ein F32-Vektor mit {hidden} Werten je Experte, zur Eingabe des Experten addiert. Er bleibt F32 (nicht ternär). Der feste ' +
          'seed_bias dominiert die Eingabe des Experten: seine Streuung liegt bei etwa 0,7, die der normierten Eingabe bei etwa 0,003 (mlp.rs:40-42).',
      },
      researcher: {
        en: 'Source comment: seed std about 0.7 against LN output std about 0.003; about 29.6 % of inner neurons are seed-saturated ' +
          '(A4, mlp.rs:12, 40-42). Added at moe.rs:369-370.',
        de: 'Quellkommentar: Standardabweichung des Seeds etwa 0,7 gegenüber etwa 0,003 für die Ausgabe der Layer Norm; etwa 29,6 % der ' +
          'inneren Neuronen sind vom Seed gesättigt (A4, mlp.rs:12, 40-42). Addiert in moe.rs:369-370.',
      },
    },
    formula: 'x′ = x + seed_bias_e',
    inputs: { en: 'ln2 output', de: 'Ausgabe von ln2' },
    outputs: { en: 'shifted input for c_fc', de: 'verschobene Eingabe für c_fc' },
    source: [
      { file: 'model/mlp.rs', lines: '40-42', tokens: ['seed std≈0.7', 'LN output std≈0.003'] },
      { file: 'model/moe.rs', lines: '369-370', tokens: ['expert_seeds', 'broadcast_add'] },
    ],
    caveats: ['A4'],
  },
  gelu: {
    title: { en: 'GELU', de: 'GELU' },
    text: {
      intuition: {
        en: 'A smooth switch between the two layers of the expert. Small negative values are squashed towards zero.',
        de: 'Ein weicher Schalter zwischen den beiden Stufen des Experten. Kleine negative Werte werden Richtung null gedrückt.',
      },
      technical: {
        en: 'Elementwise GELU on the {ffn} inner neurons. It has no weights.',
        de: 'Elementweise GELU auf den {ffn} inneren Neuronen. Sie hat keine Gewichte.',
      },
      researcher: { en: 'x.gelu() at mlp.rs:87.', de: 'x.gelu() in mlp.rs:87.' },
    },
    formula: 'GELU(z) = z · Φ(z)',
    inputs: { en: 'c_fc output ({ffn} values)', de: 'Ausgabe von c_fc ({ffn} Werte)' },
    outputs: { en: 'activations for c_proj', de: 'Aktivierungen für c_proj' },
    source: [{ file: 'model/mlp.rs', lines: '87', tokens: ['x.gelu()'] }],
    caveats: [],
  },
  anastomosis: {
    title: { en: 'Anastomosis gate', de: 'Austausch-Tor (Anastomose)' },
    text: {
      intuition: {
        en: 'A valve between the two streams. It lets a little of each stream flow into the other, at {fusion_count} layers.',
        de: 'Ein Ventil zwischen den beiden Strömen. In {fusion_count} Ebenen lässt es ein wenig von jedem Strom in den anderen fließen.',
      },
      technical: {
        en: 'g = σ(W [h_a; h_b] + b) gives two numbers per position. Both streams update at once from the old values. ' +
          'The code skips this gate in the training forward pass and applies it only in prefill and decode (see caveats).',
        de: 'g = σ(W [h_a; h_b] + b) liefert zwei Zahlen je Position. Beide Ströme werden gleichzeitig aus den alten Werten aktualisiert. ' +
          'Der Code überspringt dieses Tor im Trainings-Forward-Pass und wendet es nur bei Prefill und Decode an (siehe Hinweise).',
      },
      researcher: {
        en: 'anastomosis.rs:60-73. h_a′ = h_a + g₀ · h_b and h_b′ = h_b + g₁ · h_a, simultaneous. Applied after block i for ' +
          'i in [{fusion_list}] (fusion_layers). Training forward skips it (A1); gate weights sit at init scale (A2).',
        de: 'anastomosis.rs:60-73. h_a′ = h_a + g₀ · h_b und h_b′ = h_b + g₁ · h_a, gleichzeitig. Angewendet nach Block i für ' +
          'i in [{fusion_list}] (fusion_layers). Der Trainings-Forward-Pass überspringt es (A1); die Gewichte des Tors liegen auf Init-Niveau (A2).',
      },
    },
    formula: 'g = σ(W [h_a; h_b] + b);  h_a′ = h_a + g₀·h_b;  h_b′ = h_b + g₁·h_a',
    inputs: { en: 'h_A, h_B after the block', de: 'h_A, h_B nach dem Block' },
    outputs: { en: 'mixed h_A′, h_B′', de: 'gemischte h_A′, h_B′' },
    source: [
      { file: 'model/anastomosis.rs', lines: '60-73', tokens: ['Tensor::cat', 'sigmoid'] },
      { file: 'model/transformer.rs', lines: '184-215', tokens: ['blocks_b', 'fn forward'] },
    ],
    caveats: ['A1', 'A2'],
    tour: 'anastomosis',
  },
  ln_f: {
    title: { en: 'Final LayerNorm', de: 'Letzte Layer Norm' },
    text: {
      intuition: {
        en: 'After the last layer the two streams are averaged into one, and this step rescales the result.',
        de: 'Nach der letzten Ebene werden die beiden Ströme zu einem gemittelt, und dieser Schritt bringt das Ergebnis auf eine einheitliche Größenordnung.',
      },
      technical: {
        en: 'The streams merge as a mean, h = (h_a + h_b) / 2, then ln_f (F32) feeds the LM head.',
        de: 'Die Ströme werden als Mittelwert vereint, h = (h_a + h_b) / 2; danach speist ln_f (F32) den LM-Kopf.',
      },
      researcher: {
        en: 'transformer.rs:206-208 and 237-239: h_merged → ln_f → lm_head.',
        de: 'transformer.rs:206-208 und 237-239: h_merged → ln_f → lm_head.',
      },
    },
    formula: 'h = ln_f((h_A + h_B) / 2)',
    inputs: { en: 'h_A, h_B after the last block', de: 'h_A, h_B nach dem letzten Block' },
    outputs: { en: 'one normalised vector per position', de: 'ein normierter Vektor je Position' },
    source: [
      { file: 'model/transformer.rs', lines: '206-208', tokens: ['affine(0.5', 'ln_f.forward'] },
      { file: 'model/transformer.rs', lines: '237-239', tokens: ['affine(0.5', 'ln_f.forward'] },
    ],
    caveats: [],
  },
  lm_head: {
    title: { en: 'LM head', de: 'LM-Kopf' },
    text: {
      intuition: {
        en: 'Turns the final vector into a score for every word in the vocabulary. The highest scores are the likely next words.',
        de: 'Macht aus dem letzten Vektor eine Bewertung für jedes Wort im Wortschatz. Die höchsten Werte sind die wahrscheinlichen nächsten Wörter.',
      },
      technical: {
        en: 'A ternary [{vocab} × {hidden}] projection. The checkpoint stores it as F32 latent weights.',
        de: 'Eine ternäre Projektion [{vocab} × {hidden}]. Der Checkpoint speichert sie als latente F32-Gewichte.',
      },
      researcher: {
        en: 'TernaryLinear built at transformer.rs:147; applied after ln_f at transformer.rs:207-208.',
        de: 'TernaryLinear, gebaut in transformer.rs:147; nach ln_f angewendet in transformer.rs:207-208.',
      },
    },
    formula: 'logits = W_head · h',
    inputs: { en: 'ln_f output', de: 'Ausgabe von ln_f' },
    outputs: { en: 'one logit per vocabulary entry', de: 'ein Logit je Eintrag im Wortschatz' },
    source: [
      { file: 'model/transformer.rs', lines: '145-147', tokens: ['ln_f', 'TernaryLinear::new'] },
      { file: 'model/transformer.rs', lines: '206-208', tokens: ['lm_head.forward'] },
    ],
    caveats: [],
  },
  shaft: {
    title: { en: 'Residual stream', de: 'Residualstrom' },
    text: {
      intuition: {
        en: 'The running notes of one stream. Every block adds to it; nothing is overwritten.',
        de: 'Die laufenden Notizen eines Stroms. Jeder Block fügt etwas hinzu; nichts wird überschrieben.',
      },
      technical: {
        en: 'Stream A and stream B are two residual streams. Blocks add to them (x = x + …); anastomosis gates mix them at {fusion_count} layers.',
        de: 'Strom A und Strom B sind zwei Residualströme. Die Blöcke addieren zu ihnen (x = x + …); Austausch-Tore mischen sie in {fusion_count} Ebenen.',
      },
      researcher: {
        en: 'transformer.rs:74-99 (residual adds), 126-131 (two streams), 206-208 (mean merge).',
        de: 'transformer.rs:74-99 (Residual-Additionen), 126-131 (zwei Ströme), 206-208 (Vereinen als Mittelwert).',
      },
    },
    formula: 'x ← x + f(ln(x))',
    inputs: { en: 'embedding output', de: 'Ausgabe der Einbettung' },
    outputs: { en: 'merged by mean before ln_f', de: 'vor ln_f als Mittelwert vereint' },
    source: [
      { file: 'model/transformer.rs', lines: '74-99', tokens: ['x + self.attention', 'feed_forward'] },
      { file: 'model/transformer.rs', lines: '126-131', tokens: ['stream_a', 'stream_b'] },
    ],
    caveats: [],
  },
};

/** Component type of an id, or null for unknown ids. */
export function componentTypeOf(id: ComponentId): ComponentType | null {
  const p = parseId(id);
  if (!p) return null;
  switch (p.type) {
    case 'gate': return 'anastomosis';
    default: return p.type;
  }
}

/** Placeholder values for an architecture. Every number comes from `a`; nothing is typed here. */
export function placeholders(a: Architecture, lang: Lang = 'en'): Record<string, string> {
  const m = a.model;
  const n = (x: number): string => x.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');
  return {
    layers: n(m.num_layers),
    streams: n(m.num_streams),
    experts: n(m.num_experts),
    top_k: n(m.top_k),
    hidden: n(m.hidden),
    ffn: n(m.ffn_inner),
    heads: n(m.num_heads),
    head_dim: n(m.head_dim),
    vocab: n(m.vocab),
    attentions: n(m.num_layers * m.num_streams),
    routers: n(m.num_layers * m.num_streams),
    physical_experts: n(m.num_layers * m.num_experts),
    slots: n(m.num_layers * m.num_experts * m.num_streams),
    fusion_count: n(m.fusion_layers.length),
    fusion_list: m.fusion_layers.join(', '),
  };
}

/** Fills {name} placeholders from the architecture; an unknown name is a bug and throws. */
export function resolveText(s: string, a: Architecture, lang: Lang = 'en'): string {
  const vars = placeholders(a, lang);
  return s.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`unknown placeholder {${k}} in "${s.slice(0, 40)}"`);
    return v;
  });
}

export interface ResolvedContent {
  title: string;
  text: Record<Depth, string>;
  formula: string;
  inputs: string;
  outputs: string;
}

/** Component texts for the loaded architecture, in `lang` (formulas are the same in both languages). */
export function contentFor(type: ComponentType, a: Architecture, lang: Lang = 'en'): ResolvedContent {
  const c = COMPONENTS[type];
  const r = (x: string): string => resolveText(x, a, lang);
  const l = (x: L10n): string => r(x[lang]);
  return {
    title: l(c.title),
    text: { intuition: l(c.text.intuition), technical: l(c.text.technical), researcher: l(c.text.researcher) },
    formula: r(c.formula),
    inputs: l(c.inputs),
    outputs: l(c.outputs),
  };
}
