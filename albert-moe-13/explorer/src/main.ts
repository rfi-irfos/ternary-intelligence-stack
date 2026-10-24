import * as THREE from 'three';
import './style/tokens.css';
import './style/ui.css';
import { createControls } from './camera/controls';
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
import { createSidebar } from './ui/sidebar';
import { createRunTimeline } from './ui/runTimeline';
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
import { closeTourMenu, isTourMenuOpen, openTourMenu } from './ui/tourMenu';

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
  // The side panel is created before the camera rig: its Esc listener then runs first and a press that
  // closes the panel never also flies the camera. It gives way while a level, a tour menu or a dialog owns Esc.
  let escBusy = (): boolean => false;
  const sidebar = createSidebar({ yieldEsc: () => escBusy() || isTourMenuOpen() });
  const top = createTopBar(heading, { onGear: () => sidebar.open(['display']) });
  document.body.append(top.element, sidebar.element, sidebar.edgeTab);
  top.sidebarButton.addEventListener('click', () => sidebar.toggle());
  const syncSidebarButton = (): void => top.setSidebarOpen(sidebar.isOpen());
  sidebar.onChange(syncSidebarButton);
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
  // The component the user last selected (stepper, scene click or panel): the stepper follows it and
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
  // The panel's three parts live in the side panel: Modell, Inspektion and Analyse.
  panel.mount({ model: sidebar.body('model'), inspect: sidebar.body('inspect'), analysis: sidebar.body('analysis') });
  // Selecting something opens the side panel at Modell / Inspektion; a panel it opened itself closes again
  // when the selection folds back (one that the visitor opened stays).
  let autoOpened = false;
  sidebar.onChange(() => { if (!sidebar.isOpen()) autoOpened = false; });
  const showPanel = (id: string): Promise<void> => {
    if (!sidebar.isOpen()) autoOpened = true;
    if (!layerMode.element.hidden) return Promise.resolve();
    sidebar.open(['model', 'inspect']);
    return panel.openPanel(id);
  };
  const closePanel = (): void => {
    panel.close();
    if (autoOpened) sidebar.close();
    autoOpened = false;
  };
  view = createExplode({
    tower, arch, rig, loadWeights, name: sceneName, watch: onPrefsChange,
    onChange: (id) => {
      note(id);
      reapplyPin();
      if (id) void showPanel(id);
      else closePanel();
      bar.setHint(view.depth() > 0 ? 'hint.levelOpen' : null);
    },
  });
  scene.add(view.root);
  attachDepthKeys();
  const animator = createAnimator(tower);
  scene.add(animator.root);
  // The layer stepper of the dock looks at that layer, like a click on it: it selects it, flies there and
  // opens the side panel at Modell.
  const bar = createPlayerBar({
    arch, tower, rig, animator,
    onLayerStep: (l) => {
      selection.set(slabId(l));
      void rig.flyTo(tower.anchor(slabId(l)), 14);
      void showPanel(slabId(l));
    },
  });
  const dock = document.createElement('div');
  dock.className = 'dock';
  dock.append(bar.element);
  // The mini dock is permanent; the run timeline sits at the very bottom, below it.
  const timeline = createRunTimeline(() => bar.timing());
  document.body.append(dock, timeline.element);
  // The stepper follows the layer the word is in and any selection made elsewhere.
  bar.onOp((op) => { if (op.layer !== undefined) bar.setLayer(op.layer); });
  selection.onChange((l) => { if (l !== null) bar.setLayer(l); });
  // The tool: Sitzung (sentence and words), Darstellung (view mode, quality, sound) hold the bar's controls.
  sidebar.body('session').append(bar.session);
  sidebar.body('display').append(bar.display);
  const layerMode = createLayerMode({
    arch, view, rig, loadWeights,
    slabCenter: (l) => new THREE.Vector3(tower.slabX(l), 0, 0),
    selectedLayer: () => selection.layer() ?? layerOfId(panel.current()),
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
      sidebar.close();
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
  // The legend chip is a tray item of the system bar (left, after home); its card floats under the bar.
  (top.element.querySelector('.top-left') ?? document.body).appendChild(legend.element);
  // The card leaves the bar's box (its blur would make it the card's positioning parent) and floats on the page.
  document.body.appendChild(legend.card);
  // Open on the first visit only (beside the coach marks); afterwards a collapsed chip.
  legend.setOpen(!coachSeen());
  /** The pinned legend role again, after an explode level or a quality switch rebuilt colours. */
  const reapplyPin = (): void => {
    const role = legend.pinned();
    if (role) highlighter.show((id) => matchesRole(id, role));
  };

  // The HUD insets the camera frames around (top bar, dock and timeline, side panel, legend card). The rig
  // reads them at fly time from this provider, so a panel that opened in the same click already counts; a
  // new measure never moves the camera. Inset changes (and camera rests) only refade the labels under the HUD.
  const GAP = 8;
  const hudNow = () => measureHud({
    top: top.element, dock, timeline: timeline.element, gap: GAP, win: window,
    // The open side panel floats over the scene on the right; the layer steps use the same column.
    side: () => (!layerMode.element.hidden ? layerMode.element : sidebar.isOpen() ? sidebar.element : null),
    legendCard: () => (legend.isOpen() ? legend.card : null),
  });
  rig.setInsetsProvider(hudNow);
  const refadeLabels = (): void => view.fadeLabels(camera, window.innerWidth, window.innerHeight, rig.insets());
  rig.onSettle(refadeLabels);
  escBusy = () => view.depth() > 0 || layerBusy();
  // The side panel (or the layer steps) and the dock never overlap: the dock re-centres in the free width.
  function layerBusy(): boolean { return !layerMode.element.hidden; }
  const syncSide = (): void => {
    document.body.classList.toggle('layer-open', !layerMode.element.hidden);
    refadeLabels();
  };
  const sideObserver = new MutationObserver(syncSide);
  sideObserver.observe(layerMode.element, { attributes: true, attributeFilter: ['hidden'] });
  sideObserver.observe(legend.element, { attributes: true, attributeFilter: ['class'] });
  sidebar.onChange(syncSide);
  if (typeof ResizeObserver === 'function') {
    const sizes = new ResizeObserver(refadeLabels);
    for (const x of [top.element, dock, timeline.element, legend.card, sidebar.element, layerMode.element]) sizes.observe(x);
  }
  syncSide();
  // First frame of the session: the overview already fits between the HUD (startup, not an inset change).
  void rig.overview(0);
  lobby.show();
  startDrift();
  sidebar.element.addEventListener('pointerover', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-link]');
    if (link?.dataset.link) {
      const want = link.dataset.link;
      highlighter.show((id) => id === want || id.startsWith(`${want}.`));
    }
  });
  sidebar.element.addEventListener('pointerout', (e) => {
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
        openPanel: (x) => showPanel(x),
      });
    },
    onEmpty: () => {
      void emptyClick({
        layerActive: () => !layerMode.element.hidden,
        depth: view.depth, reassembleAll: () => view.reassembleAll(), closePanel,
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
  // Quality and sound sit in the side panel's Darstellung section (the gear opens it); the bar's own settings
  // popover keeps the same content for a bar built without the side panel.
  sidebar.body('display').append(menu.element, soundToggle(sound).element);

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
    timeline.update();
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
