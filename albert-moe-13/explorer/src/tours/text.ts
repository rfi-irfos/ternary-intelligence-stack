import type { L10n, TourText } from './engine';

/** A bilingual text. */
export const L = (en: string, de: string): L10n => ({ en, de });

/**
 * Step text: `simple` is read in Simple mode (Intuition), `adv` in Advanced at Technical depth. `res` is the optional
 * extra for Researcher depth (formula, tensor names, raw shapes); a step without `res` repeats `adv` there.
 * Placeholders ({layers}, {experts}, {layer} ...) come from architecture.json at render time.
 */
export const tx = (simple: [string, string], adv: [string, string], res?: [string, string]): TourText => ({
  intuition: L(...simple),
  technical: L(...adv),
  researcher: L(...(res ?? adv)),
});

/** The twelve experts of layer 12 (0-based; "Ebene 13" on screen): the cabinets of its pool. */
export const BANK: string[] = Array.from({ length: 12 }, (_, e) => `L12.expert.${e}`);
