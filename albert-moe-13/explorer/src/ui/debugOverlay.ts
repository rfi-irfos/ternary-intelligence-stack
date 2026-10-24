/*
 * Performance overlay, shown only with `?debug=1` in the URL (Task 16). Technical, so its labels are English
 * in both languages. Off by default: main.ts loads this module with a dynamic import only when the flag is set,
 * so without the flag there is no code, no DOM, no listener and no per-frame work.
 * Draw calls and triangles come from `renderer.info`. A frame can render several times (bloom pass, final
 * pass), so the overlay turns `info.autoReset` off and resets the counters itself once per frame.
 */

/** Frames per second over the last `windowMs` ms. `stamps` are frame times in ms, oldest first; old ones are dropped in place. */
export function rollingFps(stamps: number[], now: number, windowMs = 1000): number {
  while (stamps.length > 0 && now - stamps[0]! > windowMs) stamps.shift();
  if (stamps.length < 2) return 0;
  const span = stamps[stamps.length - 1]! - stamps[0]!;
  return span > 0 ? ((stamps.length - 1) * 1000) / span : 0;
}

export interface DebugSource {
  info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } };
  domElement: { width: number; height: number };
  getPixelRatio(): number;
}

export interface DebugOverlay {
  element: HTMLElement;
  /** Call once at the end of every frame, with the frame time (ms). */
  tick(now: number): void;
  remove(): void;
}

export const DEBUG_OVERLAY_CSS = `
.debug-overlay { position: fixed; z-index: 11; left: var(--edge-pad); bottom: calc(var(--timeline-h) + 2 * var(--space-2));
  width: 188px; box-sizing: border-box; padding: var(--space-2) var(--space-3); pointer-events: none; user-select: none;
  background: var(--c-card-solid); border: 1px solid var(--c-card-line); border-radius: var(--r-control);
  font: 500 12px/1.45 var(--font-ui); font-variant-numeric: tabular-nums; color: var(--c-text); }
.debug-overlay div { display: flex; justify-content: space-between; gap: var(--space-3); }
.debug-overlay span:first-child { color: var(--c-text); opacity: 0.8; }
/* Narrow screen: the dock fills the width, so the overlay sits under the top bar and steps aside while the settings menu is open. */
@media (max-width: 720px) {
  .debug-overlay { bottom: auto; top: calc(var(--top-h) + var(--space-3)); }
  body:has(.settings-menu:not([hidden])) .debug-overlay { visibility: hidden; }
}
`;

const ROWS = ['FPS', 'Draw calls', 'Triangles', 'Quality', 'Canvas', 'Pixel ratio'] as const;
const REFRESH_MS = 250;

export function createDebugOverlay(
  source: DebugSource,
  quality: () => string,
  doc: Document = document,
  win: { devicePixelRatio: number } = window,
): DebugOverlay {
  const style = doc.createElement('style');
  style.textContent = DEBUG_OVERLAY_CSS;
  const element = doc.createElement('div');
  element.className = 'debug-overlay';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Debug overlay (fps, draw calls, triangles)');
  const values = ROWS.map((label) => {
    const row = doc.createElement('div');
    const name = doc.createElement('span');
    name.textContent = label;
    const value = doc.createElement('span');
    row.append(name, value);
    element.append(row);
    return value;
  });
  doc.head.append(style);
  doc.body.append(element);

  source.info.autoReset = false;
  const stamps: number[] = [];
  let shownAt = -Infinity;
  return {
    element,
    tick(now) {
      stamps.push(now);
      const fps = rollingFps(stamps, now);
      if (now - shownAt >= REFRESH_MS) {
        shownAt = now;
        const { calls, triangles } = source.info.render;
        const c = source.domElement;
        const text = [
          fps.toFixed(1), String(calls), String(triangles), quality(),
          `${c.width} x ${c.height}`, `${source.getPixelRatio()} (device ${win.devicePixelRatio})`,
        ];
        text.forEach((s, i) => { values[i]!.textContent = s; });
        element.dataset.fps = fps.toFixed(1);
        element.dataset.calls = String(calls);
        element.dataset.triangles = String(triangles);
      }
      source.info.reset();
    },
    remove() {
      element.remove();
      style.remove();
      source.info.autoReset = true;
    },
  };
}
