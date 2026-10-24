import * as THREE from 'three';
import { backdropMid } from './backdrop';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM_LAYER, type LookRole, type Quality, lookMaterial } from './materials';
import { PALETTE } from './palette';

export type { Quality };
export const QUALITIES: readonly Quality[] = ['high', 'medium', 'low'];

/** What a preset switches on. `post` = any post-processing (low has none). */
export interface Preset {
  /** Selective bloom on lanes, pulses and lit experts. */
  bloom: boolean;
  /** Depth haze: exponential fog along the row. */
  haze: boolean;
  /** Frosted transmission glass on the slabs (else alpha + fresnel, or plain alpha on low). */
  transmission: boolean;
  /** Fresnel rim on the glass. */
  fresnel: boolean;
  /** MSAA samples of the post-processing target (the composer bypasses the canvas antialias). */
  msaa: number;
  /** Cap on devicePixelRatio. */
  maxPixelRatio: number;
}

export const PRESETS: Record<Quality, Preset> = {
  high: { bloom: true, haze: true, transmission: true, fresnel: true, msaa: 4, maxPixelRatio: 2 },
  medium: { bloom: true, haze: true, transmission: false, fresnel: true, msaa: 2, maxPixelRatio: 1.5 },
  // Low keeps the identity (black room, thin white edges, tinted glass, coloured lanes, haze for depth)
  // and drops only what costs: post-processing, transmission and the fresnel shader.
  low: { bloom: false, haze: true, transmission: false, fresnel: false, msaa: 0, maxPixelRatio: 1 },
};

export const usesPost = (q: Quality): boolean => PRESETS[q].bloom;

/** Median of the finite samples (NaN for none). */
export function median(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/**
 * Preset from probe frame times (ms): median <= 12 -> high, <= 22 -> medium, else low. No usable
 * sample means the probe could not measure anything, which is treated as a weak device -> low
 * (Review Focus 5: a weak GPU must land on Low, never on a black screen).
 */
export function chooseQuality(frameTimesMs: number[]): Quality {
  const m = median(frameTimesMs);
  if (!Number.isFinite(m)) return 'low';
  if (m <= 12) return 'high';
  if (m <= 22) return 'medium';
  return 'low';
}

/** Minimal Storage subset (window.localStorage in the app, a stub in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const QUALITY_STORAGE_KEY = 'albert-explorer.quality';

const isQuality = (v: unknown): v is Quality => v === 'high' || v === 'medium' || v === 'low';

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked (privacy mode, sandboxed iframe)
  }
}

/** The user's persisted preset choice from the settings menu; null = automatic (probe decides). */
export function loadOverride(store: KeyValueStore | null = defaultStore()): Quality | null {
  try {
    const v = store?.getItem(QUALITY_STORAGE_KEY) ?? null;
    return isQuality(v) ? v : null;
  } catch {
    return null;
  }
}

/** Persists (or with null clears) the user's choice. */
export function saveOverride(q: Quality | null, store: KeyValueStore | null = defaultStore()): void {
  try {
    if (q) store?.setItem(QUALITY_STORAGE_KEY, q);
    else store?.removeItem(QUALITY_STORAGE_KEY);
  } catch {
    /* storage full or blocked: the choice holds for this session only */
  }
}

/** A persisted override always wins over the probe. */
export function resolveQuality(probe: Quality, store: KeyValueStore | null = defaultStore()): Quality {
  return loadOverride(store) ?? probe;
}

/**
 * Collects per-frame render work times (ms) after a warm-up (shader compiles), then reports once.
 * Work time, not the requestAnimationFrame interval: rAF is vsync-capped (16.7 ms at 60 Hz), so an
 * interval median could never reach the 12 ms "high" threshold.
 */
export interface Probe {
  /** Adds one frame time; returns the pick once, on the frame that completes the probe. */
  add(ms: number): Quality | null;
  done(): boolean;
  /** Median of the samples so far (ms), for calibration logs. */
  medianMs(): number;
  /** Number of samples counted after the warm-up. */
  count(): number;
}

export function createProbe(samples = 30, warmup = PROBE_WARMUP): Probe {
  const times: number[] = [];
  let seen = 0;
  let result: Quality | null = null;
  return {
    add(ms) {
      if (result) return null;
      if (seen++ < warmup) return null;
      times.push(ms);
      // Clearly too slow already: do not keep a weak device on High for the whole probe.
      const early = times.length >= EARLY_SAMPLES && median(times) > 2 * 22;
      if (!early && times.length < samples) return null;
      result = chooseQuality(times);
      return result;
    },
    done: () => result !== null,
    medianMs: () => median(times),
    count: () => times.length,
  };
}

/** Frames skipped before measuring (late shader compiles, texture uploads, first layout). */
export const PROBE_WARMUP = 8;
const EARLY_SAMPLES = 5;

/** Selective bloom: a soft halo around the light lines, not a wash over the room. */
export const BLOOM = { strength: 0.6, radius: 0.25 } as const;

/** Haze density along the row (FogExp2); far slabs of the overview fade to about half. */
export const HAZE_DENSITY = 0.004;
const HAZE_PERIOD_S = 14;
const HAZE_SWING = 0.12;

/** Haze density at time t (s). Reduced motion: constant. */
export function hazeDensity(t: number, reducedMotion: boolean): number {
  if (reducedMotion) return HAZE_DENSITY;
  return HAZE_DENSITY * (1 + HAZE_SWING * Math.sin((2 * Math.PI * t) / HAZE_PERIOD_S));
}

const MIX_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const MIX_FRAGMENT = /* glsl */ `
uniform sampler2D baseTexture;
uniform sampler2D bloomTexture;
uniform float bloomGain;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D( baseTexture, vUv ) + bloomGain * texture2D( bloomTexture, vUv );
}`;

interface Post {
  bloom: EffectComposer;
  final: EffectComposer;
  /** 1 = add the bloom texture, 0 = skip it (no bloom source visible this frame). */
  gain: { value: number };
  dispose(): void;
}

export interface LookDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Root whose `userData.look`-tagged meshes get the preset materials (the tower). */
  root: THREE.Object3D;
  reducedMotion?: () => boolean;
}

