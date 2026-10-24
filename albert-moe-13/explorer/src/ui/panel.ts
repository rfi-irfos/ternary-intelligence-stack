import type { Architecture, TensorSpec } from '../data/architecture';
import type { CameraRig } from '../camera/controls';
import { findMatrix, findVector, type WeightsLoader, weightKey } from '../data/weights';
import { CAVEATS } from '../content/caveats';
import { COMPONENTS, type ComponentType, type ResolvedContent, componentTypeOf, contentFor, sourceUrl } from '../content/components';
import { badge, citedNote, fmt, fmtText, labelBlock, richHtml, structure, pctStr } from '../data/labeled';
import {
  type ComponentId, type ParsedId, type Stream,
  attnId, bankId, embedId, expertId, lmHeadId, lnFId, ln1Id, ln2Id, parseId, routerId, slabId,
} from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { PALETTE, cssHex } from '../scene/palette';
import { DEPTHS, getDepth, onDepthChange, setDepth } from './depth';
import { ICONS, typeIcon } from './icons';
import { getLang, getMode, layerLabel, lt, onPrefsChange, t } from './prefs';
import { ROLE_VAR, componentName, roleOf } from './roles';
import type { StringKey } from './strings';

export interface PanelDeps {
  arch: Architecture;
  tower: Pick<TowerScene, 'has' | 'anchor'>;
  rig: Pick<CameraRig, 'flyTo'>;
  loadWeights: WeightsLoader;
  /** Called after a connection link flew the camera, so the app can follow with explode etc. */
  onNavigate?: (id: ComponentId) => void;
  /**
   * Awaited before a connection link flies to its target. While a component is exploded the row
   * anchors are hidden, so the app reassembles here and the camera never flies to a hidden anchor.
   */
  beforeNavigate?: () => Promise<void>;
  /** "Step inside" on the card of anything inside a layer: the app opens that layer step by step. */
  onStepInside?: (id: ComponentId) => void;
  /**
   * The router's recorded choice for the word on screen in one layer (see PlayerBar.routing). Without it,
   * or without rows, the "Active experts" list is left out: nothing is invented.
   */
  routing?: (layer: number) => { word: string; rows: Array<{ stream: Stream; experts: Array<{ expert: number; share: number }> }> };
}

