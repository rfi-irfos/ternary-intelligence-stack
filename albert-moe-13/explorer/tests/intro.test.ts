// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { buildTower } from '../src/scene/tower';
import { embedId, slabId } from '../src/scene/ids';
import type { CameraPose } from '../src/camera/controls';
import {
  INTRO_KEY, introLength, introLine, introPath, introPlaying, playIntro, shouldPlayIntro,
} from '../src/intro/cinematic';
import { type AudioLike, createSound, unlockOnGesture } from '../src/audio/sound';
import { setLang } from '../src/ui/prefs';

const a = validateArchitecture(arch);
const tower = buildTower(a);

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  setLang('en');
  localStorage.clear();
});

/** A key-value store in memory. */
function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { m.set(k, v); }), map: m };
}

/** A camera rig whose flights end at once (or, with `hold`, only when the next flight starts). */
function fakeRig(hold = false) {
  let pending: (() => void) | null = null;
  const fly = (): Promise<void> => {
    pending?.();
    pending = null;
    if (!hold) return Promise.resolve();
    return new Promise<void>((r) => { pending = r; });
  };
  return {
    flyToPose: vi.fn((_p: CameraPose, _ms?: number) => fly()),
    overview: vi.fn((_ms?: number) => { pending?.(); pending = null; return Promise.resolve(); }),
  };
}

const now = () => Promise.resolve();

describe('intro cinematic', () => {
  it('intro skipped when seen', async () => {
    const rig = fakeRig();
    const store = memStore({ [INTRO_KEY]: '1' });
    expect(shouldPlayIntro({ store, reducedMotion: false })).toBe(false);
    await playIntro(rig, tower, a, { store, reducedMotion: false, wait: now });
    expect(rig.flyToPose).not.toHaveBeenCalled();
    expect(rig.overview).not.toHaveBeenCalled();
    expect(document.querySelector('.intro')).toBeNull();
  });

  it('intro skipped with reduced motion', async () => {
    const rig = fakeRig();
    const store = memStore();
    expect(shouldPlayIntro({ store, reducedMotion: true })).toBe(false);
    await playIntro(rig, tower, a, { store, reducedMotion: true, wait: now });
    expect(rig.flyToPose).not.toHaveBeenCalled();
    expect(rig.overview).not.toHaveBeenCalled();
    // Not marked seen: a visitor who later turns reduced motion off still gets it once.
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('the path: embedding, every fusion slab in row order (from the tower), then the overview, in 15-25 s', () => {
    const steps = introPath(tower, a);
    const fusion = [...a.model.fusion_layers].sort((x, y) => x - y);
    expect(steps.map((s) => s.at)).toEqual([embedId(), ...fusion.map(slabId), 'overview']);
    expect(steps[0]!.pose!.target.toArray()).toEqual(tower.anchor(embedId()).toArray());
    fusion.forEach((l, k) => expect(steps[k + 1]!.pose!.target.x).toBeCloseTo(tower.slabX(l), 6));
    // A short pause at each fusion slab's gate arc; the overview pose comes from the rig.
    for (const s of steps.slice(1, -1)) expect(s.hold).toBeGreaterThan(0);
    expect(steps[steps.length - 1]!.pose).toBeNull();
    const ms = introLength(steps);
    expect(ms).toBeGreaterThanOrEqual(15000);
    expect(ms).toBeLessThanOrEqual(25000);
    // Travel time follows the distance along the row: the longest hop takes the longest.
    const hops = fusion.map((l, k) => tower.slabX(l) - (k === 0 ? tower.anchor(embedId()).x : tower.slabX(fusion[k - 1]!)));
    const longest = hops.indexOf(Math.max(...hops));
    expect(steps[longest + 1]!.ms).toBe(Math.max(...steps.slice(1, -1).map((s) => s.ms)));
  });

  it('plays once: flies the path, shows one line with the counts from architecture.json, and marks itself seen', async () => {
    const rig = fakeRig();
    const store = memStore();
    const p = playIntro(rig, tower, a, { store, reducedMotion: false, wait: now });
    expect(introPlaying()).toBe(true);
    const line = document.querySelector('.intro .intro-line')!;
    expect(document.body.classList.contains('cinema')).toBe(true);
    const v = (k: string) => line.querySelector<HTMLElement>(`[data-v="${k}"]`)?.textContent;
    expect(v('layers')).toBe(String(a.model.num_layers));
    expect(v('streams')).toBe(String(a.model.num_streams));
    expect(v('experts')).toBe(String(a.model.num_experts));
    expect(line.querySelector('[data-v="params"]')!.getAttribute('data-kind')).toBe('structure');
    await p;
    expect(rig.flyToPose).toHaveBeenCalledTimes(1 + a.model.fusion_layers.length);
    expect(rig.overview).toHaveBeenCalledTimes(1);
    expect(store.map.get(INTRO_KEY)).toBe('1');
    expect(document.querySelector('.intro')).toBeNull();
    expect(document.body.classList.contains('cinema')).toBe(false);
    // Second time: nothing.
    await playIntro(rig, tower, a, { store, reducedMotion: false, wait: now });
    expect(rig.flyToPose).toHaveBeenCalledTimes(1 + a.model.fusion_layers.length);
  });

  it('any key skips it: a cut to the overview, and the key reaches nothing behind it', async () => {
    const rig = fakeRig(true);
    const store = memStore();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    const p = playIntro(rig, tower, a, { store, reducedMotion: false, wait: now });
    await Promise.resolve();
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(space);
    await p;
    expect(space.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    expect(rig.flyToPose).toHaveBeenCalledTimes(1);
    expect(rig.overview).toHaveBeenCalledWith(0);
    expect(store.map.get(INTRO_KEY)).toBe('1');
    document.removeEventListener('keydown', behind);
  });

  it('a click skips it too, and the click never reaches the canvas', async () => {
    const rig = fakeRig(true);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const picked = vi.fn();
    canvas.addEventListener('pointerdown', picked);
    const p = playIntro(rig, tower, a, { store: memStore(), reducedMotion: false, wait: now });
    const layer = document.querySelector<HTMLElement>('.intro')!;
    layer.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    await p;
    expect(picked).not.toHaveBeenCalled();
    expect(rig.overview).toHaveBeenCalledWith(0);
  });

  it('the line follows the language (German counts and words)', () => {
    setLang('de');
    const tmp = document.createElement('p');
    tmp.innerHTML = introLine(a);
    expect(tmp.textContent).toBe('albert. – 46 Ebenen, 2 Ströme, 12 gemeinsame Experten, 331.140.622 Parameter');
  });
});

/** A minimal Web Audio stand-in: every node accepts the calls the cues make. */
function fakeAudio(): AudioLike {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), type: 'sine', frequency: param(), gain: param() });
  return {
    currentTime: 1,
    destination: {} as AudioNode,
    state: 'running',
    createOscillator: vi.fn(() => node() as unknown as OscillatorNode),
    createGain: vi.fn(() => node() as unknown as GainNode),
    createBiquadFilter: vi.fn(() => node() as unknown as BiquadFilterNode),
  };
}

