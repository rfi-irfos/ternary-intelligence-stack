import type { CameraRig } from '../camera/controls';
import { gateId, slabId } from '../scene/ids';
import type { TowerScene } from '../scene/tower';

export interface SlabRail {
  element: HTMLElement;
  select(layer: number): void;
  selected(): number | null;
}

const FOCUS_DISTANCE = 14;

/** Slim horizontal rail of one button per slab; fusion slabs (those with a gate) are marked. */
export function createSlabRail(
  tower: TowerScene,
  rig: CameraRig,
  onSelect: (layer: number) => void,
): SlabRail {
  const layers = tower.layerCount;
  const el = document.createElement('div');
  el.className = 'slab-rail';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Layer slabs');
  const buttons: HTMLButtonElement[] = [];
  let current: number | null = null;

  const select = (layer: number): void => {
    const l = Math.max(0, Math.min(layers - 1, layer));
    current = l;
    buttons.forEach((b, i) => {
      b.classList.toggle('active', i === l);
      b.tabIndex = i === l ? 0 : -1;
      b.setAttribute('aria-pressed', String(i === l));
    });
    // The anchor is where the slab is drawn now (an exploded neighbour may have nudged it aside).
    void rig.flyTo(tower.anchor(slabId(l)), FOCUS_DISTANCE);
    onSelect(l);
  };

  for (let l = 0; l < layers; l++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slab-rail-item';
    b.dataset.layer = String(l);
    b.title = `Layer ${l}`;
    b.textContent = String(l);
    if (tower.has(gateId(l))) {
      b.classList.add('fusion');
      b.dataset.fusion = 'true';
      b.title += ' (fusion)';
    }
    b.tabIndex = l === 0 ? 0 : -1;
    b.addEventListener('click', () => select(l));
    buttons.push(b);
    el.appendChild(b);
  }

  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (current ?? (e.key === 'ArrowRight' ? -1 : layers)) + (e.key === 'ArrowRight' ? 1 : -1);
    select(next);
    buttons[current ?? 0]?.focus();
  });

  return { element: el, select, selected: () => current };
}
