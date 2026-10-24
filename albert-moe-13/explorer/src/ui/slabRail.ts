import type { CameraRig } from '../camera/controls';
import { gateId, slabId } from '../scene/ids';
import type { TowerScene } from '../scene/tower';
import { layerLabel, onPrefsChange, t } from './prefs';
import type { Selection } from './selection';

export interface SlabRail {
  element: HTMLElement;
  /** A user pick on the rail: marks the layer, flies to it and reports it. */
  select(layer: number): void;
  /** Moves the highlight only (no flight); used when the selection comes from elsewhere. */
  mark(layer: number | null): void;
  /**
   * Shows how far a run has got: `layer` gets the travelling marker (null = none, e.g. before the
   * first layer) and `fraction` (0..1) fills the progress line under the ticks.
   */
  flow(layer: number | null, fraction: number): void;
  selected(): number | null;
  dispose(): void;
}

const FOCUS_DISTANCE = 14;
/** Every MAJOR-th layer shows its number permanently; the others show it on hover and when current. */
const MAJOR = 5;

/**
 * The slab rail is a timeline, not a control: a slim full-width ruler at the bottom edge, one tick per
 * layer, labelled at its ends ("Ebene 1" … "Ebene 46" in Simple, 0-based ids in Advanced). Its key
 * ("red = exchange gate") is in its tooltip and in the legend. A tick can still be clicked to look at
 * that layer. Fusion layers (with an anastomosis gate) are red and taller, the selected
 * layer is white, and during a run a marker and a progress line show where the word is. It follows
 * `selection`, so a scene click or panel link that selects layer N moves the highlight to N.
 */
export function createSlabRail(
  tower: TowerScene,
  rig: CameraRig,
  onSelect: (layer: number) => void,
  selection?: Selection,
): SlabRail {
  const layers = tower.layerCount;
  const wrap = document.createElement('div');
  wrap.className = 'rail-block';
  const row = document.createElement('div');
  row.className = 'rail-row';
  const first = document.createElement('span');
  first.className = 'rail-end rail-end--first';
  const last = document.createElement('span');
  last.className = 'rail-end rail-end--last';
  const track = document.createElement('div');
  track.className = 'rail-track';
  const el = document.createElement('div');
  el.className = 'slab-rail';
  el.setAttribute('role', 'toolbar');
  const progress = document.createElement('div');
  progress.className = 'rail-progress';
  const fill = document.createElement('span');
  progress.append(fill);
  track.append(el, progress);
  row.append(first, track, last);
  wrap.className = 'rail-block timeline';
  wrap.append(row);
  const buttons: HTMLButtonElement[] = [];
  let current: number | null = null;

  const mark = (layer: number | null): void => {
    current = layer === null ? null : Math.max(0, Math.min(layers - 1, layer));
    buttons.forEach((b, i) => {
      const on = i === current;
      b.classList.toggle('current', on);
      b.tabIndex = on || (current === null && i === 0) ? 0 : -1;
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  };

  const flow = (layer: number | null, fraction: number): void => {
    buttons.forEach((b, i) => b.classList.toggle('flow', i === layer));
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  };

  const select = (layer: number): void => {
    mark(layer);
    const l = current as number;
    // The anchor is where the slab is drawn now (an exploded neighbour may have nudged it aside).
    void rig.flyTo(tower.anchor(slabId(l)), FOCUS_DISTANCE);
    onSelect(l);
  };

  for (let l = 0; l < layers; l++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slab-rail-item';
    if (l % MAJOR === 0 || l === layers - 1) b.classList.add('major');
    b.dataset.layer = String(l);
    const tick = document.createElement('span');
    tick.className = 'rail-tick';
    tick.setAttribute('aria-hidden', 'true');
    const num = document.createElement('span');
    num.className = 'rail-num';
    num.dataset.layer = String(l);
    b.append(tick, num);
    if (tower.has(gateId(l))) {
      b.classList.add('fusion');
      b.dataset.fusion = 'true';
    }
    b.tabIndex = l === 0 ? 0 : -1;
    b.addEventListener('click', () => select(l));
    buttons.push(b);
    el.appendChild(b);
  }

  const paint = (): void => {
    el.setAttribute('aria-label', t('rail.label'));
    first.textContent = t('rail.layer', { n: layerLabel(0) });
    first.title = t('rail.firstTip');
    last.textContent = t('rail.layer', { n: layerLabel(layers - 1) });
    last.title = t('rail.lastTip');
    progress.title = t('rail.progressTip');
    wrap.title = t('timeline.tip', { key: t('rail.legend') });
    buttons.forEach((b, l) => {
      (b.querySelector('.rail-num') as HTMLElement).textContent = String(layerLabel(l));
      const name = t('rail.layer', { n: layerLabel(l) });
      b.title = b.dataset.fusion ? `${name}: ${t('rail.fusion')}` : name;
      b.setAttribute('aria-label', b.title);
    });
  };
  paint();
  const offPrefs = onPrefsChange(paint);
  const offSel = selection?.onChange((layer) => mark(layer)) ?? ((): void => {});

  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    // The rail owns its arrows; the player's arrow shortcuts never see them.
    e.stopPropagation();
    const next = (current ?? (e.key === 'ArrowRight' ? -1 : layers)) + (e.key === 'ArrowRight' ? 1 : -1);
    select(next);
    buttons[current ?? 0]?.focus();
  });

  return {
    element: wrap, select, mark, flow, selected: () => current,
    dispose() { offPrefs(); offSel(); wrap.remove(); },
  };
}
