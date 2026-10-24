// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_IDS, SIDEBAR_KEY, SIDEBAR_MIN, clampSidebarWidth, createSidebar, sidebarMax, type Sidebar } from '../src/ui/sidebar';
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
  it('has the four sections in the order Sitzung, Modell, Inspektion, Analyse (no Display section any more)', () => {
    setLang('de');
    const sb = make();
    expect(SECTION_IDS).toEqual(['session', 'model', 'inspect', 'analysis']);
    const heads = [...sb.element.querySelectorAll('.side-sec-toggle')].map((x) => x.textContent?.trim());
    expect(heads).toEqual(['Sitzung', 'Modell', 'Inspektion', 'Analyse']);
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

  it('the top bar has no Panel button; the gear opens a dropdown (not the sidebar); the edge tab is reachable by keyboard', () => {
    const sb = make();
    const top = createTopBar(null);
    document.body.append(top.element);
    expect(top.element.querySelector('.sidebar-btn')).toBeNull();
    top.gear.click();
    expect(top.settings.isOpen()).toBe(true);
    expect(sb.isOpen()).toBe(false);
    top.dispose();
    // the edge tab is a real button (focusable, with a name) that opens the closed panel
    expect(sb.edgeTab.tagName).toBe('BUTTON');
    expect(sb.edgeTab.tabIndex).toBeGreaterThanOrEqual(0);
    expect(sb.edgeTab.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    sb.edgeTab.focus();
    expect(document.activeElement).toBe(sb.edgeTab);
  });

  it('the head row holds title, a slot for Einfach | Erweitert, and the close button, in that order', () => {
    const sb = make();
    sb.open();
    const head = sb.element.querySelector('.sidebar-head')!;
    expect([...head.children].map((x) => x.className)).toEqual(['sidebar-title', 'sidebar-head-tools', 'hud-icon hud-icon--small sidebar-close']);
    expect(sb.headTools.parentElement).toBe(head);
    // not inside any section: it stays visible when every section is folded
    for (const id of SECTION_IDS) sb.setSectionOpen(id, false);
    sb.headTools.append(document.createElement('button'));
    expect(sb.headTools.closest('[hidden]')).toBeNull();
    expect(sb.element.querySelector('.side-sec-body [class*="mode"]')).toBeNull();
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
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ width: 'wide', folded: ['nope', 'display', 'analysis'] }));
    const sb = make();
    expect(sb.sectionOpen('analysis')).toBe(false);
    expect(sb.sectionOpen('model')).toBe(true);
    expect(sb.width()).toBe(clampSidebarWidth(1280 * 0.22, 1280));
    localStorage.setItem(SIDEBAR_KEY, '{not json');
    const sb2 = make();
    expect(sb2.sectionOpen('analysis')).toBe(true);
  });

  it('clamps the width to 280 px .. min(40 % of the viewport, half the viewport - 232 px) and keeps it, but only after the visitor resized', () => {
    expect(clampSidebarWidth(100, 1280)).toBe(SIDEBAR_MIN);
    // 1280: min(512, 408) = 408; 1920: min(768, 728) = 728; 2560: min(1024, 1048) = 1024 (the old 40 % cap for wide viewports)
    expect(sidebarMax(1280)).toBe(408);
    expect(sidebarMax(1920)).toBe(728);
    expect(sidebarMax(2560)).toBe(1024);
    expect(clampSidebarWidth(9999, 1280)).toBe(408);
    expect(clampSidebarWidth(9999, 1920)).toBe(728);
    expect(clampSidebarWidth(9999, 2560)).toBe(1024);
    expect(clampSidebarWidth(400, 1280)).toBe(400);
    // A very narrow viewport: the minimum wins.
    expect(clampSidebarWidth(500, 500)).toBe(SIDEBAR_MIN);
    const sb = make();
    // nothing is stored for the default width, even after opening and folding
    sb.open();
    sb.setSectionOpen('analysis', false);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_KEY)!).width).toBeNull();
    sb.setWidth(50);
    expect(sb.width()).toBe(280);
    sb.setWidth(2000);
    expect(sb.width()).toBe(408);
    sb.setWidth(333);
    expect(sb.element.style.width).toBe('333px');
    expect(document.documentElement.style.getPropertyValue('--side-w')).toBe('333px');
    expect(JSON.parse(localStorage.getItem(SIDEBAR_KEY)!).width).toBe(333);
    sb.dispose();
    made.pop();
    expect(make().width()).toBe(333);
  });

  it('until the visitor resizes, the default 22 % follows the viewport', () => {
    const v = { innerWidth: 1280 };
    const sb = make({ win: v });
    expect(sb.width()).toBe(282);
    v.innerWidth = 1920;
    window.dispatchEvent(new Event('resize'));
    expect(sb.width()).toBe(422);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();
    // after a resize by the visitor the width is theirs
    sb.setWidth(300);
    v.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));
    expect(sb.width()).toBe(300);
    // and a user width above the new 40 % limit is clamped without being forgotten
    v.innerWidth = 600;
    window.dispatchEvent(new Event('resize'));
    expect(sb.width()).toBe(280);
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

describe('width handle is an accessible separator', () => {
  it('carries its value, the minimum and the maximum, and follows the width', () => {
    const sb = make();
    const grip = sb.element.querySelector('.sidebar-grip')!;
    expect(grip.getAttribute('aria-valuenow')).toBe(String(sb.width()));
    expect(grip.getAttribute('aria-valuemin')).toBe(String(SIDEBAR_MIN));
    expect(grip.getAttribute('aria-valuemax')).toBe(String(sidebarMax(1280)));
    sb.setWidth(333);
    expect(grip.getAttribute('aria-valuenow')).toBe('333');
  });
});
