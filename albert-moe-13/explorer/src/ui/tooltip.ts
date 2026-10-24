import type { ComponentId } from '../scene/ids';
import { ROLE_VAR, hoverText, roleOf } from './roles';

export interface HoverTip {
  element: HTMLElement;
  /** Shows the name and role colour of `id` (null hides). */
  show(id: ComponentId | null): void;
  /** Places the tip next to the pointer (kept inside the viewport). */
  move(x: number, y: number): void;
  /** Re-renders the text (after a language or mode switch). */
  refresh(): void;
  current(): ComponentId | null;
}

const OFFSET = 14;

/** Small label that follows the pointer over the scene: role swatch plus the component's name. */
export function createHoverTip(): HoverTip {
  const el = document.createElement('div');
  el.className = 'hover-tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  const dot = document.createElement('span');
  dot.className = 'hover-tip-dot';
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  el.append(dot, text);
  let cur: ComponentId | null = null;
  // Size of the tip, measured once per text change (paint), never per pointer move.
  let w = 160;
  let h = 28;
  const paint = (): void => {
    if (!cur) return;
    const role = roleOf(cur);
    el.style.setProperty('--role', role ? ROLE_VAR[role] : 'var(--c-neutral)');
    el.dataset.role = role ?? 'neutral';
    text.textContent = hoverText(cur);
    w = el.offsetWidth || 160;
    h = el.offsetHeight || 28;
  };
  return {
    element: el,
    show(id) {
      cur = id;
      el.hidden = !id;
      paint();
    },
    move(x, y) {
      const vw = typeof window === 'undefined' ? 1e9 : window.innerWidth;
      const vh = typeof window === 'undefined' ? 1e9 : window.innerHeight;
      const left = x + OFFSET + w > vw ? x - OFFSET - w : x + OFFSET;
      const top = y + OFFSET + h > vh ? y - OFFSET - h : y + OFFSET;
      el.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`;
    },
    refresh: paint,
    current: () => cur,
  };
}
