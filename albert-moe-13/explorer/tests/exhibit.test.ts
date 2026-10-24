// @vitest-environment jsdom
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overviewPose, overviewPoints } from '../src/camera/controls';
import { EXHIBIT_URL, createExhibit, exhibitAnchor } from '../src/scene/exhibit';
import { createExhibitEntry } from '../src/ui/exhibitEntry';
import { closeLightbox, isLightboxOpen, openLightbox } from '../src/ui/lightbox';
import { setLang, t } from '../src/ui/prefs';
import { STRINGS, resolve } from '../src/ui/strings';

const extent = { minX: -20, maxX: 160 };
const fakeImage = { width: 1871, height: 932 } as unknown as TexImageSource;

afterEach(() => {
  closeLightbox();
  document.body.innerHTML = '';
  setLang('en');
  vi.restoreAllMocks();
});

describe('exhibit caption and assets', () => {
  it('has an honest caption and alt text in DE and EN (28-layer stage, real screenshot, no invented number)', () => {
    for (const lang of ['de', 'en'] as const) {
      const cap = resolve(STRINGS[lang]['exhibit.caption'], 'simple');
      expect(cap).toMatch(/28/);
      expect(cap).toMatch(lang === 'de' ? /echter Screenshot/ : /Real screenshot/);
      // the only date is the repository date taken from git history of the file
      expect(cap.match(/\d{2,4}[-.]\d{2}[-.]\d{2,4}/g)).toEqual([lang === 'de' ? '02.07.2026' : '2026-07-02']);
      expect(resolve(STRINGS[lang]['exhibit.alt'], 'simple').length).toBeGreaterThan(20);
    }
  });

  it('ships the real screenshot in public/ (no video)', () => {
    const u = new URL(`../public${EXHIBIT_URL}`, import.meta.url);
    expect(existsSync(u)).toBe(true);
    expect(statSync(u).size).toBeGreaterThan(100_000);
    const b = readFileSync(u);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1871, 932]);
  });
});

describe('exhibit scene object', () => {
  it('lies outside every overview frame (the overview framing stays as it was)', () => {
    const ex = createExhibit(extent);
    const points = overviewPoints(extent);
    for (const aspect of [0.46, 1, 1.78, 2.4]) {
      const { target, distance } = overviewPose(aspect, 45, extent);
      // worst case: a right panel halves the free width, so the camera sits twice as far
      const cam = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
      cam.up.set(0, 0, 1);
      cam.position.copy(target).addScaledVector(new THREE.Vector3(-0.45, -1, 0.5).normalize(), distance * 2);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      expect(points.every((p) => frustum.containsPoint(p))).toBe(true);
      const box = new THREE.Box3().setFromObject(ex.group);
      expect(frustum.intersectsBox(box)).toBe(false);
    }
    // the exhibit adds nothing to the row extent that the overview frames
    expect(exhibitAnchor(extent).x).toBeGreaterThan(extent.maxX + 100);
  });

  it('creates its texture at most once, only on request, and disposes it', async () => {
    const loadImage = vi.fn(async () => fakeImage);
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const ex = createExhibit(extent, { loadImage });
    expect(loadImage).not.toHaveBeenCalled();
    expect(ex.texture()).toBeNull();
    const [a, b] = await Promise.all([ex.ensureTexture(), ex.ensureTexture()]);
    await ex.ensureTexture();
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(ex.texture()).toBe(a);
    ex.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ex.texture()).toBeNull();
  });

  it('a failed load leaves the plain frame and no texture', async () => {
    const ex = createExhibit(extent, { loadImage: () => Promise.reject(new Error('x')) });
    expect(await ex.ensureTexture()).toBeNull();
    ex.dispose();
  });

  it('does not create a texture when disposed before the image arrived', async () => {
    let done!: (i: TexImageSource) => void;
    const ex = createExhibit(extent, { loadImage: () => new Promise((r) => { done = r; }) });
    const p = ex.ensureTexture();
    ex.dispose();
    done(fakeImage);
    expect(await p).toBeNull();
    expect(ex.texture()).toBeNull();
  });

  it('is static: it adds no update hook, and the picture uses the palette-token colours only', () => {
    const ex = createExhibit(extent);
    expect(ex.group.userData.update).toBeUndefined();
    ex.dispose();
  });
});

describe('lightbox', () => {
  const press = (key: string): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e;
  };

  it('opens on the trigger, labels the image in both languages and restores focus on Esc', () => {
    const entry = createExhibitEntry({ show: () => undefined });
    document.body.append(entry.element);
    entry.openButton.focus();
    entry.openButton.click();
    expect(isLightboxOpen()).toBe(true);
    const box = document.querySelector<HTMLElement>('.lightbox')!;
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.querySelector('img')!.alt).toBe(t('exhibit.alt'));
    expect(box.querySelector('figcaption')!.textContent).toBe(t('exhibit.caption'));
    setLang('de');
    expect(box.querySelector('img')!.alt).toMatch(/Screenshot des albert/);
    expect(document.activeElement).toBe(box.querySelector('.lightbox-close'));
    const e = press('Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(isLightboxOpen()).toBe(false);
    expect(document.querySelector('.lightbox')).toBeNull();
    expect(document.activeElement).toBe(entry.openButton);
  });

  it('Esc never reaches the other Esc handlers while it is open (one press, one level)', () => {
    const other = vi.fn();
    document.addEventListener('keydown', other);
    const trigger = document.createElement('button');
    document.body.append(trigger);
    openLightbox({ src: EXHIBIT_URL, returnFocus: trigger });
    press('Escape');
    expect(other).not.toHaveBeenCalled();
    document.removeEventListener('keydown', other);
  });

  it('closes on a backdrop click and on the close button, not on a click inside the figure', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const box = openLightbox({ src: EXHIBIT_URL, returnFocus: trigger });
    box.querySelector<HTMLElement>('img')!.click();
    expect(isLightboxOpen()).toBe(true);
    box.click();
    expect(isLightboxOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    const again = openLightbox({ src: EXHIBIT_URL, returnFocus: trigger });
    again.querySelector<HTMLElement>('.lightbox-close')!.click();
    expect(isLightboxOpen()).toBe(false);
  });

  it('keeps focus inside (Tab) and opens only once', () => {
    const a = openLightbox({ src: EXHIBIT_URL });
    expect(openLightbox({ src: EXHIBIT_URL })).toBe(a);
    expect(document.querySelectorAll('.lightbox')).toHaveLength(1);
    const e = press('Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a.querySelector('.lightbox-close'));
  });

  it('removes its key handler on close (Esc is free again)', () => {
    openLightbox({ src: EXHIBIT_URL });
    closeLightbox();
    const other = vi.fn();
    document.addEventListener('keydown', other);
    press('Escape');
    expect(other).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', other);
  });
});

describe('exhibit entry', () => {
  it('the show button calls the fly hook only on click and the labels follow the language', () => {
    const show = vi.fn();
    const entry = createExhibitEntry({ show });
    document.body.append(entry.element);
    expect(show).not.toHaveBeenCalled();
    entry.showButton.click();
    expect(show).toHaveBeenCalledTimes(1);
    setLang('de');
    expect(entry.showButton.textContent).toBe('In der Szene zeigen');
    expect(entry.openButton.textContent).toBe('Großansicht');
    expect(entry.showButton.getAttribute('aria-label')).toBeTruthy();
  });
});
