/** Provenance of a measured value: one forward pass of a named prompt (Task 7 emits exactly these fields). */
export interface TraceProvenance {
  prompt_id: string;
  prompt: string;
  token_ids: number[];
  tokens: string[];
  checkpoint_sha256: string;
  git_commit: string;
  num_layers: number;
  tau_schedule: number[];
  ttl_rule: string;
  mode: 'eval';
  path: 'forward_prefill';
  attention_window?: number;
  date: string;
}

export type LabelKind = 'structure' | 'measured' | 'illustrative';

/**
 * Every number the UI shows carries one of three labels:
 * structure (read from the checkpoint, architecture.json or cited source), measured (from a trace, with
 * provenance), illustrative (a schematic, not a measurement).
 */
export type Labeled<T> = { kind: LabelKind; value: T; provenance?: TraceProvenance };

export type LabeledValue = number | string | number[];

export const structure = <T>(value: T): Labeled<T> => ({ kind: 'structure', value });
export const illustrative = <T>(value: T): Labeled<T> => ({ kind: 'illustrative', value });

export function measured<T>(value: T, provenance: TraceProvenance): Labeled<T> {
  const p = provenance as Partial<TraceProvenance> | undefined | null;
  const strings = ['prompt_id', 'prompt', 'checkpoint_sha256', 'git_commit', 'ttl_rule', 'date'] as const;
  const arrays = ['token_ids', 'tokens', 'tau_schedule'] as const;
  const bad = !p
    || strings.some((k) => typeof p[k] !== 'string')
    || arrays.some((k) => !Array.isArray(p[k]))
    || typeof p.num_layers !== 'number'
    || p.mode !== 'eval'
    || p.path !== 'forward_prefill'
    || (p.attention_window !== undefined && typeof p.attention_window !== 'number');
  if (bad) throw new Error('measured value needs complete provenance (every TraceProvenance field)');
  return { kind: 'measured', value, provenance };
}

export interface FmtOptions {
  /** Custom text for the value (e.g. a percentage). */
  format?: (v: LabeledValue) => string;
  /** Tooltip note replacing the default wording of the kind. */
  note?: string;
}

/** Plain text of a value: integers with thousands separators, other numbers to 5 significant digits, shapes as [a × b]. */
export function fmtText(l: Labeled<LabeledValue>, opts: FmtOptions = {}): string {
  if (opts.format) return opts.format(l.value);
  const v = l.value;
  if (Array.isArray(v)) return `[${v.join(' × ')}]`;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toPrecision(5)));
  return v;
}

const KIND_TITLE: Record<LabelKind, string> = {
  structure: 'structure: read from the checkpoint, the architecture file or the cited source',
  measured: 'measured',
  illustrative: 'illustrative: a schematic, not a measurement',
};

function provenanceTitle(p: TraceProvenance): string {
  return `measured: prompt ${p.prompt_id}, checkpoint ${p.checkpoint_sha256.slice(0, 12)}, commit ${p.git_commit.slice(0, 12)}, ${p.date}`;
}

/** Empty badge element; the look comes from CSS (LABEL_CSS) so textContent stays the bare value. */
export function badge(kind: LabelKind, provenance?: TraceProvenance, note?: string): HTMLElement {
  const b = document.createElement('i');
  b.className = `badge badge--${kind}`;
  b.setAttribute('aria-hidden', 'true');
  b.title = note ?? (kind === 'measured' && provenance ? provenanceTitle(provenance) : KIND_TITLE[kind]);
  return b;
}

/** Value + badge. The element carries data-kind; its textContent is the value alone. */
export function fmt(l: Labeled<LabeledValue>, opts: FmtOptions = {}): HTMLElement {
  const root = document.createElement('span');
  root.className = `lv lv--${l.kind}`;
  root.dataset.kind = l.kind;
  const v = document.createElement('span');
  v.className = 'lv-v';
  v.textContent = fmtText(l, opts);
  root.append(v, badge(l.kind, l.provenance, opts.note));
  root.title = opts.note ?? (l.kind === 'measured' && l.provenance ? provenanceTitle(l.provenance) : KIND_TITLE[l.kind]);
  if (l.provenance) root.dataset.promptId = l.provenance.prompt_id;
  return root;
}

/** Wrapper for a figure whose numbers are all of one kind (e.g. a schematic). */
export function labelBlock(kind: LabelKind, inner: string): HTMLElement {
  const d = document.createElement('div');
  d.className = `lv-block lv-block--${kind}`;
  d.dataset.kind = kind;
  d.title = KIND_TITLE[kind];
  d.innerHTML = inner;
  d.append(badge(kind));
  return d;
}

/** A number token in prose: not part of an identifier (L12, A4, ln1, top3), with decimals, thousands and exponent. */
export const NUM_TOKEN = /(?<![A-Za-z_\d])\d+(?:[.,]\d+)*(?:e-\d+)?/g;

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapes prose and wraps every number token in fmt(structure(token)). Returns HTML. */
export interface RichOptions {
  kind?: LabelKind;
  /** Tooltip for number tokens, except those listed in `plain`. */
  note?: string;
  /** Tokens that keep the default tooltip of the kind (architecture facts). */
  plain?: Set<string>;
}

export const CITED_NOTE = 'stated in the cited investigation / source';

export function richHtml(text: string, o: RichOptions = {}): string {
  const kind = o.kind ?? 'structure';
  let out = '';
  let last = 0;
  for (const m of text.matchAll(NUM_TOKEN)) {
    const at = m.index ?? 0;
    out += escHtml(text.slice(last, at));
    out += fmt({ kind, value: m[0] }, o.plain?.has(m[0]) ? {} : { note: o.note }).outerHTML;
    last = at + m[0].length;
  }
  return out + escHtml(text.slice(last));
}

export const LABEL_CSS = `
.lv { white-space: nowrap; }
.badge { display: none; width: 0.7em; height: 0.7em; margin-left: 0.2em; border-radius: 50%; vertical-align: baseline; }
.badge--measured { display: inline-block; background: #ffd940; }
.badge--illustrative { display: inline-block; border: 1px solid #cfd8e8;
  background: repeating-linear-gradient(45deg, #cfd8e8 0 2px, transparent 2px 4px); }
.lv-block { position: relative; }
.lv-block > .badge { position: absolute; right: 2px; top: 2px; }
`;
