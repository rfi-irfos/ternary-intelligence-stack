import type { ComponentId } from '../scene/ids';

export interface PickDeps {
  explodable(id: ComponentId): boolean;
  /** Opens the exploded view; the app's onChange hook opens the panel when a level opens. */
  explode(id: ComponentId): Promise<void>;
  openPanel(id: ComponentId): Promise<void> | void;
}

/**
 * Click on a component. An explodable component opens its panel through explode's onChange, so the
 * panel is opened here only for leaves, or when exploding failed; never twice.
 */
export function pickAction(id: ComponentId, d: PickDeps): void {
  if (!d.explodable(id)) {
    void d.openPanel(id);
    return;
  }
  d.explode(id).catch((err: unknown) => {
    console.error(err);
    void d.openPanel(id);
  });
}

export interface EmptyClickDeps {
  /** True while layer mode is open: it owns its levels, so an empty click leaves them and the camera alone. */
  layerActive?(): boolean;
  depth(): number;
  /** Closes every open level in one tween; the camera returns to the pose from before the first level. */
  reassembleAll(): Promise<void>;
  closePanel(): void;
}

/**
 * Click into empty space. While a level is open, everything outside the open group counts as empty
 * (the picker raycasts only the open level, so dimmed row slabs, faded neighbour glass and the
 * background all land here): one click folds every level back together and the camera returns. With
 * nothing open it closes the panel. Esc stays one level back (scene/explode.ts).
 */
export function emptyClick(d: EmptyClickDeps): Promise<void> {
  if (d.layerActive?.()) return Promise.resolve();
  if (d.depth() > 0) return d.reassembleAll();
  d.closePanel();
  return Promise.resolve();
}
