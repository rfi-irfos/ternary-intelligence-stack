import * as THREE from 'three';
import './style/tokens.css';
import './style/ui.css';
import { createControls } from './camera/controls';
import { createSlabRail } from './ui/slabRail';
import { loadArchitecture } from './data/architecture';
import { buildTower } from './scene/tower';
import { loadModules } from './scene/modules';
import { createWeightsLoader } from './data/weights';
import { createExplode } from './scene/explode';
import { isExplodable } from './scene/hierarchy';
import { parseId, slabId } from './scene/ids';
import { createPanel, PANEL_CSS } from './ui/panel';
import { attachDepthKeys } from './ui/depth';
import { emptyClick, pickAction } from './ui/pickAction';
import { APP_NAME } from './content/brand';
import { PALETTE } from './scene/palette';
import { FONT } from './style/theme';
import { type Probe, type Quality, createLook, createProbe, loadOverride, resolveQuality } from './scene/look';
import { QUALITY_MENU_CSS, createQualityMenu } from './ui/qualityMenu';
import { LABEL_CSS } from './data/labeled';
import { createAnimator } from './flow/animate';
import { LAYER_CSS, createLayerMode, layerOfId } from './layer/views';
import { createPlayerBar } from './ui/player';
import { attachPicking, createHover, createPickGuard, createRaycastPicker } from './ui/picking';
import { createTopBar } from './ui/topbar';
import { createLegend } from './ui/legend';
import { createHighlighter } from './ui/highlight';
import { matchesRole, sceneName } from './ui/roles';
import { createHoverTip } from './ui/tooltip';
import { createSelection } from './ui/selection';
import { onPrefsChange } from './ui/prefs';
import { measureHud } from './ui/hudInsets';
import { coachSeen, createCoachMarks } from './ui/coach';
import { sound, unlockOnGesture } from './audio/sound';
import { playIntro, shouldPlayIntro, skipIntro } from './intro/cinematic';
import { type DriftState, createLobby, createLobbyFlow, driftTick, soundToggle } from './ui/lobby';
import { closeTourMenu, openTourMenu } from './ui/tourMenu';

/** Waits (at most `ms`) for the display face, so the canvas labels of the scene draw in it; runs beside the data loads. */
async function fontsReady(ms = 1500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const load = Promise.all([
    document.fonts.load(`500 30px ${FONT.display}`),
    document.fonts.load(`400 14px ${FONT.ui}`),
  ]).then(() => undefined, () => undefined);
  await Promise.race([load, new Promise<void>((r) => setTimeout(r, ms))]);
}

