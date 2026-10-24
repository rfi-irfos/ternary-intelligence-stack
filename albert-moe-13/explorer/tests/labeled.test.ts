// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import arch from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { APP_NAME } from '../src/content/brand';
import {
  type TraceProvenance, fmt, fmtText, illustrative, measured, richHtml, structure,
} from '../src/data/labeled';
import { validateArchitecture } from '../src/data/architecture';
import { validateLayerWeights } from '../src/data/weights';
import { buildTower } from '../src/scene/tower';
import { PANEL_CSS, createPanel } from '../src/ui/panel';
import { CITED_NOTE, LABEL_CSS } from '../src/data/labeled';
import { DEPTHS, setDepth } from '../src/ui/depth';
import { setMode } from '../src/ui/prefs';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const loadWeights = async () => validateLayerWeights(fixture);

const prov: TraceProvenance = {
  prompt_id: 'p-001', prompt: 'hello', token_ids: [1, 2], tokens: ['he', 'llo'],
  checkpoint_sha256: 'ab'.repeat(32), git_commit: 'cd'.repeat(20), num_layers: 46,
  tau_schedule: [0.01, 0.02], ttl_rule: 'rule', mode: 'eval', path: 'forward_prefill', date: '2026-10-23',
};

afterEach(() => {
  document.body.innerHTML = '';
  setMode('simple');
  setDepth('intuition');
});

describe('labelled values', () => {
  it('measured without provenance throws', () => {
    expect(() => measured(1, undefined as unknown as TraceProvenance)).toThrow(/provenance/);
    expect(() => measured(1, {} as TraceProvenance)).toThrow(/provenance/);
    expect(measured(0.5, prov).provenance).toBe(prov);
  });

  it('measured validates every provenance field the tooltip reads', () => {
    for (const k of Object.keys(prov).filter((x) => x !== 'attention_window')) {
      const broken = { ...prov, [k]: undefined } as unknown as TraceProvenance;
      expect(() => measured(1, broken), k).toThrow(/provenance/);
    }
    expect(() => measured(1, { ...prov, git_commit: null } as unknown as TraceProvenance)).toThrow(/provenance/);
    expect(() => fmt(measured(1, { ...prov, attention_window: 8 }))).not.toThrow();
  });

  it('fmt adds data-kind attribute', () => {
    expect(fmt(structure(46)).dataset.kind).toBe('structure');
    expect(fmt(measured(0.5, prov)).dataset.kind).toBe('measured');
    expect(fmt(illustrative('x')).dataset.kind).toBe('illustrative');
  });

  it('illustrative badge has class badge--illustrative', () => {
    const el = fmt(illustrative(3));
    expect(el.querySelector('.badge')?.classList.contains('badge--illustrative')).toBe(true);
  });

  it('measured badge is solid and its tooltip names the provenance', () => {
    const el = fmt(measured(0.25, prov));
    const b = el.querySelector('.badge');
    expect(b?.classList.contains('badge--measured')).toBe(true);
    expect(b?.getAttribute('title')).toContain('p-001');
    expect(b?.getAttribute('title')).toContain('2026-10-23');
  });

  it('textContent is the bare value; shapes and integers are formatted', () => {
    expect(fmt(structure(1104)).textContent).toBe('1,104');
    expect(fmt(structure([1024, 256])).textContent).toBe('[1024 × 256]');
    expect(fmt(structure(0.123456789)).textContent).toBe('0.12346');
    expect(fmtText(structure('x'))).toBe('x');
  });

  it('richHtml wraps number tokens but not identifiers', () => {
    const d = document.createElement('div');
    d.innerHTML = richHtml('Layer 12 of 46, tau 0.01, L12.A.attn, ln1, top3, A4, 1,104 slots, eps 1e-5');
    const tokens = [...d.querySelectorAll('[data-kind]')].map((e) => e.textContent);
    expect(tokens).toEqual(['12', '46', '0.01', '1,104', '1e-5']);
  });
});

/** Text nodes with a digit that is not part of an identifier and not inside a [data-kind] element. */
function bareNumbers(root: HTMLElement): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent ?? '';
    if (!/(?<![A-Za-z_\d])\d/.test(text)) continue;
    if ((n.parentElement as HTMLElement).closest('[data-kind]')) continue;
    out.push(text);
  }
  return out;
}

