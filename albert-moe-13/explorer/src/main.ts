import * as THREE from 'three';
import { createControls } from './camera/controls';
import { createSlabRail } from './ui/slabRail';
import { loadArchitecture } from './data/architecture';
import { buildTower } from './scene/tower';
import { createWeightsLoader } from './data/weights';
import { createExplode } from './scene/explode';
import { isExplodable } from './scene/hierarchy';
import { slabId } from './scene/ids';
import { createPanel, PANEL_CSS } from './ui/panel';
import { attachDepthKeys } from './ui/depth';
import { pickAction } from './ui/pickAction';
import { APP_NAME } from './content/brand';
import { LABEL_CSS } from './data/labeled';
import { createAnimator } from './flow/animate';
import { PLAYER_CSS, createPlayerBar } from './ui/player';
import { attachPicking, createHover, createRaycastPicker } from './ui/picking';

async function main(): Promise<void> {
  document.title = APP_NAME;
  const heading = document.getElementById('app-name');
  if (heading) heading.textContent = APP_NAME;
  const arch = await loadArchitecture();
  const tower = buildTower(arch);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(tower.root);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(20, -30, 40);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.up.set(0, 0, 1);
  const rig = createControls(camera, renderer.domElement, tower.rowExtent);
  void rig.overview(0);

  const style = document.createElement('style');
  style.textContent = `
    .slab-rail { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 2px;
      max-width: 96vw; overflow-x: auto; padding: 4px; background: rgba(0,0,0,0.55); border-radius: 6px; }
    .slab-rail-item { font: 10px monospace; min-width: 20px; padding: 3px 0; color: #cfd8e8; background: #14161b;
      border: 1px solid #333a46; border-radius: 3px; cursor: pointer; }
    .slab-rail-item.fusion { border-color: #ffd940; color: #ffd940; }
    .slab-rail-item.active { background: #58c4dd; color: #000; }
    ${PANEL_CSS}
    ${LABEL_CSS}
    ${PLAYER_CSS}
    .overview-btn { position: fixed; top: 56px; left: 14px; font: 12px monospace; padding: 6px 10px; color: #fff;
      background: #14161b; border: 1px solid #333a46; border-radius: 4px; cursor: pointer; }`;
  document.head.appendChild(style);
  const loadWeights = createWeightsLoader();
  // Declared before use: the panel reassembles an open explosion before a connection link flies.
  let view: ReturnType<typeof createExplode>;
  const panel = createPanel({
    arch, tower, rig, loadWeights,
    beforeNavigate: async () => {
      while (view.depth() > 0) await view.reassemble();
    },
  });
  document.body.appendChild(panel.element);
  view = createExplode({
    tower, arch, rig, loadWeights,
    onChange: (id) => {
      if (id) void panel.openPanel(id);
      else panel.close();
    },
  });
  scene.add(view.root);
  attachDepthKeys();
  const rail = createSlabRail(tower, rig, (l) => void panel.openPanel(slabId(l)));
  document.body.appendChild(rail.element);
  const animator = createAnimator(tower);
  scene.add(animator.root);
  const bar = createPlayerBar({ arch, tower, rig, animator });
  document.body.appendChild(bar.element);
  const ov = document.createElement('button');
  ov.className = 'overview-btn';
  ov.textContent = 'Overview (Esc)';
  ov.addEventListener('click', () => void rig.overview());
  document.body.appendChild(ov);

  const rayAt = createRaycastPicker(camera, renderer.domElement, () => view.pickRoot(),
    (hit) => (view.depth() > 0 ? view.pick(hit) : tower.pick(hit)));
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const hover = createHover(scene);
  attachPicking(renderer.domElement, {
    pickAt: (x, y) => rayAt(x, y)?.id ?? null,
    onPick: (id) => pickAction(id, {
      explodable: (x) => isExplodable(x, arch),
      explode: (x) => view.explode(x),
      openPanel: (x) => panel.openPanel(x),
    }),
    onEmpty: () => {
      if (view.depth() > 0) void view.reassemble();
      else panel.close();
    },
    onHover: (id) => hover.show(id ? rayAt(lastX, lastY) : null),
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    rig.update(dt);
    view.update(dt);
    bar.tick(dt);
    animator.update(dt);
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  document.body.textContent = String(err);
});
