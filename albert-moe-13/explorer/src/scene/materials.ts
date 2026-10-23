import * as THREE from 'three';
import { PALETTE } from './palette';

/** Quality preset names (see look.ts). Defined here so the scene can build without post-processing code. */
export type Quality = 'high' | 'medium' | 'low';

/** Camera/object layer whose objects feed the selective bloom (lanes, pulses, lit experts). */
export const BLOOM_LAYER = 1;

/** Marks an object (not its children) for the selective bloom. */
export function markBloom(o: THREE.Object3D): void {
  o.layers.enable(BLOOM_LAYER);
}

/**
 * Role tags on tower objects (`userData.look`); look.ts swaps the material of every tagged object
 * when the quality changes. Untagged objects keep their own material.
 */
export type LookRole = 'slab-glass' | 'part-glass' | 'part-edge';

/**
 * Draw order of the see-through layers: slabs first, then the parts inside them, then outlines, then
 * the gate arcs (drawn over the glass so the red bridge never fades behind a slab).
 */
export const RENDER_ORDER = { slab: 1, part: 2, edge: 3, gate: 4 } as const;

const SLAB_OPACITY = 0.05;
const PART_OPACITY = 0.2;
/**
 * Low has no fresnel rim and no bloom, so the tint of a part must come from the glass body alone:
 * a denser body and fainter outlines keep experts green and routers violet at overview distance,
 * where the dense white outlines of 12 small boxes would otherwise merge into a white blob.
 */
const PART_OPACITY_LOW = 0.38;
const EDGE_OPACITY = 0.7;
const EDGE_OPACITY_LOW = 0.3;

/**
 * Alpha glass with a fresnel rim: faces seen edge-on get brighter and more opaque, faces seen
 * head-on stay clear. A MeshBasicMaterial with an injected term, so fog, instancing, instance
 * colours and `opacity` (dimmed by explode.ts) keep working as in three.js.
 */
export function fresnelGlass(color: number, opacity: number, rim: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  m.name = 'fresnel-glass';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rim };
    const vary = 'varying vec3 vFresN;\nvarying vec3 vFresV;';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vary}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec3 fresN = normal;
  #ifdef USE_INSTANCING
    fresN = mat3( instanceMatrix ) * fresN;
  #endif
  vFresN = normalize( normalMatrix * fresN );
  vFresV = normalize( -mvPosition.xyz );`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uRim;\n${vary}`)
      .replace('#include <opaque_fragment>', `float fres = pow( 1.0 - abs( dot( normalize( vFresN ), normalize( vFresV ) ) ), 3.0 );
  outgoingLight = mix( outgoingLight, vec3( 1.0 ), 0.3 * fres );
  diffuseColor.a = min( 1.0, diffuseColor.a * ( 1.0 + uRim * fres ) );
  #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = (): string => 'albert-fresnel-glass';
  return m;
}

/** Glass of the 46 slab planes for one quality. */
export function slabGlassMaterial(q: Quality): THREE.Material {
  if (q === 'high') {
    // Frosted transmission: the lanes and gates behind a slab show through, slightly blurred.
    const m = new THREE.MeshPhysicalMaterial({
      color: PALETTE.glass, emissive: 0x0b0f16, transmission: 1, thickness: 0.05, ior: 1.3,
      roughness: 0.3, metalness: 0, specularIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false,
      // A veil, not a wall: half of what is behind stays sharp, half is frosted.
      transparent: true, opacity: 0.45,
    });
    m.name = 'slab-glass-transmission';
    return m;
  }
  if (q === 'medium') return fresnelGlass(PALETTE.glass, SLAB_OPACITY, 4);
  const m = new THREE.MeshBasicMaterial({
    color: PALETTE.glass, transparent: true, opacity: SLAB_OPACITY, depthWrite: false, side: THREE.DoubleSide,
  });
  m.name = 'slab-glass-basic';
  return m;
}

/** Glass of the instanced parts (experts, routers, attention, norms, row ends); tinted per instance. */
export function partGlassMaterial(q: Quality): THREE.Material {
  if (q !== 'low') return fresnelGlass(0xffffff, PART_OPACITY, 2.5);
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: PART_OPACITY_LOW, depthWrite: false, side: THREE.DoubleSide,
  });
  m.name = 'part-glass-basic';
  return m;
}

/** Thin white outline of the instanced parts (instanced LineSegments, see instancedEdges). */
export function partEdgeMaterial(q: Quality): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({
    color: PALETTE.edge, transparent: true, opacity: q === 'low' ? EDGE_OPACITY_LOW : EDGE_OPACITY, depthWrite: false,
  });
  mat.defines = { USE_INSTANCING: '' };
  mat.name = 'edge-instanced';
  return mat;
}

/** Material for a tagged role at a quality. */
export function lookMaterial(role: LookRole, q: Quality): THREE.Material {
  if (role === 'slab-glass') return slabGlassMaterial(q);
  if (role === 'part-edge') return partEdgeMaterial(q);
  return partGlassMaterial(q);
}

/**
 * Thin white outline of every instance of `mesh` in one draw call: an instanced LineSegments that
 * shares the mesh's instanceMatrix attribute, so hiding an instance (explode.ts scales it to 0)
 * hides its outline too. Added as a child of the mesh; not pickable.
 */
export function instancedEdges(
  mesh: THREE.InstancedMesh,
  material: THREE.Material = partEdgeMaterial('low'),
  thresholdDeg = 30,
): THREE.LineSegments {
  const eg = new THREE.EdgesGeometry(mesh.geometry, thresholdDeg);
  const ig = new THREE.InstancedBufferGeometry();
  ig.setAttribute('position', eg.getAttribute('position'));
  ig.instanceCount = mesh.count;
  if (!mesh.boundingSphere) mesh.computeBoundingSphere();
  // Same culling sphere as the parent, so the parent (which uploads the shared matrices) is drawn
  // whenever the outline is.
  ig.boundingSphere = mesh.boundingSphere!.clone();
  const line = new THREE.LineSegments(ig, material);
  // Opacity per quality: look.ts swaps the material of every `part-edge` (shared, cached per preset).
  line.userData.look = 'part-edge' satisfies LookRole;
  // WebGLBindingStates binds `object.instanceMatrix` for the instanceMatrix attribute.
  (line as unknown as { instanceMatrix: THREE.InstancedBufferAttribute }).instanceMatrix = mesh.instanceMatrix;
  line.raycast = (): void => {};
  line.name = `${mesh.name}-edges`;
  line.renderOrder = RENDER_ORDER.edge;
  mesh.add(line);
  return line;
}
