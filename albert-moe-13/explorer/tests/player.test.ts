// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace } from '../src/data/trace';
import { attachDepthKeys, getDepth, setDepth } from '../src/ui/depth';
import { buildTimeline } from '../src/flow/timeline';
import { buildTower } from '../src/scene/tower';
import {
  NO_TRACE_TEXT, OP_SECONDS, QUICK_PASS_SECONDS, createPlayer, createPlayerBar, formatClock, opRole, quickGroups, quickSeconds, stepLayer,
} from '../src/ui/player';
import { timelineLength } from '../src/flow/timeline';
import { setLang, setMode } from '../src/ui/prefs';
import { MAX_FRAME_FULL, MAX_FRAME_QUICK } from '../src/ui/player';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const trace = (id: string) => validateTrace(modules[`../public/data/trace/${id}.json`], a);
const ops = buildTimeline(trace('kjv'), a, 3);

afterEach(() => {
  document.body.innerHTML = '';
  setLang('en');
  setMode('simple');
  localStorage.clear();
});

/** tick() clamps dt to 0.1 s, so advance in frames of that size. */
const run = (p: ReturnType<typeof createPlayer>, seconds: number): void => {
  for (let t = 0; t < seconds - 1e-9; t += 0.1) p.tick(0.1);
};

describe('createPlayer', () => {
  it('steps, scrubs and clamps', () => {
    const seen: number[] = [];
    const p = createPlayer(ops, (_o, i) => seen.push(i));
    p.scrub(5);
    p.step(1);
    p.step(-2);
    expect(p.index()).toBe(4);
    p.scrub(-9);
    expect(p.index()).toBe(0);
    p.scrub(99999);
    expect(p.index()).toBe(ops.length - 1);
    expect(seen.slice(0, 3)).toEqual([5, 6, 4]);
  });

  it('plays with speed, pauses at the end and restarts', () => {
    const p = createPlayer(ops, () => undefined);
    p.scrub(0);
    p.play();
    run(p, OP_SECONDS * 3);
    expect(p.index()).toBe(3);
    p.setSpeed(4);
    run(p, OP_SECONDS);
    expect(p.index()).toBe(7);
    p.pause();
    run(p, 10);
    expect(p.index()).toBe(7);
    p.scrub(ops.length - 2);
    p.play();
    run(p, OP_SECONDS * 20);
    expect(p.index()).toBe(ops.length - 1);
    expect(p.playing()).toBe(false);
    p.play();
    expect(p.index()).toBe(0);
  });

  it('jumps to a layer and to the next op of a kind (wrapping)', () => {
    const p = createPlayer(ops, () => undefined);
    expect(p.jumpToLayer(12)).toBe(true);
    expect(ops[p.index()]?.layer).toBe(12);
    expect(p.jumpToLayer(99)).toBe(false);
    p.scrub(0);
    expect(p.jumpToNext('gate')).toBe(true);
    expect(ops[p.index()]?.layer).toBe(2);
    p.jumpToNext('gate');
    expect(ops[p.index()]?.layer).toBe(3);
    p.scrub(ops.length - 1);
    p.jumpToNext('embed');
    expect(p.index()).toBe(0);
  });

  it('clamps a huge dt to one frame', () => {
    const p = createPlayer(ops, () => undefined);
    p.scrub(0);
    p.play();
    p.tick(100);
    expect(p.index()).toBeLessThanOrEqual(1);
  });

  it('camera mode and speed are settable', () => {
    const p = createPlayer(ops, () => undefined);
    expect(p.cameraMode()).toBe('free');
    p.setCameraMode('overview');
    p.setSpeed(0.5);
    expect(p.cameraMode()).toBe('overview');
    expect(p.speed()).toBe(0.5);
  });
});

