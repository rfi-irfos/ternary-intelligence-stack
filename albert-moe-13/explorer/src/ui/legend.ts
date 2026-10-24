import { ICONS } from './icons';
import { getMode, onPrefsChange, t } from './prefs';
import { ROLES, ROLE_VAR, type Role } from './roles';
import type { StringKey } from './strings';

export interface LegendDeps {
  /** Highlight hook: a role while one is pinned or hovered, null to clear. */
  onHighlight(role: Role | null): void;
}

export interface Legend {
  /** The chip for the top bar (toggles the card). */
  toggle: HTMLButtonElement;
  /** The wrapper to put in the top bar: the chip, and the floating card under the bar. */
  element: HTMLElement;
  /** The floating card (header with fold chevron, then the seven rows). */
  card: HTMLElement;
  /** The pinned role (clicked), or null. */
  pinned(): Role | null;
  /** Shows or hides the card (the chip's state). */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Folds the rows away (header stays) or back. */
  setExpanded(expanded: boolean): void;
  dispose(): void;
}

/**
 * Legend of Simeon's mockup: a chip "Legende" in the top bar toggles a small floating card under the bar,
 * top left. The card has a header with a fold chevron (up while the rows show) and seven rows, each a
 * 12 px rounded swatch and a label, in the mockup's order. The swatches read the scene's role colours
 * (tokens.css --c-*), so legend and scene cannot drift apart.
 * Simple: the rows are a passive key (pointing at one previews the highlight; nothing pins).
 * Advanced: the rows are buttons: hover previews, click pins (click again clears).
 * The app opens the card on the first visit only, beside the coach marks.
 */
export function createLegend(deps: LegendDeps): Legend {
  const el = document.createElement('div');
  el.className = 'legend';
  el.dataset.control = 'guide';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'hud-btn tray-item legend-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const card = document.createElement('section');
  card.className = 'legend-card';
  card.hidden = true;
  const head = document.createElement('div');
  head.className = 'legend-head';
  const title = document.createElement('h2');
  title.className = 'legend-title';
  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'hud-icon hud-icon--small legend-fold';
  fold.innerHTML = ICONS.chevronUp;
  const list = document.createElement('ul');
  list.className = 'legend-list';
  list.id = 'legend-list';
  fold.setAttribute('aria-controls', list.id);
  toggle.setAttribute('aria-controls', card.id || 'legend-card');
  card.id = 'legend-card';
  head.append(title, fold);
  card.append(head, list);
  let pinned: Role | null = null;
  let hovered: Role | null = null;
  let open = false;
  let expanded = true;
  let builtFor: string | null = null;
  const items = new Map<Role, HTMLElement>();
  const emit = (): void => deps.onHighlight(hovered ?? pinned);

  const build = (simple: boolean): void => {
    items.clear();
    list.replaceChildren();
    for (const r of ROLES) {
      const li = document.createElement('li');
      const b = document.createElement(simple ? 'span' : 'button');
      b.className = 'legend-item';
      b.dataset.role = r;
      b.style.setProperty('--role', ROLE_VAR[r]);
      b.innerHTML = '<span class="legend-swatch" aria-hidden="true"></span><span class="legend-name"></span>';
      if (!simple) {
        (b as HTMLButtonElement).type = 'button';
        b.setAttribute('aria-pressed', String(pinned === r));
        b.addEventListener('click', () => {
          pinned = pinned === r ? null : r;
          for (const [k, x] of items) x.setAttribute('aria-pressed', String(k === pinned));
          emit();
        });
      }
      b.addEventListener('pointerenter', () => { hovered = r; emit(); });
      b.addEventListener('pointerleave', () => { if (hovered === r) { hovered = null; emit(); } });
      items.set(r, b);
      li.append(b);
      list.append(li);
    }
  };

  const sync = (): void => {
    card.hidden = !open;
    list.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(open));
    fold.setAttribute('aria-expanded', String(expanded));
    fold.classList.toggle('folded', !expanded);
    el.classList.toggle('open', open);
  };
  const setOpen = (o: boolean): void => { open = o; sync(); };
  const setExpanded = (x: boolean): void => { expanded = x; sync(); };
  toggle.addEventListener('click', () => setOpen(!open));
  fold.addEventListener('click', () => setExpanded(!expanded));

  const paint = (): void => {
    const simple = getMode() === 'simple';
    el.dataset.mode = getMode();
    if (builtFor !== getMode()) {
      // Pins belong to the Advanced tool; Simple has none.
      if (simple && pinned) { pinned = null; emit(); }
      build(simple);
      builtFor = getMode();
    }
    title.textContent = t('legend.title');
    card.setAttribute('aria-label', t('legend.title'));
    list.setAttribute('aria-label', t('legend.title'));
    toggle.innerHTML = `${ICONS.info}<span>${t('legend.title')}</span>`;
    toggle.title = t('legend.tip');
    fold.setAttribute('aria-label', t('legend.collapse'));
    fold.title = t('legend.collapse');
    for (const [r, b] of items) (b.querySelector('.legend-name') as HTMLElement).textContent = t(`role.${r}` as StringKey);
    sync();
  };
  paint();
  const off = onPrefsChange(paint);
  el.append(toggle, card);
  return {
    toggle, element: el, card, pinned: () => pinned, setOpen, isOpen: () => open, setExpanded,
    dispose: () => { off(); el.remove(); },
  };
}
