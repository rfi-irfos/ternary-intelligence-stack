// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { type Architecture, validateArchitecture } from '../src/data/architecture';
import { validateTrace } from '../src/data/trace';
import { buildTower } from '../src/scene/tower';
import { createSound } from '../src/audio/sound';
import { createPlayerBar } from '../src/ui/player';
import { attachPicking, createPickGuard } from '../src/ui/picking';
import { createTopBar } from '../src/ui/topbar';
import { createSidebar } from '../src/ui/sidebar';
import { refitOnToggle } from '../src/camera/controls';
import { MODE_KEY, getLang, getMode, reloadPrefsForTest, setLang, setMode } from '../src/ui/prefs';
import { setDepth } from '../src/ui/depth';
import { closeTourMenu, isTourMenuOpen } from '../src/ui/tourMenu';
import { type DriftState, type LobbyEntry, createLobby, createLobbyFlow, driftPose, driftTick, soundToggle } from '../src/ui/lobby';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const traces = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const trace = (id: string) => validateTrace(traces[`../public/data/trace/${id}.json`], a);

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  closeTourMenu();
  document.body.innerHTML = '';
  document.body.className = '';
  setLang('en');
  setMode('simple');
  localStorage.clear();
});

/** The app's lobby wiring with a real player bar and top bar and a fake camera rig. */
function app(opts: {
  intro?: () => Promise<boolean>; architecture?: Architecture;
  overview?: () => Promise<void>; onEnter?: () => void; load?: (id: string) => Promise<ReturnType<typeof trace>>;
} = {}) {
  const rig = { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(opts.overview ?? (() => Promise.resolve())) };
  const top = createTopBar(null);
  const bar = createPlayerBar({ arch: a, tower, rig, animator: { show: vi.fn() }, load: opts.load ?? ((id) => Promise.resolve(trace(id))) });
  const sound = createSound({ create: () => null });
  let pending: Promise<void> = Promise.resolve();
  let loaded = false;
  void bar.ready.then(() => { loaded = true; });
  const lobby = createLobby({
    arch: opts.architecture ?? a, sound, traceDate: () => bar.traceDate(), hasTrace: () => bar.hasTraces() || !loaded,
    onChoose: (e: LobbyEntry) => { pending = flow.choose(e); },
  });
  const closeAll = vi.fn(() => Promise.resolve());
  const openTours = vi.fn();
  const flow = createLobbyFlow({ lobby, bar, rig, intro: opts.intro ?? (() => Promise.resolve(false)), openTours, closeAll, onEnter: opts.onEnter });
  top.home.addEventListener('click', () => { pending = flow.home(); });
  document.body.append(top.element, bar.element, lobby.element);
  cleanup.push(() => { lobby.dispose(); bar.dispose(); top.dispose(); });
  lobby.show();
  return { rig, top, bar, lobby, flow, sound, closeAll, openTours, settle: () => pending };
}

const entry = (id: LobbyEntry) => document.querySelector<HTMLButtonElement>(`.lobby-entry[data-entry="${id}"]`)!;

