import { ICONS } from './icons';
import { onPrefsChange, t } from './prefs';
import type { StringKey } from './strings';

/**
 * The OS-style side panel (Simeon, Task 11d addendum 1): one floating card at the right edge that holds
 * every tool. Five sections, each a collapsible accordion row, in this order: Sitzung (sentence and
 * words), Modell (the selected part), Inspektion (parameters, tensors, weights), Analyse (computation,
 * notes, source) and Darstellung (view mode, quality, sound). It opens over the 3D area and never
 * shrinks the canvas; the camera framing reads its box through hudInsets. Opened and closed by the
 * top-bar button, the edge tab and Esc; the width is dragged at the left edge. Width and the folded
 * sections are remembered (nothing else is stored).
 */
export const SIDEBAR_KEY = 'albert.sidebar';
export const SECTION_IDS = ['session', 'model', 'inspect', 'analysis', 'display'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Narrowest and widest the card gets: 280 px, and 40 % of the viewport. */
export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX_FRACTION = 0.4;
/** First width: 22 % of the viewport (the mockup's card), within the limits. */
export const SIDEBAR_DEFAULT_FRACTION = 0.22;

/** Width clamped to [280 px, 40 % of the viewport]; the minimum wins on a very narrow viewport. */
export function clampSidebarWidth(w: number, viewport: number): number {
  const max = Math.max(SIDEBAR_MIN, Math.floor(viewport * SIDEBAR_MAX_FRACTION));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, w)));
}

interface Stored { width: number | null; folded: SectionId[] }

function readStored(): Stored {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SIDEBAR_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    const folded = Array.isArray(v.folded) ? v.folded.filter((x): x is SectionId => (SECTION_IDS as readonly string[]).includes(x)) : [];
    return { width: typeof v.width === 'number' && Number.isFinite(v.width) ? v.width : null, folded };
  } catch {
    return { width: null, folded: [] };
  }
}

