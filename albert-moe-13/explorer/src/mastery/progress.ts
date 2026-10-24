import { TOUR_IDS } from '../ui/strings';

/**
 * The optional mastery map: which things the visitor has done. It is a plain list of milestones, never a
 * score: no points, no percentage, no streak. Stored in this browser only, under `albert.progress.v1`.
 * Corrupt JSON resets silently; a storage that throws (private mode) leaves the list in memory.
 */
export const PROGRESS_KEY = 'albert.progress.v1';

/** Every milestone the code knows. Anything else found in storage is dropped. */
export const MILESTONES: readonly string[] = [
  ...TOUR_IDS.map((id) => `tour:${id}`),
  'predicted:experts',
  'traced:attention',
  'explained:residual',
];

export interface Progress { done: string[]; remaining: string[] }

let memory: string[] = [];
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = (): void => listeners.forEach((l) => l());

const clean = (v: unknown): string[] => {
  const raw = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as { done?: unknown }).done : undefined;
  const set = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  return MILESTONES.filter((m) => set.has(m));
};

function read(): string[] {
  let raw: string | null;
  try {
    if (typeof localStorage === 'undefined') return memory;
    raw = localStorage.getItem(PROGRESS_KEY);
  } catch {
    return memory;
  }
  if (raw === null) return [];
  try {
    return clean(JSON.parse(raw));
  } catch {
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* storage unavailable */ }
    return [];
  }
}

function write(done: string[]): void {
  memory = done;
  try {
    if (typeof localStorage === 'undefined') return;
    if (done.length === 0) localStorage.removeItem(PROGRESS_KEY);
    else localStorage.setItem(PROGRESS_KEY, JSON.stringify({ done }));
  } catch {
    /* storage unavailable: the list stays in memory */
  }
}

export function progress(): Progress {
  const done = read();
  return { done, remaining: MILESTONES.filter((m) => !done.includes(m)) };
}

/** Marks a milestone done. Silent: nothing on screen changes except the map. Unknown names are ignored. */
export function markDone(m: string): void {
  if (!MILESTONES.includes(m)) return;
  const done = read();
  if (done.includes(m)) return;
  write(MILESTONES.filter((x) => x === m || done.includes(x)));
  notify();
}

export function resetProgress(): void {
  write([]);
  notify();
}

/** Fires after markDone changed the list or after a reset. Returns the unsubscribe function. */
export function onProgressChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