describe('lobby', () => {
  it('the lobby renders 4 entries (About is the fourth) in DE and EN', () => {
    const { lobby } = app();
    const titles = () => [...lobby.element.querySelectorAll('.lobby-entry .lobby-entry-title')].map((x) => x.textContent);
    expect(lobby.element.querySelectorAll('.lobby-entry')).toHaveLength(4);
    expect(titles()).toEqual(['Explore', 'Guided tour', 'Watch it think', 'About albert.']);
    expect(lobby.element.querySelector('.lobby-logo')!.textContent).toBe('Xperience albert.');
    for (const b of lobby.element.querySelectorAll('.lobby-entry')) expect(b.querySelector('svg.icon')).not.toBeNull();
    setLang('de');
    expect(lobby.element.querySelectorAll('.lobby-entry')).toHaveLength(4);
    expect(titles()).toEqual(['Erkunden', 'Geführte Tour', 'Durchlauf ansehen', 'Über albert.']);
    expect(lobby.element.querySelector('.lobby-sub')!.textContent).toBe('Ein Sprachmodell zum Anfassen – 46 Ebenen, 2 Ströme, 12 gemeinsame Experten');
  });

  it('the subtitle counts come from Architecture', () => {
    const other = structuredClone(a);
    other.model.num_layers = 7;
    other.model.num_streams = 3;
    other.model.num_experts = 99;
    const { lobby } = app({ architecture: other });
    const sub = lobby.element.querySelector('.lobby-sub')!;
    const v = (k: string) => sub.querySelector<HTMLElement>(`[data-v="${k}"]`);
    expect(v('layers')!.textContent).toBe('7');
    expect(v('streams')!.textContent).toBe('3');
    expect(v('experts')!.textContent).toBe('99');
    for (const k of ['layers', 'streams', 'experts']) expect(v(k)!.dataset.kind).toBe('structure');
    expect(sub.textContent).not.toContain('46');
    // The Watch line uses the same count.
    expect(entry('watch').querySelector('.lobby-entry-desc')!.textContent).toContain('7 layers');
  });

  it('Explore hides the lobby and does not start the player', async () => {
    const { lobby, bar, rig, settle } = app();
    await bar.ready;
    entry('explore').click();
    expect(lobby.visible()).toBe(false);
    expect(document.body.classList.contains('in-lobby')).toBe(false);
    await settle();
    expect(bar.player()!.playing()).toBe(false);
    expect(bar.player()!.index()).toBe(0);
    // No intro this time: the click flies to the overview.
    expect(rig.overview).toHaveBeenCalledTimes(1);
  });

  it('Explore and Watch play the intro on the first visit; it ends on the overview, so no second flight', async () => {
    const intro = vi.fn(() => Promise.resolve(true));
    const { rig, settle, bar } = app({ intro });
    await bar.ready;
    entry('explore').click();
    await settle();
    expect(intro).toHaveBeenCalledTimes(1);
    expect(rig.overview).not.toHaveBeenCalled();
  });

  it('Watch starts the player: the first sentence, from step 1, as a quick pass', async () => {
    const { bar, settle } = app();
    await bar.ready;
    // An earlier choice of the visitor (another sentence) ...
    bar.session.querySelector<HTMLButtonElement>('.sentence-chip')!.click();
    document.querySelector<HTMLElement>('.sentence-pop [data-prompt="de"]')!.click();
    expect(bar.selection()!.promptId).toBe('de');
    // ... then Watch it think, an explicit choice: the first sentence plays.
    entry('watch').click();
    await settle();
    const p = bar.player()!;
    expect(p.playing()).toBe(true);
    expect(p.index()).toBe(0);
    expect(p.pace()).toBe('quick');
    expect(bar.selection()!.promptId).toBe('kjv');
    const tag = bar.element.querySelector<HTMLElement>('.quick-tag')!;
    expect(tag.hidden).toBe(false);
    expect(tag.textContent).toBe('Quick pass');
    expect(tag.title).toMatch(/all \d+ recorded steps.*Nothing is left out or made up/);
  });

  it('Watch in Advanced is a quick pass too; the next Play in Advanced has the full pace again', async () => {
    setMode('advanced');
    const { bar, settle } = app();
    await bar.ready;
    entry('watch').click();
    await settle();
    expect(bar.player()!.pace()).toBe('quick');
    const play = bar.element.querySelector<HTMLButtonElement>('[data-action="play"]')!;
    play.click(); // pause: the run stays a quick run (Pause keeps it)
    expect(bar.player()!.playing()).toBe(false);
    expect(bar.player()!.pace()).toBe('quick');
    play.click(); // resume
    expect(bar.player()!.playing()).toBe(true);
    expect(bar.player()!.pace()).toBe('quick');
    play.click(); // pause again, then a step ends the quick run
    bar.element.querySelector<HTMLButtonElement>('[data-action="next"]')!.click();
    expect(bar.player()!.pace()).toBe('full');
    play.click();
    expect(bar.player()!.playing()).toBe(true);
    expect(bar.player()!.pace()).toBe('full');
    expect(bar.element.querySelector<HTMLElement>('.quick-tag')!.hidden).toBe(true);
  });

  it('Guided tour opens the tour menu and does not start the player', async () => {
    const { bar, openTours, settle, lobby } = app();
    await bar.ready;
    entry('tour').click();
    await settle();
    expect(lobby.visible()).toBe(false);
    expect(openTours).toHaveBeenCalledTimes(1);
    expect(bar.player()!.playing()).toBe(false);
  });

  it('The home button returns to the lobby (pauses the run, closes everything)', async () => {
    const { top, bar, lobby, closeAll, settle } = app();
    await bar.ready;
    entry('watch').click();
    await settle();
    expect(bar.player()!.playing()).toBe(true);
    top.home.click();
    await settle();
    expect(lobby.visible()).toBe(true);
    expect(document.body.classList.contains('in-lobby')).toBe(true);
    expect(closeAll).toHaveBeenCalledTimes(1);
    expect(bar.player()!.playing()).toBe(false);
    expect(bar.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.getAttribute('aria-pressed')).toBe('false');
    // The home button shows its name as text (zur Lobby) and keeps the longer name as its tooltip.
    expect(top.home.textContent).toBe('To lobby');
    expect(top.home.title).toBe('Close everything and go back to the main menu (Esc closes one level)');
    setLang('de');
    expect(top.home.textContent).toBe('Zur Lobby');
    expect(top.home.title).toBe('Alles schließen und zurück zum Hauptmenü (Esc schließt eine Ebene)');
  });

  it('The toggles in the lobby and in the HUD share state', async () => {
    const { lobby, top, bar } = app();
    await bar.ready;
    const lobbyLang = (v: string) => lobby.element.querySelector<HTMLButtonElement>(`.lang-toggle button[data-value="${v}"]`)!;
    const hudLang = (v: string) => top.element.querySelector<HTMLButtonElement>(`.lang-toggle button[data-value="${v}"]`)!;
    const lobbyMode = (v: string) => lobby.element.querySelector<HTMLButtonElement>(`.mode-toggle button[data-value="${v}"]`)!;
    const hudMode = (v: string) => bar.display.querySelector<HTMLButtonElement>(`.mode-toggle button[data-value="${v}"]`)!;
    lobbyLang('de').click();
    expect(getLang()).toBe('de');
    expect(hudLang('de').getAttribute('aria-checked')).toBe('true');
    hudLang('en').click();
    expect(lobbyLang('en').getAttribute('aria-checked')).toBe('true');
    lobbyMode('advanced').click();
    expect(getMode()).toBe('advanced');
    expect(hudMode('advanced').getAttribute('aria-checked')).toBe('true');
    hudMode('simple').click();
    expect(lobbyMode('simple').getAttribute('aria-checked')).toBe('true');
  });

  it('the sound toggle is off by default and shares its state with the one in the HUD settings', () => {
    const { lobby, sound } = app();
    const hud = soundToggle(sound);
    document.body.append(hud.element);
    cleanup.push(() => hud.dispose());
    const inLobby = lobby.element.querySelector<HTMLButtonElement>('.sound-toggle')!;
    expect(inLobby.getAttribute('aria-pressed')).toBe('false');
    expect(inLobby.textContent).toBe('Sound off');
    inLobby.click();
    expect(sound.muted()).toBe(false);
    expect(hud.element.getAttribute('aria-pressed')).toBe('true');
    expect(hud.element.textContent).toBe('Sound on');
    hud.element.click();
    expect(inLobby.getAttribute('aria-pressed')).toBe('false');
  });

  it('the checkpoint line: short SHA from architecture.json labelled structure, and the date the runs were recorded', async () => {
    const { lobby, bar } = app();
    await bar.ready;
    lobby.refresh();
    const cp = lobby.element.querySelector<HTMLElement>('.lobby-checkpoint')!;
    expect(cp.querySelector('.kind-tag')!.textContent).toBe('structure');
    const sha = cp.querySelector<HTMLElement>('[data-v="sha"]')!;
    expect(sha.textContent).toBe(a.checkpoint.sha256.slice(0, 7));
    expect(sha.dataset.kind).toBe('structure');
    expect(cp.querySelector('time')!.getAttribute('datetime')).toBe(trace('kjv').provenance.date);
    setLang('de');
    expect(cp.querySelector('time')!.textContent).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(cp.querySelector('.kind-tag')!.textContent).toBe('Struktur');
  });

  it('one gear holds language, mode, sound and the checkpoint; Esc and an outside press close it one level at a time', () => {
    const { lobby } = app();
    const gear = lobby.element.querySelector<HTMLButtonElement>('.lobby-gear')!;
    const panel = lobby.element.querySelector<HTMLElement>('.lobby-settings')!;
    // nothing but the gear is visible at first; the rest of the old footer is not loose on the screen
    expect(panel.hidden).toBe(true);
    expect(lobby.element.querySelector('.lobby-foot')).toBeNull();
    for (const sel of ['.lang-toggle', '.mode-toggle', '.sound-toggle', '.lobby-checkpoint']) expect(panel.querySelector(sel), sel).not.toBeNull();
    gear.click();
    expect(panel.hidden).toBe(false);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    // Esc closes the panel and keeps the lobby open
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.hidden).toBe(true);
    expect(lobby.visible()).toBe(true);
    // an outside press closes it too; a press inside does not
    gear.click();
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(false);
    lobby.element.querySelector('.lobby-logo')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    // hiding the lobby closes it as well
    gear.click();
    lobby.hide();
    expect(panel.hidden).toBe(true);
  });

  it('About opens an honest blurb; Esc closes it (one level) and the key goes no further', () => {
    const { lobby } = app();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    const btn = lobby.element.querySelector<HTMLButtonElement>('.lobby-about-btn')!;
    btn.click();
    expect(lobby.aboutOpen()).toBe(true);
    const box = lobby.element.querySelector<HTMLElement>('.lobby-about')!;
    expect(box.querySelector('.about-real [data-v="params"]')!.textContent).toBe('331,140,622');
    expect(box.textContent).toMatch(/For illustration: .*measure nothing/);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    box.dispatchEvent(esc);
    expect(lobby.aboutOpen()).toBe(false);
    expect(lobby.visible()).toBe(true);
    // A second Esc closes nothing more: the lobby is the top level.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(lobby.visible()).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener('keydown', behind);
  });

  it('keys behind the lobby (Space, arrows) never reach the player; Up/Down move between the entries', async () => {
    const { bar } = app();
    await bar.ready;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(bar.player()!.playing()).toBe(false);
    entry('explore').focus();
    entry('explore').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(entry('tour'));
    entry('tour').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(entry('explore'));
    entry('explore').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(bar.player()!.index()).toBe(0);
  });

  it('the lobby works with the mouse alone: every entry is a button, the menu has a name', () => {
    const { lobby } = app();
    for (const b of lobby.element.querySelectorAll<HTMLElement>('.lobby-entry')) expect(b.tagName).toBe('BUTTON');
    expect(lobby.element.querySelector('.lobby-menu')!.getAttribute('aria-label')).toBeTruthy();
    expect(lobby.element.getAttribute('role')).toBe('dialog');
    expect(isTourMenuOpen()).toBe(false);
  });

  it('Low: a still frame (no drift, no blur)', () => {
    const { lobby } = app();
    expect(lobby.still()).toBe(false);
    lobby.setStill(true);
    expect(lobby.element.dataset.still).toBe('true');
  });
});

