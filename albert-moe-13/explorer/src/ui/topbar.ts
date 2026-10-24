import { ICONS } from './icons';
import { getLang, onPrefsChange, setLang, t } from './prefs';
import { type Lang, LANGS, TOUR_IDS } from './strings';
import { closeTourMenu, isTourMenuOpen, openTourMenu } from './tourMenu';

export interface TopBar {
  element: HTMLElement;
  /** Home: closes everything and returns to the main menu (lobby); the app wires the click. */
  home: HTMLButtonElement;
  /** Content of the settings popover (quality), behind the gear (both modes). */
  settings: HTMLElement;
  toursButton: HTMLButtonElement;
  /** Opens or closes the side panel (the app wires the click; aria-expanded follows setSidebarOpen). */
  sidebarButton: HTMLButtonElement;
  setSidebarOpen(open: boolean): void;
  gear: HTMLButtonElement;
  dispose(): void;
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
 * wordmark and the home (overview) icon, named by its tooltip. Right: compass + "Tour", the DE | EN pill
 * and the settings gear (quality). Einfach | Erweitert lives in the dock (src/ui/player.ts). Each
 * top-level control carries `data-control`, so the HUD can be counted (Simple: at most 5). Switching
 * language re-renders the bar in place: no reload, no camera move.
 */
export function createTopBar(title: HTMLElement | null, opts: { onGear?: () => void } = {}): TopBar {
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
  left.append(home);

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
  const pop = document.createElement('div');
  pop.className = 'settings-pop';
  pop.setAttribute('role', 'dialog');
  pop.tabIndex = -1;
  pop.hidden = true;
  const settings = document.createElement('div');
  settings.className = 'top-settings';
  pop.append(settings);
  const setPop = (open: boolean): void => {
    pop.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
    if (open) (pop.querySelector<HTMLElement>('select, button') ?? pop).focus();
  };
  gear.addEventListener('click', () => (opts.onGear ? opts.onGear() : setPop(pop.hidden)));
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setPop(false); gear.focus(); }
  });
  const onDocDown = (e: PointerEvent): void => {
    if (!pop.hidden && !pop.contains(e.target as Node) && !gear.contains(e.target as Node)) setPop(false);
  };
  document.addEventListener('pointerdown', onDocDown);
  const prefs = document.createElement('div');
  prefs.className = 'top-prefs';
  prefs.dataset.control = 'prefs';
  const sidebar = document.createElement('button');
  sidebar.type = 'button';
  sidebar.className = 'hud-btn tray-item sidebar-btn';
  sidebar.dataset.control = 'sidebar';
  sidebar.setAttribute('aria-expanded', 'false');
  const sidebarText = document.createElement('span');
  sidebar.innerHTML = ICONS.sidebar;
  sidebar.append(sidebarText);
  prefs.append(lang.wrap, gear, pop);
  const right = document.createElement('div');
  right.className = 'top-right';
  right.append(tours, prefs, sidebar);
  el.append(left, right);

  const paint = (): void => {
    home.title = t('nav.homeTip');
    homeText.textContent = t('nav.homeText');
    sidebarText.textContent = t('side.toggle');
    sidebar.title = t('side.toggleTip');
    toursText.textContent = t('app.tours');
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
    pop.setAttribute('aria-label', t('settings.label'));
    lang.sync();
  };
  paint();
  const off = onPrefsChange(paint);
  return {
    element: el, home, settings, toursButton: tours, sidebarButton: sidebar, gear,
    setSidebarOpen: (o) => sidebar.setAttribute('aria-expanded', String(o)),
    dispose: () => { off(); document.removeEventListener('pointerdown', onDocDown); el.remove(); },
  };
}
