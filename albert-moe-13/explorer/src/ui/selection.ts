import { type ComponentId, parseId } from '../scene/ids';

/**
 * The component the user selected last (rail, scene click, panel link, layer mode). One store, so the
 * rail, Enter layer and the panel agree on the current layer. Selecting never moves the camera.
 */
export interface Selection {
  set(id: ComponentId | null): void;
  id(): ComponentId | null;
  /** Layer of the last selection that had one (kept when a selection without a layer follows). */
  layer(): number | null;
  onChange(cb: (layer: number | null, id: ComponentId | null) => void): () => void;
}

export function createSelection(): Selection {
  let cur: ComponentId | null = null;
  let layer: number | null = null;
  const listeners = new Set<(layer: number | null, id: ComponentId | null) => void>();
  return {
    set(id) {
      cur = id;
      const p = id ? parseId(id) : null;
      if (p && 'layer' in p) layer = p.layer;
      listeners.forEach((l) => l(layer, cur));
    },
    id: () => cur,
    layer: () => layer,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