describe('lobby flow: entry token, focus, missing traces', () => {
  it('Home pressed while the entry flight is still pending: the lobby stays, no player, no coach marks, no tone', async () => {
    let land: () => void = () => undefined;
    const onEnter = vi.fn();
    const { lobby, bar, top, settle, rig } = app({ overview: () => new Promise<void>((r) => { land = r; }), onEnter });
    await bar.ready;
    entry('watch').click();
    const entering = settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(lobby.visible()).toBe(false);
    expect(rig.overview).toHaveBeenCalledTimes(1);
    top.home.click(); // Home before the overview promise resolved
    await settle();
    expect(lobby.visible()).toBe(true);
    land(); // the old flight lands now
    await entering;
    await Promise.resolve();
    expect(lobby.visible()).toBe(true);
    expect(bar.player()!.playing()).toBe(false);
    expect(onEnter).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(bar.element.querySelector('[data-action="play"]'));
  });

  it('Home while the intro still plays skips it and the late entry does nothing', async () => {
    let end: (v: boolean) => void = () => undefined;
    const intro = vi.fn(() => new Promise<boolean>((r) => { end = r; }));
    const skipIntro = vi.fn(() => end(true));
    const onEnter = vi.fn();
    const rig = { overview: vi.fn(() => Promise.resolve()) };
    const lobby = { show: vi.fn(), hide: vi.fn(), visible: vi.fn(() => false) };
    const bar = { pause: vi.fn(), watch: vi.fn(), ready: Promise.resolve(), focusPlay: vi.fn() };
    const flow = createLobbyFlow({ lobby, bar, rig, intro, skipIntro, openTours: vi.fn(), closeAll: () => Promise.resolve(), onEnter });
    const entering = flow.choose('watch');
    await flow.home();
    expect(skipIntro).toHaveBeenCalledTimes(1);
    await entering;
    expect(lobby.show).toHaveBeenCalledTimes(1);
    expect(bar.watch).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();
    expect(rig.overview).not.toHaveBeenCalled();
  });

  it('after Explore the dock has the focus (not the body, and not a button that Enter or Space would press); nothing plays', async () => {
    const { bar, settle } = app();
    await bar.ready;
    entry('explore').click();
    await settle();
    expect(document.activeElement).toBe(bar.element);
    expect(bar.player()?.playing()).toBe(false);
  });
  it('C: after Explore and the intro skip nothing plays by itself: opening and closing the sidebar, focus moves and time passing leave the run paused', async () => {
    const { bar, settle, rig } = app({ intro: () => Promise.resolve(true) });
    await bar.ready;
    const sidebar = createSidebar({ win: { innerWidth: 1568 } });
    document.body.append(sidebar.element, sidebar.edgeTab);
    cleanup.push(() => sidebar.dispose());
    // the same wiring as src/main.ts
    refitOnToggle(sidebar, { atOverview: () => true, overview: rig.overview });
    entry('explore').click();
    await settle();
    const player = bar.player()!;
    const index = player.index();
    expect(player.playing()).toBe(false);
    const idle = (): void => { for (let i = 0; i < 20; i++) bar.tick(0.25); };
    idle();
    // the browser sequence: one click on the edge tab, 3 s later; then close; then focus moves
    sidebar.edgeTab.click();
    idle();
    expect(sidebar.isOpen()).toBe(true);
    expect(player.playing()).toBe(false);
    sidebar.element.querySelector<HTMLButtonElement>('.side-sec-toggle')!.focus();
    sidebar.element.querySelector<HTMLButtonElement>('.sidebar-close')!.click();
    bar.element.focus();
    document.body.focus();
    idle();
    expect(sidebar.isOpen()).toBe(false);
    expect(player.playing()).toBe(false);
    expect(player.index()).toBe(index);
    expect(bar.element.querySelector('[data-action="play"]')!.getAttribute('aria-pressed')).toBe('false');
    // a pointer click on the dock's text zone or a Space on the closed sidebar's edge tab does not start the run either
    bar.element.querySelector<HTMLElement>('.dock-left')!.click();
    sidebar.edgeTab.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    idle();
    expect(player.playing()).toBe(false);
  });

  it('D: the lobby footer toggle and the sidebar toggle always show the same mode (fresh load, either click, depth keys)', async () => {
    const { bar, lobby } = app();
    await bar.ready;
    const checked = (root: ParentNode): string | null =>
      root.querySelector('.mode-toggle [role="radio"][aria-checked="true"]')?.getAttribute('data-value') ?? null;
    const sidebar = createSidebar({ win: { innerWidth: 1568 } });
    sidebar.headTools.append(bar.display);
    document.body.append(sidebar.element);
    cleanup.push(() => sidebar.dispose());
    const same = (want: string): void => {
      expect(getMode()).toBe(want);
      expect(checked(lobby.element)).toBe(want);
      expect(checked(sidebar.element)).toBe(want);
    };
    same('simple');
    lobby.element.querySelector<HTMLButtonElement>('.mode-toggle [data-value="advanced"]')!.click();
    same('advanced');
    sidebar.element.querySelector<HTMLButtonElement>('.mode-toggle [data-value="simple"]')!.click();
    same('simple');
    // a depth change (key 2 / 3, panel button) switches the mode: both toggles follow
    setDepth('technical');
    same('advanced');
    // a fresh page load reads the stored mode once; both toggles are built from the same value
    expect(localStorage.getItem(MODE_KEY)).toBe('advanced');
    reloadPrefsForTest();
    expect(getMode()).toBe('advanced');
    setMode('simple');
    same('simple');
    expect(localStorage.getItem(MODE_KEY)).toBe('simple');
  });


  it('Watch with no recorded run is disabled and says why; a click does nothing', async () => {
    const { lobby, bar } = app({ load: () => Promise.reject(new Error('no trace')) });
    await bar.ready;
    lobby.refresh();
    const w = entry('watch');
    expect(bar.hasTraces()).toBe(false);
    expect(w.getAttribute('aria-disabled')).toBe('true');
    expect(w.title).toBe('no measured trace available');
    w.click();
    expect(lobby.visible()).toBe(true);
    setLang('de');
    expect(w.title).toBe('keine gemessene Spur verfügbar');
    expect(bar.element.textContent).toContain('keine gemessene Spur verfügbar');
  });
});

