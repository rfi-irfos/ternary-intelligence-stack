// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import realL12 from '../public/data/weights/L12.json';
import fixture from './fixtures/L12.fixture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace, type Trace } from '../src/data/trace';
import { validateLayerWeights, ternarySlice } from '../src/data/weights';
import { buildTower } from '../src/scene/tower';
import { parseId } from '../src/scene/ids';
import { setLang, setMode, saveTourProgress, tourProgress } from '../src/ui/prefs';
import { setDepth } from '../src/ui/depth';
import { fill, STRINGS, TOUR_IDS } from '../src/ui/strings';
import { CAVEATS } from '../src/content/caveats';
import { createCoachMarks } from '../src/ui/coach';
import { closeLightbox, isLightboxOpen, openLightbox } from '../src/ui/lightbox';
import { closeTourMenu, openTourMenu, setTourPick } from '../src/ui/tourMenu';
import { TOURS, tourOf } from '../src/tours/index';
import { attentionAnswer, createTourRunner, expertsAnswer, gateAnswer, highlightPredicate, tourVars, type Measured, type TourDeps } from '../src/tours/engine';
import { matmulOf, sampleInput } from '../src/tours/figures';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const traces = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const kjv: Trace = validateTrace(traces['../public/data/trace/kjv.json'], a);
const last = kjv.provenance.tokens.length - 1;
const real: Measured = { trace: kjv, position: last };
const realWeights = validateLayerWeights(realL12);

const SPEC_TITLES = [
  'Meet albert.', 'Follow a token', 'Why only three experts?', 'Inside attention',
  'Ternary computation', 'Two streams, one model', 'From embedding to prediction',
];

interface Rig { flyTo: ReturnType<typeof vi.fn>; overview: ReturnType<typeof vi.fn>; pose: ReturnType<typeof vi.fn>; flyToPose: ReturnType<typeof vi.fn>; isFlying: ReturnType<typeof vi.fn> }
function mockRig(): Rig & { moveTo(x: number): void } {
  let x = 0;
  const rig = {
    flyTo: vi.fn((target: THREE.Vector3) => { x = target.x; return Promise.resolve(); }),
    overview: vi.fn(() => { x = -1; return Promise.resolve(); }),
    pose: vi.fn(() => ({ position: new THREE.Vector3(x, 5, 5), target: new THREE.Vector3(x, 0, 0) })),
    flyToPose: vi.fn(() => Promise.resolve()),
    isFlying: vi.fn(() => false),
    moveTo: (v: number) => { x = v; },
  };
  return rig;
}

