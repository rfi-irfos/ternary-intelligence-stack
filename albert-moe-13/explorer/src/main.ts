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
import { pickAction } from './ui/pickAction';
import { APP_NAME } from './content/brand';
import { PALETTE } from './scene/palette';
import { FONT } from './style/theme';
import { type Probe, type Quality, createLook, createProbe, loadOverride, resolveQuality } from './scene/look';
import { QUALITY_MENU_CSS, createQualityMenu } from './ui/qualityMenu';
import { LABEL_CSS } from './data/labeled';
import { createAnimator } from './flow/animate';
import { LAYER_CSS, createLayerMode, layerOfId } from './layer/views';
import { createPlayerBar } from './ui/player';
import { attachPicking, createHover, createRaycastPicker } from './ui/picking';
import { createTopBar } from './ui/topbar';
import { createLegend } from './ui/legend';
import { createHighlighter } from './ui/highlight';
import { matchesRole } from './ui/roles';
import { createHoverTip } from './ui/tooltip';
import { createSelection } from './ui/selection';
import { onPrefsChange } from './ui/prefs';
import { createCoachMarks } from './ui/coach';

/** Waits (at most `ms`) for the display face, so the canvas labels of the scene draw in it. */
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
  await fontsReady();
  const arch = await loadArchitecture();
  const tower = buildTower(arch, await loadModules());

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
  void rig.overview(0);

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
    beforeNavigate: async () => {
      while (view.depth() > 0) await view.reassemble();
    },
    // Contextual "Step inside" on the selection card replaces the old Enter layer button.
    onStepInside: (id) => {
      const p = parseId(id);
      const stream = p && 'stream' in p && p.stream ? p.stream : undefined;
      void layerMode.enter(layerOfId(id) ?? undefined, stream);
    },
  });
  document.body.appendChild(panel.element);
  view = createExplode({
    tower, arch, rig, loadWeights,
    onChange: (id) => {
      note(id);
      if (id) void panel.openPanel(id);
      else panel.close();
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
  dock.append(bar.element, rail.element);
  // The rail doubles as the run's progress: a marker on the layer the word is in, a line under it.
  bar.onOp((op, i, n) => rail.flow(op.layer ?? null, n > 1 ? i / (n - 1) : 0));
  document.body.appendChild(dock);
  const layerMode = createLayerMode({
    arch, view, rig, loadWeights,
    slabCenter: (l) => new THREE.Vector3(tower.slabX(l), 0, 0),
    selectedLayer: () => selection.layer() ?? rail.selected() ?? layerOfId(panel.current()),
    defaults: () => bar.selection(),
  });
  document.body.appendChild(layerMode.element);

  // Home (overview) closes every open level at once (Esc closes one), leaves layer mode, then flies
  // to the overview: all on the user's click.
  top.home.addEventListener('click', () => {
    void (async () => {
      await layerMode.exit();
      while (view.depth() > 0) await view.reassemble();
      await rig.overview();
    })();
  });

  // The side column (inspection panel or layer steps) and the dock never overlap: the dock moves left.
  const syncSide = (): void => {
    document.body.classList.toggle('side-open', !panel.element.hidden || !layerMode.element.hidden);
  };
  const sideObserver = new MutationObserver(syncSide);
  sideObserver.observe(panel.element, { attributes: true, attributeFilter: ['hidden'] });
  sideObserver.observe(layerMode.element, { attributes: true, attributeFilter: ['hidden'] });
  syncSide();

  // Highlights: a legend role (hover previews, click pins) or a panel row under the pointer.
  const highlighter = createHighlighter(() => [tower.root, view.root]);
  const legend = createLegend({
    onHighlight: (role) => highlighter.show(role ? (id) => matchesRole(id, role) : null),
  });
  document.body.appendChild(legend.element);
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

  const rayAt = createRaycastPicker(camera, renderer.domElement, () => view.pickRoot(),
    (hit) => (view.depth() > 0 ? view.pick(hit) : tower.pick(hit)));
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
      if (view.depth() > 0) void view.reassemble();
      else panel.close();
    },
    onHover: (id) => {
      hover.show(id ? rayAt(lastX, lastY) : null);
      tip.show(id);
      if (id) tip.move(lastX, lastY);
    },
  });

  // Look and quality: a persisted choice wins; otherwise the first frames run at High and a
  // probe of their render work time picks the preset (weak GPU -> Low, never a black screen).
  const look = createLook({ renderer, scene, camera, root: tower.root });
  // Every preset switch goes through the explode view, so an open level keeps the row dimmed.
  const applyQuality = (q: Quality): void => view.refreshLook(() => look.applyQuality(q));
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
  top.settings.append(menu.element);

  // First visit only: three short hints (Play, the tours, click anything), then never again.
  const coach = createCoachMarks([
    // The whole dock: a bubble above it never covers the bar's own headline.
    { key: 'coach.play', target: () => dock },
    { key: 'coach.tours', target: () => top.toursButton },
    { key: 'coach.click', target: () => null },
  ]);
  if (coach.element) {
    document.body.appendChild(coach.element);
    void bar.ready.then(() => requestAnimationFrame(() => coach.refresh()));
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    look.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now: number) => {
    timer.update(now);
    const dt = timer.getDelta();
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