describe('player bar', () => {
  it('shows "no measured trace available" when nothing loads', async () => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(), overview: vi.fn() }, animator: { show: vi.fn() },
      load: () => Promise.reject(new Error('404')),
    });
    await bar.ready;
    expect(bar.element.textContent).toBe(NO_TRACE_TEXT);
    expect(bar.player()).toBeNull();
  });

  it('lists the three prompts, decoded tokens, and labels measured numbers', async () => {
    setMode('advanced');
    const show = vi.fn();
    const flyTo = vi.fn(() => Promise.resolve());
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo, overview: vi.fn(() => Promise.resolve()) }, animator: { show },
      load: (id) => Promise.resolve(trace(id)),
    });
    document.body.appendChild(bar.element);
    await bar.ready;
    const [prompt, token] = bar.session.querySelectorAll('select');
    expect([...(prompt?.options ?? [])].map((o) => o.value)).toEqual(['kjv', 'de', 'ternary']);
    expect(token?.options[1]?.textContent).toContain('" the"');
    expect(bar.player()?.ops).toHaveLength(655);
    bar.player()?.jumpToNext('router');
    const lv = bar.session.querySelector('.player-details .lv');
    expect(lv?.getAttribute('data-kind')).toBe('measured');
    expect(show).toHaveBeenCalled();
    expect(flyTo).not.toHaveBeenCalled(); // free camera by default
  });

  function make(extra: Partial<Parameters<typeof createPlayerBar>[0]> = {}) {
    const flyTo = vi.fn(() => Promise.resolve());
    const overview = vi.fn(() => Promise.resolve());
    const show = vi.fn();
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo, overview }, animator: { show },
      load: (id) => Promise.resolve(trace(id)), ...extra,
    });
    document.body.appendChild(bar.element);
    return { bar, flyTo, overview };
  }
  const click = (bar: { element: HTMLElement }, action: string): void => {
    bar.element.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.click();
  };

  it('text rows read cleanly (embed row, experts row)', async () => {
    setMode('advanced');
    const { bar } = make();
    await bar.ready;
    const p = bar.player();
    p?.scrub(0);
    const embed = bar.session.querySelector('.player-row')?.textContent ?? '';
    expect(embed).toMatch(/^token "[^"]*" id \d+$/);
    p?.jumpToNext('experts');
    const experts = bar.session.querySelector('.player-row')?.textContent ?? '';
    expect(experts).toMatch(/^lit 3 of 12 experts: E\d+, E\d+, E\d+$/);
  });

  it('does not move the camera on load or on prompt/token change; free is the default', async () => {
    const { bar, flyTo, overview } = make();
    await bar.ready;
    const [prompt, token] = bar.session.querySelectorAll('select');
    expect(bar.player()?.cameraMode()).toBe('free');
    if (prompt) { prompt.value = 'de'; prompt.dispatchEvent(new Event('change')); }
    if (token) { token.value = '1'; token.dispatchEvent(new Event('change')); }
    expect(flyTo).not.toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
    // user steps while free: still no flight
    click(bar, 'next');
    expect(flyTo).not.toHaveBeenCalled();
  });

  it('flies on Play, Step and scrub only in follow mode', async () => {
    const { bar, flyTo } = make();
    await bar.ready;
    const cam = bar.session.querySelector('select.player-camera') as HTMLSelectElement;
    cam.value = 'follow';
    cam.dispatchEvent(new Event('change'));
    flyTo.mockClear();
    bar.player()?.scrub(0); // programmatic, not a user action
    expect(flyTo).not.toHaveBeenCalled();
    click(bar, 'next');
    const range = bar.session.querySelector('input[type=range]') as HTMLInputElement;
    range.value = '40';
    range.dispatchEvent(new Event('input'));
    expect(flyTo).toHaveBeenCalled();
  });
});

describe('depth keys vs form controls', () => {
  it('a digit on a focused <select> does not change the depth', () => {
    setDepth('intuition');
    const off = attachDepthKeys(document);
    const sel = document.createElement('select');
    document.body.appendChild(sel);
    sel.focus();
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(getDepth()).toBe('intuition');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(getDepth()).toBe('researcher');
    off();
    setDepth('intuition');
  });
});

