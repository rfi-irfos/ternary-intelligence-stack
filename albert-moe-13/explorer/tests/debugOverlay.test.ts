// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { debugRequested } from '../src/ui/debugFlag';
import { createDebugOverlay, rollingFps } from '../src/ui/debugOverlay';

describe('debug flag', () => {
  it('is on only for debug=1', () => {
    expect(debugRequested('?debug=1')).toBe(true);
    expect(debugRequested('?a=2&debug=1')).toBe(true);
    for (const s of ['', '?debug', '?debug=0', '?debug=true', '?debug=11', '?xdebug=1']) expect(debugRequested(s), s).toBe(false);
  });
});

describe('rollingFps', () => {
  it('averages over the last second and drops older stamps', () => {
    const stamps: number[] = [];
    let fps = 0;
    for (let t = 0; t <= 2000; t += 20) { stamps.push(t); fps = rollingFps(stamps, t); }
    expect(fps).toBeCloseTo(50, 5);
    expect(stamps.length).toBeLessThanOrEqual(51);
  });
  it('is 0 with fewer than two frames', () => {
    expect(rollingFps([], 0)).toBe(0);
    expect(rollingFps([5], 5)).toBe(0);
  });
  it('follows a slowdown', () => {
    const stamps: number[] = [];
    let t = 0;
    for (; t < 1000; t += 10) { stamps.push(t); rollingFps(stamps, t); }
    for (; t < 3000; t += 50) { stamps.push(t); }
    expect(rollingFps(stamps, t - 50)).toBeCloseTo(20, 0);
  });
});

function fakeSource() {
  const info = { autoReset: true, resets: 0, render: { calls: 7, triangles: 1234 }, reset() { this.resets++; } };
  return { info, domElement: { width: 1600, height: 900 }, getPixelRatio: () => 1.25 };
}

describe('overlay', () => {
  it('creates nothing until asked, then shows the numbers and takes over info.autoReset', () => {
    expect(document.querySelector('.debug-overlay')).toBeNull();
    const src = fakeSource();
    const o = createDebugOverlay(src, () => 'medium', document, { devicePixelRatio: 2 });
    expect(src.info.autoReset).toBe(false);
    for (let t = 0; t <= 1000; t += 20) o.tick(t);
    expect(src.info.resets).toBe(51);
    const text = o.element.textContent ?? '';
    for (const part of ['FPS', 'Draw calls', 'Triangles', 'Quality', 'Canvas', 'Pixel ratio', 'medium', '1600 x 900', '1.25 (device 2)', '1234']) expect(text).toContain(part);
    expect(o.element.dataset.calls).toBe('7');
    expect(Number(o.element.dataset.fps)).toBeCloseTo(50, 0);
    expect(o.element.getAttribute('aria-label')).toBeTruthy();
    o.remove();
    expect(document.querySelector('.debug-overlay')).toBeNull();
    expect(src.info.autoReset).toBe(true);
  });
});
