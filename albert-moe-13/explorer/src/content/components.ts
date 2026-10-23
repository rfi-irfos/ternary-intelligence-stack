import type { CaveatId } from './caveats';
import type { Depth } from '../ui/depth';
import { type ComponentId, parseId } from '../scene/ids';

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

export interface ComponentContent {
  title: string;
  text: Record<Depth, string>;
  formula: string;
  inputs: string;
  outputs: string;
  source: { file: string; lines: string }[];
  caveats: CaveatId[];
  tour?: TourId;
}

export const COMPONENTS: Record<ComponentType, ComponentContent> = {
  slab: {
    title: 'Layer block',
    text: {
      intuition:
        'One layer of albert. Two copies of the text so far, stream A and stream B, each get read by attention and then ' +
        'passed through a team of experts. The two streams have their own attention and routers but use the same experts.',
      technical:
        'A pre-norm block per stream: x = x + Attn(ln1(x)), then x = x + MoE(ln2(x)). Each layer builds stream A and ' +
        'stream B with their own attention, norms and router. Both read the same expert weights, so the model has 92 ' +
        'attentions, 92 routers and 552 physical experts (1,104 routing slots).',
      researcher:
        'transformer.rs:74-99 defines the block; transformer.rs:126-131 builds stream_a and stream_b per layer over ' +
        'one shared blocks.{i}.experts. Both streams start from the same embedding and end as their mean ' +
        '(h = (h_a + h_b) / 2, then ln_f, then lm_head; transformer.rs:206-208, 237-239). Ternary threshold tau is ' +
        'set per layer (config.rs:42-51); this checkpoint has 46 layers (A6).',
    },
    formula: 'x ← x + Attn(ln1(x));  x ← x + MoE(ln2(x))   (per stream)',
    inputs: 'two residual streams h_A, h_B',
    outputs: 'updated h_A, h_B (same shape)',
    source: [
      { file: 'model/transformer.rs', lines: '74-99' },
      { file: 'model/transformer.rs', lines: '126-131' },
      { file: 'model/config.rs', lines: '42-51' },
    ],
    caveats: ['A6', 'A7', 'A8'],
  },
  bank: {
    title: 'Shared expert bank',
    text: {
      intuition:
        'A pool of small expert networks that both streams use. Each stream picks its own favourites from the pool.',
      technical:
        'The experts of a layer are stored once and read by both streams. Each stream routes into the bank independently, ' +
        'which gives 2 × num_experts routing slots over num_experts physical experts per layer.',
      researcher:
        'Both stream_a and stream_b read the same blocks.{i}.experts weights (transformer.rs:126-131). Routing: moe.rs:197-381. ' +
        'Experts with zero load in a batch are not executed (@sparseskip).',
    },
    formula: 'MoE_s(x) = Σ_{e ∈ top3_s(x)} softmax(top-3 logits)_e · scale_e · Expert_e(x)',
    inputs: 'ln2 output of stream A or B',
    outputs: 'weighted sum of the selected expert outputs',
    source: [{ file: 'model/transformer.rs', lines: '126-131' }, { file: 'model/moe.rs', lines: '197-381' }],
    caveats: [],
    tour: 'expert',
  },
  embed: {
    title: 'Embedding',
    text: {
      intuition: 'A lookup table. Each token ID pulls out one row of numbers that stands for that token.',
      technical:
        'A [vocab × hidden] table, kept in F32 (not ternary). Both streams start from the same embedding output.',
      researcher:
        'EmbeddingLayer wraps candle_nn::embedding (embedding.rs:9-16). F32 weights. Stream A and stream B both start ' +
        'from this output (transformer.rs:184-215). Positions are not in this table: they come from RoPE in attention, ' +
        'which has no weights.',
    },
    formula: 'h⁰ = E[token]',
    inputs: 'token ids',
    outputs: 'h⁰ for stream A and stream B (identical)',
    source: [{ file: 'model/embedding.rs', lines: '9-16' }, { file: 'model/transformer.rs', lines: '184-215' }],
    caveats: [],
  },
  ln1: {
    title: 'LayerNorm 1',
    text: {
      intuition: 'Rescales the numbers of one stream so attention sees them on a steady scale.',
      technical: 'LayerNorm in F32 (weight and bias), applied before attention: Attn(ln1(x)). Each stream has its own.',
      researcher: 'DiffLayerNorm with eps 1e-5 (diff_layer_norm.rs, transformer.rs:145). Pre-norm placement: transformer.rs:74-99. Not ternary.',
    },
    formula: 'ln(x) = (x − mean) / std · weight + bias',
    inputs: 'residual stream x',
    outputs: 'normalised x',
    source: [{ file: 'model/diff_layer_norm.rs', lines: '21-34' }, { file: 'model/transformer.rs', lines: '74-99' }],
    caveats: [],
  },
  ln2: {
    title: 'LayerNorm 2',
    text: {
      intuition: 'Rescales one stream again, before it goes to the router and the experts.',
      technical: 'LayerNorm in F32, applied before the MoE: MoE(ln2(x)). Each stream has its own.',
      researcher:
        'Same DiffLayerNorm as ln1 (diff_layer_norm.rs). Its output std is about 0.003 according to the source comment ' +
        'in mlp.rs:40-42, which is why seed_bias dominates the expert input (A4).',
    },
    formula: 'ln(x) = (x − mean) / std · weight + bias',
    inputs: 'residual stream x after attention',
    outputs: 'normalised x, read by the router and the experts',
    source: [{ file: 'model/diff_layer_norm.rs', lines: '21-34' }, { file: 'model/transformer.rs', lines: '74-99' }],
    caveats: ['A4'],
  },
  attn: {
    title: 'Attention',
    text: {
      intuition:
        'Each word looks back at the earlier words and decides which ones matter. Four heads look for four different things.',
      technical:
        'Four heads of 64 dimensions with a causal mask and RoPE on Q and K. Q, K, V and O are ternary matrices. ' +
        'RoPE has no weights, so no position tensor exists in the checkpoint.',
      researcher:
        'attention.rs:77-120: q/k/v projections, reshape to [heads, head_dim], apply_rope (84-89), scores / sqrt(head_dim) + mask, ' +
        'softmax, O projection. Ternary: q_proj, k_proj, v_proj, o_proj (w_t = γ · sign(w) · [|w| > τ]). "No positional ' +
        'embeddings" must not be repeated as "no positional information": RoPE supplies position.',
    },
    formula: 'Attn(x) = O · concat_h softmax(RoPE(Q_h) RoPE(K_h)ᵀ / √d_head + mask) V_h',
    inputs: 'ln1 output',
    outputs: 'attention output added to the residual stream',
    source: [{ file: 'model/attention.rs', lines: '77-120' }, { file: 'model/attention.rs', lines: '84-89' }],
    caveats: [],
    tour: 'attention',
  },
  head: {
    title: 'Attention head',
    text: {
      intuition: 'One of four readers. Each head looks at the earlier words in its own way.',
      technical:
        'A head is a 64-wide slice of the Q, K and V outputs. It has no weights of its own; the slice comes from the shared Q, K and V matrices.',
      researcher: 'Reshape to [batch, heads, seq, head_dim] and RoPE at attention.rs:84-89.',
    },
    formula: 'head_h = softmax(RoPE(Q_h) RoPE(K_h)ᵀ / √d_head + mask) V_h',
    inputs: 'Q_h, K_h, V_h slices',
    outputs: 'head output, concatenated and sent to O',
    source: [{ file: 'model/attention.rs', lines: '84-89' }],
    caveats: [],
  },
  matrix: {
    title: 'Weight matrix',
    text: {
      intuition:
        'A grid of numbers the model learned. Ternary matrices only hold three values: −1 (red), 0 (dark) and +1 (cyan).',
      technical:
        'The checkpoint stores F32 latent weights. When the model runs, each ternary matrix is turned into γ · sign(w) · [|w| > τ] ' +
        'with γ = mean(|w|) per matrix. The router gate stays F32. The tile shows a 32 × 32 view of the matrix.',
      researcher:
        'ste.rs:12-20, ternary_linear.rs. τ per layer = 0.01 + (top − 0.01) · i / (num_layers − 1), capped at 0.05, with ' +
        'top = max(config.threshold, 0.03) (config.rs:42-51). Router gate: F32 "for routing resolution" (moe.rs:202). ' +
        'Tile cells are checkpoint values (structure).',
    },
    formula: 'w_t = γ · sign(w) · [|w| > τ],   γ = mean(|w|)',
    inputs: 'F32 latent weights from the checkpoint',
    outputs: 'ternary weights used in the matmul',
    source: [{ file: 'model/ste.rs', lines: '12-20' }, { file: 'model/ternary_linear.rs', lines: '1-40' }],
    caveats: [],
  },
  router: {
    title: 'Router',
    text: {
      intuition:
        'A switchboard. For every word it picks the three experts that should handle it, and gives each a share of the vote.',
      technical:
        'An F32 linear layer scores all experts, scaled by a router temperature. The top 3 are chosen by sequential argmax. ' +
        'Output = Σ softmax(top-3 logits) · traffic-light scale · expert output. In training a diversity bias and Gumbel noise are added.',
      researcher:
        'moe.rs:197-381: logits = gate(x) / ROUTER_TEMP, plus traffic-light logit modifiers. Experts 0-3: a negative logit is multiplied ' +
        'to 0 before the softmax, which raises their weight (A3, moe.rs:310-326). Traffic-light state is runtime state (A5) and ' +
        'persists across calls with a 50-call warm-up (A9).',
    },
    formula: 'p = softmax(top3(gate(x) / T)),   out = Σ_i p_i · scale_i · Expert_i(x)',
    inputs: 'ln2 output of this stream',
    outputs: 'three expert choices with weights',
    source: [{ file: 'model/moe.rs', lines: '197-381' }, { file: 'model/moe.rs', lines: '310-326' }],
    caveats: ['A3', 'A5', 'A9'],
    tour: 'router',
  },
  expert: {
    title: 'Expert',
    text: {
      intuition:
        'A small two-step network. Its input is first shifted by a fixed vector (seed_bias), which does most of the shaping.',
      technical:
        'c_proj(GELU(c_fc(x + seed_bias))): 256 → 1024 → 256, with ternary c_fc and c_proj. seed_bias is added to the input ' +
        'before c_fc and is much larger than the layer-norm output.',
      researcher:
        'The seed is added at moe.rs:369-370; the MLP is mlp.rs:85-89. Source comment: seed std about 0.7 against LN output ' +
        'std about 0.003, and about 29.6 % of inner neurons are seed-saturated (A4, mlp.rs:12, 40-42).',
    },
    formula: 'E(x) = c_proj(GELU(c_fc(x + seed_bias)))',
    inputs: 'ln2 output of stream A or B (selected by the router)',
    outputs: 'expert output, weighted by the router',
    source: [{ file: 'model/mlp.rs', lines: '85-89' }, { file: 'model/moe.rs', lines: '369-370' }],
    caveats: ['A4'],
    tour: 'expert',
  },
  seed_bias: {
    title: 'seed_bias',
    text: {
      intuition: 'A fixed offset added to every input of this expert. It is so strong that it decides which neurons switch on.',
      technical: 'An F32 vector of 256 values per expert, added to the expert input. It stays F32 (not ternary).',
      researcher:
        'Source comment: seed std about 0.7 against LN output std about 0.003; about 29.6 % of inner neurons are seed-saturated ' +
        '(A4, mlp.rs:12, 40-42). Added at moe.rs:369-370.',
    },
    formula: 'x′ = x + seed_bias_e',
    inputs: 'ln2 output',
    outputs: 'shifted input for c_fc',
    source: [{ file: 'model/mlp.rs', lines: '40-42' }, { file: 'model/moe.rs', lines: '369-370' }],
    caveats: ['A4'],
  },
  gelu: {
    title: 'GELU',
    text: {
      intuition: 'A smooth switch between the two layers of the expert. Small negative values are squashed towards zero.',
      technical: 'Elementwise GELU on the 1,024 inner neurons. It has no weights.',
      researcher: 'x.gelu() at mlp.rs:87.',
    },
    formula: 'GELU(z) = z · Φ(z)',
    inputs: 'c_fc output (1,024 values)',
    outputs: 'activations for c_proj',
    source: [{ file: 'model/mlp.rs', lines: '85-89' }],
    caveats: [],
  },
  anastomosis: {
    title: 'Anastomosis gate',
    text: {
      intuition:
        'A valve between the two streams. It lets a little of each stream flow into the other, at seven layers.',
      technical:
        'g = σ(W [h_a; h_b] + b) gives two numbers per position. Both streams update at once from the old values. ' +
        'The code skips this gate in the training forward pass and applies it only in prefill and decode (see caveats).',
      researcher:
        'anastomosis.rs:60-73. h_a′ = h_a + g₀ · h_b and h_b′ = h_b + g₁ · h_a, simultaneous. Applied after block i for ' +
        'i in {2, 3, 5, 8, 13, 21, 34} (fusion_layers). Training forward skips it (A1); gate weights sit at init scale (A2).',
    },
    formula: 'g = σ(W [h_a; h_b] + b);  h_a′ = h_a + g₀·h_b;  h_b′ = h_b + g₁·h_a',
    inputs: 'h_A, h_B after the block',
    outputs: 'mixed h_A′, h_B′',
    source: [{ file: 'model/anastomosis.rs', lines: '60-73' }, { file: 'model/transformer.rs', lines: '184-215' }],
    caveats: ['A1', 'A2'],
    tour: 'anastomosis',
  },
  ln_f: {
    title: 'Final LayerNorm',
    text: {
      intuition: 'After the last layer the two streams are averaged into one, and this step rescales the result.',
      technical: 'The streams merge as a mean, h = (h_a + h_b) / 2, then ln_f (F32) feeds the LM head.',
      researcher: 'transformer.rs:206-208 and 237-239: h_merged → ln_f → lm_head.',
    },
    formula: 'h = ln_f((h_A + h_B) / 2)',
    inputs: 'h_A, h_B after the last block',
    outputs: 'one normalised vector per position',
    source: [{ file: 'model/transformer.rs', lines: '206-208' }, { file: 'model/transformer.rs', lines: '237-239' }],
    caveats: [],
  },
  lm_head: {
    title: 'LM head',
    text: {
      intuition: 'Turns the final vector into a score for every word in the vocabulary. The highest scores are the likely next words.',
      technical: 'A ternary [vocab × hidden] projection. The checkpoint stores it as F32 latent weights.',
      researcher: 'TernaryLinear built at transformer.rs:147; applied after ln_f at transformer.rs:207-208.',
    },
    formula: 'logits = W_head · h',
    inputs: 'ln_f output',
    outputs: 'one logit per vocabulary entry',
    source: [{ file: 'model/transformer.rs', lines: '145-147' }, { file: 'model/transformer.rs', lines: '206-208' }],
    caveats: [],
  },
  shaft: {
    title: 'Residual stream',
    text: {
      intuition: 'The running notes of one stream. Every block adds to it; nothing is overwritten.',
      technical:
        'Stream A and stream B are two residual streams. Blocks add to them (x = x + …); anastomosis gates mix them at seven layers.',
      researcher: 'transformer.rs:74-99 (residual adds), 126-131 (two streams), 206-208 (mean merge).',
    },
    formula: 'x ← x + f(ln(x))',
    inputs: 'embedding output',
    outputs: 'merged by mean before ln_f',
    source: [{ file: 'model/transformer.rs', lines: '74-99' }, { file: 'model/transformer.rs', lines: '126-131' }],
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
