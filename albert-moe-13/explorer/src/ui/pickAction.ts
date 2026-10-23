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
