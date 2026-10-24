/**
 * Word helpers shared by the player bar and layer mode: how a decoded token reads as a word, and which
 * token a run follows by default. Pure functions without UI imports.
 */

/** Visible form of a decoded token for Simple mode: trimmed, a blank shows as ␣. */
export const wordOf = (decoded: string): string => decoded.trim() || '␣';

/** True for a token without letters or digits (".", ",", "␣"): its chip gets extra room so it stays visible. */
export const isPunct = (word: string): boolean => !/[\p{L}\p{N}]/u.test(word);

/** The default word to follow: the last token that is not punctuation ("earth" in "… the earth."). */
export function defaultPosition(decoded: string[]): number {
  for (let k = decoded.length - 1; k >= 0; k--) if (!isPunct(wordOf(decoded[k] ?? ''))) return k;
  return Math.max(0, decoded.length - 1);
}
