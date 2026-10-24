import { onPrefsChange, t } from './prefs';
import { openLightbox } from './lightbox';
import { EXHIBIT_URL } from '../scene/exhibit';

export interface ExhibitEntryDeps {
  /** Flies the camera to the exhibit (the user's click on the first button). */
  show(): void;
}

export interface ExhibitEntry {
  element: HTMLElement;
  showButton: HTMLButtonElement;
  openButton: HTMLButtonElement;
  dispose(): void;
}

/**
 * The exhibit's entry in the side panel (Analyse): the honest caption and two buttons. "Show in the scene"
 * flies to the frame; "Large view" opens the lightbox and focus returns to that button on close. Nothing
 * here runs by itself.
 */
export function createExhibitEntry(deps: ExhibitEntryDeps): ExhibitEntry {
  const el = document.createElement('section');
  el.className = 'exhibit-entry';
  const h = document.createElement('h4');
  h.className = 'exhibit-entry-title';
  const cap = document.createElement('p');
  cap.className = 'exhibit-entry-caption';
  const row = document.createElement('div');
  row.className = 'exhibit-entry-actions';
  const showButton = document.createElement('button');
  showButton.type = 'button';
  showButton.className = 'hud-btn exhibit-show';
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'hud-btn exhibit-open';
  row.append(showButton, openButton);
  el.append(h, cap, row);
  const paint = (): void => {
    h.textContent = t('exhibit.title');
    cap.textContent = t('exhibit.caption');
    showButton.textContent = t('exhibit.show');
    showButton.setAttribute('aria-label', t('exhibit.showTip'));
    openButton.textContent = t('exhibit.open');
    openButton.setAttribute('aria-label', t('exhibit.openTip'));
  };
  paint();
  const off = onPrefsChange(paint);
  showButton.addEventListener('click', () => deps.show());
  openButton.addEventListener('click', () => { openLightbox({ src: EXHIBIT_URL, returnFocus: openButton }); });
  return { element: el, showButton, openButton, dispose() { off(); el.remove(); } };
}
