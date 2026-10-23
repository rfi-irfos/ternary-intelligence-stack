export type Depth = 'intuition' | 'technical' | 'researcher';
export const DEPTHS: Depth[] = ['intuition', 'technical', 'researcher'];
export const DEPTH_LABEL: Record<Depth, string> = {
  intuition: 'Intuition',
  technical: 'Technical',
  researcher: 'Researcher',
};

const KEY = 'albert.depth';
let current: Depth = 'intuition';
const listeners = new Set<(d: Depth) => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const saved = storage()?.getItem(KEY);
if (saved && (DEPTHS as string[]).includes(saved)) current = saved as Depth;

export const getDepth = (): Depth => current;

export function setDepth(d: Depth): void {
  if (d === current) return;
  current = d;
  try {
    storage()?.setItem(KEY, d);
  } catch {
    /* storage unavailable: depth stays in memory */
  }
  listeners.forEach((l) => l(d));
}

export function onDepthChange(cb: (d: Depth) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Keys 1-3 switch depth (not while typing in a field). Returns a detach function. */
export function attachDepthKeys(doc: Document = document): () => void {
  const on = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = DEPTHS[Number(e.key) - 1];
    if (d) setDepth(d);
  };
  doc.addEventListener('keydown', on);
  return () => doc.removeEventListener('keydown', on);
}
