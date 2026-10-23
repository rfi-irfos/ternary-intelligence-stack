import { onPrefsChange, t } from './prefs';
import { type KeyValueStore, type Quality, QUALITIES, loadOverride, saveOverride } from '../scene/look';

export interface QualityMenu {
  element: HTMLElement;
  /** Shows the probe's pick next to "auto". */
  setAuto(q: Quality | null): void;
}

const LABEL: Record<Quality, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/**
 * Settings menu for the quality preset: "Auto" (probe decides) or a fixed preset. A fixed choice
 * is persisted and wins over the probe on the next visit; "Auto" clears it.
 * `onChange(q)` gets the explicit preset, or null for Auto.
 */
export function createQualityMenu(onChange: (q: Quality | null) => void, store?: KeyValueStore | null): QualityMenu {
  const wrap = document.createElement('label');
  wrap.className = 'hud-field quality-menu';
  const name = document.createElement('span');
  name.className = 'hud-field-label';
  wrap.append(name);
  const sel = document.createElement('select');
  sel.className = 'hud-select';
  const auto = new Option('Auto', '');
  let autoPick: Quality | null = null;
  const paint = (): void => {
    name.textContent = t('quality.label');
    sel.setAttribute('aria-label', t('quality.label'));
    auto.text = autoPick ? `${t('quality.auto')} (${LABEL[autoPick]})` : t('quality.auto');
  };
  sel.append(auto, ...QUALITIES.map((q) => new Option(LABEL[q], q)));
  sel.value = (store === undefined ? loadOverride() : loadOverride(store)) ?? '';
  sel.addEventListener('change', () => {
    const q = (sel.value || null) as Quality | null;
    if (store === undefined) saveOverride(q);
    else saveOverride(q, store);
    onChange(q);
  });
  wrap.append(sel);
  paint();
  onPrefsChange(paint);
  return {
    element: wrap,
    setAuto(q) {
      autoPick = q;
      paint();
    },
  };
}

/** The look lives in src/style/ui.css. */
export const QUALITY_MENU_CSS = '';