const runners: { exit(): void }[] = [];
function setup(over: Partial<TourDeps> = {}, m: Measured | null = real) {
  const rig = mockRig();
  const highlight = vi.fn();
  const runner = createTourRunner({
    arch: a, tower, rig: rig as unknown as TourDeps['rig'], highlight, measured: () => m,
    loadWeights: async () => realWeights, ...over,
  });
  runners.push(runner);
  return { rig, highlight, runner };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const card = (): HTMLElement => document.querySelector<HTMLElement>('.tour-card')!;
const click = (sel: string): void => card().querySelector<HTMLButtonElement>(sel)!.click();

beforeEach(() => { localStorage.clear(); setLang('en'); setMode('simple'); setDepth('intuition'); });
afterEach(() => {
  for (const r of runners.splice(0)) r.exit();
  closeTourMenu();
  setTourPick(null);
  document.body.innerHTML = '';
  document.body.className = '';
  setLang('en');
  setMode('simple');
  setDepth('intuition');
});

describe('the seven tours', () => {
  it('all 7 tours exist with spec titles, in spec order, in both languages', () => {
    expect(TOURS).toHaveLength(7);
    expect(TOURS.map((x) => x.id)).toEqual([...TOUR_IDS]);
    expect(TOURS.map((x) => x.title)).toEqual(SPEC_TITLES);
    setLang('de');
    expect(TOURS.map((x) => x.title)).toEqual([
      'Lerne albert. kennen', 'Einem Wort folgen', 'Warum nur drei Experten?', 'Ein Blick in die Aufmerksamkeit',
      'Rechnen mit −1, 0 und +1', 'Zwei Ströme, ein Modell', 'Von der Einbettung zur Vorhersage',
    ]);
    console.info(`[tours] steps: ${TOURS.map((x) => `${x.id}=${x.steps.length}`).join(' ')}`);
  });

  it('every camera and highlight id resolves via tower.anchor', () => {
    for (const tour of TOURS) {
      tour.steps.forEach((s, i) => {
        const where = `${tour.id}#${i + 1}`;
        if (s.camera !== 'overview') {
          expect(tower.has(s.camera), `${where} camera ${s.camera}`).toBe(true);
          const p = tower.anchor(s.camera);
          expect([p.x, p.y, p.z].every(Number.isFinite), `${where} anchor`).toBe(true);
        }
        for (const h of s.highlight) expect(tower.has(h), `${where} highlight ${h}`).toBe(true);
        if (s.action && s.action !== 'free') {
          expect(s.action.layer).toBeGreaterThanOrEqual(0);
          expect(s.action.layer).toBeLessThan(a.model.num_layers);
          if (s.action.predict === 'gate') expect(a.model.fusion_layers, `${where} gate layer`).toContain(s.action.layer);
        }
        if (s.figure && s.figure.kind !== 'topk') expect(s.figure.layer).toBeLessThan(a.model.num_layers);
      });
    }
  });

  it('every step has text at every depth in both languages, and a tour never uses 0-based layer numbers in the simple text', () => {
    for (const tour of TOURS) {
      for (const s of tour.steps) {
        for (const d of ['intuition', 'technical', 'researcher'] as const) {
          for (const lang of ['en', 'de'] as const) {
            const shown = fill(s.text[d][lang], tourVars(a, s));
            // a real sentence: several words, a closing mark, every placeholder resolved
            expect(shown.split(/\s+/).length, `${tour.id} ${d} ${lang}`).toBeGreaterThanOrEqual(6);
            expect(shown, `${tour.id} ${d} ${lang}`).toMatch(/[.?!)]$/);
            expect(shown, `${tour.id} ${d} ${lang} unresolved placeholder`).not.toMatch(/\{\w+\}/);
            expect(shown, `${tour.id} ${d} ${lang} undefined`).not.toMatch(/undefined|NaN|\[object/);
          }
        }
      }
    }
    // {layer} is 1-based ("Ebene 13" for L12), {index} the 0-based id for Advanced details.
    const step = tourOf('three')!.steps[2]!;
    expect(tourVars(a, step).layer).toBe(13);
    expect(tourVars(a, step).index).toBe(12);
    expect(tourVars(a).gates).toBe(a.model.fusion_layers.map((l) => l + 1).join(', '));
  });

  it('two_streams cites A1 and A2', () => {
    const text = tourOf('streams')!.steps.map((s) => `${s.text.intuition.en} ${s.text.technical.en}`).join(' ');
    expect(text).toContain('A1');
    expect(text).toContain('A2');
  });

  it('the texts name the facts of the architecture file', () => {
    const v = tourVars(a);
    expect(v).toMatchObject({ layers: 46, streams: 2, experts: 12, topk: 3, gateCount: 7 });
    expect(v.gates).toBe('3, 4, 6, 9, 14, 22, 35');
    expect(v.params).toBe('331,140,622');
  });

  it('German tour texts have no English giveaways and no negation words (steps at every depth, tour* strings)', () => {
    const giveaways = [' the ', ' and ', ' of ', 'which', 'each', 'stream '];
    const negations = [/\bnicht/i, /\bnichts\b/i, /\bkein/i, /\bohne\b/i, /\bnie\b/i, /\bniemals\b/i, /\bweder\b/i];
    // Verbatim technical terms that contain a negation word. Keep this list empty unless a term cannot be reworded.
    const allowed: string[] = [];
    const scrub = (x: string): string => allowed.reduce((acc, w) => acc.split(w).join(''), x);
    for (const tour of TOURS) {
      for (const s of tour.steps) {
        for (const d of ['intuition', 'technical', 'researcher'] as const) {
          const de = ` ${scrub(s.text[d].de).toLowerCase()} `;
          for (const g of giveaways) expect(de.includes(g), `${tour.id} ${d} ${g}`).toBe(false);
          for (const n of negations) expect(n.test(de), `${tour.id} ${d} ${n} in ${de}`).toBe(false);
        }
      }
    }
    const keys = (Object.keys(STRINGS.de) as (keyof typeof STRINGS.de)[]).filter((k) => /^tour(card|pred|fig|quiz|menu)?\./.test(k));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      const e = STRINGS.de[k];
      const texts = typeof e === 'string' ? [e] : [e.simple, e.advanced];
      for (const x of texts) {
        const de = ` ${scrub(x).toLowerCase()} `;
        for (const n of negations) expect(n.test(de), `${k} ${n} in ${de}`).toBe(false);
      }
    }
  });

  it('a tour or caveat never names a layer by its 0-based number without the word index', () => {
    // "layer 35, index 34" is fine; a bare "layer 34" for the gate at index 34 is not.
    const zeroBased = new Set(a.model.fusion_layers);
    const bare = /\b(?:layers?|Ebenen?)\s+(\d+)\b(?![^.;]{0,60}\b(?:[Ii]ndex|Advanced|Erweitert|0-based))/g;
    const check = (where: string, text: string, lang: 'en' | 'de'): void => {
      for (const m of text.matchAll(bare)) {
        const n = Number(m[1]);
        // a literal number is only allowed when it is the 1-based number of a fusion layer
        const oneBasedGate = zeroBased.has(n - 1);
        expect(oneBasedGate, `${where} (${lang}): "${m[0]}" looks 0-based`).toBe(true);
      }
    };
    for (const tour of TOURS) {
      for (const [i, s] of tour.steps.entries()) {
        for (const d of ['intuition', 'technical', 'researcher'] as const) {
          for (const lang of ['en', 'de'] as const) check(`${tour.id}#${i} ${d}`, s.text[d][lang], lang);
        }
      }
    }
    for (const [id, c] of Object.entries(CAVEATS)) {
      for (const lang of ['en', 'de'] as const) check(`caveat ${id} body`, c.body[lang], lang);
    }
    // the gate caveat itself carries the label
    expect(CAVEATS.A2.body.en).toMatch(/layer 35, index 34/);
  });

});

