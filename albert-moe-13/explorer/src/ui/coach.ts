import { ICONS } from './icons';
import { onPrefsChange, t } from './prefs';
import type { StringKey } from './strings';

export const COACH_KEY = 'albert.coach';

export interface CoachStep {
  key: StringKey;
  /** Element the hint points at; null puts the hint in the middle of the screen. */
  target: () => HTMLElement | null;
}

export interface CoachMarks {
  /** The hint bubble, or null when the hints were already seen. */
  element: HTMLElement | null;
  index(): number;
  next(): void;
  dismiss(): void;
  /** Re-places the bubble at its target (after layout). */
  refresh(): void;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True once the visitor finished or closed the hints (they never come back). */
export const coachSeen = (s: Pick<Storage, 'getItem'> | null = store()): boolean => s?.getItem(COACH_KEY) === 'done';

/**
 * First-visit hints: three short bubbles, one at a time, each pointing at its control (Play, the tours,
 * then the model itself). "Next" moves on, "Got it" on the last one or the close button ends them, and
 * either way they are stored as seen and never shown again.
 */
export function createCoachMarks(steps: CoachStep[], doc: Document = document, onEnd?: () => void): CoachMarks {
  const noop: CoachMarks = { element: null, index: () => -1, next: () => undefined, dismiss: () => undefined, refresh: () => undefined };
  if (coachSeen() || steps.length === 0) return noop;
  const el = doc.createElement('div');
  el.className = 'coach';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  el.tabIndex = -1;
  const label = doc.createElement('span');
  label.className = 'coach-count';
  label.id = 'coach-count';
  const text = doc.createElement('p');
  text.className = 'coach-text';
  text.id = 'coach-text';
  el.setAttribute('aria-labelledby', 'coach-count coach-text');
  const row = doc.createElement('div');
  row.className = 'coach-row';
  const skip = doc.createElement('button');
  skip.type = 'button';
  skip.className = 'hud-icon hud-icon--small coach-skip';
  skip.innerHTML = ICONS.close;
  const go = doc.createElement('button');
  go.type = 'button';
  go.className = 'hud-btn coach-next';
  row.append(go);
  el.append(label, skip, text, row);
  let i = 0;
  let off: (() => void) | null = null;

  const place = (): void => {
    const target = steps[i]?.target() ?? null;
    const r = target?.getBoundingClientRect();
    const w = typeof window === 'undefined' ? 1366 : window.innerWidth;
    const h = typeof window === 'undefined' ? 768 : window.innerHeight;
    el.dataset.anchor = 'center';
    if (!r || (r.width === 0 && r.height === 0)) {
      el.style.left = `${w / 2}px`;
      el.style.top = `${h / 2}px`;
      return;
    }
    const below = r.top < h / 2;
    el.dataset.anchor = below ? 'below' : 'above';
    el.style.left = `${Math.min(Math.max(r.left + r.width / 2, 170), w - 170)}px`;
    el.style.top = `${below ? r.bottom + 14 : r.top - 14}px`;
  };
  const paint = (): void => {
    label.textContent = t('coach.label', { i: i + 1, n: steps.length });
    text.textContent = t(steps[i]!.key);
    go.textContent = t(i === steps.length - 1 ? 'coach.done' : 'coach.next');
    skip.setAttribute('aria-label', t('coach.skip'));
    skip.title = t('coach.skip');
    place();
  };
  const dismiss = (): void => {
    try { store()?.setItem(COACH_KEY, 'done'); } catch { /* storage unavailable */ }
    off?.();
    off = null;
    if (typeof window !== 'undefined') window.removeEventListener('resize', place);
    doc.removeEventListener('keydown', onEsc, true);
    el.remove();
    onEnd?.();
  };
  const next = (): void => {
    if (i >= steps.length - 1) { dismiss(); return; }
    i++;
    paint();
  };
  go.addEventListener('click', next);
  skip.addEventListener('click', dismiss);
  // Esc ends the hints wherever focus is: capture phase, so the explode view and the camera never see it.
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !el.isConnected) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    dismiss();
  };
  doc.addEventListener('keydown', onEsc, true);
  off = onPrefsChange(paint);
  if (typeof window !== 'undefined') window.addEventListener('resize', place);
  paint();
  // Focus moves into the hint once it is on the page (the app appends it right after this returns).
  queueMicrotask(() => { if (el.isConnected) go.focus(); });
  return { element: el, index: () => i, next, dismiss, refresh: place };
}
