import * as THREE from 'three';
import type { CameraPose, CameraRig } from '../camera/controls';
import type { Sound } from '../audio/sound';
import { APP_NAME } from '../content/brand';
import type { Architecture } from '../data/architecture';
import { fmt, kindName, structure } from '../data/labeled';
import { createAbout, dateText } from './about';
import { ICONS } from './icons';
import type { PlayerBar } from './player';
import { getLang, getMode, onPrefsChange, setLang, setMode, t } from './prefs';
import { richT } from './richText';
import { type Lang, LANGS, type Mode, MODES, type StringKey } from './strings';
import { segmented } from './topbar';

/**
 * The lobby: a full-screen title screen over a slowly drifting, blurred view of the real scene. The
 * logotype, one subtitle (counts from architecture.json) and four plain entries (Explore, Guided tour,
 * Watch it think, About: the About dialog is ui/about.ts). One gear in the top right holds everything else:
 * DE | EN and Simple | Advanced (the same prefs state as the HUD), the sound toggle (off by default) and the
 * checkpoint line. Mouse alone is enough; the arrow keys move between the entries.
 *
 * Camera rule: the drift is the one scripted camera move without a user action. It runs only while the
 * lobby is visible (no interactive view exists then) and stops when the visitor leaves it.
 */

export type LobbyEntry = 'explore' | 'tour' | 'watch';
export const LOBBY_ENTRIES: LobbyEntry[] = ['explore', 'tour', 'watch'];

const ENTRY: Record<LobbyEntry, { icon: string; title: StringKey; desc: StringKey }> = {
  explore: { icon: ICONS.explore, title: 'lobby.explore', desc: 'lobby.exploreDesc' },
  tour: { icon: ICONS.tour, title: 'lobby.tour', desc: 'lobby.tourDesc' },
  watch: { icon: ICONS.watch, title: 'lobby.watch', desc: 'lobby.watchDesc' },
};

/** Camera pose of the drift at time `t` (s): a slow sway around the base pose's target, never a full turn. */
export function driftPose(base: CameraPose, t: number): CameraPose {
  const off = base.position.clone().sub(base.target);
  const yaw = 0.22 * Math.sin((2 * Math.PI * t) / 48);
  off.applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
  off.z += off.length() * 0.04 * Math.sin((2 * Math.PI * t) / 31);
  return { target: base.target.clone(), position: base.target.clone().add(off) };
}

/** What the per-frame drift needs; `base` is null once the visitor has entered (nothing drifts then). */
export interface DriftState {
  base: CameraPose | null;
  /** Seconds the drift has run. */
  t: number;
  /** The lobby is on screen. */
  visible: boolean;
  /** Low quality: a still frame. */
  still: boolean;
  /** prefers-reduced-motion. */
  reduced: boolean;
}

/**
 * One frame of the lobby drift: the pose to show, or null when nothing moves (after entry, lobby not
 * visible, Low quality, reduced motion). It is the only camera move without a user action; time only
 * advances while it runs.
 */
export function driftTick(s: DriftState, dt: number): CameraPose | null {
  if (!s.base || !s.visible || s.still || s.reduced) return null;
  s.t += dt;
  return driftPose(s.base, s.t);
}

/** Sound on/off button: the same Sound state wherever it is placed (lobby footer, HUD settings). */
export function soundToggle(snd: Pick<Sound, 'muted' | 'mute' | 'init' | 'onChange'>, doc: Document = document): { element: HTMLButtonElement; dispose(): void } {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'hud-btn hud-btn--ghost sound-toggle';
  b.dataset.control = 'sound';
  const icon = doc.createElement('span');
  icon.className = 'sound-icon';
  const label = doc.createElement('span');
  b.append(icon, label);
  const paint = (): void => {
    const on = !snd.muted();
    icon.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    label.textContent = t(on ? 'sound.on' : 'sound.off');
    b.setAttribute('aria-pressed', String(on));
    b.title = t('sound.tip');
  };
  // The click is a user gesture: it may unlock audio before turning it on.
  b.addEventListener('click', () => {
    snd.init();
    snd.mute(!snd.muted());
  });
  paint();
  const offSound = snd.onChange(paint);
  const offPrefs = onPrefsChange(paint);
  return { element: b, dispose: () => { offSound(); offPrefs(); b.remove(); } };
}

