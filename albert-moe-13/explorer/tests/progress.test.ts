// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MILESTONES, PROGRESS_KEY, markDone, progress, resetProgress } from '../src/mastery/progress';
import { createProgressMap } from '../src/ui/progressMap';
import { createSidebar } from '../src/ui/sidebar';
import { setLang, t } from '../src/ui/prefs';
import { TOUR_IDS } from '../src/ui/strings';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace, type Trace } from '../src/data/trace';
import { buildTower } from '../src/scene/tower';
import { createTourRunner, tourVars, type Measured, type TourDeps } from '../src/tours/engine';
import { tourOf } from '../src/tours/index';
import { residualQuiz } from '../src/tours/residualQuiz';

beforeEach(() => { localStorage.clear(); resetProgress(); });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; setLang('en'); });

describe('mastery progress (Task 14)', () => {
  it('lists a milestone per tour plus the three moments', () => {
    expect(MILESTONES).toEqual([...TOUR_IDS.map((i) => `tour:${i}`), 'predicted:experts', 'traced:attention', 'explained:residual']);
    expect(progress().done).toEqual([]);
    expect(progress().remaining).toEqual([...MILESTONES]);
  });

  it('corrupt storage resets silently', () => {
    for (const bad of ['{not json', 'null', '42', '"x"', '[1,2]', '{"done":"tour:meet"}', '{"done":[1,{}]}']) {
      localStorage.setItem(PROGRESS_KEY, bad);
      expect(() => progress()).not.toThrow();
      expect(progress().done).toEqual([]);
    }
    localStorage.setItem(PROGRESS_KEY, '{oops');
    markDone('tour:meet');
    expect(progress().done).toEqual(['tour:meet']);
  });

  it('markDone is idempotent', () => {
    markDone('predicted:experts');
    markDone('predicted:experts');
    expect(progress().done).toEqual(['predicted:experts']);
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!).done).toEqual(['predicted:experts']);
    expect(progress().remaining).not.toContain('predicted:experts');
  });

  it('drops milestones unknown to the code on load and refuses them in markDone', () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ done: ['tour:meet', 'tour:gone', 'badge:gold', 'tour:meet'] }));
    expect(progress().done).toEqual(['tour:meet']);
    markDone('nope:nope');
    expect(progress().done).toEqual(['tour:meet']);
  });

  it('no score field exists anywhere in progress', () => {
    markDone('tour:meet');
    markDone('traced:attention');
    const p = progress();
    expect(Object.keys(p).sort()).toEqual(['done', 'remaining']);
    const stored = JSON.parse(localStorage.getItem(PROGRESS_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(['done']);
    const all = JSON.stringify([p, stored]);
    expect(all).not.toMatch(/score|points|percent|streak|badge|level|rank/i);
  });

  it('reset clears the storage entry and the list', () => {
    markDone('tour:meet');
    resetProgress();
    expect(progress().done).toEqual([]);
    expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('works when localStorage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => markDone('tour:meet')).not.toThrow();
    expect(progress().done).toEqual(['tour:meet']);
    expect(() => resetProgress()).not.toThrow();
    expect(progress().done).toEqual([]);
  });
});

describe('progress map in the sidebar (Analysis)', () => {
  const make = () => {
    const sb = createSidebar({ win: { innerWidth: 1280 } });
    document.body.append(sb.element, sb.edgeTab);
    const map = createProgressMap();
    sb.body('analysis').append(map.element);
    return { sb, map };
  };

  it('is collapsed by default, has one line per milestone, no score, and a reset button', () => {
    const { sb, map } = make();
    expect(sb.body('analysis').contains(map.element)).toBe(true);
    expect((map.element as HTMLDetailsElement).open).toBe(false);
    expect(map.element.querySelectorAll('li')).toHaveLength(MILESTONES.length);
    expect(map.element.querySelectorAll('li[data-done="true"]')).toHaveLength(0);
    expect(map.element.textContent).not.toMatch(/%|points|\d+\s*\/\s*\d+/i);
    expect(map.element.querySelector('button')!.textContent).toBe(t('progress.reset'));
    map.dispose();
    sb.dispose();
  });

  it('shows a plain check mark for done milestones, updates silently, and resets', () => {
    const { sb, map } = make();
    markDone('tour:meet');
    const li = map.element.querySelector<HTMLElement>('li[data-milestone="tour:meet"]')!;
    expect(li.dataset.done).toBe('true');
    expect(li.textContent).toContain('✓');
    expect(document.querySelector('[role="alert"], [role="status"], .toast')).toBeNull();
    map.element.querySelector<HTMLButtonElement>('button')!.click();
    expect(progress().done).toEqual([]);
    expect(map.element.querySelectorAll('li[data-done="true"]')).toHaveLength(0);
    map.dispose();
    sb.dispose();
  });

  it('is German when DE is selected', () => {
    setLang('de');
    const { sb, map } = make();
    expect(map.element.querySelector('summary')!.textContent).toBe('Fortschritt');
    expect(map.element.querySelector('button')!.textContent).toBe('Zurücksetzen');
    map.dispose();
    sb.dispose();
  });
});

describe('milestones come from real events in the tours', () => {
  const a = validateArchitecture(arch);
  const tower = buildTower(a);
  const traces = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  const kjv: Trace = validateTrace(traces['../public/data/trace/kjv.json'], a);
  const real: Measured = { trace: kjv, position: kjv.provenance.tokens.length - 1 };
  const rig = {
    flyTo: () => Promise.resolve(), overview: () => Promise.resolve(), flyToPose: () => Promise.resolve(), isFlying: () => false,
    pose: () => ({ position: new THREE.Vector3(), target: new THREE.Vector3() }),
  };
  const make = () => createTourRunner({
    arch: a, tower, rig: rig as unknown as TourDeps['rig'], highlight: () => undefined, measured: () => real,
    loadWeights: async () => { throw new Error('no weights'); },
  });
  const card = (): HTMLElement => document.querySelector<HTMLElement>('.tour-card')!;
  const stepOf = (id: 'prediction' | 'attention' | 'three', f: (s: NonNullable<ReturnType<typeof tourOf>>['steps'][number]) => boolean): number =>
    tourOf(id)!.steps.findIndex(f);

  it('a finished tour marks tour:<id>; leaving early does not', () => {
    const r = make();
    r.runTour('meet');
    r.exit();
    expect(progress().done).toEqual([]);
    r.runTour('meet');
    r.exit(true);
    expect(progress().done).toEqual(['tour:meet']);
  });

  it('revealing the experts guess marks predicted:experts', () => {
    const r = make();
    r.runTour('three', stepOf('three', (s) => !!s.action && s.action !== 'free' && s.action.predict === 'experts'));
    expect(progress().done).toEqual([]);
    const picks = card().querySelectorAll<HTMLButtonElement>('.tour-pick');
    for (let i = 0; i < a.model.top_k; i++) picks[i]!.click();
    card().querySelector<HTMLButtonElement>('.tour-reveal')!.click();
    expect(progress().done).toEqual(['predicted:experts']);
    r.exit();
  });

  it('revealing the attention guess marks traced:attention', () => {
    const r = make();
    r.runTour('attention', stepOf('attention', (s) => !!s.action && s.action !== 'free' && s.action.predict === 'attention'));
    card().querySelector<HTMLButtonElement>('.tour-pick')!.click();
    card().querySelector<HTMLButtonElement>('.tour-reveal')!.click();
    expect(progress().done).toEqual(['traced:attention']);
    r.exit();
  });

  it('the residual step has 3 questions; the explanation shows after each pick, with no score; the third answer marks explained:residual', () => {
    expect(residualQuiz).toHaveLength(3);
    const r = make();
    r.runTour('prediction', stepOf('prediction', (s) => s.quiz === 'residual'));
    expect(card().querySelectorAll('.tour-quiz-q')).toHaveLength(3);
    expect(card().querySelectorAll('.tour-quiz-why')).toHaveLength(0);
    for (let q = 0; q < 3; q++) {
      expect(progress().done).toEqual([]);
      // a wrong pick shows the explanation too
      card().querySelector<HTMLButtonElement>(`[data-q="${q}"][data-opt="${q === 0 ? 0 : 1}"]`)!.click();
      expect(card().querySelectorAll('.tour-quiz-why')).toHaveLength(q + 1);
    }
    expect(progress().done).toEqual(['explained:residual']);
    expect(card().textContent).not.toMatch(/correct|wrong|richtig|falsch|%/i);
    r.exit();
  });

  it('quiz answers are answerable from the step text (the numbers named in the answers appear in the text)', () => {
    const step = tourOf('prediction')!.steps.find((s) => s.quiz === 'residual')!;
    const vars = tourVars(a, step);
    for (const d of ['intuition', 'technical'] as const) {
      expect(step.text[d].en.replace('{hidden}', String(vars.hidden))).toContain(String(vars.hidden));
    }
    expect(JSON.stringify(residualQuiz)).not.toMatch(/\d{2,}/);
  });
});
