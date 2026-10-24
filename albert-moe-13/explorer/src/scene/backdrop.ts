import * as THREE from 'three';
import { BACKDROP } from '../style/theme';

const STEPS = 256;

/**
 * Vertical gradient (top navy to bottom near-black) as a 1 x 256 texture for `scene.background`. Three
 * draws a plain background texture as one full-screen quad behind the scene, so the canvas stays opaque:
 * the bloom composers, the output pass and the pixel read-back need no alpha. Built from raw pixels (no
 * 2D canvas), so it also works in tests.
 */
export function createBackdrop(): THREE.DataTexture {
  const top = new THREE.Color(BACKDROP.top);
  const bottom = new THREE.Color(BACKDROP.bottom);
  // The texture is read as sRGB, so mix the sRGB values (Color stores linear; getRGB with SRGB converts back).
  const a = { r: 0, g: 0, b: 0 };
  const b = { r: 0, g: 0, b: 0 };
  top.getRGB(a, THREE.SRGBColorSpace);
  bottom.getRGB(b, THREE.SRGBColorSpace);
  const data = new Uint8Array(STEPS * 4);
  for (let i = 0; i < STEPS; i++) {
    // row 0 is the bottom of the image
    const f = i / (STEPS - 1);
    data[i * 4] = Math.round(255 * (b.r + (a.r - b.r) * f));
    data[i * 4 + 1] = Math.round(255 * (b.g + (a.g - b.g) * f));
    data[i * 4 + 2] = Math.round(255 * (b.b + (a.b - b.b) * f));
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, STEPS, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Haze colour: the middle of the gradient, so far parts fade into the backdrop and not to a black cut. */
export function backdropMid(): THREE.Color {
  return new THREE.Color(BACKDROP.bottom).lerp(new THREE.Color(BACKDROP.top), 0.5);
}