describe('quick pass (Simple and the lobby\'s Watch)', () => {
  it('keeps every recorded op in order and only changes the pacing: one pass in 60-90 s at 1x', () => {
    expect(ops.length).toBe(timelineLength(a));
    expect(QUICK_PASS_SECONDS).toBeGreaterThanOrEqual(60);
    expect(QUICK_PASS_SECONDS).toBeLessThanOrEqual(90);
    const secs = quickSeconds(ops);
    expect(secs).toHaveLength(ops.length);
    expect(secs.reduce((x, y) => x + y, 0)).toBeCloseTo(QUICK_PASS_SECONDS, 6);
    // Groups: one before the layers (embed), one per layer, one after (merge, ln_f, lm_head).
    const g = quickGroups(ops);
    expect(new Set(g).size).toBe(a.model.num_layers + 2);
    ops.forEach((o, k) => { if (o.layer !== undefined) expect(g[k]).toBe(o.layer + 1); });
    // Every group gets the same time.
    const per = new Map<number, number>();
    g.forEach((x, k) => per.set(x, (per.get(x) ?? 0) + secs[k]!));
    for (const v of per.values()) expect(v).toBeCloseTo(QUICK_PASS_SECONDS / (a.model.num_layers + 2), 6);
    // The full pace would take 6.5 minutes.
    expect(ops.length * OP_SECONDS).toBeGreaterThan(6 * 60);
  });

  it('a quick run visits every op and ends after about QUICK_PASS_SECONDS; the full pace takes ops x 0.6 s', () => {
    const seen = new Set<number>();
    const p = createPlayer(ops, (_o, i) => seen.add(i));
    p.setPace('quick');
    expect(p.pace()).toBe('quick');
    p.scrub(0);
    p.play();
    run(p, QUICK_PASS_SECONDS - 2);
    expect(p.playing()).toBe(true);
    run(p, 3);
    expect(p.playing()).toBe(false);
    expect(seen.size).toBe(ops.length);
    const f = createPlayer(ops, () => undefined);
    expect(f.pace()).toBe('full');
    f.play();
    run(f, QUICK_PASS_SECONDS);
    expect(f.index()).toBeLessThan(ops.length / 3);
  });

  it('the bar: Play in Simple runs the quick pass and says so; Play in Advanced keeps the full pace', async () => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    document.body.append(bar.element);
    await bar.ready;
    const play = bar.element.querySelector<HTMLButtonElement>('[data-action="play"]')!;
    expect(play.title).toContain('Quick pass');
    play.click();
    expect(bar.player()!.pace()).toBe('quick');
    const tag = bar.element.querySelector<HTMLElement>('.quick-tag')!;
    expect(tag.hidden).toBe(false);
    expect(tag.title).toContain(String(bar.player()!.ops.length));
    play.click();
    expect(tag.hidden).toBe(true);
    setMode('advanced');
    expect(bar.player()!.pace()).toBe('full');
    expect(play.title).not.toContain('Quick pass');
    play.click();
    expect(bar.player()!.pace()).toBe('full');
    expect(tag.hidden).toBe(true);
    bar.dispose();
  });
});

