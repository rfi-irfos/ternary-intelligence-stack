import { type Lang, LANGS, type Mode, MODES, type StringKey, tr } from './strings';
import { getDepth, onDepthChange, setDepth } from './depth';

/**
 * UI language (DE | EN) and view mode (Simple | Advanced), both persisted in localStorage.
 *
 * Mode and depth are one concept: Simple shows the Intuition depth only; Advanced allows all three
 * depths and starts at Technical. Switching to Simple sets the depth to Intuition; choosing Technical
 * or Researcher (panel buttons or keys 2 and 3) switches to Advanced. Choosing Intuition inside
 * Advanced keeps Advanced. Neither switch reloads the page or moves the camera.
 */

export const LANG_KEY = 'albert.lang';
export const MODE_KEY = 'albert.mode';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const save = (k: string, v: string): void => {
  try {
    storage()?.setItem(k, v);
  } catch {
    /* storage unavailable: the choice stays in memory */
  }
};

/** Language from the browser: "de…" gives DE, everything else EN. */
export function langFromNavigator(nav: { language?: string } | undefined = typeof navigator === 'undefined' ? undefined : navigator): Lang {
  return (nav?.language ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** A persisted choice wins over the browser language. */
export function initialLang(store: Pick<Storage, 'getItem'> | null = storage(), nav?: { language?: string }): Lang {
  const v = store?.getItem(LANG_KEY);
  return v && (LANGS as string[]).includes(v) ? (v as Lang) : langFromNavigator(nav);
}

export function initialMode(store: Pick<Storage, 'getItem'> | null = storage()): Mode {
  const v = store?.getItem(MODE_KEY);
  return v && (MODES as string[]).includes(v) ? (v as Mode) : 'simple';
}

let lang: Lang = initialLang();
let mode: Mode = initialMode();
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = (): void => listeners.forEach((l) => l());

const setHtmlLang = (): void => {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
};
setHtmlLang();
// Simple always reads at the Intuition depth.
if (mode === 'simple' && getDepth() !== 'intuition') setDepth('intuition');

export const getLang = (): Lang => lang;
export const getMode = (): Mode => mode;

export function setLang(l: Lang): void {
  if (l === lang || !(LANGS as string[]).includes(l)) return;
  lang = l;
  save(LANG_KEY, l);
  setHtmlLang();
  notify();
}

export function setMode(m: Mode): void {
  if (m === mode || !(MODES as string[]).includes(m)) return;
  mode = m;
  save(MODE_KEY, m);
  if (m === 'simple') setDepth('intuition');
  else if (getDepth() === 'intuition') setDepth('technical');
  notify();
}

onDepthChange((d) => {
  if (d !== 'intuition' && mode === 'simple') setMode('advanced');
});

/** Fires after a language or mode change. Returns the unsubscribe function. */
export function onPrefsChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The string `key` in the current language and mode. */
export const t = (key: StringKey, vars?: Record<string, string | number>): string => tr(key, lang, mode, vars);

/** Test helper: re-reads storage and the browser language as on a fresh page load. */
export function reloadPrefsForTest(nav?: { language?: string }): void {
  lang = initialLang(storage(), nav);
  mode = initialMode();
  setHtmlLang();
}
