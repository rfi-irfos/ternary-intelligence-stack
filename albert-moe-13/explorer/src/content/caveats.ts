export type CaveatId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9';

export interface Caveat {
  title: string;
  body: string;
  evidence: string;
  /** Honesty label of the body's numbers when they come from a log rather than the code (shown as a tag). */
  label?: string;
  /** Optional data table behind the body (shown under it, rendered into CAVEATS.md). */
  table?: { head: string[]; rows: string[][] };
}

/** Findings from the 2026-10-23 investigation (spec 3.4). The explorer shows what the code does and labels the discrepancy. */
export const CAVEATS: Record<CaveatId, Caveat> = {
  A1: {
    title: 'Anastomosis is skipped in the training forward pass',
    body:
      'Transformer::forward runs stream A fully, then stream B, then averages. The code comment says this ' +
      '"approximates the interleaved fusion". Only forward_prefill and forward_decode apply the gates. ' +
      'generate() also calls forward, so it skips them too.',
    evidence: 'transformer.rs:184-215, 282-295; train_bible.rs:1582 calls model.forward',
  },
  A2: {
    title: 'Gate weights sit at initialisation scale',
    body:
      'RMS 0.010-0.012 against an init of N(0, 0.01); biases within +-0.009; gate 6 (layer 34) has bias exactly 0. ' +
      'This is consistent with A1. At inference sigma(~0) is about 0.5, so each stream adds about half of the other ' +
      'at 7 layers, a mixing the training path never saw.',
    evidence: 'checkpoint read 2026-10-23',
  },
  A3: {
    title: '"Safety gate" on experts 0-3 raises, not suppresses',
    body:
      'For experts 0-3 with a negative logit, the logit is multiplied to 0 before the top-3 softmax, which ' +
      'increases their weight. Docs describe it as suppression to zero.',
    evidence: 'moe.rs:310-326',
  },
  A4: {
    title: 'seed_bias dominates the expert input',
    body:
      'Source comment: seed std is about 0.7 against a layer-norm output std of about 0.003; about 29.6 % of the ' +
      'inner neurons are seed-saturated.',
    evidence: 'mlp.rs:12, 40-42',
  },
  A5: {
    title: 'Traffic-light state and its output scales are runtime state',
    body:
      'They are not in the checkpoint. Any traffic-light colours shown must come from a trace or a log and be ' +
      'labelled with their source.',
    evidence: 'moe.rs:240-250, 346',
  },
  A6: {
    title: 'Config says 38 layers, the checkpoint has 46',
    body:
      '42 layers is the officially documented state: the TIS session_log and convergence_log record the depth up to ' +
      'the 36→42 surgeries of 19 Sep 2026. Layers 43-46 (numbered 42-45 in the explorer, which counts from 0) grew afterwards, in the four depth surgeries 42→46 on 19 and ' +
      '20 Sep 2026, and so far only the training watch log records them, by tensor count (+78 tensors per layer). ' +
      'The explorer shows all 46 real layers: it reads the depth from the checkpoint, not the config.',
    evidence: 'models/albert_v3.0.config.json; Colony ~/.albert/albert_watch_log.md (tns per 5-minute sample)',
    label: 'measured (log): ~/.albert/albert_watch_log.md',
    table: {
      head: ['Change', 'First seen (UTC)', 'Epoch', 'tns'],
      rows: [
        ['42 → 43 layers', '2026-09-19T14:00Z', 'ep8938', '3372'],
        ['43 → 44', '2026-09-19T15:05Z', 'ep8942', '3450'],
        ['44 → 45', '2026-09-19T18:55Z', 'ep8958', '3528'],
        ['45 → 46', '2026-09-20T01:10Z', 'ep8987', '3606'],
      ],
    },
  },
  A7: {
    title: 'The explorer shows the 2026-09-23 checkpoint',
    body:
      'It may not be the newest one (the Modal volume was not checked). The site states its checkpoint date and hash.',
    evidence: 'decision 2026-10-23',
  },
  A8: {
    title: 'The serving binary builds the model from the config depth (38)',
    body:
      'It does not take the depth from the checkpoint (46). Whether blocks 38-45 are then silently ignored is not ' +
      'yet verified. If so, the deployed albert. runs a different depth than it was trained with.',
    evidence: 'albert_serve.rs:194, builder check 2026-10-23',
  },
  A9: {
    title: 'Traffic-light state persists across calls in one process',
    body:
      'It has no reset, and its modifiers are off for the first 50 calls (warm-up). Routing therefore depends on ' +
      'call history.',
    evidence: 'moe.rs:303-304, traffic_light.rs:36, 124, 208',
  },
};

export const CAVEAT_IDS = Object.keys(CAVEATS) as CaveatId[];

/** Markdown of the "Known caveats" page. `explorer/CAVEATS.md` is generated from this (npm run caveats). */
export function renderCaveats(): string {
  const out = [
    '# Known caveats',
    '',
    'Generated from `src/content/caveats.ts` by `npm run caveats`. Do not edit by hand.',
    '',
  ];
  for (const id of CAVEAT_IDS) {
    const c = CAVEATS[id];
    out.push(`## ${id}. ${c.title}`, '', c.body, '');
    if (c.table) {
      out.push(`| ${c.table.head.join(' | ')} |`, `|${c.table.head.map(() => '---').join('|')}|`);
      for (const r of c.table.rows) out.push(`| ${r.join(' | ')} |`);
      out.push('');
    }
    if (c.label) out.push(`Label: ${c.label}`, '');
    out.push(`Evidence: ${c.evidence}`, '');
  }
  return out.join('\n');
}