describe('quick pass caption and screen-reader behaviour', () => {
  const makeBar = async () => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    document.body.append(bar.element);
    await bar.ready;
    return bar;
  };
  const el = (bar: Awaited<ReturnType<typeof makeBar>>) => ({
    text: bar.element.querySelector<HTMLElement>('.step-text')!,
    line: bar.element.querySelector<HTMLElement>('.step-line')!,
    live: bar.element.querySelector<HTMLElement>('.sr-only')!,
    play: bar.element.querySelector<HTMLButtonElement>('[data-action="play"]')!,
    tag: bar.element.querySelector<HTMLElement>('.quick-tag')!,
    speed: bar.element.querySelector<HTMLButtonElement>('[data-action="speed"]')!,
  });

  it('the caption changes once per layer group: "Layer k of 46 · main op", counted from 1 in Simple', async () => {
    const bar = await makeBar();
    const x = el(bar);
    x.play.click();
    expect(bar.player()!.pace()).toBe('quick');
    const seen: string[] = [];
    let changes = 0;
    let last = x.text.textContent;
    const groups = new Set(quickGroups(bar.player()!.ops));
    for (let i = 0; i < 80 * 20 && bar.player()!.playing(); i++) {
      bar.tick(0.05);
      const now = x.text.textContent;
      if (now !== last) { changes++; seen.push(now ?? ''); last = now; }
    }
    expect(bar.player()!.playing()).toBe(false);
    // At most one change per group (the last repaint at the end of the run shows the per-op sentence).
    expect(changes).toBeLessThanOrEqual(groups.size + 1);
    expect(changes).toBeGreaterThan(a.model.num_layers);
    expect(seen[0]).toMatch(/^Layer 1 of 46 · /);
    expect(seen.some((c) => c.startsWith('Layer 46 of 46 · '))).toBe(true);
    expect(seen.some((c) => /^Layer 0 /.test(c))).toBe(false);
    // The caption is the layer's router (its choice), not a per-op sentence.
    expect(seen[0]).not.toMatch(/Step \d/);
  });

  it('Advanced counts layers from 0 (Watch is a quick pass there too); German uses the strings table', async () => {
    setMode('advanced');
    const bar = await makeBar();
    const x = el(bar);
    bar.watch();
    expect(bar.player()!.pace()).toBe('quick');
    for (let i = 0; i < 200 && !/^Layer 0 of 46 · /.test(x.text.textContent ?? ''); i++) bar.tick(0.25);
    expect(x.text.textContent).toMatch(/^Layer 0 of 46 · /);
    setLang('de');
    expect(x.text.textContent).toMatch(/^Ebene \d+ von 46 · /);
  });

  it('a Watch run that ends by itself in Advanced leaves the next Play at the full pace', async () => {
    setMode('advanced');
    const bar = await makeBar();
    bar.watch();
    expect(bar.player()!.pace()).toBe('quick');
    for (let i = 0; i < 80 * 20 && bar.player()!.playing(); i++) bar.tick(0.05);
    expect(bar.player()!.playing()).toBe(false);
    expect(bar.player()!.pace()).toBe('full');
    bar.player()!.scrub(0);
    bar.player()!.play();
    expect(bar.player()!.pace()).toBe('full');
  });

  it('paused or stepping, the per-op sentence is back; so is the normal pace', async () => {
    const bar = await makeBar();
    const x = el(bar);
    x.play.click();
    for (let i = 0; i < 100; i++) bar.tick(0.05);
    expect(x.text.textContent).toMatch(/^Layer \d+ of 46 · /);
    x.play.click(); // pause
    expect(x.text.textContent).toMatch(/^Step \d+ of \d+ · /);
    setMode('advanced');
    bar.player()!.play();
    expect(bar.player()!.pace()).toBe('full');
    bar.tick(0.7);
    expect(x.text.textContent).toMatch(/^op \d+ \/ \d+ · /); // Advanced wording, per op
  });

  it('screen reader: the step line is silent during a quick pass; one polite announcement per group', async () => {
    const bar = await makeBar();
    const x = el(bar);
    expect(x.line.getAttribute('aria-live')).toBe('polite');
    x.play.click();
    expect(x.line.getAttribute('aria-live')).toBe('off');
    const heard: string[] = [];
    let last = x.live.textContent;
    for (let i = 0; i < 80 * 20 && bar.player()!.playing(); i++) {
      bar.tick(0.05);
      if (x.live.textContent !== last) { last = x.live.textContent; heard.push(last ?? ''); }
    }
    expect(x.live.getAttribute('aria-live')).toBe('polite');
    expect(heard.length).toBeLessThanOrEqual(a.model.num_layers + 2);
    expect(heard.length).toBeGreaterThan(a.model.num_layers);
    expect(new Set(heard).size).toBe(heard.length);
    expect(x.line.getAttribute('aria-live')).toBe('polite'); // run over
  });

  it('quick frame cap is 0.25 s (a slow machine does not stretch the run); the full pace keeps 0.1 s', () => {
    expect(MAX_FRAME_QUICK).toBe(0.25);
    expect(MAX_FRAME_FULL).toBe(0.1);
    const play = (pace: 'quick' | 'full') => {
      const p = createPlayer(ops, () => undefined);
      p.setPace(pace);
      p.scrub(10); // inside a layer: a group of about 13 ops, 0.12 s each in the quick pass
      p.play();
      return p;
    };
    // One very slow frame counts as 0.25 s in the quick pass: the same as four frames of 0.0625 s.
    const slow = play('quick');
    slow.tick(5);
    const fine = play('quick');
    for (let i = 0; i < 4; i++) fine.tick(0.0625);
    expect(slow.index()).toBe(fine.index());
    expect(slow.index()).toBeGreaterThan(10);
    // Full pace: one slow frame still counts only 0.1 s of a 0.6 s op.
    const full = play('full');
    full.tick(5);
    expect(full.index()).toBe(10);
  });

  it('at 4x the tooltip says every step is passed through, and drops "nothing is left out"', async () => {
    const bar = await makeBar();
    const x = el(bar);
    x.play.click();
    expect(x.tag.title).toContain('Nothing is left out');
    x.speed.click(); // 2x
    x.speed.click(); // 4x ... 0.5x -> 1 -> 2 -> 4: from 1x two clicks give 4x
    expect(x.speed.textContent).toBe('4×');
    expect(x.tag.title).toMatch(/every step is passed through/);
    expect(x.tag.title).not.toContain('Nothing is left out');
    expect(x.play.title).not.toContain('Nothing is left out');
    setLang('de');
    expect(x.tag.title).toContain('jeder Schritt wird durchlaufen');
    expect(x.tag.title).not.toContain('Nichts wird weggelassen');
  });
});


