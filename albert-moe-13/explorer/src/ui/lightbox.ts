import { ICONS } from './icons';
import { onPrefsChange, t } from './prefs';

export interface LightboxOptions {
  src: string;
  /** Element focus returns to on close. */
  returnFocus?: HTMLElement | null;
  doc?: Document;
}

let current: { el: HTMLElement; close(): void } | null = null;

export const isLightboxOpen = (): boolean => current !== null;
/** Closes the large view if it is open (focus goes back to the trigger). */
export function closeLightbox(): void {
  current?.close();
}

/**
 * Large view of the exhibit: a modal dialog above everything. Esc, a click on the backdrop and the close
 * button close it; focus returns to the trigger. Esc is caught in the capture phase of the window, so one
 * press closes only the lightbox (the side panel and the camera rig never see it). On a phone the picture
 * fits the width and the figure scrolls and pinch-zooms natively. Text and alt text come from strings.ts.
 */
export function openLightbox(opts: LightboxOptions): HTMLElement {
  const doc = opts.doc ?? document;
  if (current) return current.el;
  const el = doc.createElement('div');
  el.className = 'lightbox';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lightbox-title');
  el.setAttribute('aria-describedby', 'lightbox-caption');
  const figure = doc.createElement('figure');
  figure.className = 'lightbox-figure';
  const head = doc.createElement('div');
  head.className = 'lightbox-head';
  const title = doc.createElement('h2');
  title.id = 'lightbox-title';
  title.className = 'lightbox-title';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'hud-icon lightbox-close';
  close.innerHTML = ICONS.close;
  head.append(title, close);
  const scroller = doc.createElement('div');
  scroller.className = 'lightbox-scroll';
  const img = doc.createElement('img');
  img.className = 'lightbox-img';
  img.src = opts.src;
  img.decoding = 'async';
  scroller.append(img);
  const cap = doc.createElement('figcaption');
  cap.id = 'lightbox-caption';
  cap.className = 'lightbox-caption';
  figure.append(head, scroller, cap);
  el.append(figure);
  const paint = (): void => {
    title.textContent = t('exhibit.title');
    cap.textContent = t('exhibit.caption');
    img.alt = t('exhibit.alt');
    close.setAttribute('aria-label', t('exhibit.close'));
    close.title = t('exhibit.close');
  };
  paint();
  const off = onPrefsChange(paint);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      api.close();
    } else if (e.key === 'Tab') {
      // The close button is the only control: keep focus inside the dialog.
      e.preventDefault();
      close.focus();
    }
  };
  const api = {
    el,
    close(): void {
      if (current !== api) return;
      current = null;
      off();
      doc.defaultView?.removeEventListener('keydown', onKey, true);
      el.remove();
      const back = opts.returnFocus;
      if (back && back.isConnected) back.focus();
    },
  };
  // A press on the dark backdrop (not on the figure) closes.
  el.addEventListener('click', (e) => { if (e.target === el) api.close(); });
  close.addEventListener('click', () => api.close());
  doc.defaultView?.addEventListener('keydown', onKey, true);
  doc.body.append(el);
  current = api;
  close.focus();
  return el;
}