export interface Look {
  quality(): Quality;
  /** Switches materials, haze, bloom and pixel ratio. */
  applyQuality(q: Quality): void;
  /** Renders one frame (with or without post). Returns the CPU+GPU work time in ms when `measure`. */
  render(dt: number, measure?: boolean): number;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createLook(deps: LookDeps): Look {
  const { renderer, scene, camera, root } = deps;
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = deps.reducedMotion ?? ((): boolean => mq?.matches ?? false);
  const fog = new THREE.FogExp2(backdropMid(), HAZE_DENSITY);
  const materials = new Map<string, THREE.Material>();
  const size = renderer.getSize(new THREE.Vector2());
  // The tower is built with the low materials; they become the cached low set.
  root.traverse((o) => {
    const role = o.userData.look as LookRole | undefined;
    if (role && !materials.has(`${role}:low`)) materials.set(`${role}:low`, (o as THREE.Mesh).material as THREE.Material);
  });
  let q: Quality = 'low';
  let post: Post | null = null;
  let elapsed = 0;
  const pixel = new Uint8Array(4);
  const bloomLayers = new THREE.Layers();
  bloomLayers.set(BLOOM_LAYER);
  // Reused every frame: no per-frame allocation for the bloom-source scan.
  const muted: THREE.Object3D[] = [];
  let lit = 0;
  const scanBloom = (o: THREE.Object3D): void => {
    if (!o.layers.test(bloomLayers)) return;
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    // A dimmed bloom source (explode.ts fades the row) must not glow at full strength.
    if (m && !Array.isArray(m) && m.opacity < 0.5) muted.push(o);
    else lit++;
  };

  const material = (role: LookRole, quality: Quality): THREE.Material => {
    const key = `${role}:${quality}`;
    let m = materials.get(key);
    if (!m) materials.set(key, (m = lookMaterial(role, quality)));
    return m;
  };

  const buildPost = (p: Preset): Post => {
    // Half-float targets keep the bloom smooth; fall back to 8 bit where they cannot be rendered to.
    const ext = renderer.extensions;
    const type = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
      ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const bloom = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type }));
    bloom.renderToScreen = false;
    bloom.addPass(new RenderPass(scene, camera));
    bloom.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, 0));
    const final = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type, samples: p.msaa }));
    final.addPass(new RenderPass(scene, camera));
    const gain = { value: 1 };
    const mix = new ShaderPass(new THREE.ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloom.renderTarget2.texture }, bloomGain: gain },
      vertexShader: MIX_VERTEX,
      fragmentShader: MIX_FRAGMENT,
    }), 'baseTexture');
    mix.needsSwap = true;
    final.addPass(mix);
    final.addPass(new OutputPass());
    // ShaderPass uses a given ShaderMaterial as is; read the uniform back from the pass to be safe.
    const live = (mix.material as THREE.ShaderMaterial).uniforms.bloomGain as { value: number };
    return {
      bloom,
      final,
      gain: live,
      dispose() {
        for (const c of [bloom, final]) {
          for (const pass of c.passes) pass.dispose();
          c.dispose();
        }
      },
    };
  };

  const look: Look = {
    quality: () => q,
    applyQuality(next) {
      q = next;
      const p = PRESETS[next];
      root.traverse((o) => {
        const role = o.userData.look as LookRole | undefined;
        if (role) (o as THREE.Mesh).material = material(role, next);
      });
      scene.fog = p.haze ? fog : null;
      renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, p.maxPixelRatio));
      post?.dispose();
      post = p.bloom ? buildPost(p) : null;
      post?.bloom.setPixelRatio(renderer.getPixelRatio());
      post?.final.setPixelRatio(renderer.getPixelRatio());
      post?.bloom.setSize(size.x, size.y);
      post?.final.setSize(size.x, size.y);
    },
    render(dt, measure = false) {
      elapsed += dt;
      if (scene.fog === fog) fog.density = hazeDensity(elapsed, reduced());
      const t0 = measure ? performance.now() : 0;
      if (post) {
        // Bloom source: only objects on BLOOM_LAYER, on black. Lanes are lights seen through glass,
        // so the slabs need not occlude them here.
        muted.length = 0;
        lit = 0;
        scene.traverseVisible(scanBloom);
        post.gain.value = lit > 0 ? 1 : 0;
        if (lit > 0) {
          const mask = camera.layers.mask;
          const bg = scene.background;
          for (const o of muted) o.visible = false;
          try {
            scene.background = null;
            camera.layers.set(BLOOM_LAYER);
            post.bloom.render(dt);
          } finally {
            // A throwing pass must not leave the scene black-backgrounded or the dimmed lanes hidden.
            camera.layers.mask = mask;
            scene.background = bg;
            for (const o of muted) o.visible = true;
            muted.length = 0;
          }
        }
        post.final.render(dt);
      } else {
        renderer.render(scene, camera);
      }
      if (!measure) return 0;
      // gl.finish() does not block in Chrome; reading one pixel back waits for the GPU for real.
      renderer.setRenderTarget(null);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return performance.now() - t0;
    },
    setSize(w, h) {
      size.set(w, h);
      renderer.setSize(w, h);
      post?.bloom.setSize(w, h);
      post?.final.setSize(w, h);
    },
    dispose() {
      post?.dispose();
      post = null;
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
  return look;
}