describe('prediction answers come from the trace and are measured', () => {
  it('experts: the recorded top-3 and softmax shares of the router event', () => {
    const ev = kjv.events.find((e) => e.type === 'router' && e.layer === 12 && e.stream === 'a');
    if (ev?.type !== 'router') throw new Error('no router event');
    const ans = expertsAnswer(real, 12, 'A')!;
    expect(ans.experts).toEqual(ev.top3[last]);
    expect(ans.shares).toEqual(ev.weights[last]);
    const evB = kjv.events.find((e) => e.type === 'router' && e.layer === 12 && e.stream === 'b');
    if (evB?.type !== 'router') throw new Error('no router event');
    expect(expertsAnswer(real, 12, 'B')!.experts).toEqual(evB.top3[last]);
  });

  it('attention: the argmax over earlier keys of the recorded row', () => {
    const ev = kjv.events.find((e) => e.type === 'attention' && e.layer === 12 && e.stream === 'a' && e.head === 0);
    if (ev?.type !== 'attention') throw new Error('no attention event');
    const row = ev.weights[last]!;
    let best = 0;
    for (let j = 1; j < last; j++) if (row[j]! > row[best]!) best = j;
    const ans = attentionAnswer(real, 12, 'A', 0)!;
    expect(ans).toEqual({ kind: 'token', index: best, share: row[best] });
    expect(attentionAnswer({ trace: kjv, position: 0 }, 12, 'A', 0)).toEqual({ kind: 'first' });
  });

  it('gate: g_a against g_b at the word', () => {
    const ev = kjv.events.find((e) => e.type === 'gate' && e.layer === 13);
    if (ev?.type !== 'gate') throw new Error('no gate event');
    const ans = gateAnswer(real, 13)!;
    expect(ans.gA).toBe(ev.g_a[last]);
    expect(ans.gB).toBe(ev.g_b[last]);
    expect(ans.wider).toBe(ev.g_a[last]! > ev.g_b[last]! ? 'A' : ev.g_a[last]! < ev.g_b[last]! ? 'B' : 'equal');
  });

  it('test data (fixture mode) and a missing run give no answer: nothing is invented', () => {
    const fx: Trace = { ...kjv, provenance: { ...kjv.provenance, mode: 'fixture' } };
    expect(expertsAnswer({ trace: fx, position: last }, 12, 'A')).toBeNull();
    expect(gateAnswer({ trace: fx, position: last }, 13)).toBeNull();
    expect(attentionAnswer({ trace: fx, position: last }, 12, 'A', 0)).toBeNull();
    expect(expertsAnswer(null, 12, 'A')).toBeNull();
  });

  it('the experts moment: pick 3 cabinets, then the measured answer appears beside the pick, labelled measured', async () => {
    const { runner } = setup();
    runner.runTour('three', 2);
    await flush();
    const body = card().querySelector<HTMLElement>('.tour-pred')!;
    expect(body.querySelectorAll('.tour-pick')).toHaveLength(a.model.num_experts);
    expect(body.textContent).not.toContain('Measured');
    const reveal = body.querySelector<HTMLButtonElement>('.tour-reveal')!;
    expect(reveal.disabled).toBe(true);
    for (const e of [0, 1, 2]) card().querySelector<HTMLButtonElement>(`[data-expert="${e}"]`)!.click();
    expect(card().querySelectorAll('.tour-pick[aria-pressed="true"]')).toHaveLength(3);
    // a fourth pick is ignored
    card().querySelector<HTMLButtonElement>('[data-expert="3"]')!.click();
    expect(card().querySelectorAll('.tour-pick[aria-pressed="true"]')).toHaveLength(3);
    click('.tour-reveal');
    const rows = [...card().querySelectorAll('.tour-pred-row')].map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Your pick');
    expect(rows[0]).toMatch(/0.*1.*2/);
    expect(rows[1]).toContain('Measured');
    const ans = expertsAnswer(real, 12, 'A')!;
    for (const e of ans.experts) expect(rows[1]).toContain(String(e));
    expect(card().querySelector('.tour-pred-row .kind-tag[data-kind="measured"]')).not.toBeNull();
    // no score anywhere
    expect(card().textContent).not.toMatch(/\b(score|points|correct|wrong)\b/i);
  });

  it('without a recorded run the moment says so and shows no answer', async () => {
    const { runner } = setup({}, null);
    runner.runTour('three', 2);
    await flush();
    expect(card().querySelector('.tour-pred')!.textContent).toContain('No recorded run');
    expect(card().querySelector('.tour-pick')).toBeNull();
  });

  it('the attention moment and the gate moment reveal their measured answers', async () => {
    const { runner } = setup();
    const att = tourOf('attention')!.steps.findIndex((s) => s.action !== undefined && s.action !== 'free');
    runner.runTour('attention', att);
    await flush();
    const ans = attentionAnswer(real, 12, 'A', 0);
    if (ans?.kind !== 'token') throw new Error('expected a token answer');
    const wrong = [...card().querySelectorAll<HTMLButtonElement>('.tour-pick')].find((b) => b.dataset.token !== String(ans.index))!;
    const right = card().querySelector<HTMLButtonElement>(`.tour-pick[data-token="${ans.index}"]`);
    expect(right, 'the recorded answer sits inside the 15-word pick window').not.toBeNull();
    // a miss: the pick is shown, without the match mark
    wrong.click();
    click('.tour-reveal');
    expect(card().querySelector('.tour-hit')).toBeNull();
    expect(card().querySelector('.tour-pred')!.textContent).not.toContain('✓');
    expect(card().querySelector('.tour-pred')!.textContent).toContain(`word ${ans.index + 1}`);
    // a hit: the same moment again, picking the recorded word
    click('[data-act="again"]');
    card().querySelector<HTMLButtonElement>(`.tour-pick[data-token="${ans.index}"]`)!.click();
    click('.tour-reveal');
    expect(card().querySelector('.tour-hit')).not.toBeNull();
    expect(card().querySelector('.tour-pred')!.textContent).toContain('✓');
    expect(card().querySelector('.kind-tag[data-kind="measured"]')).not.toBeNull();
    const gate = tourOf('streams')!.steps.findIndex((s) => s.action !== undefined && s.action !== 'free');
    runner.runTour('streams', gate);
    await flush();
    card().querySelector<HTMLButtonElement>('[data-gate="A"]')!.click();
    click('.tour-reveal');
    const g = gateAnswer(real, 13)!;
    expect(card().querySelector('.tour-pred')!.textContent).toContain(`g_a = ${g.gA.toFixed(3)}`);
  });

  it('a click on a cabinet in the scene answers the experts moment and opens nothing else', async () => {
    const { runner } = setup();
    runner.runTour('three', 2);
    await flush();
    expect(runner.handlePick('L12.expert.5')).toBe(true);
    expect(runner.handlePick('L12.expert.5.c_fc')).toBe(true); // a part of the cabinet: deselects again
    expect(card().querySelectorAll('.tour-pick[aria-pressed="true"]')).toHaveLength(0);
    expect(runner.handlePick('L11.expert.5')).toBe(false);
    expect(runner.handlePick('L12.A.attn')).toBe(false);
    runner.runTour('three', 0);
    expect(runner.handlePick('L12.expert.5')).toBe(false);
  });
});