async function main(): Promise<void> {
  document.title = APP_NAME;
  const heading = document.getElementById('app-name');
  if (heading) heading.textContent = APP_NAME;
  const top = createTopBar(heading);
  document.body.appendChild(top.element);
  // Fonts, architecture and modules load in parallel; the font wait only caps itself, it never delays the data.
  const [arch, modules] = await Promise.all([loadArchitecture(), loadModules(), fontsReady()]);
  const tower = buildTower(arch, modules);

  // Canvas MSAA stays on: Low renders straight to the canvas and relies on it for the thin edges, and
  // the preset can change at runtime without recreating the context. On High and Medium the composer
  // renders into its own MSAA target and the canvas AA only costs the final full-screen copy.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.background);
  scene.add(tower.root);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(20, -30, 40);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.up.set(0, 0, 1);
  const rig = createControls(camera, renderer.domElement, tower.rowExtent);

  // Functional layout rules that live with their modules; the look comes from src/style/*.css.
  const style = document.createElement('style');
  style.textContent = `${PANEL_CSS}\n${LABEL_CSS}\n${LAYER_CSS}\n${QUALITY_MENU_CSS}`;
  document.head.appendChild(style);
  const selection = createSelection();
  const loadWeights = createWeightsLoader();
  // The component the user last selected (rail, scene click or panel): the rail follows it and
  // Enter layer starts at its layer.
  const note = (id: string | null): void => {
    if (id) selection.set(id);
  };
  // Declared before use: the panel reassembles an open explosion before a connection link flies.
  let view: ReturnType<typeof createExplode>;
  const panel = createPanel({
    arch, tower, rig, loadWeights,
    // A link flies on its own, so the fold-all does not restore the camera first.
    beforeNavigate: () => view.reassembleAll({ restoreCamera: false }),
    // Contextual "Step inside" on the selection card replaces the old Enter layer button.
    onStepInside: (id) => {
      const p = parseId(id);
      const stream = p && 'stream' in p && p.stream ? p.stream : undefined;
      void layerMode.enter(layerOfId(id) ?? undefined, stream);
    },
  });
  document.body.appendChild(panel.element);
  view = createExplode({
    tower, arch, rig, loadWeights, name: sceneName, watch: onPrefsChange,
    onChange: (id) => {
      note(id);
      reapplyPin();
      if (id) void panel.openPanel(id);
      else panel.close();
      bar.setHint(view.depth() > 0 ? 'hint.levelOpen' : null);
    },
  });
  scene.add(view.root);
  attachDepthKeys();
  const rail = createSlabRail(tower, rig, (l) => {
    selection.set(slabId(l));
    void panel.openPanel(slabId(l));
  }, selection);
  const animator = createAnimator(tower);
  scene.add(animator.root);
  const bar = createPlayerBar({ arch, tower, rig, animator });
  const dock = document.createElement('div');
  dock.className = 'dock';
  dock.append(bar.element);
  // The rail is the run's timeline along the bottom edge: a marker on the layer the word is in, a fill.
  bar.onOp((op, i, n) => rail.flow(op.layer ?? null, n > 1 ? i / (n - 1) : 0));
  document.body.append(dock, rail.element);
  const layerMode = createLayerMode({
    arch, view, rig, loadWeights,
    slabCenter: (l) => new THREE.Vector3(tower.slabX(l), 0, 0),
    selectedLayer: () => selection.layer() ?? rail.selected() ?? layerOfId(panel.current()),
    defaults: () => bar.selection(),
  });
  document.body.appendChild(layerMode.element);

  // Sound: procedural, off by default; the first pointerdown or key unlocks audio (browser rule).
  unlockOnGesture(sound);
  // Cues while a run plays: a soft tick per router, a rising tone when the word enters a new layer.
  let cueLayer: number | null = null;
  bar.onOp((op) => {
    if (!bar.player()?.playing()) { cueLayer = null; return; }
    if (op.kind === 'router') sound.routerClick();
    if (op.layer !== undefined && op.layer !== cueLayer) sound.tokenRise(op.layer / Math.max(arch.model.num_layers - 1, 1));
    cueLayer = op.layer ?? null;
  });

  // The lobby (title screen) comes first; the scene behind it drifts slowly (the one scripted camera
  // move: only while the lobby is up, never once the visitor is in the scene).
  // The media query is read once and kept current by its change event (not re-queried every frame).
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const drift: DriftState = { base: null, t: 0, visible: false, still: false, reduced: motionQuery?.matches ?? false };
  motionQuery?.addEventListener?.('change', (e) => { drift.reduced = e.matches; });
  const startDrift = (): void => {
    // A cut behind the lobby (it covers the view), then the sway around the overview pose.
    void rig.overview(0);
    drift.base = rig.pose();
    drift.t = 0;
    rig.controls.enabled = false;
  };
  let coachStarted = false;
  // Watch it think needs the recorded runs: once loading ended without any, the entry says so.
  let traceLoaded = false;
  const lobby = createLobby({
    arch, sound, traceDate: () => bar.traceDate(), hasTrace: () => !traceLoaded || bar.hasTraces(),
    onChoose: (e) => {
      drift.base = null;
      rig.controls.enabled = true;
      guard.begin();
      void flow.choose(e).finally(() => guard.end());
    },
  });
  // The canvas picks nothing while an entry is happening (a double click on an entry must not open a part).
  const guard = createPickGuard({ isFlying: () => rig.isFlying(), lobbyVisible: () => lobby.visible() });
  document.body.appendChild(lobby.element);
  void bar.ready.then(() => { traceLoaded = true; lobby.refresh(); });
  const flow = createLobbyFlow({
    lobby, bar, rig,
    intro: async () => {
      if (!shouldPlayIntro()) return false;
      await playIntro(rig, tower, arch);
      return true;
    },
    skipIntro,
    openTours: () => { openTourMenu({ returnFocus: top.toursButton }); },
    // Home closes every open level at once (Esc closes one), leaves layer mode and closes the panel.
    closeAll: async () => {
      closeTourMenu();
      await layerMode.exit();
      await view.reassembleAll({ restoreCamera: false });
      panel.close();
    },
    onEnter: () => {
      sound.roomTone(true);
      if (!coachStarted) { coachStarted = true; startCoach(); }
    },
    onLobby: () => {
      sound.roomTone(false);
      startDrift();
    },
  });
  // Home: back to the main menu, on the user's click.
  top.home.addEventListener('click', () => { void flow.home(); });

  // Highlights: a legend role (hover previews, click pins) or a panel row under the pointer.
  const highlighter = createHighlighter(() => [tower.root, view.root]);
  const legend = createLegend({
    onHighlight: (role) => highlighter.show(role ? (id) => matchesRole(id, role) : null),
  });
  // The legend chip is a tray item of the system bar (left, after home); its key drops down below.
  (top.element.querySelector('.top-left') ?? document.body).appendChild(legend.element);
  // Open on the first visit only (beside the coach marks); afterwards a collapsed chip.
  legend.setOpen(!coachSeen());
  /** The pinned legend role again, after an explode level or a quality switch rebuilt colours. */
  const reapplyPin = (): void => {
    const role = legend.pinned();
    if (role) highlighter.show((id) => matchesRole(id, role));
  };

  // The HUD insets the camera frames around (top bar, dock, side column, legend). The rig reads them at
  // fly time from this provider, so a panel that opened in the same click already counts; a new measure
  // never moves the camera. Inset changes (and camera rests) only refade the labels under the HUD.
  const GAP = 8;
  const hudNow = () => measureHud({
    top: top.element, dock, gap: GAP, win: window,
    // A collapsed panel is a small tray tab in the bar: it takes no column from the scene.
    side: () => (!layerMode.element.hidden ? layerMode.element : !panel.element.hidden && !panel.collapsed() ? panel.element : null),
    legendList: () => (legend.element.classList.contains('open') ? legend.element.querySelector<HTMLElement>('.legend-list') : null),
  });
  rig.setInsetsProvider(hudNow);
  const refadeLabels = (): void => view.fadeLabels(camera, window.innerWidth, window.innerHeight, rig.insets());
  rig.onSettle(refadeLabels);
  // The side column (inspection panel or layer steps) and the dock never overlap: the dock moves left.
  const syncSide = (): void => {
    document.body.classList.toggle('side-open', (!panel.element.hidden && !panel.collapsed()) || !layerMode.element.hidden);
    refadeLabels();
  };
  const sideObserver = new MutationObserver(syncSide);
  sideObserver.observe(panel.element, { attributes: true, attributeFilter: ['hidden', 'class'] });
  sideObserver.observe(layerMode.element, { attributes: true, attributeFilter: ['hidden'] });
  sideObserver.observe(legend.element, { attributes: true, attributeFilter: ['class'] });
  // The collapsed panel docks into the system bar left of its right cluster (Tour, DE | EN, gear).
  const trayRight = (): void => {
    const cluster = top.element.querySelector<HTMLElement>('.top-right');
    if (cluster) document.documentElement.style.setProperty('--tray-right', `${window.innerWidth - cluster.getBoundingClientRect().left + GAP}px`);
  };
  trayRight();
  if (typeof ResizeObserver === 'function') {
    const cluster = top.element.querySelector<HTMLElement>('.top-right');
    if (cluster) new ResizeObserver(trayRight).observe(cluster);
    const sizes = new ResizeObserver(refadeLabels);
    const key = legend.element.querySelector<HTMLElement>('.legend-list');
    for (const x of [top.element, dock, key ?? legend.element, panel.element, layerMode.element]) sizes.observe(x);
  }
  syncSide();
  // First frame of the session: the overview already fits between the HUD (startup, not an inset change).
  void rig.overview(0);
  lobby.show();
  startDrift();
  panel.element.addEventListener('pointerover', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-link]');
    if (link?.dataset.link) {
      const want = link.dataset.link;
      highlighter.show((id) => id === want || id.startsWith(`${want}.`));
    }
  });
  panel.element.addEventListener('pointerout', (e) => {
    const from = (e.target as HTMLElement).closest('[data-link]');
    const to = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-link]');
    if (from && from !== to) {
      const role = legend.pinned();
      highlighter.show(role ? (id) => matchesRole(id, role) : null);
    }
  });

  const rayAtRaw = createRaycastPicker(camera, renderer.domElement, () => view.pickRoot(),
    (hit) => (view.depth() > 0 ? view.pick(hit) : tower.pick(hit)));
  // The hit of the last raycast: hover outline and tooltip reuse it (one raycast per frame, not two).
  let lastHit: ReturnType<typeof rayAtRaw> = null;
  const rayAt = (x: number, y: number): ReturnType<typeof rayAtRaw> => (lastHit = rayAtRaw(x, y));
  let lastX = 0;
  let lastY = 0;
  const tip = createHoverTip();
  document.body.appendChild(tip.element);
  // The tip follows the pointer every move (cheap); the raycast itself runs once per frame.
  renderer.domElement.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (tip.current()) tip.move(lastX, lastY);
  });
  onPrefsChange(() => tip.refresh());
  const hover = createHover(scene);
  attachPicking(renderer.domElement, {
    blocked: () => guard.blocked(),
    pickAt: (x, y) => rayAt(x, y)?.id ?? null,
    onPick: (id) => {
      note(id);
      pickAction(id, {
        explodable: (x) => isExplodable(x, arch),
        explode: (x) => view.explode(x),
        openPanel: (x) => panel.openPanel(x),
      });
    },
    onEmpty: () => {
      void emptyClick({
        layerActive: () => !layerMode.element.hidden,
        depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel: () => panel.close(),
      });
    },
    onHover: (id) => {
      hover.show(id && lastHit?.id === id ? lastHit : null);
      tip.show(id);
      if (id) tip.move(lastX, lastY);
    },
  });

  // Look and quality: a persisted choice wins; otherwise the first frames run at High and a
  // probe of their render work time picks the preset (weak GPU -> Low, never a black screen).
  const look = createLook({ renderer, scene, camera, root: tower.root });
  // Every preset switch goes through the explode view, so an open level keeps the row dimmed.
  const applyQuality = (q: Quality): void => {
    view.refreshLook(() => look.applyQuality(q));
    reapplyPin();
    // Low: the lobby shows a still frame under a plain veil (no drift, no backdrop blur).
    lobby.setStill(q === 'low');
  };
  const override = loadOverride();
  applyQuality(override ?? 'high');
  let probe: Probe | null = null;
  let probeToken = 0;
  // Compile the High shaders first (where supported), so the probe measures frames, not compiles.
  const startProbe = (): void => {
    const token = ++probeToken;
    probe = null;
    const compiled = typeof renderer.compileAsync === 'function'
      ? renderer.compileAsync(scene, camera).catch(() => undefined) : Promise.resolve();
    void compiled.then(() => {
      if (token === probeToken) probe = createProbe();
    });
  };
  const stopProbe = (): void => {
    probeToken++;
    probe = null;
  };
  if (!override) startProbe();
  let lastAuto: Quality | null = null;
  const menu = createQualityMenu((q) => {
    if (q) {
      stopProbe();
      applyQuality(q);
    } else if (lastAuto) {
      applyQuality(lastAuto);
    } else {
      applyQuality('high');
      startProbe();
    }
  });
  top.settings.append(menu.element, soundToggle(sound).element);

  // First visit only, once the visitor left the lobby: three short hints (Play, the tours, click
  // anything), then never again.
  function startCoach(): void {
    const coach = createCoachMarks([
      // The whole dock: a bubble above it never covers the bar's own headline.
      { key: 'coach.play', target: () => dock },
      { key: 'coach.tours', target: () => top.toursButton },
      { key: 'coach.click', target: () => null },
    ], document, () => legend.setOpen(false));
    if (coach.element) {
      document.body.appendChild(coach.element);
      void bar.ready.then(() => requestAnimationFrame(() => coach.refresh()));
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    look.setSize(window.innerWidth, window.innerHeight);
    refadeLabels();
    trayRight();
    // The lobby covers the view: re-base the drift on the overview of the new window size.
    if (lobby.visible()) startDrift();
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now: number) => {
    timer.update(now);
    const dt = timer.getDelta();
    drift.visible = lobby.visible();
    drift.still = lobby.still();
    const p = driftTick(drift, dt);
    if (p) {
      camera.position.copy(p.position);
      rig.controls.target.copy(p.target);
    }
    rig.update(dt);
    view.update(dt);
    bar.tick(dt);
    animator.update(dt);
    const ms = look.render(dt, probe !== null);
    const picked = probe?.add(ms) ?? null;
    if (picked && probe) {
      // Calibration data for Task 16: the measured median render work time and the pick.
      console.debug(`[albert] quality probe: median ${probe.medianMs().toFixed(2)} ms over ${probe.count()} frames -> ${picked}`);
      stopProbe();
      lastAuto = picked;
      menu.setAuto(picked);
      applyQuality(resolveQuality(picked));
    }
  });
}

main().catch((err) => {
  document.body.textContent = String(err);
});