describe('run timing (the timeline reads it; nothing is typed in)', () => {
  it('the quick pass is 75 s, the full pace is every op at OP_SECONDS; both start at 0 and end at the duration', () => {
    const p = createPlayer(ops, () => undefined);
    p.setPace('quick');
    expect(p.duration()).toBeCloseTo(QUICK_PASS_SECONDS, 6);
    expect(formatClock(p.duration())).toBe('1:15');
    expect(p.timeOf(0)).toBe(0);
    expect(p.timeOf(ops.length)).toBeCloseTo(p.duration(), 9);
    p.setPace('full');
    expect(p.duration()).toBeCloseTo(ops.length * OP_SECONDS, 6);
    expect(formatClock(p.duration())).toBe(`${Math.floor((ops.length * OP_SECONDS) / 60)}:${String(Math.round((ops.length * OP_SECONDS) % 60)).padStart(2, '0')}`);
  });

  it('elapsed follows the run; indexAtTime inverts timeOf and clamps', () => {
    const p = createPlayer(ops, () => undefined);
    p.setPace('quick');
    p.scrub(0);
    expect(p.elapsed()).toBe(0);
    p.play();
    run(p, 3);
    expect(p.elapsed()).toBeGreaterThan(2.5);
    expect(p.elapsed()).toBeLessThan(3.5);
    expect(p.elapsed()).toBeGreaterThanOrEqual(p.timeOf(p.index()));
    for (const k of [0, 1, 7, 100, 333, ops.length - 1]) expect(p.indexAtTime(p.timeOf(k) + 1e-6)).toBe(k);
    expect(p.indexAtTime(-5)).toBe(0);
    expect(p.indexAtTime(1e9)).toBe(ops.length - 1);
    // every time maps to the op on screen: that op starts at or before it and the next starts after it
    for (const sec of [0.4, 12.3, 40, 74.9]) {
      const k = p.indexAtTime(sec);
      expect(p.timeOf(k)).toBeLessThanOrEqual(sec + 1e-9);
      expect(p.timeOf(k + 1)).toBeGreaterThan(sec - 1e-9);
    }
  });

  it('formatClock is m:ss rounded to the second', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.4)).toBe('0:59');
    expect(formatClock(59.6)).toBe('1:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3600)).toBe('60:00');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('the bar exposes the timing: gate marks at the real gates, layer marks, seeking is the visitor\'s own navigation', async () => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    expect(bar.timing()).toBeNull();
    await bar.ready;
    const tm = bar.timing()!;
    // Simple: the quick pass, 75 s
    expect(tm.duration()).toBeCloseTo(75, 6);
    // One gate op per fusion layer; each mark sits at the start of that op, in order
    const gateOps = bar.player()!.ops.flatMap((o, k) => (o.kind === 'gate' ? [{ o, k }] : []));
    expect(gateOps.map((g) => g.o.layer)).toEqual(a.model.fusion_layers);
    expect(tm.gates()).toHaveLength(a.model.fusion_layers.length);
    expect(tm.gates()).toEqual(gateOps.map((g) => bar.player()!.timeOf(g.k)));
    expect([...tm.gates()].sort((x, y) => x - y)).toEqual(tm.gates());
    expect(tm.layers()).toHaveLength(a.model.num_layers);
    tm.seek(30);
    expect(bar.player()!.index()).toBe(bar.player()!.indexAtTime(30));
    expect(Math.abs(tm.elapsed() - 30)).toBeLessThan(2);
    // Advanced is the full pace: a longer axis
    setMode('advanced');
    expect(bar.timing()!.duration()).toBeCloseTo(ops.length * OP_SECONDS, 6);
    bar.dispose();
  });
});

