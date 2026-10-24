import type { Insets } from '../camera/controls';

export interface HudElements {
  top: HTMLElement;
  dock: HTMLElement;
  /** The side column that takes width from the scene (open inspection panel or layer steps), or null. */
  side(): HTMLElement | null;
  /** The open legend key under its chip in the bar, or null. */
  legendList(): HTMLElement | null;
  win: { innerWidth: number; innerHeight: number };
  /** Air between the HUD and the framed content (px). */
  gap: number;
}

/**
 * Screen pixels the HUD covers on each side, read from the layout as it is right now: the camera rig
 * calls this at fly time (CameraRig.setInsetsProvider). Layout boxes (offsetTop/offsetLeft), so an open
 * animation that scales a panel does not shift the insets.
 */
export function measureHud(e: HudElements): Insets {
  const side = e.side();
  const list = e.legendList();
  const legendRight = list && !list.hidden ? list.getBoundingClientRect().right : 0;
  return {
    top: e.top.offsetHeight,
    bottom: e.dock.offsetHeight ? e.win.innerHeight - e.dock.offsetTop + e.gap : 0,
    right: side && side.offsetWidth ? e.win.innerWidth - side.offsetLeft + e.gap : 0,
    left: legendRight > 0 ? legendRight + e.gap : 0,
  };
}
