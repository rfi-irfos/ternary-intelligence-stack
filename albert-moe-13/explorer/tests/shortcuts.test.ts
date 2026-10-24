// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_ROWS, MOUSE_ROWS, attachShortcutsKey, closeShortcuts, createShortcutsEntry, isShortcutsOpen, openShortcuts } from '../src/ui/shortcuts';
import { setLang, t } from '../src/ui/prefs';

afterEach(() => {
  closeShortcuts();
  document.body.innerHTML = '';
  setLang('en');
});

const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('shortcut list', () => {
  it('is a modal dialog with a title and a close button that takes focus', () => {
    const el = openShortcuts();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(el.getAttribute('aria-labelledby')!)!.textContent).toBe(t('shortcuts.title'));
    expect(document.activeElement).toBe(el.querySelector('.shortcuts-close'));
  });

  it('lists Space, the arrows, Esc and Tab, plus the mouse actions', () => {
    const el = openShortcuts();
    const keys = [...el.querySelectorAll('dt')].map((d) => d.textContent);
    expect(keys.length).toBe(KEY_ROWS.length + MOUSE_ROWS.length);
    const text = el.textContent!;
    for (const k of ['Space', '←→', 'Esc', 'Tab', '?']) expect(keys.join('|')).toContain(k);
    expect(text).toContain(t('shortcuts.d.esc'));
    expect(el.querySelectorAll('dd').length).toBe(keys.length);
  });

  it('shows the key names in German too', () => {
    setLang('de');
    const el = openShortcuts();
    expect(el.querySelector('.shortcuts-title')!.textContent).toBe('Tastenkürzel');
    expect([...el.querySelectorAll('dt')][0]!.textContent).toBe('Leertaste');
    setLang('en');
    expect([...el.querySelectorAll('dt')][0]!.textContent).toBe('Space');
  });

  it('keeps focus inside: Tab goes back to the close button', () => {
    const el = openShortcuts();
    const e = press('Tab', el.querySelector('.shortcuts-close')!);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('.shortcuts-close'));
  });

  it('Esc closes it, stops the key for everything else, and focus returns to the trigger', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    openShortcuts();
    let seen = false;
    document.addEventListener('keydown', () => { seen = true; }, { once: true });
    press('Escape', document.activeElement!);
    expect(isShortcutsOpen()).toBe(false);
    expect(document.querySelector('.shortcuts')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(seen).toBe(false);
  });

  it('the close button and a click on the backdrop close it', () => {
    openShortcuts();
    document.querySelector<HTMLElement>('.shortcuts-close')!.click();
    expect(isShortcutsOpen()).toBe(false);
    const el = openShortcuts();
    el.click();
    expect(isShortcutsOpen()).toBe(false);
  });

  it('opens once', () => {
    expect(openShortcuts()).toBe(openShortcuts());
    expect(document.querySelectorAll('.shortcuts').length).toBe(1);
  });
});

describe('the ? key and the Workbench entry', () => {
  it('? toggles the list; typing in a field does not', () => {
    const off = attachShortcutsKey();
    press('?');
    expect(isShortcutsOpen()).toBe(true);
    press('?');
    expect(isShortcutsOpen()).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    press('?', input);
    expect(isShortcutsOpen()).toBe(false);
    press('?', document.body, { ctrlKey: true });
    expect(isShortcutsOpen()).toBe(false);
    off();
    press('?');
    expect(isShortcutsOpen()).toBe(false);
  });

  it('the entry button opens the list and focus returns to it', () => {
    const { element, button } = createShortcutsEntry();
    document.body.append(element);
    expect(button.textContent).toContain(t('shortcuts.entry'));
    button.focus();
    button.click();
    expect(isShortcutsOpen()).toBe(true);
    press('Escape', document.activeElement!);
    expect(document.activeElement).toBe(button);
  });
});