describe('opRole: colours of the run line follow the legend', () => {
  it('the ends are input / merge / output; the layer ops keep their roles', () => {
    expect(opRole({ kind: 'embed' })).toBe('input');
    expect(opRole({ kind: 'merge' })).toBe('merge');
    expect(opRole({ kind: 'ln_f' })).toBe('merge');
    expect(opRole({ kind: 'lm_head' })).toBe('output');
    expect(opRole({ kind: 'router' })).toBe('router');
    expect(opRole({ kind: 'experts' })).toBe('expert');
    expect(opRole({ kind: 'gate' })).toBe('gate');
  });
});

describe('mini dock', () => {
  const makeDock = async (extra: Partial<Parameters<typeof createPlayerBar>[0]> = {}) => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)), ...extra,
    });
    document.body.append(bar.element);
    await bar.ready;
    return bar;
  };

  it('holds back, a round play button, next, ONE speed button and the layer stepper; the rest lives in the side panel', async () => {
    const bar = await makeDock();
    const controls = [...bar.element.querySelectorAll<HTMLElement>('[data-control]')].map((x) => x.dataset.control);
    expect(controls).toEqual(['prev', 'play', 'next', 'speed', 'layer']);
    expect(bar.element.querySelectorAll('button[data-action="speed"]')).toHaveLength(1);
    expect(bar.element.querySelector('select')).toBeNull();
    expect(bar.element.querySelector('.word-strip')).toBeNull();
    expect(bar.element.querySelector('.sentence-chip')).toBeNull();
    expect(bar.session.querySelector('.word-strip')).not.toBeNull();
    expect(bar.session.querySelector('.sentence-chip')).not.toBeNull();
    expect(bar.display.querySelector('.mode-toggle')).not.toBeNull();
    // Back and Next are always there now (the dock is permanent)
    expect(bar.element.querySelector<HTMLElement>('[data-action="prev"]')!.hidden).toBe(false);
  });

  it('the speed button cycles 0.5 -> 1 -> 2 -> 4 in that order and wraps; its label shows the speed', async () => {
    const bar = await makeDock();
    const speed = bar.element.querySelector<HTMLButtonElement>('[data-action="speed"]')!;
    expect(speed.textContent).toBe('1×');
    const seen: string[] = [];
    const rates: number[] = [];
    for (let i = 0; i < 5; i++) {
      speed.click();
      seen.push(speed.textContent ?? '');
      rates.push(bar.player()!.speed());
    }
    expect(seen).toEqual(['2×', '4×', '0.5×', '1×', '2×']);
    expect(rates).toEqual([2, 4, 0.5, 1, 2]);
    expect(speed.getAttribute('aria-label')).toContain('2');
    setLang('de');
    speed.click();
    expect(speed.textContent).toBe('4×');
  });

  it('the layer stepper shows "‹ 22 / 46 ›", clamps at both ends and reports each real step', async () => {
    const onLayerStep = vi.fn();
    const bar = await makeDock({ onLayerStep });
    const count = bar.element.querySelector<HTMLElement>('.layer-count')!;
    const prev = bar.element.querySelector<HTMLButtonElement>('[data-action="layer-prev"]')!;
    const next = bar.element.querySelector<HTMLButtonElement>('[data-action="layer-next"]')!;
    bar.setLayer(21);
    expect(count.textContent).toBe('22 / 46'); // Simple counts from 1
    next.click();
    expect(count.textContent).toBe('23 / 46');
    expect(onLayerStep).toHaveBeenLastCalledWith(22);
    prev.click();
    prev.click();
    expect(onLayerStep).toHaveBeenLastCalledWith(20);
    bar.setLayer(0);
    expect(prev.disabled).toBe(true);
    onLayerStep.mockClear();
    prev.click();
    expect(onLayerStep).not.toHaveBeenCalled();
    expect(count.textContent).toBe('1 / 46');
    bar.setLayer(999);
    expect(count.textContent).toBe('46 / 46');
    expect(next.disabled).toBe(true);
    next.click();
    expect(onLayerStep).not.toHaveBeenCalled();
    bar.setLayer(-4);
    expect(count.textContent).toBe('1 / 46');
    // Advanced counts from 0, as the rest of the HUD does
    setMode('advanced');
    bar.setLayer(21);
    expect(count.textContent).toBe('21 / 45');
    setLang('de');
    expect(bar.element.querySelector('[data-control="layer"]')!.getAttribute('aria-label')).toBe('Ebene');
    expect(prev.getAttribute('aria-label')).toBe('Vorherige Ebene');
  });

  it('stepLayer clamps to 0..count-1', () => {
    expect(stepLayer(5, 1, 46)).toBe(6);
    expect(stepLayer(0, -1, 46)).toBe(0);
    expect(stepLayer(45, 1, 46)).toBe(45);
    expect(stepLayer(10, 100, 46)).toBe(45);
    expect(stepLayer(10, -100, 46)).toBe(0);
    expect(stepLayer(3, 1, 0)).toBe(0);
  });

