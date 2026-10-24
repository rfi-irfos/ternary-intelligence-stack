// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { buildTower } from '../src/scene/tower';
import { createOverviewLabels } from '../src/scene/overviewLabels';
import { setLang, setMode } from '../src/ui/prefs';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const texts: string[] = [];
const stub = (text: string): THREE.Object3D => {
  texts.push(text);
  const s = new THREE.Sprite(new THREE.SpriteMaterial());
  s.userData.text = text;
  return s;
};

afterEach(() => { setLang('en'); setMode('simple'); texts.length = 0; });

describe('overview pill labels (mockup: Eingabe, Ebene N, Ausgabe)', () => {
  it('Eingabe and Ausgabe stand over the ends of the model; Ebene N only with a selection', () => {
    setLang('de');
    const l = createOverviewLabels({ tower, label: stub });
    expect(texts).toEqual(['Eingabe', 'Ausgabe']);
    expect(l.names()).toEqual(['input', 'output']);
    const [inp, out] = l.group.children as THREE.Sprite[];
    expect(inp!.position.x).toBeCloseTo(tower.anchor('embed').x);
    expect(out!.position.x).toBeCloseTo(tower.anchor('lm_head').x);
    // above the whole model
    expect(inp!.position.y).toBeGreaterThan(new THREE.Box3().setFromObject(tower.root).max.y);
    l.setLayer(21);
    expect(texts.at(-1)).toBe('Ebene 22'); // Simple counts from 1
    expect(l.names()).toContain('layer');
    l.setLayer(null);
    expect(l.names()).not.toContain('layer');
    l.dispose();
  });

  it('Advanced counts from 0, English says Layer', () => {
    setMode('advanced');
    const l = createOverviewLabels({ tower, label: stub });
    l.setLayer(21);
    expect(texts.at(-1)).toBe('Layer 21');
    setLang('de');
    l.refresh();
    expect(texts.at(-1)).toBe('Ebene 21');
  });

  it('keeps a constant screen size (no size attenuation), hangs from its leader tip, and rescales on resize', () => {
    const l = createOverviewLabels({ tower, label: stub });
    const s = l.group.children[0] as THREE.Sprite;
    expect(s.material.sizeAttenuation).toBe(false);
    expect(s.center.y).toBe(0);
    l.resize(720);
    const h720 = s.scale.y;
    l.resize(1080);
    expect(s.scale.y).toBeCloseTo(h720 * 720 / 1080, 9);
    // 12 px text of a 30 px texture text: sprite height = 12/30 x 64 px of the viewport
    l.resize(720);
    expect(s.scale.y * 720 / (2 * Math.tan(THREE.MathUtils.degToRad(22.5)))).toBeCloseTo((12 / 30) * 64, 6);
  });

  it('hides all three while a level is open', () => {
    const l = createOverviewLabels({ tower, label: stub });
    l.setLayer(3);
    l.setVisible(false);
    expect(l.group.children.every((c) => !c.visible)).toBe(true);
    l.setVisible(true);
    expect(l.group.children.every((c) => c.visible)).toBe(true);
    // a label made while hidden stays hidden
    l.setVisible(false);
    l.setLayer(4);
    expect(l.group.children.every((c) => !c.visible)).toBe(true);
  });
});
