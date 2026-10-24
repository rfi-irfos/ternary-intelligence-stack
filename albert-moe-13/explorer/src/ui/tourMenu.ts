import { ICONS } from './icons';
import { onPrefsChange, t, tourProgress } from './prefs';
import { TOUR_IDS, type StringKey, type TourKey } from './strings';
import { tourOf } from '../tours/index';

/** Title of a tour in the current language (spec §4.9 titles in strings.ts). */
export const tourTitle = (id: TourKey): string => t(`tour.${id}` as StringKey);

/** What a click on a tour entry asks for: continue at the saved step, or start over at step 1. */
export type TourPick = (id: TourKey, restart: boolean) => void;

let defaultPick: TourPick | null = null;
/** The app registers the tour engine here; the top bar, the lobby and the menu all open the same menu. */
export function setTourPick(fn: TourPick | null): void {
  defaultPick = fn;
}

export interface TourMenuOptions {
  /** Called with the chosen tour (default: the handler from `setTourPick`). Without any handler the menu only lists them. */
  onPick?: TourPick;
  /** Element focus returns to on close. */
  returnFocus?: HTMLElement | null;
  doc?: Document;
}

let open: { el: HTMLElement; close(): void } | null = null;

/** Closes the tour menu if it is open. */
export function closeTourMenu(): void {
  open?.close();
}

/**
 * Opens the guided-tour menu: the seven tours of spec §4.9 in order. A click starts the tour (or continues
 * at its saved step, with a "Start over" button beside it); without a handler each entry says "coming in
 * this build". Esc, the close button or a click outside closes it; the camera moves only once a tour starts.
 */
export function openTourMenu(opts: TourMenuOptions = {}): HTMLElement {
  const doc = opts.doc ?? document;
  const pick = opts.onPick ?? defaultPick;
  if (open) return open.el;
  const el = doc.createElement('div');
  el.className = 'tour-menu';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'tour-menu-title');
  const head = doc.createElement('header');
  const h = doc.createElement('h2');
  h.id = 'tour-menu-title';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'hud-icon tour-close';
  close.innerHTML = ICONS.close;
  head.append(h, close);
  const list = doc.createElement('ol');
  list.className = 'tour-list';
  const items: { id: TourKey; title: HTMLElement; soon: HTMLElement; btn: HTMLButtonElement; restart: HTMLButtonElement }[] = [];
  for (const id of TOUR_IDS) {
    const li = doc.createElement('li');
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'tour-item';
    btn.dataset.tour = id;
    const title = doc.createElement('span');
    title.className = 'tour-title';
    const soon = doc.createElement('span');
    soon.className = 'tour-soon';
    btn.append(title, soon);
    btn.addEventListener('click', () => pick?.(id, false));
    const restart = doc.createElement('button');
    restart.type = 'button';
    restart.className = 'tour-restart';
    restart.dataset.tourRestart = id;
    restart.addEventListener('click', () => pick?.(id, true));
    li.append(btn, restart);
    list.append(li);
    items.push({ id, title, soon, btn, restart });
  }
  el.append(head, list);
  const paint = (): void => {
    h.textContent = t('tours.title');
    close.setAttribute('aria-label', t('tours.close'));
    close.title = t('tours.close');
    for (const it of items) {
      it.title.textContent = tourTitle(it.id);
      const steps = tourOf(it.id)?.steps.length ?? 0;
      const saved = tourProgress(it.id);
      const runnable = pick !== null && steps > 0;
      it.btn.disabled = pick !== null && steps === 0;
      it.soon.textContent = !pick || steps === 0 ? t('tours.soon') : saved > 0 && saved < steps ? t('tourcard.resume', { i: saved + 1, n: steps }) : '';
      it.restart.hidden = !(runnable && saved > 0 && saved < steps);
      it.restart.textContent = t('tourcard.restart');
      it.restart.title = t('tourcard.restartTip');
    }
  };
  paint();
  const offPrefs = onPrefsChange(paint);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Esc here closes the menu only; it never reaches the explode view or the camera.
    e.stopPropagation();
    e.preventDefault();
    api.close();
  };
  const onOutside = (e: PointerEvent): void => {
    const target = e.target as Node | null;
    if (target && !el.contains(target) && !(opts.returnFocus && opts.returnFocus.contains(target))) api.close();
  };
  el.addEventListener('keydown', onKey);
  close.addEventListener('click', () => api.close());
  doc.addEventListener('pointerdown', onOutside, true);
  const api = {
    el,
    close(): void {
      if (open !== api) return;
      open = null;
      offPrefs();
      doc.removeEventListener('pointerdown', onOutside, true);
      el.remove();
      opts.returnFocus?.setAttribute('aria-expanded', 'false');
      opts.returnFocus?.focus();
    },
  };
  open = api;
  doc.body.append(el);
  opts.returnFocus?.setAttribute('aria-expanded', 'true');
  items[0]?.btn.focus();
  return el;
}

/** True while the menu is open. */
export const isTourMenuOpen = (): boolean => open !== null;