describe('fix round 1: seek and selection', () => {
  const makeBar = async () => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    document.body.append(bar.element);
    await bar.ready;
    return bar;
  };
  it('seek during a quick run in Advanced lands on the op that was on screen at that time of the quick axis', async () => {
    setMode('advanced');
    const bar = await makeBar();
    bar.watch();
    const p = bar.player()!;
    expect(p.pace()).toBe('quick');
    const wanted = p.indexAtTime(37.5);
    const full = (() => { p.setPace('full'); const k = p.indexAtTime(37.5); p.setPace('quick'); return k; })();
    expect(wanted).not.toBe(full);
    bar.timing()!.seek(37.5);
    expect(p.pace()).toBe('full');
    expect(p.index()).toBe(wanted);
  });

  it('a layer selected elsewhere moves the stepper and the playhead to the same layer (Simple counts from 1)', async () => {
    const bar = await makeBar();
    const p = bar.player()!;
    p.scrub(0);
    bar.setLayer(1); // code index 1 = "layer 2" in Simple, like the sidebar says
    const count = bar.element.querySelector('.layer-count')!;
    expect(count.textContent).toBe('2 / 46');
    expect(p.ops[p.index()]!.layer).toBe(1);
    expect(bar.timing()!.elapsed()).toBeGreaterThan(0);
    // A repaint of the same op (hint, language) keeps both, the old feedback loop is gone.
    bar.setHint('hint.levelOpen');
    expect(count.textContent).toBe('2 / 46');
    // A playing run keeps its own position.
    p.play();
    const at = p.index();
    bar.setLayer(10);
    expect(p.index()).toBe(at);
  });
});

  it('routing(layer) returns the recorded top-3 and softmax shares per stream (sum 1), the word on screen', async () => {
    const bar = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    document.body.append(bar.element);
    await bar.ready;
    const r = bar.routing(12);
    expect(r.word).toBe('earth');
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.experts).toHaveLength(3);
      expect(row.experts.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1, 3);
    }
    const first = bar.player()!.ops.find((o) => o.kind === 'router' && o.layer === 12 && o.stream === r.rows[0]!.stream)!;
    expect(r.rows[0]!.experts.map((e) => e.expert)).toEqual((first.data.value as { top3: number[] }).top3);
  });

});
