// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { validateArchitecture } from '../src/data/architecture';
import { createWeightsLoader, validateLayerWeights } from '../src/data/weights';
import { buildTower } from '../src/scene/tower';
import { createExplode } from '../src/scene/explode';
import { pickAction } from '../src/ui/pickAction';
import { isExplodable } from '../src/scene/hierarchy';
import { SHORT_NAME_MAX, connectionsOf, createPanel, shortNames, tensorRows } from '../src/ui/panel';
import { setDepth } from '../src/ui/depth';
import { setMode, t } from '../src/ui/prefs';
import { CAVEATS } from '../src/content/caveats';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const loadWeights = async () => validateLayerWeights(fixture);

function make() {
  const flyTo = vi.fn(() => Promise.resolve());
  const panel = createPanel({ arch: a, tower, rig: { flyTo }, loadWeights });
  document.body.appendChild(panel.element);
  return { panel, flyTo };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = '';
  setMode('simple');
  setDepth('intuition');
});

describe('inspection panel', () => {
  it('panel for L12.expert.7 lists c_fc [1024 × 256] ternary and seed_bias [256] F32', async () => {
    const { panel } = make();
    await panel.openPanel('L12.expert.7');
    const rows = [...panel.element.querySelectorAll<HTMLElement>('tr[data-tensor]')];
    const cfc = rows.find((r) => r.dataset.tensor === 'blocks.12.experts.7.c_fc.weight');
    expect(cfc?.textContent).toContain('[1024 × 256]');
    expect(cfc?.dataset.dtype).toBe('ternary');
    expect(cfc?.textContent).toContain('ternary');
    const seed = rows.find((r) => r.dataset.tensor === 'blocks.12.experts.7.seed_bias');
    expect(seed?.textContent).toContain('[256]');
    expect(seed?.dataset.dtype).toBe('F32');
    expect(seed?.textContent).toContain('F32');
  });

  it('has the sections of the spec, in order: Modell, Inspektion, Analyse', async () => {
    const { panel } = make();
    await panel.openPanel('L12.B.router');
    const names = [...panel.element.querySelectorAll('section')].map((s) => s.dataset.section).filter((n) => n !== 'weights');
    expect(names).toEqual(['what', 'connections', 'params', 'tensors', 'compute', 'visual', 'caveats', 'source', 'tour']);
    // The three parts keep the order Modell, Inspektion, Analyse.
    expect([...panel.element.querySelectorAll<HTMLElement>('.panel-part')].map((x) => x.dataset.part)).toEqual(['model', 'inspect', 'analysis']);
    expect(panel.element.querySelectorAll('[data-caveat]')).toHaveLength(3);
    expect(panel.element.textContent).toContain('stream B');
  });

  it('source links pin the commit', async () => {
    const { panel } = make();
    await panel.openPanel('L3.A.attn');
    const hrefs = [...panel.element.querySelectorAll<HTMLAnchorElement>('[data-section="source"] a')].map((x) => x.href);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toMatch(/\/blob\/[0-9a-f]{40}\//);
  });

  it('connection links fly the camera', async () => {
    const { panel, flyTo } = make();
    await panel.openPanel('L12.expert.7');
    const link = panel.element.querySelector<HTMLElement>('[data-link="L12.A.router"]');
    expect(link).not.toBeNull();
    link!.click();
    await flush();
    expect(flyTo).toHaveBeenCalledTimes(1);
    const target = (flyTo.mock.calls[0] as unknown as [THREE.Vector3, number])[0];
    expect(target.distanceTo(tower.anchor('L12.A.router'))).toBeLessThan(1e-9);
    expect(panel.current()).toBe('L12.A.router');
  });

  it('matrix level shows tile statistics from weights/L{n}.json labelled structure', async () => {
    const { panel } = make();
    await panel.openPanel('L12.A.attn.q');
    const box = panel.element.querySelector<HTMLElement>('.weights');
    expect(box?.querySelector<HTMLElement>('[data-v="gamma"]')?.dataset.kind).toBe('structure');
    expect(box?.textContent).toContain('γ');
    expect(box?.querySelector('[data-v="gamma"]')?.textContent).toBe('0.1');
    expect(box?.textContent).toContain('32 × 32');
    const rows = [...panel.element.querySelectorAll<HTMLElement>('tr[data-tensor]')];
    expect(rows.map((r) => r.dataset.tensor)).toEqual(['blocks.12.stream_a.attn.q_proj.weight']);
  });

  it('router gate matrix is F32 and has its own tensor row', async () => {
    const { panel } = make();
    await panel.openPanel('L12.A.router.gate');
    const rows = [...panel.element.querySelectorAll<HTMLElement>('tr[data-tensor]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataset.dtype).toBe('F32');
    expect(rows[0]?.textContent).toContain('[12 × 256]');
  });

  it('re-renders on depth change and hides evidence at intuition depth', async () => {
    const { panel } = make();
    await panel.openPanel('L12.A.router');
    expect(panel.element.querySelector('.evidence')).toBeNull();
    setDepth('researcher');
    expect(panel.element.querySelector('.evidence')?.textContent).toContain('moe.rs');
  });

  it('tour link raises an event', async () => {
    const { panel } = make();
    await panel.openPanel('L12.A.router');
    const got = vi.fn();
    panel.element.addEventListener('albert:tour', got);
    panel.element.querySelector<HTMLElement>('[data-tour]')!.click();
    expect(got).toHaveBeenCalledTimes(1);
  });

  it('weights loader fetches each layer once', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const load = createWeightsLoader(f, '/w');
    await Promise.all([load(12), load(12)]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/w/L12.json');
  });
});

describe('exploded navigation and picking', () => {
  const noLabel = () => new THREE.Object3D();

  it('a connection link while exploded reassembles first, then flies to the visible anchor', async () => {
    const order: string[] = [];
    const t = buildTower(a);
    const rig = { flyTo: vi.fn(() => { order.push('fly'); return Promise.resolve(); }) };
    const viewRig = { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null as (() => boolean) | null };
    const view = createExplode({ tower: t, arch: a, rig: viewRig, loadWeights, label: noLabel, ms: 0 });
    const panel = createPanel({
      arch: a, tower: t, rig, loadWeights,
      beforeNavigate: async () => {
        while (view.depth() > 0) await view.reassemble();
        order.push(`reassembled depth ${view.depth()}`);
      },
    });
    document.body.appendChild(panel.element);
    await view.explode('L12');
    await view.explode('L12.A.attn');
    expect(view.depth()).toBe(2);
    rig.flyTo.mockClear();
    order.length = 0;
    await panel.openPanel('L12.A.attn');
    panel.element.querySelector<HTMLElement>('[data-link="L12.A.ln1"]')!.click();
    await flush();
    expect(view.depth()).toBe(0);
    expect(order).toEqual(['reassembled depth 0', 'fly']);
    const target = (rig.flyTo.mock.calls[0] as unknown as [THREE.Vector3, number])[0];
    expect(target.distanceTo(t.anchor('L12.A.ln1'))).toBeLessThan(1e-9);
    expect(panel.current()).toBe('L12.A.ln1');
    view.dispose();
  });

  it('picking an explodable component opens the panel once, a leaf once', async () => {
    const t = buildTower(a);
    const rig = { flyTo: vi.fn(() => Promise.resolve()), escapeGuard: null as (() => boolean) | null };
    const openPanel = vi.fn(async () => {});
    const view = createExplode({ tower: t, arch: a, rig, loadWeights, label: noLabel, ms: 0, onChange: (id) => { if (id) void openPanel(); } });
    const deps = { explodable: (id: string) => isExplodable(id, a), explode: (id: string) => view.explode(id), openPanel };
    pickAction('L12.A.attn', deps);
    await flush();
    // From the row the part opens through its slab (two levels), with one panel open.
    expect(view.depth()).toBe(2);
    expect(view.current()).toBe('L12.A.attn');
    expect(openPanel).toHaveBeenCalledTimes(1);
    openPanel.mockClear();
    pickAction('L12.expert.7.gelu', { ...deps, explodable: () => false });
    expect(openPanel).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});

describe('ids and rows', () => {
  it('tensorRows covers every component with the architecture shapes', () => {
    expect(tensorRows('L0.A.attn', a)).toHaveLength(4);
    expect(tensorRows('L0.A.ln1', a).map((r) => r.shape)).toEqual([[256], [256]]);
    expect(tensorRows('embed', a)[0]?.shape).toEqual([32000, 256]);
    expect(tensorRows('L2.gate', a)[0]?.name).toBe('anastomosis.0.gate.weight');
  });

  it('every connection target is a known id', () => {
    for (const id of ['L0', 'L45', 'L12.A.attn', 'L12.B.router', 'L12.expert.3', 'L12.bank', 'embed', 'ln_f', 'lm_head', 'L5.gate']) {
      for (const l of connectionsOf(id, a)) {
        expect(tower.has(l.id) || l.id.endsWith('.bank'), `${id} -> ${l.id}`).toBe(true);
      }
    }
  });
});

describe('codex panel layout', () => {
  const visible = (el: Element | null): boolean => !!el && !el.closest('[hidden]');

  it('Modell: head with the type pill and an info card of labelled key / value rows', async () => {
    const { panel } = make();
    await panel.openPanel('L12.expert.7');
    const head = panel.element.querySelector('.panel-head')!;
    expect(head.querySelector('h2')?.textContent).toContain('Expert');
    expect(head.querySelector('.role-chip')?.getAttribute('data-role')).toBe('expert');
    expect(head.querySelector('.role-chip svg')).not.toBeNull();
    expect(head.querySelector('.panel-summary')?.textContent).toBe(t('sum.expert'));
    const rows = [...panel.element.querySelectorAll('.info-card .kv-row')];
    const labels = rows.map((r) => r.querySelector('.stat-label')?.textContent);
    expect(labels).toEqual([t('info.type'), t('info.layer'), t('info.stream'), t('info.expert'), t('info.experts'), t('info.hidden'), t('info.dtype')].filter((l) => l !== t('info.stream')));
    // Simple counts layers from 1 (layerLabel): blocks.12 is "layer 13 of 46"; every number carries its kind.
    expect(rows[1]?.textContent).toContain('13');
    expect(rows[1]?.textContent).toContain('46');
    expect(rows.find((r) => r.textContent?.includes(t('info.experts')))?.querySelector('[data-kind="structure"]')?.textContent).toBe('12');
    expect(rows.find((r) => r.textContent?.includes(t('info.hidden')))?.textContent).toContain('256');
    expect(head.querySelector('.depth-switch')).toBeNull();
  });

  it('Simple: what, connections and the computation start open, the other analysis rows closed', async () => {
    const { panel } = make();
    await panel.openPanel('L12.expert.7');
    const body = (name: string) => panel.element.querySelector(`[data-section="${name}"] .sec-body`);
    expect(visible(body('what'))).toBe(true);
    expect(visible(body('connections'))).toBe(true);
    expect(visible(body('compute'))).toBe(true);
    for (const name of ['caveats', 'source', 'visual']) expect(visible(body(name)), name).toBe(false);
    // Opening one keeps it open.
    panel.element.querySelector<HTMLElement>('[data-toggle="caveats"]')!.click();
    expect(visible(body('caveats'))).toBe(true);
    expect(panel.element.querySelector('[data-toggle="caveats"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('Inspektion: tabs Parameter | Tensoren (| Gewichte); one tab shows at a time; a tab without content is left out', async () => {
    setMode('advanced');
    const { panel } = make();
    await panel.openPanel('L12.A.attn');
    expect(panel.element.querySelector('.depth-switch')).not.toBeNull();
    const tabs = () => [...panel.element.querySelectorAll<HTMLElement>('[role=tab]')];
    expect(tabs().map((x) => x.dataset.tab)).toEqual(['params', 'tensors']);
    const sec = (name: string) => panel.element.querySelector(`[data-section="${name}"]`);
    expect(visible(sec('params'))).toBe(true);
    expect(visible(sec('tensors'))).toBe(false);
    tabs()[1]!.click();
    expect(visible(sec('tensors'))).toBe(true);
    expect(visible(sec('params'))).toBe(false);
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    // A matrix has real tile statistics: the third tab appears.
    await panel.openPanel('L12.A.attn.q');
    expect(tabs().map((x) => x.dataset.tab)).toEqual(['params', 'tensors', 'weights']);
    // A part without tensors (an activation) has no Inspektion at all.
    await panel.openPanel('L12.expert.7.gelu');
    expect(tabs()).toHaveLength(0);
    expect((panel.element.querySelector('.panel-part--inspect') as HTMLElement).hidden).toBe(true);
    // The computation (Analyse) is a collapsible row with the formula.
    await panel.openPanel('L12.A.attn');
    expect(visible(sec('compute')!.querySelector('.formula'))).toBe(true);
  });

  it('tensor rows show the short name; the full path is the tooltip and the sub-line', async () => {
    const { panel } = make();
    await panel.openPanel('L12.expert.7');
    const row = panel.element.querySelector<HTMLElement>('tr[data-tensor="blocks.12.experts.7.c_fc.weight"]')!;
    const name = row.querySelector<HTMLElement>('.t-namebox')!;
    expect(name.querySelector('.lv-v')?.textContent).toBe('c_fc.weight');
    expect(name.title).toBe('blocks.12.experts.7.c_fc.weight');
    expect(name.querySelector('.t-path')?.textContent).toBe('blocks.12.experts.7.c_fc.weight');
    expect(row.querySelector('.dtype--ternary')?.textContent).toBe('ternary');
    expect(row.querySelector('.t-params')?.textContent).toBe('262,144');
  });

  it('the expert bank groups its per-expert tensors under one "× 12 experts" header', async () => {
    const { panel } = make();
    await panel.openPanel('L12.bank');
    const group = panel.element.querySelector('tr.t-group')!;
    expect(group.textContent).toMatch(/× 12 experts/);
    const grouped = [...panel.element.querySelectorAll<HTMLElement>('tr[data-group="experts"]')];
    expect(grouped.length).toBe(5);
    expect(grouped.every((r) => r.dataset.tensor?.includes('experts.{e}.'))).toBe(true);
    // Every grouped row comes after the header.
    expect(group.compareDocumentPosition(grouped[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('caveats are compact rows: code chip and title, body collapsed until clicked', async () => {
    const { panel } = make();
    await panel.openPanel('L12');
    const rows = [...panel.element.querySelectorAll<HTMLDetailsElement>('details[data-caveat]')];
    expect(rows.map((d) => d.dataset.caveat)).toEqual(['A6', 'A7', 'A8']);
    for (const d of rows) {
      expect(d.open).toBe(false);
      expect(d.querySelector('summary .code-chip')?.textContent).toBe(d.dataset.caveat);
      expect(d.querySelector('summary .cv-title')?.textContent).toBe(CAVEATS[d.dataset.caveat as 'A6'].title.en);
    }
    const a6 = rows[0]!;
    // A time cell shows short ("09-19 14:00Z", R6: the table fits the panel at 1280 px) and keeps the full
    // ISO value in datetime and title.
    const cells = [...a6.querySelectorAll('.cv-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => {
      const time = td.querySelector('time');
      if (time) {
        expect(time.title).toBe(time.getAttribute('datetime'));
        expect(time.textContent).toBe(`${time.getAttribute('datetime')!.slice(5, 10)} ${time.getAttribute('datetime')!.slice(11)}`);
      }
      return time?.getAttribute('datetime') ?? td.textContent;
    }));
    expect(cells).toEqual([
      ['42 → 43', '2026-09-19T14:00Z', 'ep8938', '3372'],
      ['43 → 44', '2026-09-19T15:05Z', 'ep8942', '3450'],
      ['44 → 45', '2026-09-19T18:55Z', 'ep8958', '3528'],
      ['45 → 46', '2026-09-20T01:10Z', 'ep8987', '3606'],
    ]);
    // The table was read from the watch log: a measured block whose badge names the log.
    const wrap = a6.querySelector<HTMLElement>('.cv-table-wrap')!;
    expect(wrap.dataset.kind).toBe('measured');
    expect(wrap.classList.contains('lv-block--measured')).toBe(true);
    expect(wrap.title).toBe('~/.albert/albert_watch_log.md');
    expect(a6.querySelector('.tag--measured')?.textContent).toContain('albert_watch_log.md');
  });

  it('short tensor names are unambiguous: truncated from the left, the .weight / .bias suffix kept', () => {
    const full = [
      'blocks.12.A.attn.q.weight', 'blocks.12.B.attn.q.weight', 'blocks.12.A.ln1.weight', 'blocks.12.A.ln1.bias',
      'blocks.12.experts.7.c_fc.weight', 'blocks.12.experts.7.seed_bias',
    ];
    const short = shortNames(full);
    expect(new Set(short).size).toBe(full.length);
    for (const [k, s] of short.entries()) {
      expect(s.length, s).toBeLessThanOrEqual(SHORT_NAME_MAX);
      const tail = s.replace(/^…/, '');
      expect(full[k]!.endsWith(tail), `${s} is a suffix of ${full[k]}`).toBe(true);
      if (/\.(weight|bias)$/.test(full[k]!)) expect(s).toMatch(/\.(weight|bias)$/);
    }
    expect(short[0]).not.toBe(short[1]);
    expect(short[4]).toBe('c_fc.weight');
    const long = shortNames(['blocks.12.experts.7.a_very_long_projection_name.weight']);
    expect(long[0]!.length).toBeLessThanOrEqual(SHORT_NAME_MAX);
    expect(long[0]).toMatch(/^….*\.weight$/);
  });

  it('mounts its three parts into the side panel sections; close empties them; the camera never moves', async () => {
    const { panel, flyTo } = make();
    const slots = { model: document.createElement('div'), inspect: document.createElement('div'), analysis: document.createElement('div') };
    panel.mount(slots);
    expect(panel.element.querySelector('.panel-part')).toBeNull();
    await panel.openPanel('L20.bank');
    expect(slots.model.querySelector('h2')).not.toBeNull();
    expect(slots.inspect.querySelector('[role=tab]')).not.toBeNull();
    expect(slots.analysis.querySelector('[data-section="compute"]')).not.toBeNull();
    const closed = vi.fn();
    panel.element.addEventListener('albert:panel-close', closed);
    panel.close();
    expect(panel.current()).toBeNull();
    expect(slots.model.textContent).toContain(t('side.noSelection'));
    expect(slots.inspect.querySelector('[role=tab]')).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(flyTo).not.toHaveBeenCalled();
  });

  it('"Step inside" sits on the card of anything in a layer and hands the id to the app', async () => {
    const onStepInside = vi.fn();
    const panel = createPanel({ arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()) }, loadWeights, onStepInside });
    document.body.appendChild(panel.element);
    await panel.openPanel('L20');
    const btn = panel.element.querySelector<HTMLElement>('[data-action="step-inside"]')!;
    expect(btn.textContent).toBe(t('nav.enter'));
    btn.click();
    expect(onStepInside).toHaveBeenCalledWith('L20');
    await panel.openPanel('embed');
    expect(panel.element.querySelector('[data-action="step-inside"]')).toBeNull();
  });
});
