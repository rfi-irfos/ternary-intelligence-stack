import * as THREE from 'three';
import type { MatrixData } from '../data/weights';
import { fmtText, structure } from '../data/labeled';
import { PALETTE } from './palette';

/** Spec §5 value colours (palette.ts): +1 warm, -1 cold, 0 dark. */
export const TILE_COLORS = { plus: PALETTE.ternaryPlus, minus: PALETTE.ternaryMinus, zero: PALETTE.ternaryZero } as const;
export const CELL = 0.12;

const cPlus = new THREE.Color(TILE_COLORS.plus);
const cMinus = new THREE.Color(TILE_COLORS.minus);
const cZero = new THREE.Color(TILE_COLORS.zero);

export function ternaryColor(ch: string): number {
  return ch === '+' ? TILE_COLORS.plus : ch === '-' ? TILE_COLORS.minus : TILE_COLORS.zero;
}

/** Diverging scale: -max -> cold, 0 -> dark, +max -> warm. */
export function divergingColor(v: number, maxAbs: number): number {
  const t = maxAbs > 0 ? Math.min(Math.abs(v) / maxAbs, 1) : 0;
  return new THREE.Color().copy(cZero).lerp(v >= 0 ? cPlus : cMinus, t).getHex();
}

export interface TileGrid {
  rows: number;
  cols: number;
  /** Row-major cell colours. */
  colors: number[];
}

export function tileGrid(m: MatrixData): TileGrid {
  const rows = m.tile.length;
  if (m.ternary) {
    const lines = m.tile as string[];
    const cols = lines[0]?.length ?? 0;
    return { rows, cols, colors: lines.flatMap((r) => [...r].map(ternaryColor)) };
  }
  const data = m.tile as number[][];
  const cols = data[0]?.length ?? 0;
  const maxAbs = Math.max(0, ...data.flat().map(Math.abs));
  return { rows, cols, colors: data.flatMap((r) => r.map((v) => divergingColor(v, maxAbs))) };
}

/** Caption lines under a tile (structure values from the weights file); short enough for the label width. */
export function tileCaption(m: MatrixData): string[] {
  const num = (v: number | null): string => (v === null ? '—' : fmtText(structure(v)));
  const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)} %`);
  if (!m.ternary) return [m.name, `F32 · ${fmtText(structure(m.shape))}`];
  return [
    m.name,
    `γ ${num(m.gamma)} · τ ${num(m.tau)}`,
    `−1 ${pct(m.frac_neg)} · 0 ${pct(m.frac_zero)} · +1 ${pct(m.frac_pos)}`,
  ];
}

/** Glass plane facing -Y (towards the default camera) with one quad per tile cell. */
export function buildTile(m: MatrixData, id: string): THREE.Group {
  const g = tileGrid(m);
  const group = new THREE.Group();
  group.name = `tile:${id}`;
  const w = g.cols * CELL;
  const h = g.rows * CELL;
  const glassGeo = new THREE.PlaneGeometry(w + 0.2, h + 0.2);
  glassGeo.rotateX(Math.PI / 2);
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.MeshStandardMaterial({
      color: PALETTE.glass, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  glass.position.y = 0.01;
  glass.userData.ids = [id];
  const quadGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9);
  quadGeo.rotateX(Math.PI / 2);
  const cells = new THREE.InstancedMesh(quadGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), g.rows * g.cols);
  cells.name = 'tile-cells';
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  for (let r = 0; r < g.rows; r++) {
    for (let k = 0; k < g.cols; k++) {
      const i = r * g.cols + k;
      o.position.set((k + 0.5) * CELL - w / 2, 0, h / 2 - (r + 0.5) * CELL);
      o.updateMatrix();
      cells.setMatrixAt(i, o.matrix);
      cells.setColorAt(i, c.setHex(g.colors[i] ?? TILE_COLORS.zero));
    }
  }
  cells.userData.ids = Array.from({ length: g.rows * g.cols }, () => id);
  group.add(glass, cells);
  group.userData.grid = g;
  return group;
}
