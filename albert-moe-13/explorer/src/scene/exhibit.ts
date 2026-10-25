import * as THREE from 'three';
import { PALETTE } from './palette';
import { UI } from '../style/theme';
import { assetUrl } from '../data/assetUrl';
import type { RowExtent } from '../camera/controls';

/** The one exhibit: the real training dashboard (screenshot of the 28-layer stage). Static, never animated. */
export const EXHIBIT_URL = assetUrl('assets/exhibits/dashboard-live.png');
/** Size of the screenshot in pixels (1871 x 932); the picture keeps this ratio. */
export const EXHIBIT_ASPECT = 1871 / 932;
/** World height of the picture (the frame comes on top). */
const PICTURE_H = 9;
const BAR = 0.28;
const BAR_DEPTH = 0.4;
/** Place in the room: along the row, toward the camera, and height (the row sits at z = 0). */
const EXHIBIT_X_FRACTION = 0.5;
const EXHIBIT_Y = -34;
const EXHIBIT_Z = -3;

export interface ExhibitDeps {
  /** Loads the picture; only called on the first `ensureTexture()`. Defaults to an HTML image. */
  loadImage?: (url: string) => Promise<TexImageSource>;
  maxAnisotropy?: () => number;
}

export interface Exhibit {
  group: THREE.Group;
  /** Centre of the picture in the world. */
  anchor: THREE.Vector3;
  /** Camera distance at which the whole frame (with plaque) fits. */
  viewDistance(aspect: number, fovDeg: number): number;
  /** Starts loading the picture (once); resolves with the texture, or null if loading failed. */
  ensureTexture(): Promise<THREE.Texture | null>;
  /** The texture if it was created, else null. */
  texture(): THREE.Texture | null;
  dispose(): void;
}

/**
 * Where the exhibit hangs: in the model's room, in front of the row (toward the default overview camera) and a little
 * left of its middle, facing the camera (-y). The row ends alone set the overview frame; the wall stands inside that
 * frame, in the empty space below the row, so it is in view from the first moment.
 */
export function exhibitAnchor(extent: RowExtent): THREE.Vector3 {
  const len = extent.maxX - extent.minX;
  return new THREE.Vector3(extent.minX + len * EXHIBIT_X_FRACTION, EXHIBIT_Y, EXHIBIT_Z);
}

const defaultLoad = (url: string): Promise<TexImageSource> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`exhibit image failed: ${url}`));
    img.src = url;
  });

/**
 * Museum-style frame: a thin dark metal frame, the unlit picture (the screenshot as it is, no glow, no
 * motion) and a small plaque plate below. Until the picture has loaded the plane shows the plain dark
 * surface colour. The texture is created at most once and disposed with the exhibit.
 */
export function createExhibit(extent: RowExtent, deps: ExhibitDeps = {}): Exhibit {
  const load = deps.loadImage ?? defaultLoad;
  const w = PICTURE_H * EXHIBIT_ASPECT;
  const group = new THREE.Group();
  group.name = 'exhibit';
  group.position.copy(exhibitAnchor(extent));

  const pictureMat = new THREE.MeshBasicMaterial({ color: UI.surface, toneMapped: false });
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(w, PICTURE_H), pictureMat);
  picture.name = 'exhibit:picture';
  group.add(picture);

  const frameMat = new THREE.MeshStandardMaterial({ color: UI.hairline, metalness: 0.85, roughness: 0.35 });
  const bars: THREE.Mesh[] = [];
  const bar = (bw: number, bh: number, x: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, BAR_DEPTH, bh), frameMat);
    m.position.set(x, BAR_DEPTH / 2 - 0.02, z);
    m.name = 'exhibit:frame';
    bars.push(m);
    group.add(m);
  };
  bar(w + 2 * BAR, BAR, 0, PICTURE_H / 2 + BAR / 2);
  bar(w + 2 * BAR, BAR, 0, -PICTURE_H / 2 - BAR / 2);
  bar(BAR, PICTURE_H, -w / 2 - BAR / 2, 0);
  bar(BAR, PICTURE_H, w / 2 + BAR / 2, 0);

  // Plaque: a small dark plate under the frame with one thin accent line (text lives in the DOM caption).
  const plateMat = new THREE.MeshStandardMaterial({ color: UI.raised, metalness: 0.6, roughness: 0.5 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w * 0.28, 0.12, 0.9), plateMat);
  plate.position.set(0, 0.04, -PICTURE_H / 2 - BAR - 1.1);
  plate.name = 'exhibit:plaque';
  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent, toneMapped: false });
  const line = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.02, 0.05), lineMat);
  line.position.set(0, -0.03, -PICTURE_H / 2 - BAR - 1.1);
  group.add(plate, line);

  // The plane faces +z; turn it to face -y (z up, x to the right as seen from the front).
  picture.rotation.x = Math.PI / 2;

  let tex: THREE.Texture | null = null;
  let pending: Promise<THREE.Texture | null> | null = null;
  let disposed = false;

  return {
    group,
    anchor: group.position.clone(),
    viewDistance(aspect, fovDeg) {
      const halfV = THREE.MathUtils.degToRad(fovDeg) / 2;
      const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 0.2));
      const need = Math.max((w / 2 + BAR) / Math.tan(halfH), (PICTURE_H / 2 + BAR + 2.2) / Math.tan(halfV));
      return need * 1.15 + 1;
    },
    ensureTexture() {
      if (pending) return pending;
      pending = load(EXHIBIT_URL).then((img) => {
        if (disposed) return null;
        const t = new THREE.Texture(img as never);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = deps.maxAnisotropy?.() ?? 1;
        t.needsUpdate = true;
        tex = t;
        pictureMat.map = t;
        pictureMat.color.set(0xffffff);
        pictureMat.needsUpdate = true;
        return t;
      }, () => null);
      return pending;
    },
    texture: () => tex,
    dispose() {
      disposed = true;
      tex?.dispose();
      tex = null;
      pictureMat.map = null;
      for (const o of group.children) {
        const m = o as THREE.Mesh;
        m.geometry.dispose();
      }
      pictureMat.dispose();
      frameMat.dispose();
      plateMat.dispose();
      lineMat.dispose();
      group.removeFromParent();
    },
  };
}

/** The pagehide handler: always closes the lightbox, disposes the exhibit only on a real unload.
 *  A back/forward-cache restore (`persisted`) keeps the page alive and needs the exhibit. */
export function pagehideHandler(
  exhibit: { dispose(): void },
  closeLightbox: () => void,
): (e: { persisted: boolean }) => void {
  return (e) => {
    closeLightbox();
    if (!e.persisted) exhibit.dispose();
  };
}
