import { onPrefsChange, t } from './prefs';

/**
 * True when the browser can create a WebGL 2 context. The probe context is released at once, so it does
 * not count against the browser's limit of live contexts.
 */
export function hasWebGL2(doc: Document = document): boolean {
  try {
    const probe = doc.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    (gl as WebGL2RenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Address of the static page that replaces the 3D view (built from architecture.json and the caveats). */
export const fallbackUrl = (base: string): string => `${base.endsWith('/') ? base : `${base}/`}fallback.html`;

export interface ContextWatch {
  /** The overlay element (hidden until the context is lost). */
  element: HTMLElement;
  isLost(): boolean;
  dispose(): void;
}

export interface ContextWatchOptions {
  /** The context is gone: stop drawing. */
  onLost?: () => void;
  /** The context is back: rebuild what the view needs and draw again. */
  onRestored?: () => void;
  doc?: Document;
  reload?: () => void;
}

/**
 * Watches a canvas for a lost WebGL context. A loss shows an overlay that says what happened, with a
 * Reload button; the page then waits for the browser to give the context back. `webglcontextrestored`
 * hides the overlay and calls `onRestored` (the app re-creates its render targets and starts drawing
 * again). preventDefault on the loss event is what allows a restore at all.
 */
export function watchContext(canvas: HTMLCanvasElement, opts: ContextWatchOptions = {}): ContextWatch {
  const doc = opts.doc ?? canvas.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'gl-lost';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', 'gl-lost-title');
  el.setAttribute('aria-describedby', 'gl-lost-text');
  el.hidden = true;
  const card = doc.createElement('div');
  card.className = 'gl-lost-card';
  const title = doc.createElement('h2');
  title.id = 'gl-lost-title';
  const text = doc.createElement('p');
  text.id = 'gl-lost-text';
  const reload = doc.createElement('button');
  reload.type = 'button';
  reload.className = 'hud-btn gl-lost-reload';
  reload.addEventListener('click', () => (opts.reload ?? (() => doc.defaultView?.location.reload()))());
  card.append(title, text, reload);
  el.append(card);
  doc.body.append(el);
  const paint = (): void => {
    title.textContent = t('gl.lostTitle');
    text.textContent = t('gl.lostText');
    reload.textContent = t('boot.reload');
  };
  paint();
  const offPrefs = onPrefsChange(paint);

  let lost = false;
  let back: HTMLElement | null = null;
  const onLost = (e: Event): void => {
    e.preventDefault();
    if (lost) return;
    lost = true;
    back = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    el.hidden = false;
    reload.focus();
    opts.onLost?.();
  };
  const onRestored = (): void => {
    if (!lost) return;
    lost = false;
    el.hidden = true;
    if (back && back.isConnected) back.focus();
    back = null;
    opts.onRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return {
    element: el,
    isLost: () => lost,
    dispose() {
      offPrefs();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      el.remove();
    },
  };
}
