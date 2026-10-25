import { ICONS } from './icons';
import { getLang, onPrefsChange, setLang, t } from './prefs';
import { type Lang, LANGS, type StringKey, TOUR_IDS } from './strings';
import { closeTourMenu, isTourMenuOpen, openTourMenu } from './tourMenu';

export interface TopBar {
  element: HTMLElement;
  /** Home: closes everything and returns to the main menu (lobby); the app wires the click. */
  home: HTMLButtonElement;
  toursButton: HTMLButtonElement;
  /** Shows or hides the training backdrop (the exhibit); the app wires the click and keeps `aria-pressed`. */
  exhibitButton: HTMLButtonElement;
  /** Navigation group of the right side: Lobby, Legende (the app inserts it before Tour), Tour. */
  nav: HTMLElement;
  gear: HTMLButtonElement;
  /** The settings dropdown under the gear; the app mounts Quality and Sound into `settingsBody`. */
  settings: { element: HTMLElement; body: HTMLElement; isOpen(): boolean; open(): void; close(): void };
  dispose(): void;
}

/** One row of the settings dropdown: a quiet label over the control (the quality menu brings its own label). */
export function settingsField(labelKey: StringKey, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'hud-field settings-field';
  const label = document.createElement('span');
  label.className = 'hud-field-label';
  const paint = (): void => { label.textContent = t(labelKey); };
  paint();
  onPrefsChange(paint);
  row.append(label, control);
  return row;
}

export function segmented<T extends string>(cls: string, values: readonly T[], get: () => T, set: (v: T) => void) {
  const wrap = document.createElement('div');
  wrap.className = `hud-segmented ${cls}`;
  const label = document.createElement('span');
  label.className = 'hud-field-label';
  const group = document.createElement('div');
  group.className = 'hud-segment';
  group.setAttribute('role', 'radiogroup');
  const buttons = values.map((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = v;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => set(v));
    group.append(b);
    return b;
  });
  wrap.append(label, group);
  const sync = (): void => {
    for (const b of buttons) {
      const on = b.dataset.value === get();
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('active', on);
      b.tabIndex = on ? 0 : -1;
    }
  };
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const k = values.indexOf(get());
    const n = values[(k + (e.key === 'ArrowRight' ? 1 : values.length - 1)) % values.length] as T;
    set(n);
    buttons[values.indexOf(n)]?.focus();
  });
  return { wrap, label, group, buttons, sync };
}

/**
 * OS-style system bar: one slim full-width row of translucent glass with a hairline under it. Left: the
 * wordmark only. Right: the navigation (Lobby, Legende, Tour, Training picture), a thin divider, then the settings (DE | EN
 * pill and the gear, which opens a dropdown with Quality and Sound). Einfach | Erweitert lives in the
 * sidebar head (src/ui/player.ts). Each
 * top-level control carries `data-control`, so the HUD can be counted (Simple: at most 5). Switching
 * language re-renders the bar in place: no reload, no camera move.
 */
export function createTopBar(title: HTMLElement | null): TopBar {
  const el = document.createElement('header');
  el.className = 'top-bar';
  const left = document.createElement('div');
  left.className = 'top-left';
  if (title) left.append(title);
  const home = document.createElement('button');
  home.type = 'button';
  home.className = 'hud-btn tray-item home-btn';
  home.dataset.control = 'home';
  const homeText = document.createElement('span');
  home.innerHTML = ICONS.home;
  home.append(homeText);

  const exhibitBtn = document.createElement('button');
  exhibitBtn.type = 'button';
  exhibitBtn.className = 'hud-btn tray-item exhibit-btn';
  exhibitBtn.dataset.control = 'guide';
  const exhibitText = document.createElement('span');
  exhibitBtn.innerHTML = ICONS.eye;
  exhibitBtn.append(exhibitText);

  const tours = document.createElement('button');
  tours.type = 'button';
  tours.className = 'hud-btn tray-item tours-btn';
  tours.dataset.control = 'guide';
  tours.setAttribute('aria-haspopup', 'dialog');
  tours.setAttribute('aria-expanded', 'false');
  const toursText = document.createElement('span');
  tours.innerHTML = ICONS.target;
  tours.append(toursText);
  tours.addEventListener('click', () => {
    if (isTourMenuOpen()) closeTourMenu();
    else openTourMenu({ returnFocus: tours });
    tours.setAttribute('aria-expanded', String(isTourMenuOpen()));
  });

  const lang = segmented<Lang>('lang-toggle', LANGS, getLang, setLang);
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'hud-icon tray-item settings-btn';
  gear.innerHTML = ICONS.gear;
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.setAttribute('aria-expanded', 'false');
  // The settings dropdown: anchored under the gear, closes on an outside press and on Esc.
  const menu = document.createElement('div');
  menu.className = 'settings-menu';
  menu.setAttribute('role', 'dialog');
  menu.hidden = true;
  menu.tabIndex = -1;
  const menuBody = document.createElement('div');
  menuBody.className = 'settings-body';
  menu.append(menuBody);
  const setMenu = (open: boolean, focusBack = false): void => {
    if (menu.hidden === !open) return;
    menu.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector<HTMLElement>('select, button, input') ?? menu).focus();
    else if (focusBack) gear.focus();
  };
  gear.addEventListener('click', () => setMenu(menu.hidden));
  const onDocDown = (e: Event): void => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !gear.contains(e.target as Node)) setMenu(false);
  };
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || menu.hidden) return;
    e.stopImmediatePropagation(); // the camera rig and the side panel must not also react to this press
    e.preventDefault();
    setMenu(false, true);
  };
  document.addEventListener('pointerdown', onDocDown);
  document.addEventListener('keydown', onDocKey, true);
  const prefs = document.createElement('div');
  prefs.className = 'top-prefs';
  prefs.dataset.control = 'prefs';
  prefs.append(lang.wrap, gear);
  const nav = document.createElement('div');
  nav.className = 'top-nav';
  nav.append(home, tours, exhibitBtn);
  const divider = document.createElement('span');
  divider.className = 'top-divider';
  divider.setAttribute('aria-hidden', 'true');
  const right = document.createElement('div');
  right.className = 'top-right';
  right.append(nav, divider, prefs);
  el.append(left, right, menu);

  const paint = (): void => {
    home.title = t('nav.homeTip');
    homeText.textContent = t('nav.homeText');
    toursText.textContent = t('app.tours');
    exhibitText.textContent = t('nav.exhibitText');
    exhibitBtn.title = t('nav.exhibitTip');
    tours.title = t('app.toursTip', { n: TOUR_IDS.length });
    lang.label.textContent = t('lang.label');
    lang.group.setAttribute('aria-label', t('lang.label'));
    for (const b of lang.buttons) {
      b.textContent = (b.dataset.value ?? '').toUpperCase();
      b.setAttribute('lang', b.dataset.value ?? '');
      b.title = b.dataset.value === 'de' ? 'Deutsch' : 'English';
    }
    gear.setAttribute('aria-label', t('settings.label'));
    gear.title = t('settings.tip');
    menu.setAttribute('aria-label', t('settings.label'));
    lang.sync();
  };
  paint();
  const off = onPrefsChange(paint);
  return {
    element: el, home, toursButton: tours, exhibitButton: exhibitBtn, nav, gear,
    settings: { element: menu, body: menuBody, isOpen: () => !menu.hidden, open: () => setMenu(true), close: () => setMenu(false) },
    dispose: () => {
      off();
      document.removeEventListener('pointerdown', onDocDown);
      document.removeEventListener('keydown', onDocKey, true);
      el.remove();
    },
  };
}
