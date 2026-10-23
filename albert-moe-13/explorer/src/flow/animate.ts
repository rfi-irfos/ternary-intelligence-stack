import * as THREE from 'three';
import {
  type ComponentId, type Stream,
  attnId, embedId, expertId, gateId, ln1Id, ln2Id, lmHeadId, lnFId, routerId,
} from '../scene/ids';
import { COLORS, LANE_Y, LANE_Z, type TowerScene, gateArc } from '../scene/tower';
import type { ExpertsData, GateData, Op } from './timeline';

/** What one op lights up, as ids and numbers (no THREE objects; unit-testable). */
export interface OpTarget {
  /** Where the pulse sits (component anchor id). */
  pulse: ComponentId;
  stream?: Stream;
  /** Expert cubes lit (router top-3) and the ones left dark. */
  lit: { id: ComponentId; weight: number }[];
  dark: ComponentId[];
  /** Gate valve openness 0..1 per lane, from g_a / g_b. */
  valves?: { A: number; B: number; gate: ComponentId };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function opTarget(op: Op, tower: TowerScene): OpTarget {
  const layer = op.layer ?? 0;
  const s = op.stream;
  const pick = (id: ComponentId): OpTarget => ({ pulse: id, ...(s ? { stream: s } : {}), lit: [], dark: [] });
  switch (op.kind) {
    case 'embed': return pick(embedId());
    case 'ln_f': case 'merge': return pick(lnFId());
    case 'lm_head': return pick(lmHeadId());
    case 'ln1': return pick(ln1Id(layer, s ?? 'A'));
    case 'ln2': return pick(ln2Id(layer, s ?? 'A'));
    case 'attn': case 'resid': return pick(attnId(layer, s ?? 'A'));
    case 'router': return pick(routerId(layer, s ?? 'A'));
    case 'experts': {
      const d = op.data.value as ExpertsData;
      return {
        pulse: routerId(layer, s ?? 'A'),
        ...(s ? { stream: s } : {}),
        lit: d.lit.map((e, i) => ({ id: expertId(layer, e), weight: d.weights[i] ?? 0 })),
        dark: d.dark.map((e) => expertId(layer, e)),
      };
    }
    case 'gate': {
      const d = op.data.value as GateData;
      const gate = gateId(layer);
      if (!tower.has(gate)) throw new Error(`no gate at layer ${layer}`);
      return { pulse: gate, lit: [], dark: [], valves: { A: clamp01(d.gA), B: clamp01(d.gB), gate } };
    }
  }
}

export interface Animator {
  root: THREE.Group;
  /** Show one op (called when the player moves to it). */
  show(op: Op | null): void;
  update(dt: number): void;
  dispose(): void;
}

const PULSE_SECONDS = 0.5;

/**
 * Overlay for the follow-a-token player: a pulse that rides lane A or B (both lanes for end ops),
 * the lit and dark expert cubes, and gate valves opened by g_a / g_b. Never alters the base scene.
 */
export function createAnimator(tower: TowerScene): Animator {
  const root = new THREE.Group();
  root.name = 'flow';
  const pulseMat = (c: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthTest: false });
  const sphere = new THREE.SphereGeometry(0.28, 16, 12);
  const pulses: Record<Stream, THREE.Mesh> = { A: new THREE.Mesh(sphere, pulseMat(COLORS.A)), B: new THREE.Mesh(sphere, pulseMat(COLORS.B)) };
  for (const p of Object.values(pulses)) { p.visible = false; p.renderOrder = 10; root.add(p); }

  const valveGeo = new THREE.SphereGeometry(0.3, 12, 10);
  const cube = new THREE.BoxGeometry(0.46, 0.46, 0.46);
  const litMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.8 });
  const expertMarks = new THREE.Group();
  root.add(expertMarks);
  const valves = new THREE.Group();
  root.add(valves);

  let t = PULSE_SECONDS;

  const clearGroup = (g: THREE.Group): void => {
    for (const c of g.children) if (c.name.startsWith('valve:')) ((c as THREE.Mesh).material as THREE.Material).dispose();
    g.clear();
  };

  const place = (target: OpTarget): void => {
    const here = tower.anchor(target.pulse);
    const lanes: Stream[] = target.stream ? [target.stream] : ['A', 'B'];
    for (const l of (['A', 'B'] as Stream[])) {
      const p = pulses[l];
      if (!lanes.includes(l)) { p.visible = false; continue; }
      // The pulse rides its lane from where it was to the new x.
      const dest = new THREE.Vector3(here.x, LANE_Y[l], LANE_Z);
      p.userData.from = (p.visible ? p.position : dest).clone();
      p.userData.to = dest;
      p.visible = true;
    }
    t = 0;
  };

  return {
    root,
    show(op) {
      clearGroup(expertMarks);
      clearGroup(valves);
      if (!op) {
        for (const p of Object.values(pulses)) p.visible = false;
        return;
      }
      const target = opTarget(op, tower);
      place(target);
      for (const l of target.lit) {
        const m = new THREE.Mesh(cube, litMat);
        m.position.copy(tower.anchor(l.id));
        m.scale.setScalar(0.8 + 0.5 * clamp01(l.weight));
        m.renderOrder = 9;
        m.name = `lit:${l.id}`;
        expertMarks.add(m);
      }
      for (const d of target.dark) {
        const m = new THREE.Mesh(cube, darkMat);
        m.position.copy(tower.anchor(d));
        m.name = `dark:${d}`;
        expertMarks.add(m);
      }
      if (target.valves) {
        const arc = gateArc(tower.slabX(op.layer ?? 0));
        for (const l of ['A', 'B'] as Stream[]) {
          const open = target.valves[l];
          const v = new THREE.Mesh(valveGeo, new THREE.MeshBasicMaterial({
            color: COLORS[l], transparent: true, opacity: 0.25 + 0.7 * open, depthTest: false,
          }));
          v.position.copy(arc.getPoint(l === 'A' ? 0.15 : 0.85));
          v.scale.setScalar(0.4 + 0.9 * open);
          v.renderOrder = 10;
          v.name = `valve:${l}`;
          valves.add(v);
        }
      }
    },
    update(dt) {
      if (t >= PULSE_SECONDS) return;
      t = Math.min(t + dt, PULSE_SECONDS);
      const k = t / PULSE_SECONDS;
      for (const p of Object.values(pulses)) {
        if (!p.visible || !p.userData.from) continue;
        p.position.lerpVectors(p.userData.from as THREE.Vector3, p.userData.to as THREE.Vector3, k);
      }
    },
    dispose() {
      clearGroup(valves);
      sphere.dispose(); valveGeo.dispose(); cube.dispose(); litMat.dispose(); darkMat.dispose();
      for (const p of Object.values(pulses)) (p.material as THREE.Material).dispose();
      root.clear();
    },
  };
}