describe('procedural sound', () => {
  it('sound does nothing before first gesture', () => {
    const create = vi.fn(fakeAudio);
    const s = createSound({ create });
    expect(s.muted()).toBe(true);
    s.mute(false);
    s.routerClick();
    s.tokenRise(0.5);
    s.roomTone(true);
    expect(create).not.toHaveBeenCalled();
    expect(s.contexts()).toBe(0);
    // The gesture unlocks it; the sound was turned on, so the context comes now (and only one).
    s.init();
    s.routerClick();
    s.tokenRise(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(s.contexts()).toBe(1);
  });

  it('is off by default: a gesture alone creates nothing', () => {
    const create = vi.fn(fakeAudio);
    const s = createSound({ create });
    s.init();
    s.routerClick();
    s.tokenRise(0.2);
    s.roomTone(true);
    expect(create).not.toHaveBeenCalled();
    expect(s.muted()).toBe(true);
  });

  it('cues make tones (no audio files): oscillators and gains only; mute stops them', () => {
    const ctx = fakeAudio();
    const s = createSound({ create: () => ctx });
    s.init();
    s.mute(false);
    s.routerClick();
    s.tokenRise(0);
    s.roomTone(true);
    expect((ctx.createOscillator as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(5);
    const before = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.calls.length;
    s.mute(true);
    s.routerClick();
    s.tokenRise(1);
    expect((ctx.createOscillator as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it('sound is OFF on every visit: an earlier "on" is never carried over, and "on" is never stored', () => {
    localStorage.setItem('albert.sound', 'on');
    const first = createSound({ create: () => fakeAudio() });
    expect(first.muted()).toBe(true);
    first.init();
    first.mute(false);
    expect(first.muted()).toBe(false);
    expect(localStorage.getItem('albert.sound')).toBe('on'); // only the stale key of an old build, untouched
    localStorage.clear();
    first.mute(true);
    first.mute(false);
    expect(localStorage.length).toBe(0);
    // A second visit starts silent again.
    expect(createSound({ create: () => fakeAudio() }).muted()).toBe(true);
  });

  it('mute suspends the audio context and unmute resumes it', () => {
    const ctx = fakeAudio();
    const suspend = vi.fn(() => Promise.resolve());
    const resume = vi.fn(() => Promise.resolve());
    Object.assign(ctx, { suspend, resume });
    const s = createSound({ create: () => ctx });
    s.init();
    s.mute(false);
    s.routerClick(); // the context exists now
    resume.mockClear();
    s.mute(true);
    expect(suspend).toHaveBeenCalledTimes(1);
    s.mute(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('the first pointerdown or key unlocks it, once', () => {
    const init = vi.fn();
    unlockOnGesture({ init }, document);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(init).toHaveBeenCalledTimes(1);
  });

});
