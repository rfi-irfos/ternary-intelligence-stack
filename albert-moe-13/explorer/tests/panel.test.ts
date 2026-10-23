// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { validateArchitecture } from '../src/data/architecture';
import { createWeightsLoader, validateLayerWeights } from '../src/data/weights';
import { buildTower } from '../src/scene/tower';
import { connectionsOf, createPanel, tensorRows } from '../src/ui/panel';
import { setDepth } from '../src/ui/depth';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const loadWeights = async () => validateLayerWeights(fixture);

function make() {
  const flyTo = vi.fn(() => Promise.resolve());
  const panel = createPanel({ arch: a, tower, rig: { flyTo }, loadWeights });
  document.body.appendChild(panel.element);
  return { panel, flyTo };
}

afterEach(() => {
  document.body.innerHTML = '';
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

  it('has the eight sections of the spec, in order', async () => {
    const { panel } = make();
    await panel.openPanel('L12.B.router');
    const names = [...panel.element.querySelectorAll('section')].map((s) => s.dataset.section);
    expect(names).toEqual(['what', 'tensors', 'compute', 'connections', 'visual', 'caveats', 'source', 'tour']);
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
    expect(flyTo).toHaveBeenCalledTimes(1);
    const target = (flyTo.mock.calls[0] as unknown as [THREE.Vector3, number])[0];
    expect(target.distanceTo(tower.anchor('L12.A.router'))).toBeLessThan(1e-9);
    expect(panel.current()).toBe('L12.A.router');
  });

  it('matrix level shows tile statistics from weights/L{n}.json labelled structure', async () => {
    const { panel } = make();
    await panel.openPanel('L12.A.attn.q');
    const box = panel.element.querySelector<HTMLElement>('.weights');
    expect(box?.dataset.kind).toBe('structure');
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