export interface Sidebar {
  /** The card. */
  element: HTMLElement;
  /** The slim tab at the right edge that opens the card (visible while it is closed). */
  edgeTab: HTMLButtonElement;
  /** Slot in the head row between the title and the close button (Einfach | Erweitert sits here). */
  headTools: HTMLElement;
  /** Body of a section: the app mounts content here. */
  body(id: SectionId): HTMLElement;
  section(id: SectionId): HTMLElement;
  isOpen(): boolean;
  /** Opens the card; `expand` unfolds those sections. */
  open(expand?: SectionId[]): void;
  close(): void;
  toggle(): void;
  width(): number;
  setWidth(w: number): void;
  /** Section open (unfolded) or not. */
  sectionOpen(id: SectionId): boolean;
  setSectionOpen(id: SectionId, open: boolean): void;
  /** Fires when the card opens, closes or changes width. */
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export interface SidebarDeps {
  win?: { innerWidth: number };
  /** True while something else owns Esc (a dialog, a popover, an open model level). */
  yieldEsc?: () => boolean;
}

export function createSidebar(deps: SidebarDeps = {}): Sidebar {
  const win = deps.win ?? window;
  const stored = readStored();
  const folded = new Set<SectionId>(stored.folded);
  // The width is stored only after the visitor resized it; until then the default (22 %) follows the viewport.
  let userWidth: number | null = stored.width;
  let w = clampSidebarWidth(userWidth ?? win.innerWidth * SIDEBAR_DEFAULT_FRACTION, win.innerWidth);
  let isOpen = false;
  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((l) => l());
  const persist = (): void => {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ width: userWidth, folded: [...folded] }));
    } catch {
      /* storage unavailable: the choice stays in memory */
    }
  };

  const el = document.createElement('aside');
  el.className = 'os-sidebar';
  el.hidden = true;
  el.dataset.control = 'sidebar';
  const grip = document.createElement('div');
  grip.className = 'sidebar-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.tabIndex = 0;
  const head = document.createElement('div');
  head.className = 'sidebar-head';
  const title = document.createElement('h2');
  title.className = 'sidebar-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'hud-icon hud-icon--small sidebar-close';
  close.innerHTML = ICONS.close;
  const headTools = document.createElement('div');
  headTools.className = 'sidebar-head-tools';
  head.append(title, headTools, close);
  const scroller = document.createElement('div');
  scroller.className = 'sidebar-body';
  el.append(grip, head, scroller);

  const sections = new Map<SectionId, { root: HTMLElement; toggle: HTMLButtonElement; label: HTMLElement; body: HTMLElement }>();
  for (const id of SECTION_IDS) {
    const root = document.createElement('section');
    root.className = 'side-sec';
    root.dataset.side = id;
    const h = document.createElement('h3');
    h.className = 'side-sec-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'side-sec-toggle';
    toggle.id = `side-toggle-${id}`;
    const label = document.createElement('span');
    toggle.append(label);
    toggle.insertAdjacentHTML('beforeend', ICONS.chevronDown);
    h.append(toggle);
    const body = document.createElement('div');
    body.className = 'side-sec-body';
    body.id = `side-body-${id}`;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-labelledby', toggle.id);
    toggle.setAttribute('aria-controls', body.id);
    root.append(h, body);
    scroller.append(root);
    sections.set(id, { root, toggle, label, body });
    toggle.addEventListener('click', () => api.setSectionOpen(id, folded.has(id)));
  }
  const syncSection = (id: SectionId): void => {
    const s = sections.get(id)!;
    const open = !folded.has(id);
    s.body.hidden = !open;
    s.toggle.setAttribute('aria-expanded', String(open));
    s.root.dataset.open = String(open);
  };
  SECTION_IDS.forEach(syncSection);

  const edgeTab = document.createElement('button');
  edgeTab.type = 'button';
  edgeTab.className = 'sidebar-edge';
  edgeTab.innerHTML = ICONS.chevron;
  edgeTab.setAttribute('aria-expanded', 'false');

  const applyWidth = (): void => {
    el.style.width = `${w}px`;
    if (typeof document !== 'undefined') document.documentElement.style.setProperty('--side-w', `${w}px`);
  };
  applyWidth();

  const paint = (): void => {
    title.textContent = t('side.title');
    el.setAttribute('aria-label', t('side.label'));
    close.setAttribute('aria-label', t('side.close'));
    close.title = t('side.close');
    grip.setAttribute('aria-label', t('side.resize'));
    grip.title = t('side.resize');
    edgeTab.setAttribute('aria-label', t('side.toggleTip'));
    edgeTab.title = t('side.toggleTip');
    for (const id of SECTION_IDS) sections.get(id)!.label.textContent = t(`side.sec.${id}` as StringKey);
  };
  paint();
  const offPrefs = onPrefsChange(paint);

  const show = (o: boolean): void => {
    if (isOpen === o) return;
    isOpen = o;
    el.hidden = !o;
    edgeTab.hidden = o;
    edgeTab.setAttribute('aria-expanded', String(o));
    if (typeof document !== 'undefined') document.body.classList.toggle('side-open', o);
    emit();
  };

  const api: Sidebar = {
    element: el, edgeTab, headTools,
    body: (id) => sections.get(id)!.body,
    section: (id) => sections.get(id)!.root,
    isOpen: () => isOpen,
    open(expand) {
      for (const id of expand ?? []) { folded.delete(id); syncSection(id); }
      if (expand?.length) persist();
      show(true);
    },
    close: () => show(false),
    toggle: () => show(!isOpen),
    width: () => w,
    setWidth(v) {
      const n = clampSidebarWidth(v, win.innerWidth);
      if (n === w && userWidth !== null) return;
      w = n;
      userWidth = n;
      applyWidth();
      persist();
      emit();
    },
    sectionOpen: (id) => !folded.has(id),
    setSectionOpen(id, open) {
      if (open) folded.delete(id);
      else folded.add(id);
      syncSection(id);
      persist();
      emit();
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    dispose() {
      offPrefs();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('side-open');
      el.remove();
      edgeTab.remove();
    },
  };

  close.addEventListener('click', () => api.close());
  edgeTab.addEventListener('click', () => api.open());

  // Drag the left edge: the width follows the pointer (the card is anchored at the right edge).
  const RIGHT_GAP = 8;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture?.(e.pointerId);
    const move = (m: PointerEvent): void => api.setWidth(win.innerWidth - RIGHT_GAP - m.clientX);
    const up = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    api.setWidth(w + (e.key === 'ArrowLeft' ? 16 : -16));
  });

  // Esc closes the card (one level) unless something else owns the key. It is created before the camera
  // rig, so stopping the event here keeps the rig's overview flight out of the same key press.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !isOpen || deps.yieldEsc?.()) return;
    // One press, one level: the rig's overview flight must not fire for the same key.
    e.stopImmediatePropagation();
    api.close();
  };
  document.addEventListener('keydown', onKey);
  const onResize = (): void => {
    const n = clampSidebarWidth(userWidth ?? win.innerWidth * SIDEBAR_DEFAULT_FRACTION, win.innerWidth);
    if (n !== w) { w = n; applyWidth(); emit(); }
  };
  window.addEventListener('resize', onResize);
  return api;
}
