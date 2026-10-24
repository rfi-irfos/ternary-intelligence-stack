// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackUrl, hasWebGL2, watchContext } from '../src/ui/glSupport';
import { setLang, t } from '../src/ui/prefs';

afterEach(() => {
  document.body.innerHTML = '';
  setLang('en');
  vi.restoreAllMocks();
});

describe('hasWebGL2', () => {
  it('is false when the canvas gives no webgl2 context (jsdom has none)', () => {
    expect(hasWebGL2()).toBe(false);
  });

  it('is false when creating the context throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('blocked'); });
    expect(hasWebGL2()).toBe(false);
  });

  it('is true when a webgl2 context comes back, and releases the probe context', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext } : null) };
    const get = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) => (id === 'webgl2' ? gl : null)) as never);
    expect(hasWebGL2()).toBe(true);
    expect(get).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledOnce();
  });
});

describe('fallbackUrl', () => {
  it('joins the base and the page name with exactly one slash', () => {
    expect(fallbackUrl('/')).toBe('/fallback.html');
    expect(fallbackUrl('/albert')).toBe('/albert/fallback.html');
    expect(fallbackUrl('/albert/')).toBe('/albert/fallback.html');
  });
});

describe('watchContext', () => {
  const make = () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const reload = vi.fn();
    const w = watchContext(canvas, { onLost, onRestored, reload });
    return { canvas, w, onLost, onRestored, reload };
  };

  it('starts hidden; a loss shows the overlay with a focused reload button and stops drawing', () => {
    const { canvas, w, onLost } = make();
    expect(w.element.hidden).toBe(true);
    const ev = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // without it the browser never restores the context
    expect(w.isLost()).toBe(true);
    expect(w.element.hidden).toBe(false);
    expect(w.element.getAttribute('role')).toBe('alertdialog');
    const btn = w.element.querySelector('button')!;
    expect(btn.textContent).toBe(t('boot.reload'));
    expect(document.activeElement).toBe(btn);
    expect(w.element.textContent).toContain(t('gl.lostText'));
    expect(onLost).toHaveBeenCalledOnce();
  });

  it('the button reloads', () => {
    const { canvas, w, reload } = make();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    w.element.querySelector('button')!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('a restore hides the overlay, gives focus back and calls onRestored once', () => {
    const { canvas, w, onRestored } = make();
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(w.isLost()).toBe(false);
    expect(w.element.hidden).toBe(true);
    expect(document.activeElement).toBe(before);
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it('a restore without a loss does nothing; a second loss event does not call onLost twice', () => {
    const { canvas, onLost, onRestored } = make();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onRestored).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).toHaveBeenCalledOnce();
  });

  it('follows the language and goes away on dispose', () => {
    const { w } = make();
    setLang('de');
    expect(w.element.textContent).toContain('Die 3D-Ansicht ist stehen geblieben');
    w.dispose();
    expect(document.querySelector('.gl-lost')).toBeNull();
  });
});
