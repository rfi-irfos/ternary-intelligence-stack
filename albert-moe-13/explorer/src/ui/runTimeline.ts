import { onPrefsChange, t } from './prefs';
import { type RunTiming, formatClock } from './player';

export interface RunTimeline {
  element: HTMLElement;
  /** Repaints the played part and the playhead; cheap enough to call every frame. */
  update(): void;
  dispose(): void;
}

const pct = (v: number): string => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(3)}%`;

/**
 * The run timeline along the bottom edge (Simeon's mockup): "0:00" at the left, the length of the run
 * (m:ss) at the right, a thin line whose played part and playhead are cyan, small marks where a layer
 * starts and red marks at the real swap gates. The time axis is the current run at 1x, read from the
 * player (quick pass or full pace), never typed in. Click or drag jumps (the visitor's own navigation).
 * Gate marks come from the recorded gate ops, so a run without a gate shows none.
 */
export function createRunTimeline(timing: () => RunTiming | null): RunTimeline {
  const el = document.createElement('div');
  el.className = 'timeline run-timeline';
  const start = document.createElement('span');
  start.className = 'tl-time tl-time--start num';
  const end = document.createElement('span');
  end.className = 'tl-time tl-time--end num';
  const track = document.createElement('div');
  track.className = 'tl-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-valuemin', '0');
  const line = document.createElement('div');
  line.className = 'tl-line';
  const played = document.createElement('div');
  played.className = 'tl-played';
  const marks = document.createElement('div');
  marks.className = 'tl-marks';
  const head = document.createElement('div');
  head.className = 'tl-head';
  track.append(line, played, marks, head);
  el.append(start, track, end);

  let builtFor = '';
  let lastPaint = '';
  const build = (tm: RunTiming | null): void => {
    const total = tm?.duration() ?? 0;
    const gates = tm?.gates() ?? [];
    const layers = tm?.layers() ?? [];
    const key = `${total.toFixed(3)}|${gates.length}|${layers.length}`;
    if (key === builtFor) return;
    builtFor = key;
    marks.replaceChildren();
    if (total <= 0) return;
    const gateTip = t('timeline.gateTip');
    for (const s of layers) {
      const m = document.createElement('span');
      m.className = 'tl-mark tl-mark--layer';
      m.style.left = pct(s / total);
      marks.append(m);
    }
    for (const s of gates) {
      const m = document.createElement('span');
      m.className = 'tl-mark tl-mark--gate';
      m.dataset.gate = 'true';
      m.dataset.at = s.toFixed(3);
      m.style.left = pct(s / total);
      m.title = gateTip;
      marks.append(m);
    }
  };

  const update = (): void => {
    const tm = timing();
    build(tm);
    const total = tm?.duration() ?? 0;
    const now = tm ? Math.min(tm.elapsed(), total) : 0;
    const frac = total > 0 ? now / total : 0;
    const text = `${formatClock(now)}|${formatClock(total)}|${frac.toFixed(4)}`;
    if (text === lastPaint) return;
    lastPaint = text;
    start.textContent = '0:00';
    end.textContent = formatClock(total);
    played.style.width = pct(frac);
    head.style.left = pct(frac);
    track.setAttribute('aria-valuemax', String(Math.round(total)));
    track.setAttribute('aria-valuenow', String(Math.round(now)));
    track.setAttribute('aria-valuetext', `${formatClock(now)} / ${formatClock(total)}`);
  };

  const paintText = (): void => {
    el.title = t('timeline.tip', { key: t('timeline.gateKey') });
    track.setAttribute('aria-label', t('timeline.label'));
    lastPaint = '';
    builtFor = '';
    update();
  };

  const seekAt = (clientX: number): void => {
    const tm = timing();
    if (!tm) return;
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    tm.seek(f * tm.duration());
    update();
  };
  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture?.(e.pointerId);
    seekAt(e.clientX);
  });
  track.addEventListener('pointermove', (e) => { if (dragging) seekAt(e.clientX); });
  const stop = (): void => { dragging = false; };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);
  track.addEventListener('keydown', (e: KeyboardEvent) => {
    const tm = timing();
    if (!tm) return;
    // The timeline owns its arrows; the player's arrow shortcuts never see them.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      tm.step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      tm.seek(e.key === 'Home' ? 0 : tm.duration());
    } else return;
    update();
  });

  paintText();
  const off = onPrefsChange(paintText);
  return { element: el, update, dispose() { off(); el.remove(); } };
}
