import type { Architecture, TensorSpec } from '../data/architecture';
import type { CameraRig } from '../camera/controls';
import { findMatrix, findVector, type WeightsLoader, weightKey } from '../data/weights';
import { CAVEATS } from '../content/caveats';
import { COMPONENTS, type ComponentType, type ResolvedContent, componentTypeOf, contentFor, sourceUrl } from '../content/components';
import { fmt, fmtText, labelBlock, richHtml, structure } from '../data/labeled';
import {
  type ComponentId, type ParsedId, type Stream,
  attnId, bankId, embedId, expertId, lmHeadId, lnFId, ln1Id, ln2Id, parseId, routerId, slabId,
} from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { DEPTHS, DEPTH_LABEL, getDepth, onDepthChange, setDepth } from './depth';

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
}

export interface Panel {
  readonly element: HTMLElement;
  openPanel(id: ComponentId): Promise<void>;
  close(): void;
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

export interface Link { label: string; id: ComponentId }

/** Components next to this one in the data flow; each link flies the camera there. */
export function connectionsOf(id: ComponentId, a: Architecture): Link[] {
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
  const layer = 'layer' in p ? `Layer ${p.layer} of ${a.model.num_layers}` : '';
  const stream = 'stream' in p && p.stream ? ` · stream ${p.stream}` : '';
  const expert = 'expert' in p && p.expert !== undefined ? ` · expert ${p.expert}` : '';
  if (layer) return layer + stream + expert;
  return p.type === 'shaft' ? `stream ${p.stream}` : 'ends of the row';
}

/** Small schematic of the maths; carries no checkpoint numbers. */
function visual(type: ComponentType, a: Architecture, id: ComponentId, rc: ResolvedContent): string {
  const p = parseId(id);
  const ternary = type === 'matrix' ? p?.type === 'matrix' && p.name !== 'gate'
    : type === 'attn' || type === 'expert' || type === 'lm_head';
  if (type === 'router') {
    const n = a.model.num_experts;
    const bars = Array.from({ length: n }, (_, i) =>
      `<rect x="${6 + i * 14}" y="${i < 3 ? 6 : 24}" width="10" height="${i < 3 ? 30 : 12}" fill="${i < 3 ? '#58c4dd' : '#2a2e36'}"/>`).join('');
    return `<svg viewBox="0 0 ${12 + n * 14} 44" role="img" aria-label="router lights 3 of ${n} outputs"><title>schematic: top 3 of ${n} lit</title>${bars}</svg>`;
  }
  if (type === 'anastomosis') {
    return '<svg viewBox="0 0 160 44" role="img" aria-label="two streams exchange"><title>schematic</title>' +
      '<circle cx="30" cy="22" r="14" fill="#ffd940"/><circle cx="130" cy="22" r="14" fill="#66f2b3"/>' +
      '<path d="M46 14 L114 14 M114 30 L46 30" stroke="#fff" stroke-width="2" fill="none"/>' +
      '<text x="80" y="10" fill="#fff" font-size="10" text-anchor="middle">g₀</text>' +
      '<text x="80" y="42" fill="#fff" font-size="10" text-anchor="middle">g₁</text></svg>';
  }
  if (ternary) {
    return '<svg viewBox="0 0 170 44" role="img" aria-label="ternary weights are minus one, zero or plus one"><title>schematic</title>' +
      '<rect x="6" y="8" width="28" height="28" fill="#fc6255"/><text x="20" y="27" text-anchor="middle" font-size="14" fill="#000">−1</text>' +
      '<rect x="40" y="8" width="28" height="28" fill="#1a1c21" stroke="#555"/><text x="54" y="27" text-anchor="middle" font-size="14" fill="#fff">0</text>' +
      '<rect x="74" y="8" width="28" height="28" fill="#58c4dd"/><text x="88" y="27" text-anchor="middle" font-size="14" fill="#000">+1</text>' +
      '<text x="108" y="27" font-size="14" fill="#fff">× γ</text></svg>';
  }
  return `<svg viewBox="0 0 260 44" role="img" aria-label="in, operation, out"><title>schematic</title>` +
    `<text x="4" y="18" font-size="10" fill="#cfd8e8">${esc(rc.inputs.slice(0, 40))}</text>` +
    `<path d="M4 26 H256" stroke="#fff" stroke-width="1.5"/>` +
    `<text x="4" y="40" font-size="10" fill="#cfd8e8">${esc(rc.outputs.slice(0, 40))}</text></svg>`;
}

const pctText = (v: unknown): string => (typeof v === 'number' ? `${(v * 100).toFixed(1)} %` : '—');
const numText = (v: unknown): string => (typeof v === 'number' ? fmtText(structure(v)) : '—');

/** A checkpoint value (structure) as HTML; null (not defined for this matrix) shows a dash. */
const sv = (v: number | null, key: string, format?: (x: unknown) => string): string => {
  const el = fmt(structure(v ?? 0), { format: format ? () => format(v) : () => numText(v) });
  el.dataset.v = key;
  return el.outerHTML;
};

export function createPanel(deps: PanelDeps): Panel {
  const { arch, tower, rig, loadWeights } = deps;
  const el = document.createElement('aside');
  el.className = 'inspect-panel';
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

  function html(id: ComponentId, type: ComponentType, p: ParsedId): string {
    const c = COMPONENTS[type];
    const rc = contentFor(type, arch);
    const depth = getDepth();
    const rows = tensorRows(id, arch);
    const tau = 'layer' in p ? arch.layers[p.layer]?.tau : undefined;
    const links = connectionsOf(id, arch);
    const depthButtons = DEPTHS.map((d, i) =>
      `<button type="button" class="depth-btn${d === depth ? ' active' : ''}" data-depth="${d}" title="key ${i + 1}">${DEPTH_LABEL[d]}</button>`).join('');
    const tensors = rows.length === 0
      ? '<p>No tensors of its own.</p>'
      : `<table><tbody>${rows.map((r) =>
        `<tr data-tensor="${esc(r.name)}" data-dtype="${r.ternary ? 'ternary' : 'F32'}"><td>${fmt(structure(r.name)).outerHTML}</td>` +
        `<td>${fmt(structure(r.shape)).outerHTML}</td><td>${r.ternary ? 'ternary' : 'F32'}</td>` +
        `<td>${fmt(structure(r.params)).outerHTML}</td></tr>`).join('')}</tbody></table>`;
    const caveats = c.caveats.length === 0
      ? '<p>None recorded for this component.</p>'
      : c.caveats.map((cid) => {
        const cv = CAVEATS[cid];
        return `<details open data-caveat="${cid}"><summary>${cid} · ${richHtml(cv.title)}</summary><p>${richHtml(cv.body)}</p>` +
          (depth === 'intuition' ? '' : `<p class="evidence">Evidence: ${richHtml(cv.evidence)}</p>`) + '</details>';
      }).join('');
    const sources = c.source.map((s) =>
      `<li><a href="${esc(sourceUrl(s.file, s.lines))}" target="_blank" rel="noopener noreferrer">${richHtml(`${s.file}:${s.lines}`)}</a></li>`).join('');
    return `
      <header><h2>${richHtml(rc.title)}</h2><button type="button" class="panel-close" aria-label="Close">×</button>
        <div class="depth-switch">${depthButtons}</div></header>
      <section data-section="what"><h3>What it is</h3><p>${richHtml(rc.text[depth])}</p>
        <p class="where">${richHtml(location(p, arch))}${tau !== undefined ? ` · τ ${fmt(structure(tau)).outerHTML}` : ''}</p></section>
      <section data-section="tensors"><h3>Real tensors</h3>${tensors}<div class="weights"></div></section>
      <section data-section="compute"><h3>In → computation → out</h3>
        <p><b>In:</b> ${richHtml(rc.inputs)}</p><p class="formula">${richHtml(rc.formula)}</p><p><b>Out:</b> ${richHtml(rc.outputs)}</p></section>
      <section data-section="connections"><h3>Connections</h3>${links.length === 0 ? '<p>None.</p>' :
        `<ul>${links.map((l) => `<li><a href="#" data-link="${esc(l.id)}">${richHtml(l.label)}</a></li>`).join('')}</ul>`}</section>
      <section data-section="visual"><h3>The maths, schematic</h3>${labelBlock('illustrative', visual(type, arch, id, rc)).outerHTML}</section>
      <section data-section="caveats"><h3>Caveats</h3>${caveats}</section>
      <section data-section="source"><h3>Source</h3><ul>${sources}</ul></section>
      <section data-section="tour"><h3>Walkthrough</h3>${c.tour
        ? `<a href="#" data-tour="${c.tour}">Start the walkthrough about this</a>` : '<p>No walkthrough for this component yet.</p>'}</section>`;
  }

  async function fillWeights(id: ComponentId, p: ParsedId, mine: number): Promise<void> {
    const key = weightKey(p);
    const box = el.querySelector<HTMLElement>('.weights');
    if (!key || !box || !('layer' in p)) return;
    box.textContent = 'Loading weights…';
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
            `+${richHtml('1')}: ${sv(m.frac_pos, 'frac_pos', pctText)}</p><p>tile ${tile} (checkpoint values)</p>`
          : `<p>F32, shown as a diverging colour scale. tile ${tile} (checkpoint values)</p>`;
      } else if (key.vector) {
        const v = findVector(w, key.vector);
        if (!v) throw new Error('vector missing');
        box.innerHTML = `<p>mean ${sv(v.mean, 'mean')} · std ${sv(v.std, 'std')} · min ${sv(v.min, 'min')} · max ${sv(v.max, 'max')} (checkpoint values)</p>`;
      }
    } catch (err) {
      if (mine === token) box.innerHTML = richHtml(`Weights unavailable: ${String(err)}`);
    }
    void id;
  }

  function render(id: ComponentId): Promise<void> {
    const type = componentTypeOf(id);
    const p = parseId(id);
    if (!type || !p) return Promise.resolve();
    token++;
    currentId = id;
    el.hidden = false;
    el.dataset.id = id;
    el.dataset.type = type;
    el.innerHTML = html(id, type, p);
    return fillWeights(id, p, token);
  }

  const open = (id: ComponentId): Promise<void> => render(id);

  el.addEventListener('click', (e) => {
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
    const depthBtn = t.closest<HTMLElement>('[data-depth]');
    if (depthBtn?.dataset.depth) {
      setDepth(depthBtn.dataset.depth as (typeof DEPTHS)[number]);
      return;
    }
    const tour = t.closest<HTMLElement>('[data-tour]');
    if (tour) {
      e.preventDefault();
      el.dispatchEvent(new CustomEvent('albert:tour', { bubbles: true, detail: { id: tour.dataset.tour, component: currentId } }));
      return;
    }
    if (t.closest('.panel-close')) panel.close();
  });

  const offDepth = onDepthChange(() => {
    if (currentId) void render(currentId);
  });

  const panel: Panel = {
    element: el,
    openPanel: open,
    close() {
      token++;
      currentId = null;
      el.hidden = true;
      el.innerHTML = '';
    },
    current: () => currentId,
    dispose() {
      offDepth();
      el.remove();
    },
  };
  return panel;
}

