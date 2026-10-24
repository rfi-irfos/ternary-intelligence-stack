import type { Insets } from '../camera/controls';

export interface HudElements {
  top: HTMLElement;
  /** The mini dock. */
  dock: HTMLElement;
  /** The run timeline at the very bottom (below the dock), when it is not part of the dock's box. */
  timeline?: HTMLElement;
  /** The side column that takes width from the scene (open side panel or layer steps), or null. */
  side(): HTMLElement | null;
  /** The open legend card under the bar (top left), or null. */
  legendCard(): HTMLElement | null;
  win: { innerWidth: number; innerHeight: number };
  /** Air between the HUD and the framed content (px). */
  gap: number;
}

/**
 * Screen pixels the HUD covers on each side, read from the layout as it is right now: the camera rig
 * calls this at fly time (CameraRig.setInsetsProvider). Layout boxes (offsetTop/offsetLeft), so an open
 * animation that scales a panel does not shift the insets. The bottom is the higher of the dock and the
 * timeline, the right is the open side panel (it floats over the scene), the left is the open legend card.
 */
export function measureHud(e: HudElements): Insets {
  const side = e.side();
  const card = e.legendCard();
  const legendRight = card && !card.hidden ? card.getBoundingClientRect().right : 0;
  const reach = (x: HTMLElement | undefined): number => (x && x.offsetHeight ? e.win.innerHeight - x.offsetTop + e.gap : 0);
  const left = legendRight > 0 ? legendRight + e.gap : 0;
  let right = side && side.offsetWidth ? e.win.innerWidth - side.offsetLeft + e.gap : 0;
  // On a phone the side panel is a full-width sheet. The camera must never frame the model into less than a
  // quarter of the viewport width: the right inset gives way (the sheet then simply covers the model's edge).
  right = Math.min(right, Math.max(0, e.win.innerWidth * (1 - MIN_FREE_FRACTION) - left));
  return {
    top: e.top.offsetHeight,
    bottom: Math.max(reach(e.dock), reach(e.timeline)),
    right,
    left,
  };
}

/** The framing area keeps at least this share of the viewport width. */
export const MIN_FREE_FRACTION = 0.25;
