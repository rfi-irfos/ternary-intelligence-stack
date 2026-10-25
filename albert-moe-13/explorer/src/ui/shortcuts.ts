import { ICONS } from './icons';
import { onPrefsChange, t } from './prefs';
import type { StringKey } from './strings';

export interface ShortcutsOptions {
  /** Element focus returns to on close (default: the element that had focus when the list opened). */
  returnFocus?: HTMLElement | null;
  doc?: Document;
}

/** The keys and what they do, in the order shown. `k` entries are key names; a plain string is shown as is. */
export const KEY_ROWS: ReadonlyArray<{ keys: Array<StringKey | string>; text: StringKey }> = [
  { keys: ['shortcuts.k.space'], text: 'shortcuts.d.space' },
  { keys: ['←', '→'], text: 'shortcuts.d.arrows' },
  { keys: ['W', 'A', 'S', 'D'], text: 'shortcuts.d.wasd' },
  { keys: ['Q', 'E'], text: 'shortcuts.d.qe' },
  { keys: ['Home', 'End'], text: 'shortcuts.d.homeEnd' },
  { keys: ['1', '2', '3'], text: 'shortcuts.d.depth' },
  { keys: ['shortcuts.k.esc'], text: 'shortcuts.d.esc' },
  { keys: ['shortcuts.k.tab'], text: 'shortcuts.d.tab' },
  { keys: ['?'], text: 'shortcuts.d.help' },
];
export const MOUSE_ROWS: ReadonlyArray<{ keys: StringKey[]; text: StringKey }> = [
  { keys: ['shortcuts.k.drag'], text: 'shortcuts.d.drag' },
  { keys: ['shortcuts.k.rightDrag'], text: 'shortcuts.d.rightDrag' },
  { keys: ['shortcuts.k.wheel'], text: 'shortcuts.d.wheel' },
  { keys: ['shortcuts.k.click'], text: 'shortcuts.d.click' },
];

let current: { el: HTMLElement; close(): void } | null = null;

export const isShortcutsOpen = (): boolean => current !== null;
/** Closes the list if it is open (focus returns to where it was). */
export function closeShortcuts(): void {
  current?.close();
}

const isTyping = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};

/**
 * The shortcut list: a modal dialog above everything. Focus moves to the close button and stays inside
 * (Tab cycles; the close button is the only control); Esc and the close button close it and focus goes back
 * to the trigger. Esc is caught in the capture phase of the window, so one press closes only this dialog.
 */
export function openShortcuts(opts: ShortcutsOptions = {}): HTMLElement {
  const doc = opts.doc ?? document;
  if (current) return current.el;
  const opener = opts.returnFocus ?? (doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null);
  const el = doc.createElement('div');
  el.className = 'shortcuts';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'shortcuts-title');
  const card = doc.createElement('div');
  card.className = 'shortcuts-card';
  const head = doc.createElement('div');
  head.className = 'shortcuts-head';
  const title = doc.createElement('h2');
  title.id = 'shortcuts-title';
  title.className = 'shortcuts-title';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'hud-icon shortcuts-close';
  close.innerHTML = ICONS.close;
  head.append(title, close);
  const groups: Array<{ h: HTMLElement; key: StringKey; rows: ReadonlyArray<{ keys: Array<StringKey | string>; text: StringKey }> }> = [];
  const body = doc.createElement('div');
  body.className = 'shortcuts-body';
  for (const [key, rows] of [['shortcuts.keys', KEY_ROWS], ['shortcuts.mouse', MOUSE_ROWS]] as const) {
    const sec = doc.createElement('section');
    const h = doc.createElement('h3');
    h.className = 'shortcuts-group';
    const dl = doc.createElement('dl');
    dl.className = 'shortcuts-list';
    for (const r of rows) {
      const dt = doc.createElement('dt');
      dt.dataset.keys = r.keys.join(' ');
      const dd = doc.createElement('dd');
      dd.dataset.text = r.text;
      dl.append(dt, dd);
    }
    sec.append(h, dl);
    body.append(sec);
    groups.push({ h, key, rows });
  }
  card.append(head, body);
  el.append(card);
  const paint = (): void => {
    title.textContent = t('shortcuts.title');
    close.setAttribute('aria-label', t('shortcuts.close'));
    close.title = t('shortcuts.close');
    for (const g of groups) {
      g.h.textContent = t(g.key);
      const dl = g.h.nextElementSibling!;
      g.rows.forEach((r, i) => {
        const dt = dl.children[i * 2]!;
        const dd = dl.children[i * 2 + 1]!;
        dt.replaceChildren(...r.keys.map((k) => {
          const kbd = doc.createElement('kbd');
          kbd.textContent = k.startsWith('shortcuts.') ? t(k as StringKey) : k;
          return kbd;
        }));
        dd.textContent = t(r.text);
      });
    }
  };
  paint();
  const offPrefs = onPrefsChange(paint);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      api.close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close.focus();
    }
  };
  const api = {
    el,
    close(): void {
      if (current !== api) return;
      current = null;
      offPrefs();
      doc.defaultView?.removeEventListener('keydown', onKey, true);
      el.remove();
      if (opener && opener.isConnected) opener.focus();
    },
  };
  el.addEventListener('click', (e) => { if (e.target === el) api.close(); });
  close.addEventListener('click', () => api.close());
  doc.defaultView?.addEventListener('keydown', onKey, true);
  doc.body.append(el);
  current = api;
  close.focus();
  return el;
}

/** The ? key opens or closes the list (not while typing in a field). Returns a detach function. */
export function attachShortcutsKey(doc: Document = document): () => void {
  const on = (e: KeyboardEvent): void => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    e.preventDefault();
    if (current) closeShortcuts();
    else openShortcuts({ doc });
  };
  doc.addEventListener('keydown', on);
  return () => doc.removeEventListener('keydown', on);
}

/** The Workbench entry: a quiet text button that opens the list. */
export function createShortcutsEntry(): { element: HTMLElement; button: HTMLButtonElement } {
  const row = document.createElement('div');
  row.className = 'shortcuts-entry';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-btn shortcuts-entry-btn';
  button.setAttribute('aria-haspopup', 'dialog');
  const label = document.createElement('span');
  const kbd = document.createElement('kbd');
  kbd.textContent = '?';
  kbd.setAttribute('aria-hidden', 'true');
  button.append(label, kbd);
  const paint = (): void => {
    label.textContent = t('shortcuts.entry');
    button.title = t('shortcuts.entryTip');
  };
  paint();
  onPrefsChange(paint);
  button.addEventListener('click', () => openShortcuts({ returnFocus: button }));
  row.append(button);
  return { element: row, button };
}