describe('a double click on an entry never picks a part', () => {
  it('the second click on the canvas right after the entry is ignored (no pick, no panel, no fly)', async () => {
    let t = 1000;
    let flying = false;
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const pick = vi.fn();
    const empty = vi.fn();
    const fly = vi.fn();
    const hold = { release: () => undefined as void };
    const { lobby, bar, rig, settle } = app({
      overview: () => { flying = true; fly(); return new Promise<void>((r) => { hold.release = () => { flying = false; r(); }; }); },
    });
    const guard = createPickGuard({ now: () => t, isFlying: () => flying, lobbyVisible: () => lobby.visible() });
    attachPicking(canvas, { pickAt: () => 'L3', onPick: pick, onEmpty: empty, blocked: () => guard.blocked() }, () => t);
    const click = () => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
    };
    // While the lobby shows, a click on the canvas picks nothing.
    click();
    expect(pick).not.toHaveBeenCalled();
    await bar.ready;
    entry('explore').click();
    guard.begin();
    const done = settle().finally(() => guard.end());
    await new Promise((r) => setTimeout(r, 0));
    click(); // the second click of the double click, while the flight runs
    expect(pick).not.toHaveBeenCalled();
    expect(empty).not.toHaveBeenCalled();
    expect(rig.overview).toHaveBeenCalledTimes(1);
    expect(rig.flyTo).not.toHaveBeenCalled();
    hold.release();
    await done;
    // Right after the landing the hold time still blocks; 400 ms later the canvas works again.
    t += 100;
    click();
    expect(pick).not.toHaveBeenCalled();
    t += 400;
    click();
    expect(pick).toHaveBeenCalledTimes(1);
  });
});

