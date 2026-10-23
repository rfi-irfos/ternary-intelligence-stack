import { ICONS } from './icons';
import { getLang, getMode, onPrefsChange, setLang, setMode, t } from './prefs';
import { type Lang, LANGS, type Mode, MODES, type StringKey } from './strings';
import { closeTourMenu, isTourMenuOpen, openTourMenu } from './tourMenu';

export interface TopBar {
  element: HTMLElement;
  /** Home: closes every level and shows the whole model (the app wires the click). */
  home: HTMLButtonElement;
  /** Content of the settings popover (quality), behind the gear; the gear shows in Advanced only. */
  settings: HTMLElement;
  toursButton: HTMLButtonElement;
  dispose(): void;
}

function segmented<T extends string>(cls: string, values: readonly T[], get: () => T, set: (v: T) => void) {
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
 * Top bar, anchored like a game HUD. Left: the title and the home button. Right: the guided-tours call
 * to action, then one small cluster with DE | EN, Simple | Advanced and (Advanced only) the settings
 * gear. Each top-level control carries `data-control`, so the HUD can be counted (Simple: at most 5).
 * Switching language or mode re-renders the HUD in place: no reload, no camera move.
 */
export function createTopBar(title: HTMLElement | null): TopBar {
  const el = document.createElement('header');
  el.className = 'top-bar';
  const left = document.createElement('div');
  left.className = 'top-left';
  if (title) left.append(title);
  const home = document.createElement('button');
  home.type = 'button';
  home.className = 'hud-btn hud-btn--ghost home-btn';
  home.dataset.control = 'home';
  home.innerHTML = ICONS.overview;
  const homeText = document.createElement('span');
  home.append(homeText);
  left.append(home);

  const tours = document.createElement('button');
  tours.type = 'button';
  tours.className = 'hud-btn tours-btn';
  tours.dataset.control = 'tours';
  tours.setAttribute('aria-haspopup', 'dialog');
  tours.setAttribute('aria-expanded', 'false');
  const toursText = document.createElement('span');
  tours.innerHTML = ICONS.tour;
  tours.append(toursText);
  tours.addEventListener('click', () => {
    if (isTourMenuOpen()) closeTourMenu();
    else openTourMenu({ returnFocus: tours });
    tours.setAttribute('aria-expanded', String(isTourMenuOpen()));
  });

  const mode = segmented<Mode>('mode-toggle', MODES, getMode, setMode);
  const lang = segmented<Lang>('lang-toggle', LANGS, getLang, setLang);
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'hud-icon hud-icon--small settings-btn';
  gear.innerHTML = ICONS.gear;
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.setAttribute('aria-expanded', 'false');
  const pop = document.createElement('div');
  pop.className = 'settings-pop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  const settings = document.createElement('div');
  settings.className = 'top-settings';
  pop.append(settings);
  const setPop = (open: boolean): void => {
    pop.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
  };
  gear.addEventListener('click', () => setPop(pop.hidden));
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
  prefs.append(lang.wrap, mode.wrap, gear, pop);
  const right = document.createElement('div');
  right.className = 'top-right';
  right.append(tours, prefs);
  el.append(left, right);

  const paint = (): void => {
    homeText.textContent = t('nav.overview');
    home.title = t('nav.overviewTip');
    home.setAttribute('aria-label', t('nav.overview'));
    toursText.textContent = t('app.tours');
    tours.title = t('app.toursTip');
    mode.label.textContent = t('mode.label');
    mode.group.setAttribute('aria-label', t('mode.label'));
    for (const b of mode.buttons) {
      b.textContent = t(`mode.${b.dataset.value}` as StringKey);
      b.title = t(`mode.${b.dataset.value}Tip` as StringKey);
    }
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
    mode.sync();
    lang.sync();
    const simple = getMode() === 'simple';
    gear.hidden = simple;
    if (simple) setPop(false);
  };
  paint();
  const off = onPrefsChange(paint);
  return {
    element: el, home, settings, toursButton: tours,
    dispose: () => { off(); document.removeEventListener('pointerdown', onDocDown); el.remove(); },
  };
}
