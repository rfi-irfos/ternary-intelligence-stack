// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import arch from '../public/data/architecture.json';
import fixture from './fixtures/L12.fixture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateLayerWeights } from '../src/data/weights';
import { validateTrace } from '../src/data/trace';
import { buildTower } from '../src/scene/tower';
import { createPanel } from '../src/ui/panel';
import { setDepth, DEPTHS } from '../src/ui/depth';
import { setLang, setMode } from '../src/ui/prefs';
import { closeTourMenu, openTourMenu } from '../src/ui/tourMenu';
import { layerSteps } from '../src/layer/steps';
import { renderStep } from '../src/layer/views';
import { numText, pctStr } from '../src/data/labeled';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const traces = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const kjv = validateTrace(traces['../public/data/trace/kjv.json'], a);
const loadWeights = async () => validateLayerWeights(fixture);

/** English words that give away an untranslated German text. */
const GIVEAWAYS = [' the ', ' and ', ' of ', 'which', 'each', 'stream '];

/**
 * Visible prose of an element, without code: formulas, tensor paths, source citations and code ids are
 * the same in both languages and are not translated.
 */
function prose(root: HTMLElement): string {
  const c = root.cloneNode(true) as HTMLElement;
  for (const x of c.querySelectorAll('code, pre, .formula, .t-path, .t-namebox, .src-row, .source-list, a[href*="github.com"]')) x.remove();
  return ` ${(c.textContent ?? '').replace(/\s+/g, ' ').toLowerCase()} `;
}

function giveaways(text: string): string[] {
  return GIVEAWAYS.filter((w) => text.includes(w)).map((w) => {
    const k = text.indexOf(w);
    return `"${w.trim()}" in …${text.slice(Math.max(0, k - 40), k + 40)}…`;
  });
}

afterEach(() => {
  closeTourMenu();
  document.body.innerHTML = '';
  setLang('en');
  setMode('simple');
  setDepth('intuition');
});

describe('German has no English left in it', () => {
  const ids = ['L12.expert.7', 'L12.bank', 'L12.A.attn', 'L12.A.router', `L${a.model.fusion_layers[4]}.gate`, 'L12.A.attn.q'];

  for (const mode of ['simple', 'advanced'] as const) {
    it(`the panel for six component types, every section open (${mode})`, async () => {
      setLang('de');
      setMode(mode);
      const panel = createPanel({ arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()) }, loadWeights });
      document.body.appendChild(panel.element);
      for (const id of ids) {
        const depths = mode === 'simple' ? (['intuition'] as const) : DEPTHS;
        for (const d of depths) {
          if (mode === 'advanced') setDepth(d);
          await panel.openPanel(id);
          for (const tg of panel.element.querySelectorAll<HTMLElement>('[data-toggle][aria-expanded="false"]')) tg.click();
          for (const det of panel.element.querySelectorAll<HTMLDetailsElement>('details')) det.open = true;
          const shown = [...panel.element.querySelectorAll<HTMLElement>('[data-section]')];
          expect(shown.length, id).toBeGreaterThan(0);
          const text = shown.map(prose).join(' ') + prose(panel.element.querySelector<HTMLElement>('.panel-head')!);
          expect(giveaways(text), `${id} ${d}`).toEqual([]);
        }
      }
    });
  }

  it('the step cards of a layer, at every depth', () => {
    setLang('de');
    for (const layer of [12, a.model.fusion_layers[4]!]) {
      for (const s of layerSteps(kjv, layer, 'A', 3, a, 'de')) {
        for (const d of DEPTHS) {
          const card = renderStep(s, d);
          expect(giveaways(prose(card)), `${layer}/${s.id}/${d}`).toEqual([]);
        }
      }
    }
  });

  it('the tour menu', () => {
    setLang('de');
    const el = openTourMenu();
    expect(giveaways(prose(el))).toEqual([]);
  });

  it('numbers follow the language: 1.104 and 0,5 in German, 1,104 and 0.5 in English', async () => {
    expect(numText(1104, 'de')).toBe('1.104');
    expect(numText(1104, 'en')).toBe('1,104');
    expect(numText(0.5, 'de')).toBe('0,5');
    expect(pctStr(0.982, 1, 'de')).toBe('98,2 %');
    expect(pctStr(0.982, 1, 'en')).toBe('98.2 %');
    setLang('de');
    const panel = createPanel({ arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()) }, loadWeights });
    document.body.appendChild(panel.element);
    await panel.openPanel('L12.expert.7');
    expect(panel.element.querySelector('tr[data-tensor="blocks.12.experts.7.c_fc.weight"] .t-params')?.textContent).toBe('262.144');
    // No English thousands separator ("262,144"); German decimals such as "0,003" are fine.
    expect(panel.element.textContent).not.toMatch(/\b[1-9]\d{0,2},\d{3}\b/);
  });

  it('the check itself catches English', () => {
    const p = document.createElement('p');
    p.textContent = 'Each expert reads the stream of the layer.';
    expect(giveaways(prose(p)).length).toBeGreaterThan(0);
  });
});
