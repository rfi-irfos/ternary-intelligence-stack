// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunTimeline } from '../src/ui/runTimeline';
import { formatClock, type RunTiming } from '../src/ui/player';
import { setLang } from '../src/ui/prefs';

function timing(over: Partial<{ duration: number; elapsed: number; gates: number[]; layers: number[] }> = {}) {
  const v = { duration: 75, elapsed: 30, gates: [7.5, 37.5], layers: [0, 15, 45], ...over };
  const seek = vi.fn();
  const step = vi.fn();
  const tm: RunTiming = {
    duration: () => v.duration, elapsed: () => v.elapsed, gates: () => v.gates, layers: () => v.layers, seek, step,
  };
  return { tm, v, seek, step };
}

const made: Array<() => void> = [];
afterEach(() => {
  while (made.length) made.pop()!();
  setLang('en');
});

function make(tm: RunTiming | null) {
  const tl = createRunTimeline(() => tm);
  document.body.appendChild(tl.element);
  made.push(() => tl.dispose());
  tl.update();
  return tl;
}

describe('run timeline (mockup: 0:00 ... m:ss, red ticks at the real gates)', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(655 * 0.6)).toBe('6:33');
  });

  it('shows 0:00 at the left and the real duration at the right', () => {
    const { tm, v } = timing();
    const tl = make(tm);
    expect(tl.element.querySelector('.tl-time--start')?.textContent).toBe('0:00');
    expect(tl.element.querySelector('.tl-time--end')?.textContent).toBe('1:15');
    v.duration = 393;
    tl.update();
    // the run is rebuilt when the pace changes (Advanced): the label follows the real length
    expect(tl.element.querySelector('.tl-time--end')?.textContent).toBe('6:33');
  });

  it('puts one red tick per real gate, at its time, and none when the run has no gate', () => {
    const { tm, v } = timing();
    const tl = make(tm);
    const gates = [...tl.element.querySelectorAll<HTMLElement>('.tl-mark--gate')];
    expect(gates.map((g) => g.style.left)).toEqual(['10%', '50%']);
    expect(tl.element.querySelectorAll('.tl-mark--layer')).toHaveLength(3);
    v.gates = [];
    v.duration = 80;
    tl.update();
    expect(tl.element.querySelectorAll('.tl-mark--gate')).toHaveLength(0);
  });

  it('paints the played part and the playhead from the elapsed time; aria values follow', () => {
    const { tm, v } = timing();
    const tl = make(tm);
    const track = tl.element.querySelector<HTMLElement>('.tl-track')!;
    expect(tl.element.querySelector<HTMLElement>('.tl-played')!.style.width).toBe('40%');
    expect(tl.element.querySelector<HTMLElement>('.tl-head')!.style.left).toBe('40%');
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-valuemax')).toBe('75');
    expect(track.getAttribute('aria-valuenow')).toBe('30');
    expect(track.getAttribute('aria-valuetext')).toBe('0:30 / 1:15');
    v.elapsed = 500; // past the end stays at the end
    tl.update();
    expect(tl.element.querySelector<HTMLElement>('.tl-played')!.style.width).toBe('100%');
  });

  it('click and drag seek by position on the track', () => {
    const { tm, seek } = timing();
    const tl = make(tm);
    const track = tl.element.querySelector<HTMLElement>('.tl-track')!;
    track.getBoundingClientRect = () => ({ left: 100, width: 400, right: 500, top: 0, bottom: 32, height: 32, x: 100, y: 0, toJSON() {} }) as DOMRect;
    track.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, bubbles: true }));
    expect(seek).toHaveBeenLastCalledWith(37.5);
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, bubbles: true }));
    expect(seek).toHaveBeenLastCalledWith(75);
    track.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
    expect(seek).toHaveBeenCalledTimes(2);
    // beyond the edges clamps
    track.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, bubbles: true }));
    expect(seek).toHaveBeenLastCalledWith(0);
  });

  it('arrow keys step, Home/End seek, and the player never sees the arrows', () => {
    const { tm, seek, step } = timing();
    const tl = make(tm);
    const track = tl.element.querySelector<HTMLElement>('.tl-track')!;
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', outer);
    expect(step.mock.calls).toEqual([[1], [-1]]);
    expect(outer).not.toHaveBeenCalled();
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(seek).toHaveBeenLastCalledWith(0);
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(seek).toHaveBeenLastCalledWith(75);
  });

  it('without a run (null timing) it shows 0:00 and no marks', () => {
    const tl = make(null);
    expect(tl.element.querySelector('.tl-time--end')?.textContent).toBe('0:00');
    expect(tl.element.querySelectorAll('.tl-mark')).toHaveLength(0);
  });

  it('has a German label', () => {
    setLang('de');
    const tl = make(timing().tm);
    expect(tl.element.querySelector('.tl-track')?.getAttribute('aria-label')).toBe('Zeitleiste des Durchlaufs');
  });
});