describe('panel labelling', () => {
  const ids = [
    'L12', 'L0', 'L12.A.ln1', 'L12.B.ln2', 'L12.A.attn', 'L12.A.attn.head2', 'L12.A.attn.q', 'L12.A.router',
    'L12.A.router.gate', 'L12.bank', 'L12.expert.7', 'L12.expert.7.seed_bias', 'L12.expert.7.c_fc',
    'L12.expert.7.gelu', 'L5.gate', 'embed', 'ln_f', 'lm_head', 'shaft.A',
  ];

  it('panel contains no bare number outside a [data-kind] element', async () => {
    const panel = createPanel({ arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()) }, loadWeights });
    document.body.appendChild(panel.element);
    let checked = 0;
    for (const d of DEPTHS) {
      setDepth(d);
      for (const id of ids) {
        await panel.openPanel(id);
        expect(bareNumbers(panel.element), `${id} @ ${d}`).toEqual([]);
        checked += panel.element.querySelectorAll('[data-kind]').length;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('weights statistics, tensor shapes and tau carry the structure kind', async () => {
    const panel = createPanel({ arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()) }, loadWeights });
    document.body.appendChild(panel.element);
    await panel.openPanel('L12.A.attn.q');
    for (const v of ['gamma', 'tau', 'frac_neg', 'frac_zero', 'frac_pos']) {
      const el = panel.element.querySelector<HTMLElement>(`[data-v="${v}"]`);
      expect(el?.dataset.kind, v).toBe('structure');
    }
    expect(panel.element.querySelector('[data-v="frac_neg"]')?.textContent).toBe('40.0 %');
    const row = panel.element.querySelector('tr[data-tensor]')!;
    expect([...row.querySelectorAll('td')].filter((td) => /\d/.test(td.textContent ?? '') && !td.querySelector('[data-kind]'))).toEqual([]);
    // Simple counts layers from 1 (blocks.12 is layer 13); Advanced keeps the code index.
    expect(panel.element.querySelector('.where [data-kind]')?.textContent).toBe('13');
  });
});

describe('app name', () => {
  it('index.html title and heading equal APP_NAME', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html');
    expect(APP_NAME).toBe('Xperience albert.');
    expect(doc.title).toBe(APP_NAME);
    expect(doc.getElementById('app-name')?.textContent).toBe(APP_NAME);
    expect(indexHtml).toMatch(/Space Grotesk/);
    expect(indexHtml).not.toMatch(/italic/);
    expect(indexHtml).not.toMatch(/FreeSerif/);
  });
});

describe('panel layout and schematic labels', () => {
  const rig = { flyTo: vi.fn(() => Promise.resolve()) };

  it('tensor table columns do not wrap: dtype, shape and params are nowrap in a fixed layout', async () => {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS + LABEL_CSS;
    document.head.appendChild(style);
    const panel = createPanel({ arch: a, tower, rig, loadWeights });
    document.body.appendChild(panel.element);
    await panel.openPanel('L12.expert.7');
    const row = panel.element.querySelector('tr[data-tensor]')!;
    for (const c of ['t-shape', 't-dtype', 't-params']) {
      const td = row.querySelector(`td.${c}`) as HTMLElement;
      expect(td, c).not.toBeNull();
      expect(getComputedStyle(td).whiteSpace, c).toBe('nowrap');
    }
    expect(getComputedStyle(panel.element.querySelector('table')!).tableLayout).toBe('fixed');
    expect(getComputedStyle(row.querySelector('td.t-name .lv')!).whiteSpace).toBe('normal');
    style.remove();
  });

  it('router schematic: the expert count is a structure value outside the illustrative figure', async () => {
    const panel = createPanel({ arch: a, tower, rig, loadWeights });
    document.body.appendChild(panel.element);
    await panel.openPanel('L12.A.router');
    const n = panel.element.querySelector<HTMLElement>('[data-v="experts"]');
    expect(n?.dataset.kind).toBe('structure');
    expect(n?.textContent).toBe(String(a.model.num_experts));
    expect(n?.closest('.lv-block--illustrative')).toBeNull();
    for (const t of ['router', 'anastomosis', 'attn', 'matrix', 'expert', 'ln1']) {
      const id = { router: 'L12.A.router', anastomosis: 'L5.gate', attn: 'L12.A.attn', matrix: 'L12.A.attn.q', expert: 'L12.expert.7', ln1: 'L12.A.ln1' }[t]!;
      await panel.openPanel(id);
      const fig = panel.element.querySelector('.lv-block--illustrative')!;
      const texts = [...fig.querySelectorAll('text,title')].map((x) => x.textContent ?? '').join(' ') + (fig.querySelector('svg')?.getAttribute('aria-label') ?? '');
      const digits = texts.replace(/[−+]?[01]\b/g, '');
      expect(/\d/.test(digits), `${t}: ${texts}`).toBe(false);
    }
  });

  it('caveat numbers carry the cited-source tooltip, architecture facts keep the default one', async () => {
    const panel = createPanel({ arch: a, tower, rig, loadWeights });
    document.body.appendChild(panel.element);
    await panel.openPanel('L12'); // slab: A6 (46 vs 38 layers), A7, A8
    const a6 = panel.element.querySelector('[data-caveat="A6"]')!;
    const byText = (t: string) => [...a6.querySelectorAll<HTMLElement>('.lv')].find((x) => x.textContent === t)!;
    expect(byText('38').title).toBe(CITED_NOTE);
    expect(byText('46').title).toContain('read from the checkpoint');
    await panel.openPanel('L12.A.router');
    const a9 = panel.element.querySelector('[data-caveat="A9"]')!;
    expect([...a9.querySelectorAll<HTMLElement>('.lv')].find((x) => x.textContent === '50')?.title).toBe(CITED_NOTE);
  });
});