describe('lobby drift', () => {
  const still: DriftState = { base: { target: new THREE.Vector3(60, 0, 0), position: new THREE.Vector3(30, -70, 40) }, t: 0, visible: true, still: false, reduced: false };
  const st = (o: Partial<DriftState>): DriftState => ({ ...still, ...o });
  it('driftTick moves only while the lobby shows, not still, not reduced, and with a base', () => {
    const run = st({});
    const p = driftTick(run, 1);
    expect(p).not.toBeNull();
    expect(run.t).toBe(1);
    for (const off of [{ base: null }, { visible: false }, { still: true }, { reduced: true }] as Partial<DriftState>[]) {
      const s = st(off);
      expect(driftTick(s, 1)).toBeNull();
      expect(s.t).toBe(0);
    }
  });

  const base = { target: new THREE.Vector3(60, 0, 0), position: new THREE.Vector3(30, -70, 40) };
  it('starts at the base pose and only sways: same target, distance within 5 %, never a full turn', () => {
    const p0 = driftPose(base, 0);
    expect(p0.position.distanceTo(base.position)).toBeLessThan(1e-9);
    const d0 = base.position.distanceTo(base.target);
    let maxYaw = 0;
    for (let t = 0; t < 120; t += 0.5) {
      const p = driftPose(base, t);
      expect(p.target.equals(base.target)).toBe(true);
      expect(Math.abs(p.position.distanceTo(p.target) - d0) / d0).toBeLessThan(0.05);
      const a0 = Math.atan2(base.position.y - base.target.y, base.position.x - base.target.x);
      const a1 = Math.atan2(p.position.y - p.target.y, p.position.x - p.target.x);
      maxYaw = Math.max(maxYaw, Math.abs(a1 - a0));
    }
    expect(maxYaw).toBeGreaterThan(0.1);
    expect(maxYaw).toBeLessThan(0.3);
    // The base pose itself is never changed.
    expect(base.position.toArray()).toEqual([30, -70, 40]);
  });
});