export interface Panel {
  readonly element: HTMLElement;
  openPanel(id: ComponentId): Promise<void>;
  close(): void;
  /** Moves the three parts (Modell, Inspektion, Analyse) into the side panel's section bodies. */
  mount(slots: { model: HTMLElement; inspect: HTMLElement; analysis: HTMLElement }): void;
  current(): ComponentId | null;
  dispose(): void;
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const paramCount = (shape: number[]): number => shape.reduce((a, b) => a * b, 1);

/** Which architecture.components entries describe a component type. */
function archKeys(type: ComponentType): string[] {
  switch (type) {
    case 'expert': case 'bank': return ['expert', 'seed_bias'];
    case 'seed_bias': return ['seed_bias'];
    case 'anastomosis': return ['anastomosis'];
    case 'matrix': case 'head': return ['attn', 'expert', 'router'];
    case 'ln1': case 'ln2': case 'attn': case 'router': case 'embed': case 'ln_f': case 'lm_head': return [type];
    default: return [];
  }
}

function instantiate(pattern: string, p: ParsedId, a: Architecture): string {
  let out = pattern;
  if ('layer' in p) {
    out = out.replace('{i}', String(p.layer));
    out = out.replace('{k}', String(a.model.fusion_layers.indexOf(p.layer)));
  }
  if ('stream' in p && p.stream) out = out.replace('{s}', p.stream.toLowerCase());
  if ('expert' in p && p.expert !== undefined) out = out.replace('{e}', String(p.expert));
  return out;
}

function matrixMatches(t: TensorSpec, p: ParsedId): boolean {
  if (p.type === 'head') return /attn\.[qkvo]_proj\.weight/.test(t.pattern);
  if (p.type !== 'matrix') return true;
  const needle = p.name === 'gate' ? 'moe.gate.weight'
    : p.name === 'c_fc' || p.name === 'c_proj' ? `${p.name}.weight` : `${p.name}_proj.weight`;
  return t.pattern.includes(needle);
}

export interface TensorRow {
  name: string;
  shape: number[];
  ternary: boolean;
  params: number;
}

/** Real tensors of a component, instantiated for this id, straight from architecture.components. */
export function tensorRows(id: ComponentId, a: Architecture): TensorRow[] {
  const p = parseId(id);
  const type = componentTypeOf(id);
  if (!p || !type) return [];
  const rows: TensorRow[] = [];
  for (const key of archKeys(type)) {
    const spec = a.components[key];
    if (!spec) continue;
    for (const t of spec.tensors) {
      if (!matrixMatches(t, p)) continue;
      // matrix ids name a stream or an expert: keep only tensors of the matching family
      if (p.type === 'matrix') {
        const expertMatrix = p.name === 'c_fc' || p.name === 'c_proj';
        if (expertMatrix !== (key === 'expert') || (p.name === 'gate') !== (key === 'router')) continue;
      }
      if (p.type === 'head' && key !== 'attn') continue;
      rows.push({ name: instantiate(t.pattern, p, a), shape: t.shape, ternary: t.ternary, params: paramCount(t.shape) });
    }
  }
  return rows;
}

/** Longest short tensor name the table shows before it truncates from the left. */
export const SHORT_NAME_MAX = 24;

/**
 * Short names for the tensor table. Each name is the shortest dotted suffix that is unique within the
 * table (at least two segments when it ends in .weight/.bias, so the suffix always stays). A name longer
 * than SHORT_NAME_MAX is truncated from the left ("…" + its tail); the full path is the tooltip.
 */
export function shortNames(full: string[]): string[] {
  const segs = full.map((f) => f.split('.'));
  const minLen = (s: string[]): number => (s.length >= 2 && /^(weight|bias)$/.test(s[s.length - 1]!) ? 2 : 1);
  const len = segs.map(minLen);
  for (let guard = 0; guard < 16; guard++) {
    const names = segs.map((s, i) => s.slice(-len[i]!).join('.'));
    let clash = false;
    names.forEach((n, i) => {
      if (names.some((m, j) => j !== i && m === n && full[j] !== full[i]) && len[i]! < segs[i]!.length) {
        len[i]!++;
        clash = true;
      }
    });
    if (!clash) break;
  }
  return segs.map((s, i) => {
    const n = s.slice(-len[i]!).join('.');
    return n.length > SHORT_NAME_MAX ? `…${n.slice(n.length - (SHORT_NAME_MAX - 1))}` : n;
  });
}

export interface Link { label: string; id: ComponentId }

/**
 * Components next to this one in the data flow; each link flies the camera there. The label is the
 * component's name in the current language and mode (the same name the link chip shows).
 */
export function connectionsOf(id: ComponentId, a: Architecture): Link[] {
  return rawConnections(id, a).map((l) => ({ label: componentName(l.id), id: l.id }));
}

function rawConnections(id: ComponentId, a: Architecture): Link[] {
  const p = parseId(id);
  if (!p) return [];
  const last = a.model.num_layers - 1;
  const streams: Stream[] = ['A', 'B'];
  switch (p.type) {
    case 'slab': {
      const out: Link[] = [];
      out.push(p.layer === 0 ? { label: 'Embedding', id: embedId() } : { label: `Layer ${p.layer - 1}`, id: slabId(p.layer - 1) });
      out.push(p.layer === last ? { label: 'Final LayerNorm', id: lnFId() } : { label: `Layer ${p.layer + 1}`, id: slabId(p.layer + 1) });
      return out;
    }
    case 'ln1': return [{ label: `Attention ${p.stream}`, id: attnId(p.layer, p.stream) }, { label: `Layer ${p.layer}`, id: slabId(p.layer) }];
    case 'attn': return [
      { label: `LayerNorm 1 ${p.stream}`, id: ln1Id(p.layer, p.stream) },
      { label: `LayerNorm 2 ${p.stream}`, id: ln2Id(p.layer, p.stream) },
    ];
    case 'ln2': return [
      { label: `Attention ${p.stream}`, id: attnId(p.layer, p.stream) },
      { label: `Router ${p.stream}`, id: routerId(p.layer, p.stream) },
    ];
    case 'router': return [
      { label: `LayerNorm 2 ${p.stream}`, id: ln2Id(p.layer, p.stream) },
      { label: `Expert bank (${a.model.num_experts} experts)`, id: bankId(p.layer) },
    ];
    case 'bank': return streams.map((s) => ({ label: `Router ${s}`, id: routerId(p.layer, s) }));
    case 'expert': return [
      ...streams.map((s) => ({ label: `Router ${s}`, id: routerId(p.layer, s) })),
      { label: 'Expert bank', id: bankId(p.layer) },
    ];
    case 'gate': return [{ label: `Layer ${p.layer}`, id: slabId(p.layer) }];
    case 'embed': return [{ label: 'Layer 0', id: slabId(0) }];
    case 'ln_f': return [{ label: `Layer ${last}`, id: slabId(last) }, { label: 'LM head', id: lmHeadId() }];
    case 'lm_head': return [{ label: 'Final LayerNorm', id: lnFId() }];
    case 'matrix': case 'head': case 'seed_bias': case 'gelu': {
      if (p.type === 'matrix' && p.expert === undefined) {
        const s = p.stream!;
        return [{ label: p.name === 'gate' ? `Router ${s}` : `Attention ${s}`, id: p.name === 'gate' ? routerId(p.layer, s) : attnId(p.layer, s) }];
      }
      if (p.type === 'head') return [{ label: `Attention ${p.stream}`, id: attnId(p.layer, p.stream) }];
      return [{ label: `Expert ${'expert' in p ? p.expert : 0}`, id: expertId(p.layer, 'expert' in p ? (p.expert ?? 0) : 0) }];
    }
    default: return [];
  }
}

function location(p: ParsedId, a: Architecture): string {
  const layer = 'layer' in p ? t('loc.layer', { l: layerLabel(p.layer), n: a.model.num_layers }) : '';
  const stream = 'stream' in p && p.stream ? ` · ${t('loc.stream', { s: p.stream })}` : '';
  const expert = 'expert' in p && p.expert !== undefined ? ` · ${t('loc.expert', { e: p.expert })}` : '';
  if (layer) return layer + stream + expert;
  return p.type === 'shaft' ? t('loc.stream', { s: p.stream }) : t('loc.ends');
}

/** Small schematic of the maths; carries no checkpoint numbers. */
function visual(type: ComponentType, a: Architecture, id: ComponentId, rc: ResolvedContent): string {
  const p = parseId(id);
  const ternary = type === 'matrix' ? p?.type === 'matrix' && p.name !== 'gate'
    : type === 'attn' || type === 'expert' || type === 'lm_head';
  const schematic = esc(t('svg.schematic'));
  if (type === 'router') {
    const n = a.model.num_experts;
    const k = a.model.top_k;
    const bars = Array.from({ length: n }, (_, i) =>
      `<rect x="${6 + i * 14}" y="${i < k ? 6 : 24}" width="10" height="${i < k ? 30 : 12}" fill="${i < k ? cssHex(PALETTE.router) : '#2a2e36'}"/>`).join('');
    return `<svg viewBox="0 0 ${12 + n * 14} 44" role="img" aria-label="${esc(t('svg.router'))}"><title>${schematic}: ${esc(t('svg.router'))}</title>${bars}</svg>`;
  }
  if (type === 'anastomosis') {
    return `<svg viewBox="0 0 160 44" role="img" aria-label="${esc(t('svg.streams'))}"><title>${schematic}</title>` +
      `<circle cx="30" cy="22" r="14" fill="${cssHex(PALETTE.streamA)}"/><circle cx="130" cy="22" r="14" fill="${cssHex(PALETTE.streamB)}"/>` +
      `<path d="M46 14 L114 14 M114 30 L46 30" stroke="${cssHex(PALETTE.gate)}" stroke-width="2" fill="none"/>` +
      '<text x="80" y="10" fill="#fff" font-size="10" text-anchor="middle">g₀</text>' +
      '<text x="80" y="42" fill="#fff" font-size="10" text-anchor="middle">g₁</text></svg>';
  }
  if (ternary) {
    return `<svg viewBox="0 0 170 44" role="img" aria-label="${esc(t('svg.ternary'))}"><title>${schematic}</title>` +
      `<rect x="6" y="8" width="28" height="28" fill="${cssHex(PALETTE.ternaryMinus)}"/>` + '<text x="20" y="27" text-anchor="middle" font-size="14" fill="#000">−1</text>' +
      `<rect x="40" y="8" width="28" height="28" fill="${cssHex(PALETTE.ternaryZero)}" stroke="#555"/>` + '<text x="54" y="27" text-anchor="middle" font-size="14" fill="#fff">0</text>' +
      `<rect x="74" y="8" width="28" height="28" fill="${cssHex(PALETTE.ternaryPlus)}"/>` + '<text x="88" y="27" text-anchor="middle" font-size="14" fill="#000">+1</text>' +
      '<text x="108" y="27" font-size="14" fill="#fff">× γ</text></svg>';
  }
  // Words only: counts of the real tensors are shown (as structure) in the text around the schematic.
  return `<svg viewBox="0 0 260 44" role="img" aria-label="${esc(t('svg.io'))}"><title>${schematic}</title>` +
    `<text x="4" y="18" font-size="10" fill="#cfd8e8">${esc(t('svg.in'))}</text>` +
    `<path d="M4 26 H256" stroke="#fff" stroke-width="1.5"/>` +
    `<text x="4" y="40" font-size="10" fill="#cfd8e8">${esc(t('svg.out'))}</text></svg>`;
}

const pctText = (v: unknown): string => (typeof v === 'number' ? pctStr(v) : '—');
const numText = (v: unknown): string => (typeof v === 'number' ? fmtText(structure(v)) : '—');

/** A checkpoint value (structure) as HTML; null (not defined for this matrix) shows a dash. */
const sv = (v: number | null, key: string, format?: (x: unknown) => string): string => {
  const el = fmt(structure(v ?? 0), { format: format ? () => format(v) : () => numText(v) });
  el.dataset.v = key;
  return el.outerHTML;
};

/** A table cell; an ISO time ("2026-09-19T14:00Z") shows short ("09-19 14:00Z") and keeps the full value in
 * datetime and title, so the A6 table fits the side panel at 1280 px without a horizontal scroll. */
export function cell(x: string): string {
  const m = /^(\d{4})-(\d{2}-\d{2})T(\d{2}:\d{2})Z$/.exec(x);
  return m ? `<time datetime="${esc(x)}" title="${esc(x)}">${m[2]} ${m[3]}Z</time>` : esc(x);
}

export function createPanel(deps: PanelDeps): Panel {
  const { arch, tower, rig, loadWeights } = deps;
  const el = document.createElement('aside');
  el.className = 'inspect-panel panel-host';
  el.hidden = true;
  let currentId: ComponentId | null = null;
  let token = 0;

  const flyTarget = (id: ComponentId): ComponentId => {
    let cand = id;
    while (cand && !tower.has(cand)) {
      const cut = cand.lastIndexOf('.');
      if (cut < 0) break;
      cand = cand.slice(0, cut);
    }
    return tower.has(cand) ? cand : id;
  };

  /** The real counts behind the router schematic, outside the illustrative figure. */
  function routerCaption(): string {
    const top = fmt(structure(arch.model.top_k)); // architecture.json model.top_k (moe.rs:197-381)
    top.dataset.v = 'top_k';
    const n = fmt(structure(arch.model.num_experts));
    n.dataset.v = 'experts';
    return `<p class="schematic-note">${t('panel.routerCaption', { k: top.outerHTML, n: n.outerHTML })}</p>`;
  }

  /** One stat tile ("readout"): a small label over a large tabular value that carries its kind. */
  const tile = (label: StringKey, value: HTMLElement, sub = ''): string =>
    `<div class="stat-tile"><span class="stat-label">${esc(t(label))}</span><span class="stat-value">${value.outerHTML}` +
    `${sub ? `<span class="stat-sub">${sub}</span>` : ''}</span></div>`;

  /** Short tensor name for the table (the full path is the tooltip and a truncated sub-line). */

  function tensorTable(rows: TensorRow[]): string {
    if (rows.length === 0) return `<p>${esc(t('panel.noTensors'))}</p>`;
    const names = shortNames(rows.map((x) => x.name));
    const short = new Map(rows.map((r, i) => [r.name, names[i]!]));
    const row = (r: TensorRow, group: boolean): string => {
      const name = fmt(structure(short.get(r.name) ?? r.name));
      name.classList.add('t-namebox');
      name.title = r.name;
      const path = document.createElement('span');
      path.className = 't-path';
      path.textContent = r.name;
      name.insertBefore(path, name.lastElementChild);
      const dtype = r.ternary ? 'ternary' : 'F32';
      return `<tr data-tensor="${esc(r.name)}" data-dtype="${dtype}"${group ? ' data-group="experts"' : ''}>` +
        `<td class="t-name">${name.outerHTML}</td><td class="t-shape">${fmt(structure(r.shape)).outerHTML}</td>` +
        `<td class="t-dtype"><span class="dtype dtype--${r.ternary ? 'ternary' : 'f32'}">${dtype}</span></td>` +
        `<td class="t-params">${fmt(structure(r.params)).outerHTML}</td></tr>`;
    };
    const single = rows.filter((r) => !r.name.includes('{e}'));
    const perExpert = rows.filter((r) => r.name.includes('{e}'));
    const head = `<thead><tr><th class="t-name">${esc(t('col.name'))}</th><th class="t-shape">${esc(t('col.shape'))}</th>` +
      `<th class="t-dtype">${esc(t('col.dtype'))}</th><th class="t-params">${esc(t('col.params'))}</th></tr></thead>`;
    const group = perExpert.length === 0 ? '' :
      `<tr class="t-group"><td colspan="4">${ICONS.cubes}<span>${richHtml(t('panel.expertsGroup', { n: arch.model.num_experts }))}</span></td></tr>` +
      perExpert.map((r) => row(r, true)).join('');
    return `<table class="tensor-table">${head}<tbody>${single.map((r) => row(r, false)).join('')}${group}</tbody></table>`;
  }

  // Inspection tabs (Parameter | Tensoren | Gewichte); the choice is kept while the visitor moves between parts.
  type Tab = 'params' | 'tensors' | 'weights';
  const TABS: Tab[] = ['params', 'tensors', 'weights'];
  const SEC_ICON: Record<string, string> = {
    what: ICONS.info, tensors: ICONS.grid, params: ICONS.grid, weights: ICONS.sigma, compute: ICONS.sigma, connections: ICONS.link,
    visual: ICONS.sketch, caveats: ICONS.warning, source: ICONS.doc, tour: ICONS.tour,
  };
  /** Analysis rows that fold; "Rechnung" starts open, the others closed until the visitor opens them. */
  const COLLAPSIBLE = new Set(['compute', 'visual', 'caveats', 'source', 'tour']);
  let tab: Tab = 'params';
  const opened = new Set<string>(['compute']);

  // The three parts of the card: Modell, Inspektion and Analyse. The app mounts them in the side panel's
  // sections (mount); on their own they stay inside `el`.
  const mkPart = (name: string): HTMLElement => {
    const d = document.createElement('div');
    d.className = `panel-part panel-part--${name}`;
    d.dataset.part = name;
    return d;
  };
  const modelPart = mkPart('model');
  const inspectPart = mkPart('inspect');
  const analysisPart = mkPart('analysis');
  const parts = [modelPart, inspectPart, analysisPart];
  el.append(...parts);

  const kvRow = (label: StringKey, value: string): string =>
    `<div class="kv-row"><span class="stat-label">${esc(t(label))}</span><span class="stat-value">${value}</span></div>`;

  /** The info card of the Modell section: key / value rows, every number labelled and from the checkpoint data. */
  function infoCard(p: ParsedId, type: ComponentType, rc: ResolvedContent, rows: TensorRow[]): string {
    // The type is the pill in the header, so the facts start with the layer.
    const out: string[] = [];
    void rc;
    if ('layer' in p) out.push(kvRow('info.layer', `${fmt(structure(layerLabel(p.layer))).outerHTML}<span class="stat-sub">${richHtml(t('tile.of', { n: arch.model.num_layers }))}</span>`));
    // The 0-based index of the code and the checkpoint shows only in Advanced, with this exact label.
    if ('layer' in p && getMode() === 'advanced') out.push(kvRow('info.layerIndex', fmt(structure(p.layer)).outerHTML));
    if ('stream' in p && p.stream) out.push(kvRow('info.stream', esc(p.stream)));
    if ('expert' in p && p.expert !== undefined) out.push(kvRow('info.expert', fmt(structure(p.expert)).outerHTML));
    if (['slab', 'bank', 'router', 'expert', 'gate'].includes(type)) {
      out.push(kvRow('info.experts', fmt(structure(arch.model.num_experts)).outerHTML));
      if (type !== 'expert') out.push(kvRow('info.active', fmt(structure(arch.model.top_k)).outerHTML));
    }
    out.push(kvRow('info.hidden', fmt(structure(arch.model.hidden)).outerHTML));
    if (rows.length > 0) {
      const tern = rows.some((r) => r.ternary);
      const f32 = rows.some((r) => !r.ternary);
      out.push(kvRow('info.dtype', fmt(structure(t(tern && f32 ? 'tile.mixed' : tern ? 'tile.ternary' : 'tile.f32'))).outerHTML));
    }
    return `<div class="info-card facts">${out.join('')}</div>`;
  }

  /** Parameter tab: the counts, shapes and weight types of the real tensors. */
  function paramTiles(p: ParsedId, rows: TensorRow[]): string {
    const out: string[] = [];
    if ('layer' in p) out.push(tile('tile.layer', fmt(structure(layerLabel(p.layer))), richHtml(t('tile.of', { n: arch.model.num_layers }))));
    const total = rows.reduce((sum, r) => sum + r.params * (r.name.includes('{e}') ? arch.model.num_experts : 1), 0);
    out.push(tile('tile.params', fmt(structure(total))));
    out.push(rows.length === 1 ? tile('tile.shape', fmt(structure(rows[0]!.shape))) : tile('tile.tensors', fmt(structure(rows.length))));
    const tern = rows.some((r) => r.ternary);
    const f32 = rows.some((r) => !r.ternary);
    out.push(tile('tile.weights', fmt(structure(t(tern && f32 ? 'tile.mixed' : tern ? 'tile.ternary' : 'tile.f32')))));
    return `<div class="stat-tiles">${out.join('')}</div>`;
  }

  /** "Active experts" of the Modell section: swatch, expert, recorded share, per stream; only with real routing data. */
  function activeExperts(p: ParsedId, type: ComponentType): string {
    if (!deps.routing || !('layer' in p) || !['slab', 'bank', 'router'].includes(type)) return '';
    const r = deps.routing(p.layer);
    const rows = r.rows.filter((x) => !('stream' in p && p.stream) || x.stream === p.stream);
    if (rows.length === 0) return '';
    const swatch = `<span class="legend-swatch" aria-hidden="true" style="--role: ${ROLE_VAR.expert}"></span>`;
    const groups = rows.map((g) => `<li class="active-group"><span class="active-stream">${esc(t('active.stream', { s: g.stream }))}</span><ul>${g.experts.map((e) =>
      `<li class="kv-row active-row" title="${esc(t('active.tip'))}">${swatch}<span class="stat-label">${esc(t('active.expert', { n: e.expert }))}</span>` +
      `<span class="stat-value">${esc(pctStr(e.share, 1, getLang()))}</span></li>`).join('')}</ul></li>`).join('');
    return `<section class="active-experts" data-section="active"><h3 class="sec-head"><span class="sec-label">${esc(t('sec.active', { w: r.word }))}</span></h3><ul class="active-list">${groups}</ul></section>`;
  }

  function parts3(id: ComponentId, type: ComponentType, p: ParsedId): { model: string; inspect: string; analysis: string } {
    const c = COMPONENTS[type];
    const rc = contentFor(type, arch, getLang());
    const simple = getMode() === 'simple';
    // Caveat numbers are findings of the cited investigation; only architecture facts keep the default tooltip.
    const facts = new Set([String(arch.model.num_layers), String(arch.model.fusion_layers.length)]);
    const note = citedNote();
    const cited = (s: string): string => richHtml(s, { note, plain: facts });
    const depth = getDepth();
    const rows = tensorRows(id, arch);
    const hasWeights = weightKey(p) !== null && 'layer' in p;
    const tau = 'layer' in p ? arch.layers[p.layer]?.tau : undefined;
    const links = connectionsOf(id, arch);
    const role = roleOf(id);
    // Depth is part of the view mode: Simple reads at Intuition, so only Advanced offers the switch.
    const depthButtons = simple ? '' : `<div class="depth-row"><span class="depth-label">${esc(t('panel.depth'))}</span><div class="depth-switch hud-segment" role="group" aria-label="${esc(t('panel.depth'))}">${DEPTHS.map((d, i) =>
      `<button type="button" class="depth-btn${d === depth ? ' active' : ''}" aria-pressed="${d === depth}" data-depth="${d}" title="${esc(t(`depth.${d}` as StringKey))} (${i + 1})">${esc(t(`depth.${d}` as StringKey))}</button>`).join('')}</div></div>`;
    const visibleTabs = TABS.filter((k) => (k === 'weights' ? hasWeights : rows.length > 0));
    if (!visibleTabs.includes(tab)) tab = visibleTabs[0] ?? 'params';
    const tabs = visibleTabs.length === 0 ? '' : `<div class="panel-tabs" role="tablist" aria-label="${esc(t('inspect.label'))}">${visibleTabs.map((k) =>
      `<button type="button" role="tab" class="panel-tab${k === tab ? ' active' : ''}" aria-selected="${k === tab}" data-tab="${k}">${esc(t(`tab.${k}` as StringKey))}</button>`).join('')}</div>`;
    const stepInside = deps.onStepInside && 'layer' in p
      ? `<button type="button" class="hud-btn step-inside" data-action="step-inside" title="${esc(t('nav.enterTip'))}">${ICONS.enter}<span>${esc(t('nav.enter'))}</span></button>` : '';
    const caveats = c.caveats.length === 0
      ? `<p>${esc(t('panel.noCaveats'))}</p>`
      : `<ul class="caveat-list">${c.caveats.map((cid) => {
        const cv = CAVEATS[cid];
        // A table read from a log is measured: the badge names the log it was read from.
        const kind = cv.logPath ? 'measured' : 'structure';
        const tip = cv.logPath ?? note;
        const table = cv.table
          ? `<div class="cv-table-wrap lv-block lv-block--${kind}" data-kind="${kind}" title="${esc(tip)}"><table class="cv-table"><thead><tr>${cv.table.head.map((h) => `<th>${esc(lt(h))}</th>`).join('')}</tr></thead>` +
            `<tbody>${cv.table.rows.map((r) => `<tr>${r.map((x) => `<td>${cell(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>${badge(kind, undefined, tip).outerHTML}</div>` : '';
        const label = cv.label ? `<p class="cv-label"><span class="tag tag--measured">${esc(lt(cv.label))}</span></p>` : '';
        return `<li><details data-caveat="${cid}"><summary><span class="code-chip">${cid}</span><span class="cv-title">${cited(lt(cv.title))}</span>${ICONS.chevron}</summary>` +
          `<div class="cv-body"><p>${cited(lt(cv.body))}</p>${table}${label}` +
          (depth === 'intuition' ? '' : `<p class="evidence">${esc(t('panel.evidence'))} ${cited(lt(cv.evidence))}</p>`) + '</div></details></li>';
      }).join('')}</ul>`;
    const sources = c.source.map((s) =>
      `<li><a href="${esc(sourceUrl(s.file, s.lines))}" target="_blank" rel="noopener noreferrer">${ICONS.doc}<span>${richHtml(`${s.file}:${s.lines}`)}</span></a></li>`).join('');
    const sec = (name: string, label: StringKey, body: string, tabOf?: Tab): string => {
      const collapsible = COLLAPSIBLE.has(name);
      const open = !collapsible || opened.has(name);
      const shown = tabOf === undefined || tabOf === tab;
      const head = `${SEC_ICON[name] ?? ''}<span class="sec-label">${esc(t(label))}</span>`;
      return `<section data-section="${name}"${tabOf ? ` data-tab="${tabOf}"` : ''} class="panel-sec${collapsible ? ' collapsible' : ''}"${shown ? '' : ' hidden'} data-open="${open}">` +
        (collapsible
          ? `<h3 class="sec-head"><button type="button" class="sec-toggle" aria-expanded="${open}" data-toggle="${name}">${head}${ICONS.chevron}</button></h3>`
          : `<h3 class="sec-head">${head}</h3>`) +
        `<div class="sec-body"${open ? '' : ' hidden'}>${body}</div></section>`;
    };
    const roleVar = role ? ROLE_VAR[role] : 'var(--c-neutral)';
    // Model section, top to bottom: header (icon, name, ONE type pill), one sentence, the facts, the one primary
    // action, "What it is" with its own Detail level switch directly above the text, then "Connected to".
    const model = `
      <div class="panel-head" data-mode="${simple ? 'simple' : 'advanced'}">
        <header>
          <span class="head-icon" aria-hidden="true">${typeIcon(type)}</span>
          <h2 title="${esc(t(`sum.${type}` as StringKey))}">${richHtml(componentName(id))}</h2>
          <span class="role-chip" data-role="${role ?? 'neutral'}" style="--role: ${roleVar}"><span>${richHtml(rc.title)}</span></span>
        </header>
        <p class="panel-summary">${esc(t(`sum.${type}` as StringKey))}</p>
      </div>
      ${infoCard(p, type, rc, rows)}
      ${stepInside}
      <div class="panel-body" data-mode="${simple ? 'simple' : 'advanced'}">
      ${sec('what', 'sec.what', `${depthButtons}<p>${richHtml(rc.text[depth])}</p>
        <p class="where">${richHtml(location(p, arch))}${tau !== undefined ? ` · τ ${fmt(structure(tau)).outerHTML}` : ''}</p>`)}
      ${activeExperts(p, type)}
      ${sec('connections', 'sec.connections', links.length === 0 ? `<p>${esc(t('panel.none'))}</p>` :
        `<ul class="panel-links">${links.map((l) => {
          const r = roleOf(l.id);
          return `<li><a href="#" class="link-chip" data-link="${esc(l.id)}" style="--role: ${r ? ROLE_VAR[r] : 'var(--c-neutral)'}">${typeIcon(componentTypeOf(l.id) ?? '')}<span>${richHtml(componentName(l.id))}</span></a></li>`;
        }).join('')}</ul>`)}
      </div>`;
    const inspect = visibleTabs.length === 0 ? '' : `${tabs}
      ${visibleTabs.includes('params') ? sec('params', 'tile.params', paramTiles(p, rows), 'params') : ''}
      ${visibleTabs.includes('tensors') ? sec('tensors', 'sec.tensors', tensorTable(rows), 'tensors') : ''}
      ${visibleTabs.includes('weights') ? sec('weights', 'tile.weights', '<div class="weights"></div>', 'weights') : ''}`;
    const analysis = `
      ${sec('compute', 'sec.compute', `<p class="io"><b>${esc(t('panel.in'))}</b> ${richHtml(rc.inputs)}</p><p class="formula">${richHtml(rc.formula)}</p><p class="io"><b>${esc(t('panel.out'))}</b> ${richHtml(rc.outputs)}</p>`)}
      ${sec('visual', 'sec.visual', `${labelBlock('illustrative', visual(type, arch, id, rc)).outerHTML}${type === 'router' ? routerCaption() : ''}`)}
      ${sec('caveats', 'sec.caveats', caveats)}
      ${sec('source', 'sec.source', `<ul class="source-list">${sources}</ul>`)}
      ${sec('tour', 'sec.tour', c.tour
        ? `<a href="#" class="tour-link" data-tour="${c.tour}">${ICONS.tour}<span>${esc(t('panel.tourStart'))}</span></a>` : `<p>${esc(t('panel.noTour'))}</p>`)}`;
    return { model, inspect, analysis };
  }

  async function fillWeights(id: ComponentId, p: ParsedId, mine: number): Promise<void> {
    const key = weightKey(p);
    const box = inspectPart.querySelector<HTMLElement>('.weights');
    if (!key || !box || !('layer' in p)) return;
    box.textContent = t('panel.loadingWeights');
    try {
      const w = await loadWeights(p.layer);
      if (mine !== token) return;
      if (key.matrix) {
        const m = findMatrix(w, key.matrix);
        if (!m) throw new Error('matrix missing');
        const tile = fmt(structure([m.tile.length, (m.tile[0] as string | number[]).length]), {
          format: (v) => (v as number[]).join(' × '),
        }).outerHTML;
        box.innerHTML = m.ternary
          ? `<p>γ ${sv(m.gamma, 'gamma')} · τ ${sv(m.tau, 'tau')}</p>` +
            `<p>−${richHtml('1')}: ${sv(m.frac_neg, 'frac_neg', pctText)} · ${richHtml('0')}: ${sv(m.frac_zero, 'frac_zero', pctText)} · ` +
            `+${richHtml('1')}: ${sv(m.frac_pos, 'frac_pos', pctText)}</p><p>${t('w.ternaryTile', { tile })}</p>`
          : `<p>${t('w.f32', { tile })}</p>`;
      } else if (key.vector) {
        const v = findVector(w, key.vector);
        if (!v) throw new Error('vector missing');
        box.innerHTML = `<p>${t('w.vector', { mean: sv(v.mean, 'mean'), std: sv(v.std, 'std'), min: sv(v.min, 'min'), max: sv(v.max, 'max') })}</p>`;
      }
    } catch (err) {
      if (mine === token) box.innerHTML = richHtml(t('w.unavailable', { e: String(err) }));
    }
    void id;
  }

  /** Nothing selected: the Modell section says so, the other two parts are empty. */
  function renderEmpty(): void {
    modelPart.closest<HTMLElement>('.side-sec')?.style.removeProperty('--sel-role');
    modelPart.innerHTML = `<p class="side-empty">${esc(t('side.noSelection'))}</p>`;
    inspectPart.innerHTML = '';
    analysisPart.innerHTML = '';
    inspectPart.hidden = true;
    analysisPart.hidden = true;
  }
  renderEmpty();

  function render(id: ComponentId): Promise<void> {
    const type = componentTypeOf(id);
    const p = parseId(id);
    if (!type || !p) return Promise.resolve();
    token++;
    currentId = id;
    el.hidden = false;
    el.dataset.id = id;
    el.dataset.type = type;
    const role = roleOf(id);
    for (const x of parts) x.style.setProperty('--role-panel', role ? ROLE_VAR[role] : 'var(--c-accent)');
    // The Model section's header icon and accent border take the selection's role colour.
    modelPart.closest<HTMLElement>('.side-sec')?.style.setProperty('--sel-role', role ? ROLE_VAR[role] : 'var(--c-neutral)');
    const h = parts3(id, type, p);
    modelPart.innerHTML = h.model;
    inspectPart.innerHTML = h.inspect;
    analysisPart.innerHTML = h.analysis;
    inspectPart.hidden = h.inspect === '';
    analysisPart.hidden = false;
    return fillWeights(id, p, token);
  }

  const open = (id: ComponentId): Promise<void> => render(id);

  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const link = t.closest<HTMLElement>('[data-link]');
    if (link?.dataset.link) {
      e.preventDefault();
      const target = link.dataset.link;
      void (async () => {
        const pre = deps.beforeNavigate?.();
        if (pre) await pre;
        const anchorId = flyTarget(target);
        if (tower.has(anchorId)) void rig.flyTo(tower.anchor(anchorId), parseId(target)?.type === 'slab' ? 16 : 8);
        void open(target);
        deps.onNavigate?.(target);
      })();
      return;
    }
    const toggle = t.closest<HTMLElement>('[data-toggle]');
    if (toggle?.dataset.toggle) {
      const name = toggle.dataset.toggle;
      const secEl = toggle.closest('section');
      const body = secEl?.querySelector<HTMLElement>('.sec-body');
      const open = !!body?.hidden;
      if (open) opened.add(name);
      else opened.delete(name);
      if (body) body.hidden = !open;
      secEl?.setAttribute('data-open', String(open));
      toggle.setAttribute('aria-expanded', String(open));
      return;
    }
    const tabBtn = t.closest<HTMLElement>('[role=tab][data-tab]');
    if (tabBtn?.dataset.tab) {
      tab = tabBtn.dataset.tab as Tab;
      for (const b of inspectPart.querySelectorAll<HTMLElement>('[role=tab]')) {
        const on = b.dataset.tab === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      }
      for (const x of inspectPart.querySelectorAll<HTMLElement>('section[data-tab]')) x.hidden = x.dataset.tab !== tab;
      return;
    }
    if (t.closest('[data-action="step-inside"]') && currentId) {
      deps.onStepInside?.(currentId);
      return;
    }
    const depthBtn = t.closest<HTMLElement>('[data-depth]');
    if (depthBtn?.dataset.depth) {
      setDepth(depthBtn.dataset.depth as (typeof DEPTHS)[number]);
      return;
    }
    const tour = t.closest<HTMLElement>('[data-tour]');
    if (tour) {
      e.preventDefault();
      tour.dispatchEvent(new CustomEvent('albert:tour', { bubbles: true, detail: { id: tour.dataset.tour, component: currentId } }));
    }
  };
  for (const x of parts) x.addEventListener('click', onClick);

  const offDepth = onDepthChange(() => {
    if (currentId) void render(currentId);
  });
  const offPrefs = onPrefsChange(() => {
    if (currentId) void render(currentId);
    else renderEmpty();
  });

  const panel: Panel = {
    element: el,
    openPanel: open,
    mount(slots) {
      slots.model.append(modelPart);
      slots.inspect.append(inspectPart);
      slots.analysis.append(analysisPart);
    },
    close() {
      token++;
      currentId = null;
      el.hidden = true;
      renderEmpty();
      el.dispatchEvent(new CustomEvent('albert:panel-close'));
    },
    current: () => currentId,
    dispose() {
      offDepth();
      offPrefs();
      for (const x of parts) x.remove();
      el.remove();
    },
  };
  return panel;
}

/** Table layout rules of the panel (the look lives in src/style/ui.css). */
export const PANEL_CSS = `
.inspect-panel table.tensor-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.inspect-panel td.t-name { overflow: hidden; }
.inspect-panel td.t-name .lv { white-space: normal; display: block; min-width: 0; }
.inspect-panel .t-namebox .lv-v, .inspect-panel .t-path { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inspect-panel td.t-shape, .inspect-panel td.t-dtype, .inspect-panel td.t-params { white-space: nowrap; }
.inspect-panel .t-shape { width: 30%; }
.inspect-panel .t-dtype { width: 19%; }
.inspect-panel .t-params { width: 21%; text-align: right; }
`;
