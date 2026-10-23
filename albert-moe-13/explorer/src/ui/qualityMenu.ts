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
  wrap.className = 'quality-menu';
  wrap.append('Quality ');
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Rendering quality');
  const auto = new Option('Auto', '');
  sel.append(auto, ...QUALITIES.map((q) => new Option(LABEL[q], q)));
  sel.value = (store === undefined ? loadOverride() : loadOverride(store)) ?? '';
  sel.addEventListener('change', () => {
    const q = (sel.value || null) as Quality | null;
    if (store === undefined) saveOverride(q);
    else saveOverride(q, store);
    onChange(q);
  });
  wrap.append(sel);
  return {
    element: wrap,
    setAuto(q) {
      auto.text = q ? `Auto (${LABEL[q]})` : 'Auto';
    },
  };
}

export const QUALITY_MENU_CSS = `
.quality-menu { position: fixed; top: 136px; left: 14px; font: 12px monospace; color: #cfd8e8; }
.quality-menu select { font: 12px monospace; color: #fff; background: #14161b; border: 1px solid #333a46;
  border-radius: 3px; padding: 3px 6px; margin-left: 4px; }`;