export interface LobbyDeps {
  arch: Architecture;
  /** Called with the chosen entry after the lobby has hidden itself. */
  onChoose: (e: LobbyEntry) => void;
  sound: Pick<Sound, 'muted' | 'mute' | 'init' | 'onChange'>;
  /** Date the runs were recorded (ISO), shown in the checkpoint line once known. */
  traceDate?: () => string | null;
  /** False once the recorded runs failed to load: "Watch it think" is then disabled with the reason as tooltip. */
  hasTrace?: () => boolean;
  doc?: Document;
}

export interface Lobby {
  element: HTMLElement;
  show(): void;
  hide(): void;
  visible(): boolean;
  /** The About blurb is open. */
  aboutOpen(): boolean;
  /** Repaints the checkpoint line (after the traces loaded). */
  refresh(): void;
  /** Low quality: no backdrop blur (a darker veil instead), and the drift stops. */
  setStill(still: boolean): void;
  still(): boolean;
  dispose(): void;
}

export function createLobby(deps: LobbyDeps): Lobby {
  const doc = deps.doc ?? document;
  const { arch } = deps;
  const m = arch.model;
  const el = doc.createElement('div');
  el.className = 'lobby';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lobby-title');
  el.hidden = true;

  const inner = doc.createElement('div');
  inner.className = 'lobby-inner';
  const logo = doc.createElement('h2');
  logo.className = 'lobby-logo';
  logo.id = 'lobby-title';
  logo.textContent = APP_NAME;
  const rule = doc.createElement('div');
  rule.className = 'lobby-rule';
  rule.setAttribute('aria-hidden', 'true');
  const sub = doc.createElement('p');
  sub.className = 'lobby-sub';
  const menu = doc.createElement('nav');
  menu.className = 'lobby-menu';
  const buttons = LOBBY_ENTRIES.map((id) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'lobby-entry';
    b.dataset.entry = id;
    const icon = doc.createElement('span');
    icon.className = 'lobby-entry-icon';
    icon.innerHTML = ENTRY[id].icon;
    const text = doc.createElement('span');
    text.className = 'lobby-entry-text';
    const title = doc.createElement('span');
    title.className = 'lobby-entry-title';
    const desc = doc.createElement('span');
    desc.className = 'lobby-entry-desc';
    text.append(title, desc);
    b.append(icon, text);
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      choose(id);
    });
    menu.append(b);
    return { id, b, title, desc };
  });
  const about = doc.createElement('button');
  about.type = 'button';
  about.className = 'lobby-entry lobby-about-btn';
  about.dataset.entry = 'about';
  about.setAttribute('aria-haspopup', 'dialog');
  about.setAttribute('aria-expanded', 'false');
  const aboutIcon = doc.createElement('span');
  aboutIcon.className = 'lobby-entry-icon';
  aboutIcon.innerHTML = ICONS.info;
  const aboutText = doc.createElement('span');
  aboutText.className = 'lobby-entry-text';
  const aboutTitle = doc.createElement('span');
  aboutTitle.className = 'lobby-entry-title';
  aboutText.append(aboutTitle);
  about.append(aboutIcon, aboutText);
  menu.append(about);
  const navButtons = [...buttons.map((x) => x.b), about];
  inner.append(logo, rule, sub, menu);

  // The gear (top right): language, mode, sound and the checkpoint line in one small panel.
  const corner = doc.createElement('div');
  corner.className = 'lobby-corner';
  const gear = doc.createElement('button');
  gear.type = 'button';
  gear.className = 'hud-icon lobby-gear';
  gear.innerHTML = ICONS.gear;
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('div');
  panel.className = 'lobby-settings';
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;
  const lang = segmented<Lang>('lang-toggle', LANGS, getLang, setLang);
  const mode = segmented<Mode>('mode-toggle', MODES, getMode, setMode);
  const snd = soundToggle(deps.sound, doc);
  const cp = doc.createElement('p');
  cp.className = 'lobby-checkpoint';
  const prefs = doc.createElement('div');
  prefs.className = 'lobby-prefs';
  prefs.append(lang.wrap, mode.wrap, snd.element);
  panel.append(prefs, cp);
  corner.append(gear, panel);
  const setPanel = (open: boolean, focusBack = false): void => {
    if (panel.hidden === !open) return;
    panel.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLElement>('button')?.focus();
    else if (focusBack) gear.focus();
  };
  gear.addEventListener('click', () => setPanel(panel.hidden));
  const onDocDown = (e: Event): void => {
    if (!panel.hidden && !corner.contains(e.target as Node)) setPanel(false);
  };
  doc.addEventListener('pointerdown', onDocDown, true);

  const dlg = createAbout({ arch, background: () => [inner, corner] });
  el.append(inner, corner, dlg.element);

  about.addEventListener('click', () => { if (dlg.isOpen()) dlg.close(); else dlg.open(about); });

  const paintCheckpoint = (): void => {
    const sha = fmt(structure(arch.checkpoint.sha256.slice(0, 7)));
    sha.dataset.v = 'sha';
    const tag = doc.createElement('span');
    tag.className = 'kind-tag';
    tag.dataset.kind = 'structure';
    tag.textContent = kindName('structure');
    const date = deps.traceDate?.() ?? null;
    cp.replaceChildren(tag, ` ${t('lobby.checkpoint')} `, sha);
    if (date) {
      const d = doc.createElement('time');
      d.dateTime = date;
      d.textContent = dateText(date, getLang());
      cp.append(` · ${t('lobby.traced')} `, d);
    }
    cp.title = t('lobby.checkpointTip');
  };
  const paint = (): void => {
    el.setAttribute('aria-label', t('lobby.label'));
    sub.innerHTML = richT('lobby.subtitle', { layers: m.num_layers, streams: m.num_streams, experts: m.num_experts });
    menu.setAttribute('aria-label', t('lobby.menu'));
    for (const x of buttons) {
      x.title.textContent = t(ENTRY[x.id].title);
      x.desc.textContent = t(ENTRY[x.id].desc, { n: m.num_layers });
    }
    // Without recorded runs there is nothing to watch: say so, instead of a click that does nothing.
    const watch = buttons.find((x) => x.id === 'watch');
    if (watch) {
      const off = deps.hasTrace ? !deps.hasTrace() : false;
      watch.b.setAttribute('aria-disabled', String(off));
      watch.b.classList.toggle('is-disabled', off);
      watch.b.title = off ? t('player.noTrace') : '';
    }
    lang.label.textContent = t('lang.label');
    lang.group.setAttribute('aria-label', t('lang.label'));
    for (const b of lang.buttons) {
      b.textContent = (b.dataset.value ?? '').toUpperCase();
      b.setAttribute('lang', b.dataset.value ?? '');
      b.title = b.dataset.value === 'de' ? 'Deutsch' : 'English';
    }
    lang.sync();
    mode.label.textContent = t('mode.label');
    mode.group.setAttribute('aria-label', t('mode.label'));
    for (const b of mode.buttons) {
      b.textContent = t(`mode.${b.dataset.value}` as StringKey);
      b.title = t(`mode.${b.dataset.value}Tip` as StringKey);
    }
    mode.sync();
    aboutTitle.textContent = t('lobby.about');
    gear.setAttribute('aria-label', t('settings.label'));
    gear.title = t('settings.tip');
    panel.setAttribute('aria-label', t('settings.label'));
    if (dlg.isOpen()) dlg.paint();
    paintCheckpoint();
  };
  paint();
  const offPrefs = onPrefsChange(paint);

  let isStill = false;
  const choose = (id: LobbyEntry): void => {
    api.hide();
    deps.onChoose(id);
  };

  // Keys while the lobby is up (capture phase, so nothing behind it sees them): Esc closes the About
  // blurb (one level); keys aimed at the page behind go nowhere. Keys inside the lobby work normally.
  const onKey = (e: KeyboardEvent): void => {
    if (el.hidden) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (dlg.isOpen()) dlg.close();
      else setPanel(false, true);
      return;
    }
    if (!el.contains(e.target as Node)) {
      e.stopImmediatePropagation();
      if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        navButtons[0]?.focus();
      }
    }
  };
  doc.addEventListener('keydown', onKey, true);
  // Inside the lobby: Up/Down move between the entries, and no key bubbles to the page's own shortcuts.
  el.addEventListener('keydown', (e) => {
    const k = navButtons.findIndex((x) => x === doc.activeElement);
    if (k >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = (k + (e.key === 'ArrowDown' ? 1 : navButtons.length - 1)) % navButtons.length;
      navButtons[n]?.focus();
    }
    e.stopPropagation();
  });

  const api: Lobby = {
    element: el,
    show() {
      paint();
      el.hidden = false;
      doc.body.classList.add('in-lobby');
      buttons[0]?.b.focus({ preventScroll: true });
    },
    hide() {
      dlg.close();
      setPanel(false);
      el.hidden = true;
      doc.body.classList.remove('in-lobby');
    },
    visible: () => !el.hidden,
    aboutOpen: () => dlg.isOpen(),
    refresh() {
      paint();
    },
    setStill(s) {
      isStill = s;
      el.dataset.still = String(s);
    },
    still: () => isStill,
    dispose() {
      offPrefs();
      dlg.dispose();
      snd.dispose();
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('pointerdown', onDocDown, true);
      doc.body.classList.remove('in-lobby');
      el.remove();
    },
  };
  api.setStill(false);
  return api;
}

