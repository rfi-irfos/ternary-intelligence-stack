// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace } from '../src/data/trace';
import { buildTimeline } from '../src/flow/timeline';
import { buildTower } from '../src/scene/tower';
import { NO_TRACE_TEXT, OP_SECONDS, createPlayer, createPlayerBar } from '../src/ui/player';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const modules = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const trace = (id: string) => validateTrace(modules[`../public/data/trace/${id}.json`], a);
const ops = buildTimeline(trace('kjv'), a, 3);

afterEach(() => { document.body.innerHTML = ''; });

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
    p.tick(OP_SECONDS * 3);
    expect(p.index()).toBe(3);
    p.setSpeed(4);
    p.tick(OP_SECONDS);
    expect(p.index()).toBe(7);
    p.pause();
    p.tick(10);
    expect(p.index()).toBe(7);
    p.scrub(ops.length - 2);
    p.play();
    p.tick(OP_SECONDS * 20);
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

  it('camera mode and speed are settable', () => {
    const p = createPlayer(ops, () => undefined);
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
    expect(flyTo).toHaveBeenCalled();
  });
});