export const PANEL_CSS = `
.inspect-panel { position: fixed; right: 12px; top: 12px; bottom: 56px; width: 340px; overflow-y: auto;
  padding: 12px 14px; color: #e8eef9; background: rgba(10,12,18,0.82); border: 1px solid rgba(255,255,255,0.35);
  border-radius: 4px; font: 13px/1.45 Georgia, 'Times New Roman', serif; backdrop-filter: blur(6px); }
.inspect-panel h2 { margin: 0 0 6px; font-weight: normal; font-style: italic; font-size: 20px; }
.inspect-panel h3 { margin: 12px 0 4px; font: 11px monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #cfd8e8; }
.inspect-panel table { width: 100%; border-collapse: collapse; font: 11px monospace; }
.inspect-panel td { padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.12); word-break: break-all; }
.inspect-panel .formula { font-style: italic; }
.inspect-panel a { color: #58c4dd; }
.inspect-panel .panel-close { position: absolute; right: 10px; top: 8px; background: none; border: 0; color: #fff; font-size: 20px; cursor: pointer; }
.inspect-panel .depth-btn { font: 11px monospace; margin-right: 4px; padding: 2px 6px; color: #cfd8e8; background: #14161b; border: 1px solid #333a46; border-radius: 3px; cursor: pointer; }
.inspect-panel .depth-btn.active { background: #58c4dd; color: #000; }
.inspect-panel svg { width: 100%; height: 56px; }
.inspect-panel svg text { fill: #e8eef9; }
.inspect-panel .evidence { font: 11px monospace; color: #cfd8e8; }
`;