export interface LobbyFlowDeps {
  lobby: Pick<Lobby, 'show' | 'hide' | 'visible'>;
  bar: Pick<PlayerBar, 'pause' | 'watch' | 'ready' | 'focusPlay'>;
  rig: Pick<CameraRig, 'overview'>;
  /** Plays the first-visit intro; resolves true when it ran (it ends on the overview). */
  intro: () => Promise<boolean>;
  /** Skips a running intro (Home while the intro plays). */
  skipIntro?: () => void;
  openTours: () => void;
  /** Closes every open level, the panel, layer mode and menus (home). */
  closeAll: () => Promise<void>;
  /** After the visitor entered the scene (coach marks, room tone). Not called when the lobby is back. */
  onEnter?: (e: LobbyEntry) => void;
  /** After the lobby came back (drift base, room tone off). */
  onLobby?: () => void;
}

export interface LobbyFlow {
  /** What a lobby entry does (the lobby has already hidden itself). */
  choose(e: LobbyEntry): Promise<void>;
  /** The HUD home button: pause, close everything, back to the lobby. */
  home(): Promise<void>;
}

/**
 * Explore: the intro on the first visit, otherwise a flight to the overview; the player does not start.
 * Guided tour: the overview and the tour menu. Watch it think: like Explore, then the first sentence
 * plays as a quick pass. Every camera move here follows the visitor's choice.
 *
 * Entry token: each choose() and each home() takes a new token; after every await a stale token stops
 * the entry (Home pressed while the flight or the intro was still running leaves the lobby alone: no
 * player, no coach marks, no room tone).
 */
export function createLobbyFlow(d: LobbyFlowDeps): LobbyFlow {
  let gen = 0;
  const toOverview = async (tok: number, withIntro: boolean): Promise<void> => {
    const played = withIntro ? await d.intro() : false;
    if (tok !== gen) return;
    if (!played) await d.rig.overview();
  };
  return {
    async choose(e) {
      const tok = ++gen;
      d.lobby.hide();
      if (e === 'tour') {
        void d.rig.overview();
        d.openTours();
      } else {
        await toOverview(tok, true);
        if (tok !== gen) return;
        if (e === 'watch') {
          await d.bar.ready;
          if (tok !== gen) return;
          d.bar.watch();
        }
      }
      if (tok !== gen || d.lobby.visible()) return;
      d.onEnter?.(e);
      if (e !== 'tour') d.bar.focusPlay();
    },
    async home() {
      const tok = ++gen;
      d.skipIntro?.();
      d.bar.pause();
      await d.closeAll();
      if (tok !== gen) return;
      d.lobby.show();
      d.onLobby?.();
    },
  };
}
