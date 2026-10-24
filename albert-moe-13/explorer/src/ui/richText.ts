import { fmt, structure } from '../data/labeled';
import { t } from './prefs';
import type { StringKey } from './strings';

export const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * `t(key)` as HTML: text escaped, each number of `nums` rendered through fmt(structure(n)) (its kind
 * badge, `data-v` = the placeholder name). The counts come from architecture.json, never typed.
 */
export function richT(key: StringKey, nums: Record<string, number>, text: Record<string, string> = {}): string {
  const marks: Record<string, string> = {};
  for (const k of Object.keys(nums)) marks[k] = `\u0001${k}\u0002`;
  return escHtml(t(key, { ...text, ...marks })).replace(/\u0001(\w+)\u0002/g, (_, k: string) => {
    const el = fmt(structure(nums[k] as number));
    el.dataset.v = k;
    return el.outerHTML;
  });
}
