// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace } from '../src/data/trace';
import { attachDepthKeys, getDepth, setDepth } from '../src/ui/depth';
import { buildTimeline } from '../src/flow/timeline';
import { buildTower } from '../src/scene/tower';
import { NO_TRACE_TEXT, OP_SECONDS, createPlayer, createPlayerBar } from '../src/ui/player';
import { setMode } from '../src/ui/prefs';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const trace = (id: string) => validateTrace(modules[`../public/data/trace/${id}.json`], a);
const ops = buildTimeline(trace('kjv'), a, 3);

afterEach(() => {
  document.body.innerHTML = '';
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
    const [prompt, token] = bar.element.querySelectorAll('select');
    expect([...(prompt?.options ?? [])].map((o) => o.value)).toEqual(['kjv', 'de', 'ternary']);
    expect(token?.options[1]?.textContent).toContain('" the"');
    expect(bar.player()?.ops).toHaveLength(655);
    bar.player()?.jumpToNext('router');
    const lv = bar.element.querySelector('.player-details .lv');
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
    const embed = bar.element.querySelector('.player-row')?.textContent ?? '';
    expect(embed).toMatch(/^token "[^"]*" id \d+$/);
    p?.jumpToNext('experts');
    const experts = bar.element.querySelector('.player-row')?.textContent ?? '';
    expect(experts).toMatch(/^lit 3 of 12 experts: E\d+, E\d+, E\d+$/);
  });

  it('does not move the camera on load or on prompt/token change; free is the default', async () => {
    const { bar, flyTo, overview } = make();
    await bar.ready;
    const [prompt, token] = bar.element.querySelectorAll('select');
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
    const cam = bar.element.querySelector('select.player-camera') as HTMLSelectElement;
    cam.value = 'follow';
    cam.dispatchEvent(new Event('change'));
    flyTo.mockClear();
    bar.player()?.scrub(0); // programmatic, not a user action
    expect(flyTo).not.toHaveBeenCalled();
    click(bar, 'next');
    const range = bar.element.querySelector('input[type=range]') as HTMLInputElement;
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
