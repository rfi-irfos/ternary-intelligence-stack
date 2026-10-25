// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createTopBar } from '../src/ui/topbar';
import { settingsField } from '../src/ui/topbar';
import { setLang, t } from '../src/ui/prefs';

const made: Array<ReturnType<typeof createTopBar>> = [];
function make() {
  const wordmark = document.createElement('span');
  wordmark.className = 'wordmark';
  wordmark.textContent = 'albert.';
  const top = createTopBar(wordmark);
  // the app puts the legend chip in front of Tour
  const legend = document.createElement('button');
  legend.className = 'legend-toggle tray-item';
  legend.textContent = 'Legend';
  top.nav.insertBefore(legend, top.toursButton);
  document.body.append(top.element);
  made.push(top);
  return { top, legend };
}
afterEach(() => {
  while (made.length) made.pop()!.dispose();
  setLang('en');
  document.body.innerHTML = '';
});

describe('E: top bar, wordmark left, everything else right', () => {
  it('left holds only the wordmark; right holds Lobby, Legende, Tour, a thin divider, DE | EN and the gear, in that order', () => {
    const { top, legend } = make();
    const left = top.element.querySelector('.top-left')!;
    expect([...left.children].map((x) => x.className)).toEqual(['wordmark']);
    const right = top.element.querySelector('.top-right')!;
    expect([...right.children].map((x) => x.className)).toEqual(['top-nav', 'top-divider', 'top-prefs']);
    expect([...top.nav.children]).toEqual([top.home, legend, top.toursButton, top.exhibitButton]);
    // the training picture is one click away, in the same control group as Legende and Tour (no extra HUD group)
    expect(top.exhibitButton.dataset.control).toBe('guide');
    expect(top.exhibitButton.textContent).toBe('Training');
    expect(top.exhibitButton.title).toBe(t('nav.exhibitTip'));
    expect(top.home.dataset.control).toBe('home');
    const prefs = right.querySelector('.top-prefs')!;
    expect([...prefs.children].map((x) => x.className.split(' ')[0])).toEqual(['hud-segmented', 'hud-icon']);
    expect(prefs.lastElementChild).toBe(top.gear);
    expect(right.querySelector('.top-divider')!.getAttribute('aria-hidden')).toBe('true');
    // German names
    setLang('de');
    expect(top.home.textContent).toBe(t('nav.homeText'));
    expect(top.toursButton.textContent).toBe(t('app.tours'));
    expect(top.exhibitButton.title).toBe('Die Trainings-Kulisse hinter dem Modell ein- oder ausblenden');
  });
});

describe('G: the gear opens a settings dropdown', () => {
  it('toggles on the gear, closes on Esc (focus back on the gear) and on an outside press; aria state follows', () => {
    const { top } = make();
    const outside = document.createElement('button');
    document.body.append(outside);
    expect(top.gear.getAttribute('aria-haspopup')).toBeTruthy();
    expect(top.gear.getAttribute('aria-expanded')).toBe('false');
    expect(top.settings.element.hidden).toBe(true);
    top.gear.click();
    expect(top.settings.isOpen()).toBe(true);
    expect(top.gear.getAttribute('aria-expanded')).toBe('true');
    // a press inside keeps it open
    top.settings.element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(top.settings.isOpen()).toBe(true);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(esc);
    expect(top.settings.isOpen()).toBe(false);
    expect(top.gear.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(top.gear);
    top.gear.click();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(top.settings.isOpen()).toBe(false);
    top.gear.click();
    top.gear.click();
    expect(top.settings.isOpen()).toBe(false);
  });

  it('Esc while the dropdown is open does not reach other Esc handlers (the sidebar, the camera rig)', () => {
    const { top } = make();
    let later = 0;
    const on = (): void => { later++; };
    document.addEventListener('keydown', on);
    top.gear.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(later).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(later).toBe(1); // closed: Esc is for the others again
    document.removeEventListener('keydown', on);
  });

  it('holds Quality and Sound rows with German names; the gear is named Einstellungen', () => {
    const { top } = make();
    const quality = document.createElement('label');
    quality.className = 'hud-field quality-menu';
    top.settings.body.append(quality, settingsField('settings.sound', document.createElement('button')));
    expect(top.settings.element.contains(quality)).toBe(true);
    expect(top.settings.body.querySelector('.settings-field .hud-field-label')!.textContent).toBe('Sound');
    setLang('de');
    expect(top.settings.body.querySelector('.settings-field .hud-field-label')!.textContent).toBe('Ton');
    expect(top.gear.getAttribute('aria-label')).toBe('Einstellungen');
    expect(top.settings.element.getAttribute('aria-label')).toBe('Einstellungen');
    expect(t('quality.label')).toBe('Qualität');
  });
});