describe('running a tour', () => {
  it('the camera moves only after the user started or stepped, and only to that step', async () => {
    const { rig, runner } = setup();
    expect(rig.flyTo).not.toHaveBeenCalled();
    expect(rig.overview).not.toHaveBeenCalled();
    runner.runTour('follow', 0);
    await flush();
    expect(rig.flyTo).toHaveBeenCalledTimes(1);
    expect(rig.flyTo.mock.calls[0]![0]).toEqual(tower.anchor('embed'));
    click('[data-act="next"]');
    await flush();
    expect(rig.flyTo).toHaveBeenCalledTimes(2);
    click('[data-act="back"]');
    await flush();
    expect(rig.flyTo).toHaveBeenCalledTimes(3);
    // changing the language or the depth repaints but never flies
    setLang('de');
    setMode('advanced');
    await flush();
    expect(rig.flyTo).toHaveBeenCalledTimes(3);
  });

  it('highlights the step parts and clears them on exit', async () => {
    const { highlight, runner } = setup();
    runner.runTour('meet', 1);
    await flush();
    const pred = highlight.mock.calls.at(-1)![0] as (id: string) => boolean;
    expect(pred('embed')).toBe(true);
    expect(pred('L3')).toBe(false);
    runner.exit();
    expect(highlight.mock.calls.at(-1)![0]).toBeNull();
    expect(highlightPredicate([])).toBeNull();
    expect(highlightPredicate(['L12.A.attn'])!('L12.A.attn.q')).toBe(true);
    expect(highlightPredicate(['L12.A.attn'])!('L12.A.attn2')).toBe(false);
  });

  it('progress is saved at every step; resume starts at the saved step; a finished tour starts again from step 1', async () => {
    const { runner } = setup();
    runner.runTour('follow');
    await flush();
    expect(tourProgress('follow')).toBe(0);
    click('[data-act="next"]');
    click('[data-act="next"]');
    expect(tourProgress('follow')).toBe(2);
    expect(card().querySelector('.tour-card-count')!.textContent).toBe('Step 3 of 8');
    runner.exit();
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(tourProgress('follow')).toBe(2);
    runner.resume('follow');
    await flush();
    expect(runner.step()).toBe(2);
    expect(card().querySelector('.tour-card-count')!.textContent).toBe('Step 3 of 8');
    runner.runTour('follow', 99);
    expect(runner.step()).toBe(7);
    expect(card().querySelector('[data-act="next"]')!.textContent).toBe('Finish');
    click('[data-act="next"]');
    expect(runner.active()).toBeNull();
    expect(tourProgress('follow')).toBe(0);
    runner.resume('follow');
    expect(runner.step()).toBe(0);
  });

  it('the menu shows the saved step and offers Start over; both reach the engine', async () => {
    saveTourProgress('attention', 2);
    const picks: [string, boolean][] = [];
    setTourPick((id, restart) => { picks.push([id, restart]); });
    const el = openTourMenu();
    const item = el.querySelector<HTMLButtonElement>('[data-tour="attention"]')!;
    expect(item.querySelector('.tour-soon')!.textContent).toBe('Continue at step 3 of 6');
    expect(el.querySelector<HTMLButtonElement>('[data-tour-restart="attention"]')!.hidden).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('[data-tour-restart="meet"]')!.hidden).toBe(true);
    item.click();
    el.querySelector<HTMLButtonElement>('[data-tour-restart="attention"]')!.click();
    expect(picks).toEqual([['attention', false], ['attention', true]]);
  });

  it('Esc leaves the tour, stops there, and focus returns to the trigger', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { runner } = setup();
    runner.runTour('meet', 0, { returnFocus: trigger });
    await flush();
    expect(document.body.classList.contains('tour-open')).toBe(true);
    expect(document.activeElement).toBe(card().querySelector('[data-act="next"]'));
    const later = vi.fn();
    document.addEventListener('keydown', later);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(later).not.toHaveBeenCalled();
    expect(runner.active()).toBeNull();
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(document.body.classList.contains('tour-open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    // Esc outside a tour is left to the others
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(later).toHaveBeenCalledTimes(1);
    // the Exit button does the same
    runner.runTour('meet', 0, { returnFocus: trigger });
    click('[data-act="exit"]');
    expect(runner.active()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('one Esc closes only the topmost layer: an open lightbox or coach first, the tour with the next Esc', async () => {
    const esc = (): void => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    const { runner } = setup();
    runner.runTour('meet', 0);
    await flush();
    openLightbox({ src: 'x.png' });
    expect(isLightboxOpen()).toBe(true);
    esc();
    expect(isLightboxOpen()).toBe(false);
    expect(runner.active()).toBe('meet');
    esc();
    expect(runner.active()).toBeNull();

    localStorage.clear();
    const coach = createCoachMarks([{ key: 'coach.play' as const, target: () => null }]);
    runner.runTour('meet', 0);
    await flush();
    expect(coach.element).not.toBeNull();
    document.body.append(coach.element!);
    esc();
    expect(document.querySelector('.coach')).toBeNull();
    expect(runner.active()).toBe('meet');
    esc();
    expect(runner.active()).toBeNull();

    // a handler that only calls preventDefault also keeps the tour open
    runner.runTour('meet', 0);
    await flush();
    const other = (e: KeyboardEvent): void => { if (e.key === 'Escape') e.preventDefault(); };
    window.addEventListener('keydown', other, true);
    esc();
    window.removeEventListener('keydown', other, true);
    expect(runner.active()).toBe('meet');
    closeLightbox();
  });

  it('leaving during the first flight restores the original pose; a camera the visitor moved stays', async () => {
    // 1. the first flight has not landed and the camera is still on its way
    const one = setup();
    one.rig.moveTo(7);
    let release: () => void = () => undefined;
    one.rig.overview.mockImplementation(() => new Promise<void>((res) => { release = res; }));
    one.rig.isFlying.mockReturnValue(true);
    one.runner.runTour('meet', 0);
    await flush();
    one.runner.exit();
    expect(one.rig.flyToPose).toHaveBeenCalledTimes(1);
    expect((one.rig.flyToPose.mock.calls[0]![0] as { position: THREE.Vector3 }).position.x).toBe(7);
    release();
    document.body.innerHTML = '';

    // 2. no flight landed and the visitor has moved the camera since: it stays
    const two = setup();
    two.rig.moveTo(7);
    two.rig.overview.mockImplementation(() => new Promise<void>(() => undefined));
    two.runner.runTour('meet', 0);
    await flush();
    two.rig.moveTo(55);
    two.runner.exit();
    expect(two.rig.flyToPose).not.toHaveBeenCalled();
  });

  it('leaving restores the pre-tour pose only while the camera still sits where the tour left it', async () => {
    const one = setup();
    one.rig.moveTo(7);
    one.runner.runTour('meet', 1);
    await flush();
    one.runner.exit();
    expect(one.rig.flyToPose).toHaveBeenCalledTimes(1);
    expect((one.rig.flyToPose.mock.calls[0]![0] as { position: THREE.Vector3 }).position.x).toBe(7);
    document.body.innerHTML = '';

    const two = setup();
    two.rig.moveTo(7);
    two.runner.runTour('meet', 1);
    await flush();
    two.rig.moveTo(123); // the visitor orbited
    two.runner.exit();
    expect(two.rig.flyToPose).not.toHaveBeenCalled();
  });

  it('the card text follows the language and the mode, and Advanced shows the 0-based index', async () => {
    const { runner } = setup();
    runner.runTour('three', 2);
    await flush();
    const text = (): string => card().querySelector('.tour-text')!.textContent ?? '';
    expect(text()).toContain('Your turn');
    expect(card().querySelector('.tour-index')).toBeNull();
    expect(card().querySelector('.tour-prompt')!.textContent).toContain('layer 13');
    setMode('advanced');
    setDepth('technical');
    expect(text()).toContain('Prediction');
    expect(card().querySelector('.tour-index')!.textContent).toContain('12');
    setLang('de');
    expect(text()).toContain('Vorhersage');
    expect(card().querySelector('.tour-card-title')!.textContent).toBe('Warum nur drei Experten?');
    expect(card().querySelector('[data-act="exit"]')!.textContent).toBe('Tour beenden');
    expect(card().querySelector('.tour-prompt')!.textContent).toContain('Ebene 13');
  });
});

describe('real data in the figures', () => {
  it('the ternary tour shows the real 4x4 corner and gamma of the layer file, an illustrative input, and the computed output', async () => {
    const { runner } = setup();
    runner.runTour('ternary', 0);
    await flush();
    const fig = card().querySelector('.tour-fig-matmul')!;
    const name = 'stream_a.attn.q_proj.weight';
    const sl = ternarySlice(realWeights, name)!;
    const tile = (realL12 as { matrices: { name: string; tile: string[]; gamma: number }[] }).matrices.find((m) => m.name === name)!;
    // W cells = the first four characters of the first four tile rows
    const want = tile.tile.slice(0, 4).flatMap((r) => [...r.slice(0, 4)]);
    const cells = [...fig.querySelectorAll('.tour-mm-w .tour-mm-cell')].map((c) => c.textContent);
    expect(cells).toEqual(want.map((ch) => (ch === '+' ? '+1' : ch === '-' ? '−1' : '0')));
    expect(sl.gamma).toBe(tile.gamma);
    expect(fig.textContent).toContain(tile.gamma.toFixed(4));
    const y = matmulOf(sl.w, sampleInput(12 * 131 + name.length), tile.gamma);
    expect(y).toHaveLength(4);
    const outs = [...fig.querySelectorAll('.tour-mm-v')][1]!.querySelectorAll('.tour-mm-cell');
    expect(outs).toHaveLength(4);
    // labels: structure for W and gamma, illustrative for x and the output
    const caps = [...fig.querySelectorAll('.tour-fig-cap')].map((c) => `${c.textContent}`);
    expect(caps.some((c) => c.includes('structure') && c.includes(name))).toBe(true);
    expect(caps.some((c) => c.includes('illustrative') && c.includes('example'))).toBe(true);
  });

  it('the fractions chart reads -1/0/+1 shares from the layer file', async () => {
    const { runner } = setup();
    const i = tourOf('ternary')!.steps.findIndex((s) => s.figure?.kind === 'fractions');
    runner.runTour('ternary', i);
    await flush();
    const rows = card().querySelectorAll('.tour-frac-row');
    expect(rows).toHaveLength(6);
    const m = (realL12 as { matrices: { name: string; frac_neg: number; frac_zero: number; frac_pos: number }[] }).matrices.find((x) => x.name === 'stream_a.attn.q_proj.weight')!;
    const row = card().querySelector('[data-matrix="stream_a.attn.q_proj.weight"]')!;
    expect(row.querySelector<HTMLElement>('.tour-frac-neg')!.style.width).toBe(`${(m.frac_neg * 100).toFixed(2)}%`);
    expect(row.querySelector<HTMLElement>('.tour-frac-zero')!.style.width).toBe(`${(m.frac_zero * 100).toFixed(2)}%`);
    expect(row.querySelector('.tour-frac-nums')!.textContent).toContain('%');
  });

  it('the last tour shows the recorded top-5 as measured, and says so when no run is loaded', async () => {
    const i = tourOf('prediction')!.steps.findIndex((s) => s.figure?.kind === 'topk');
    const one = setup();
    one.runner.runTour('prediction', i);
    await flush();
    expect(card().querySelectorAll('.tour-topk li')).toHaveLength(5);
    expect(card().querySelector('.kind-tag[data-kind="measured"]')).not.toBeNull();
    one.runner.exit();
    const two = setup({}, null);
    two.runner.runTour('prediction', i);
    await flush();
    expect(card().querySelector('.tour-topk')).toBeNull();
    expect(card().querySelector('.tour-fig-topk')!.textContent).toContain('No recorded run');
  });

  it('a layer weight file that fails to load leaves a note and invents nothing', async () => {
    const { runner } = setup({ loadWeights: () => Promise.reject(new Error('offline')) });
    runner.runTour('ternary', 0);
    await flush();
    expect(card().querySelector('.tour-mm')).toBeNull();
    expect(card().querySelector('.tour-figure')!.textContent).toContain('weight file');
  });

  it('ternarySlice reads F32 matrices and short tiles as null', () => {
    expect(ternarySlice(realWeights, 'stream_a.moe.gate.weight')).toBeNull();
    expect(ternarySlice(realWeights, 'missing')).toBeNull();
    expect(ternarySlice(validateLayerWeights(fixture), 'stream_a.attn.q_proj.weight')).not.toBeUndefined();
  });
});
