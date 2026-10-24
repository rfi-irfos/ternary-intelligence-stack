// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_IDS, SIDEBAR_KEY, SIDEBAR_MIN, clampSidebarWidth, createSidebar, type Sidebar } from '../src/ui/sidebar';
import { createTopBar } from '../src/ui/topbar';
import { setLang, t } from '../src/ui/prefs';

const win = { innerWidth: 1280 };
const made: Sidebar[] = [];
function make(deps: Parameters<typeof createSidebar>[0] = { win }) {
  const sb = createSidebar(deps);
  document.body.append(sb.element, sb.edgeTab);
  made.push(sb);
  return sb;
}

beforeEach(() => { localStorage.removeItem(SIDEBAR_KEY); });
afterEach(() => {
  while (made.length) made.pop()!.dispose();
  setLang('en');
  document.documentElement.style.removeProperty('--side-w');
});

describe('OS sidebar (Task 11d addendum 1)', () => {
  it('has the five sections in the order Sitzung, Modell, Inspektion, Analyse, Darstellung', () => {
    setLang('de');
    const sb = make();
    expect(SECTION_IDS).toEqual(['session', 'model', 'inspect', 'analysis', 'display']);
    const heads = [...sb.element.querySelectorAll('.side-sec-toggle')].map((x) => x.textContent?.trim());
    expect(heads).toEqual(['Sitzung', 'Modell', 'Inspektion', 'Analyse', 'Darstellung']);
    expect([...sb.element.querySelectorAll<HTMLElement>('.side-sec')].map((x) => x.dataset.side)).toEqual([...SECTION_IDS]);
  });

  it('is closed at first; the edge tab opens it, the close button and Esc close it', () => {
    const sb = make();
    expect(sb.isOpen()).toBe(false);
    expect(sb.element.hidden).toBe(true);
    expect(sb.edgeTab.hidden).toBe(false);
    sb.edgeTab.click();
    expect(sb.isOpen()).toBe(true);
    expect(sb.element.hidden).toBe(false);
    expect(sb.edgeTab.hidden).toBe(true);
    expect(document.body.classList.contains('side-open')).toBe(true);
    sb.element.querySelector<HTMLButtonElement>('.sidebar-close')!.click();
    expect(sb.isOpen()).toBe(false);
    expect(document.body.classList.contains('side-open')).toBe(false);
    sb.open();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const later = vi.fn();
    document.addEventListener('keydown', later);
    document.dispatchEvent(esc);
    document.removeEventListener('keydown', later);
    expect(sb.isOpen()).toBe(false);
    // Esc closes one level and stops there: the camera rig's overview flight never sees the key.
    expect(later).not.toHaveBeenCalled();
  });

  it('Esc yields while something else owns the key', () => {
    let busy = true;
    const sb = make({ win, yieldEsc: () => busy });
    sb.open();
    const later = vi.fn();
    document.addEventListener('keydown', later);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sb.isOpen()).toBe(true);
    expect(later).toHaveBeenCalled();
    busy = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', later);
    expect(sb.isOpen()).toBe(false);
  });

  it('the top bar button toggles it', () => {
    const sb = make();
    const top = createTopBar(null);
    document.body.append(top.element);
    expect(top.sidebarButton).toBeDefined();
    top.sidebarButton.addEventListener('click', () => sb.toggle());
    top.sidebarButton.click();
    expect(sb.isOpen()).toBe(true);
    top.sidebarButton.click();
    expect(sb.isOpen()).toBe(false);
    top.dispose();
  });

  it('remembers which sections are folded across a reload', () => {
    const sb = make();
    expect(SECTION_IDS.every((id) => sb.sectionOpen(id))).toBe(true);
    sb.element.querySelector<HTMLButtonElement>('#side-toggle-analysis')!.click();
    expect(sb.sectionOpen('analysis')).toBe(false);
    expect(sb.body('analysis').hidden).toBe(true);
    expect(sb.element.querySelector('#side-toggle-analysis')!.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem(SIDEBAR_KEY)!).folded).toEqual(['analysis']);
    sb.dispose();
    made.pop();
    const again = make();
    expect(again.sectionOpen('analysis')).toBe(false);
    expect(again.sectionOpen('model')).toBe(true);
    again.open(['analysis']);
    expect(again.sectionOpen('analysis')).toBe(true);
  });

  it('ignores unknown or broken stored state', () => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ width: 'wide', folded: ['nope', 'display'] }));
    const sb = make();
    expect(sb.sectionOpen('display')).toBe(false);
    expect(sb.width()).toBe(clampSidebarWidth(1280 * 0.22, 1280));
    localStorage.setItem(SIDEBAR_KEY, '{not json');
    const sb2 = make();
    expect(sb2.sectionOpen('display')).toBe(true);
  });

  it('clamps the width to 280 px .. 40 % of the viewport and keeps it', () => {
    expect(clampSidebarWidth(100, 1280)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(9999, 1280)).toBe(512);
    expect(clampSidebarWidth(9999, 1920)).toBe(768);
    expect(clampSidebarWidth(400, 1280)).toBe(400);
    // A very narrow viewport: the minimum wins.
    expect(clampSidebarWidth(500, 500)).toBe(SIDEBAR_MIN);
    const sb = make();
    sb.setWidth(50);
    expect(sb.width()).toBe(280);
    sb.setWidth(2000);
    expect(sb.width()).toBe(512);
    sb.setWidth(333);
    expect(sb.element.style.width).toBe('333px');
    expect(document.documentElement.style.getPropertyValue('--side-w')).toBe('333px');
    expect(JSON.parse(localStorage.getItem(SIDEBAR_KEY)!).width).toBe(333);
    sb.dispose();
    made.pop();
    expect(make().width()).toBe(333);
  });

  it('starts at 22 % of the viewport', () => {
    expect(make({ win: { innerWidth: 1920 } }).width()).toBe(422);
  });

  it('dragging the left edge sets the width; the arrow keys on the grip too', () => {
    const sb = make();
    const grip = sb.element.querySelector<HTMLElement>('.sidebar-grip')!;
    grip.dispatchEvent(new MouseEvent('pointerdown', { clientX: 900, bubbles: true }));
    grip.dispatchEvent(new MouseEvent('pointermove', { clientX: 880, bubbles: true }));
    expect(sb.width()).toBe(1280 - 8 - 880);
    grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    grip.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, bubbles: true }));
    expect(sb.width()).toBe(392);
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(sb.width()).toBe(408);
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(sb.width()).toBe(392);
  });

  it('labels follow the language and the controls are named', () => {
    const sb = make();
    expect(sb.element.getAttribute('aria-label')).toBe(t('side.label'));
    setLang('de');
    expect(sb.element.getAttribute('aria-label')).toBe('Seitenleiste');
    expect(sb.edgeTab.getAttribute('aria-label')).toBe('Seitenleiste öffnen oder schließen');
    expect(sb.element.querySelector('.sidebar-grip')!.getAttribute('aria-label')?.length).toBeGreaterThan(0);
  });

  it('notifies listeners on open, close and width changes', () => {
    const sb = make();
    const cb = vi.fn();
    const off = sb.onChange(cb);
    sb.open();
    sb.setWidth(300);
    sb.close();
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    sb.open();
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
