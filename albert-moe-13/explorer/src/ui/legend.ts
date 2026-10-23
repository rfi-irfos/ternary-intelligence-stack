import { ICONS } from './icons';
import { getMode, onPrefsChange, t } from './prefs';
import { ROLES, ROLE_VAR, type Role } from './roles';
import type { StringKey } from './strings';

export interface LegendDeps {
  /** Highlight hook: a role while one is pinned or hovered, null to clear. */
  onHighlight(role: Role | null): void;
}

export interface Legend {
  element: HTMLElement;
  /** The pinned role (clicked), or null. */
  pinned(): Role | null;
  setOpen(open: boolean): void;
  dispose(): void;
}

/** Shape of each role, as drawn in the scene (colour is never the only signal). */
const SHAPE: Record<Role, string> = {
  streamA: '<path d="M1 14h22" stroke="var(--c-stream-a)" stroke-width="3" stroke-linecap="round"/><text x="12" y="10" text-anchor="middle" font-size="9" font-weight="600" fill="var(--c-stream-a)">A</text>',
  streamB: '<path d="M1 14h22" stroke="var(--c-stream-b)" stroke-width="3" stroke-linecap="round"/><text x="12" y="10" text-anchor="middle" font-size="9" font-weight="600" fill="var(--c-stream-b)">B</text>',
  expert: '<rect x="6" y="4" width="12" height="12" fill="var(--c-expert)" fill-opacity="0.35" stroke="var(--c-expert)" stroke-width="1.5"/>',
  router: '<path d="M12 2.5l7 7.5-7 7.5-7-7.5z" fill="var(--c-router)" fill-opacity="0.35" stroke="var(--c-router)" stroke-width="1.5"/>',
  gate: '<path d="M3 16C6 3 18 3 21 16" fill="none" stroke="var(--c-gate)" stroke-width="3" stroke-linecap="round"/>',
  ternary: '<rect x="1" y="5" width="7" height="10" fill="var(--c-ternary-minus)"/><rect x="8.5" y="5" width="7" height="10" fill="var(--c-ternary-zero)" stroke="var(--c-hairline)"/><rect x="16" y="5" width="7" height="10" fill="var(--c-ternary-plus)"/>',
};

/**
 * Legend of the six colour roles; every entry pairs the colour with its scene shape.
 * Simple: a quiet, always-visible key (no buttons; pointing at an entry previews the highlight).
 * Advanced: collapsible, and the entries are buttons: hover previews, click pins (click again clears).
 */
export function createLegend(deps: LegendDeps): Legend {
  const el = document.createElement('section');
  el.className = 'legend';
  el.dataset.control = 'legend';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'hud-btn hud-btn--ghost legend-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const title = document.createElement('h2');
  title.className = 'legend-title';
  const list = document.createElement('ul');
  list.className = 'legend-list';
  list.id = 'legend-list';
  toggle.setAttribute('aria-controls', list.id);
  let pinned: Role | null = null;
  let hovered: Role | null = null;
  let open = false;
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
      b.innerHTML = `<svg class="legend-shape" viewBox="0 0 24 20" width="24" height="20" aria-hidden="true">${SHAPE[r]}</svg><span class="legend-name"></span>`;
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
    if (!simple) {
      const hint = document.createElement('li');
      hint.className = 'legend-hint';
      list.append(hint);
    }
  };

  const setOpen = (o: boolean): void => {
    open = o;
    const simple = getMode() === 'simple';
    list.hidden = !simple && !open;
    toggle.setAttribute('aria-expanded', String(open));
    el.classList.toggle('open', simple || open);
  };
  toggle.addEventListener('click', () => setOpen(!open));

  const paint = (): void => {
    const simple = getMode() === 'simple';
    el.dataset.mode = getMode();
    if (builtFor !== getMode()) {
      // Pins belong to the Advanced tool; Simple has none.
      if (simple && pinned) { pinned = null; emit(); }
      build(simple);
      builtFor = getMode();
    }
    toggle.hidden = simple;
    title.hidden = !simple;
    title.textContent = t('legend.title');
    toggle.innerHTML = `${ICONS.legend}<span>${t('legend.title')}</span>`;
    toggle.title = t('legend.tip');
    const hint = list.querySelector('.legend-hint');
    if (hint) hint.textContent = t('legend.hint');
    for (const [r, b] of items) (b.querySelector('.legend-name') as HTMLElement).textContent = t(`role.${r}` as StringKey);
    setOpen(open);
  };
  paint();
  const off = onPrefsChange(paint);
  el.append(title, toggle, list);
  return { element: el, pinned: () => pinned, setOpen, dispose: () => { off(); el.remove(); } };
}
