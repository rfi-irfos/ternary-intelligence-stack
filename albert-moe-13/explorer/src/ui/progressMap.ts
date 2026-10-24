import { MILESTONES, onProgressChange, progress, resetProgress } from '../mastery/progress';
import { onPrefsChange, t } from './prefs';
import type { StringKey } from './strings';

export interface ProgressMap { element: HTMLElement; dispose(): void }

const label = (m: string): string => {
  const [kind, name] = m.split(':') as [string, string];
  return kind === 'tour' ? t('progress.tour', { title: t(`tour.${name}` as StringKey) }) : t(`progress.m.${kind}` as StringKey);
};

/**
 * The quiet map in the side panel (Analysis): folded at first, one line per milestone, a plain check mark
 * when done, and a reset button. No score, no percentage, no popup.
 */
export function createProgressMap(): ProgressMap {
  const el = document.createElement('details');
  el.className = 'progress-map';
  const summary = document.createElement('summary');
  summary.className = 'progress-map-title';
  const note = document.createElement('p');
  note.className = 'progress-map-note';
  const list = document.createElement('ul');
  list.className = 'progress-map-list';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'hud-btn progress-reset';
  reset.addEventListener('click', () => resetProgress());
  el.append(summary, note, list, reset);

  const paint = (): void => {
    summary.textContent = t('progress.title');
    note.textContent = t('progress.note');
    reset.textContent = t('progress.reset');
    reset.title = t('progress.resetTip');
    const done = new Set(progress().done);
    list.replaceChildren(...MILESTONES.map((m) => {
      const li = document.createElement('li');
      li.dataset.milestone = m;
      li.dataset.done = String(done.has(m));
      const mark = document.createElement('span');
      mark.className = 'progress-mark';
      mark.textContent = done.has(m) ? '✓' : '';
      mark.setAttribute('aria-label', done.has(m) ? t('progress.done') : t('progress.open'));
      li.append(mark, ' ', label(m));
      return li;
    }));
  };
  paint();
  const offs = [onProgressChange(paint), onPrefsChange(paint)];
  return { element: el, dispose() { offs.forEach((o) => o()); el.remove(); } };
}
