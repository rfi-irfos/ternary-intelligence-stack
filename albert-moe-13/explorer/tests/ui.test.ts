// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import arch from '../public/data/architecture.json';
import { validateArchitecture } from '../src/data/architecture';
import { validateTrace } from '../src/data/trace';
import { buildTower } from '../src/scene/tower';
import { createControls } from '../src/camera/controls';
import { getDepth, setDepth } from '../src/ui/depth';
import {
  LANG_KEY, MODE_KEY, getLang, getMode, initialLang, langFromNavigator, reloadPrefsForTest, setLang, setMode, t,
} from '../src/ui/prefs';
import { LANGS, MODES, STRINGS, TOUR_IDS, type StringKey, resolve } from '../src/ui/strings';
import { createTopBar } from '../src/ui/topbar';
import { createLegend } from '../src/ui/legend';
import { ROLES, hoverText, matchesRole, roleOf } from '../src/ui/roles';
import { createHoverTip } from '../src/ui/tooltip';
import { closeTourMenu, isTourMenuOpen, openTourMenu } from '../src/ui/tourMenu';
import { createSelection } from '../src/ui/selection';
import { createSlabRail } from '../src/ui/slabRail';
import { createPlayerBar, opLabel } from '../src/ui/player';
import { attachPicking } from '../src/ui/picking';
import { COACH_KEY, coachSeen, createCoachMarks } from '../src/ui/coach';
import { createHighlighter, HIGHLIGHT_DIM } from '../src/ui/highlight';

const a = validateArchitecture(arch);
const tower = buildTower(a);
const traces = import.meta.glob('../public/data/trace/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const trace = (id: string) => validateTrace(traces[`../public/data/trace/${id}.json`], a);

/** Spec §4.9, in order. */
const SPEC_TOURS = [
  'Meet albert.', 'Follow a token', 'Why only three experts?', 'Inside attention',
  'Ternary computation', 'Two streams, one model', 'From embedding to prediction',
];

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  closeTourMenu();
  document.body.innerHTML = '';
  setLang('en');
  setMode('simple');
  setDepth('intuition');
  localStorage.clear();
});

function bar() {
  const b = createPlayerBar({
    arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
    animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
  });
  document.body.appendChild(b.element);
  return b;
}

describe('strings', () => {
  it('every key exists in both languages and resolves to text in both modes', () => {
    const en = Object.keys(STRINGS.en) as StringKey[];
    expect(Object.keys(STRINGS.de).sort()).toEqual([...en].sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of en) {
      for (const mode of MODES) {
        const e = resolve(STRINGS.en[k], mode);
        const d = resolve(STRINGS.de[k], mode);
        expect(e.trim().length, `en ${k} ${mode}`).toBeGreaterThan(0);
        expect(d.trim().length, `de ${k} ${mode}`).toBeGreaterThan(0);
        expect(vars(d), `placeholders ${k} ${mode}`).toEqual(vars(e));
      }
    }
  });

  it('the Overview tooltip says "close all" in Simple', () => {
    expect(t('nav.overviewTip')).toMatch(/^Close all/);
    setLang('de');
    expect(t('nav.overviewTip')).toMatch(/^Alles zuklappen/);
  });
});

describe('language', () => {
  it('defaults from navigator.language and sets <html lang>', () => {
    expect(langFromNavigator({ language: 'de-AT' })).toBe('de');
    expect(langFromNavigator({ language: 'en-GB' })).toBe('en');
    expect(langFromNavigator({ language: 'fr-FR' })).toBe('en');
    expect(initialLang(null, { language: 'de' })).toBe('de');
    reloadPrefsForTest({ language: 'de-DE' });
    expect(getLang()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    reloadPrefsForTest({ language: 'en-US' });
    expect(getLang()).toBe('en');
  });

  it('the DE | EN toggle persists over a reload and wins over the browser language', () => {
    const top = createTopBar(null);
    document.body.appendChild(top.element);
    const de = top.element.querySelector<HTMLButtonElement>('.lang-toggle button[data-value="de"]')!;
    de.click();
    expect(getLang()).toBe('de');
    expect(localStorage.getItem(LANG_KEY)).toBe('de');
    expect(de.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.lang).toBe('de');
    reloadPrefsForTest({ language: 'en-US' });
    expect(getLang()).toBe('de');
    top.dispose();
  });

  it('DE -> EN re-renders the Play label and the router label in place', async () => {
    setLang('de');
    const b = bar();
    await b.ready;
    const play = b.element.querySelector('button[data-action="play"]')!;
    expect(play.getAttribute('aria-label')).toBe('Durchlauf starten');
    b.player()?.jumpToNext('router');
    const chip = b.element.querySelector('.step-line')!;
    expect(chip.textContent).toContain('Die Weiche wählt 3 von 12 Experten');
    const sameEl = b.element;
    setLang('en');
    expect(b.element).toBe(sameEl);
    expect(play.getAttribute('aria-label')).toBe('Watch albert think');
    expect(play.textContent).toBe('Watch albert think');
    expect(chip.textContent).toContain('The switch picks 3 of 12 experts');
    expect(chip.textContent).not.toContain('Weiche');
  });
});

describe('Simple | Advanced', () => {
  it('defaults to Simple; the toggle persists and maps to the depth', () => {
    expect(getMode()).toBe('simple');
    const top = createTopBar(null);
    document.body.appendChild(top.element);
    const gear = top.element.querySelector<HTMLElement>('.settings-btn')!;
    expect(gear.hidden).toBe(true);
    top.element.querySelector<HTMLButtonElement>('.mode-toggle button[data-value="advanced"]')!.click();
    expect(getMode()).toBe('advanced');
    expect(localStorage.getItem(MODE_KEY)).toBe('advanced');
    expect(getDepth()).toBe('technical');
    expect(gear.hidden).toBe(false);
    reloadPrefsForTest();
    expect(getMode()).toBe('advanced');
    setMode('simple');
    expect(getDepth()).toBe('intuition');
    // Choosing a deeper depth (keys 2/3, panel buttons) switches to Advanced.
    setDepth('researcher');
    expect(getMode()).toBe('advanced');
    top.dispose();
  });

  it('Simple hides speed, camera, next-of-kind and ids; Advanced shows them', async () => {
    const b = bar();
    await b.ready;
    const adv = b.element.querySelector<HTMLElement>('.advanced-controls')!;
    expect(adv.contains(b.element.querySelector('.player-speed'))).toBe(true);
    expect(adv.contains(b.element.querySelector('.player-camera'))).toBe(true);
    expect(adv.contains(b.element.querySelector('.player-kind'))).toBe(true);
    const [prompt, token] = b.element.querySelectorAll<HTMLSelectElement>('select');
    const tools = b.element.querySelector<HTMLButtonElement>('[data-control="tools"]')!;
    expect(adv.hidden).toBe(true);
    expect(tools.hidden).toBe(true);
    expect(token!.options[1]!.textContent).toBe('the');
    expect(prompt!.options[0]!.textContent).not.toMatch(/^kjv:/);
    setMode('advanced');
    // Advanced: the expert tools come back, grouped in one drawer behind the Tools button.
    expect(tools.hidden).toBe(false);
    expect(adv.hidden).toBe(true);
    tools.click();
    expect(tools.getAttribute('aria-expanded')).toBe('true');
    expect(adv.hidden).toBe(false);
    expect(adv.contains(token!)).toBe(true);
    expect(adv.contains(b.element.querySelector('input[type=range]'))).toBe(true);
    expect(token!.options[1]!.textContent).toBe('1: " the"');
    expect(prompt!.options[0]!.textContent).toMatch(/^kjv: /);
  });

  it('the router label is plain in Simple and technical in Advanced', () => {
    expect(opLabel('router', a)).toBe('Switch: which experts?');
    expect(opLabel('router', a)).not.toMatch(/top|\d/);
    setMode('advanced');
    expect(opLabel('router', a)).toBe('Router (top-3 of 12 experts)');
  });
});

describe('player bar', () => {
  it('every transport button has an icon, an aria-label and a tooltip that says what happens', async () => {
    const b = bar();
    await b.ready;
    const icons = [...b.element.querySelectorAll<HTMLButtonElement>('.transport button')];
    expect(icons.map((x) => x.dataset.action)).toEqual(['prev', 'play', 'next']);
    expect(icons[1]!.title).toMatch(/^Runs one sentence through all 46 layers/);
    for (const x of icons) {
      expect(x.getAttribute('aria-label')?.length, x.dataset.action).toBeGreaterThan(0);
      expect(x.title).toMatch(/\(.+\)$/);
      expect(x.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('player bar explains itself', () => {
  it('a plain headline says what the bar does, in DE and EN', async () => {
    setLang('de');
    const b = bar();
    await b.ready;
    const h = b.element.querySelector<HTMLElement>('.player-headline')!;
    expect(h.textContent).toBe('Schau zu, wie albert einen Satz liest – Ebene für Ebene.');
    expect(h.title.length).toBeGreaterThan(0);
    setLang('en');
    expect(h.textContent).toBe('Watch albert read a sentence – layer by layer.');
  });

  it('the sentence shows as word chips, one per token, the followed word marked', async () => {
    const b = bar();
    await b.ready;
    const tr = trace('kjv');
    const chips = [...b.element.querySelectorAll<HTMLButtonElement>('.word-strip .word-chip')];
    expect(chips).toHaveLength(tr.provenance.tokens.length);
    const current = chips.filter((c) => c.classList.contains('current'));
    expect(current).toHaveLength(1);
    expect(Number(current[0]!.dataset.pos)).toBe(b.selection()!.position);
    expect(current[0]!.getAttribute('aria-pressed')).toBe('true');
    for (const c of chips) expect(c.title.length, c.textContent ?? '').toBeGreaterThan(0);
    expect(chips.slice(0, 3).map((c) => c.textContent)).toEqual(['In', 'the', 'beginning']);
    // Clicking a word follows it; the marker moves, the camera does not.
    chips[3]!.click();
    expect(b.selection()!.position).toBe(3);
    const now = [...b.element.querySelectorAll<HTMLElement>('.word-chip.current')];
    expect(now.map((c) => c.dataset.pos)).toEqual(['3']);
  });

  it('a punctuation token is a visible chip of its own', async () => {
    const b = bar();
    await b.ready;
    const chips = [...b.element.querySelectorAll<HTMLButtonElement>('.word-strip .word-chip')];
    const dot = chips.at(-1)!;
    expect(dot.textContent).toBe('.');
    expect(dot.classList.contains('word-chip--punct')).toBe(true);
    expect(chips.filter((c) => (c.textContent ?? '').trim() === '')).toEqual([]);
  });

  it('before Play a hint explains the run; the step sentence then changes with the op', async () => {
    setLang('de');
    const b = bar();
    await b.ready;
    const line = b.element.querySelector<HTMLElement>('.step-line')!;
    expect(line.textContent).toBe('Drück auf Start – dann wandert das Wort durch alle 46 Ebenen');
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    expect(line.textContent).toMatch(/^Schritt 1 von \d+ · „\.“ wird zu einer Liste von Zahlen$/);
    const p = b.player()!;
    p.pause();
    p.jumpToNext('router');
    const router = line.textContent!;
    expect(router).toMatch(/^Schritt \d+ von \d+ · Ebene 0 von 46(?: · Strom [AB])? · Die Weiche wählt 3 von 12 Experten$/);
    expect(line.dataset.role).toBe('router');
    p.jumpToNext('gate');
    expect(line.textContent).not.toBe(router);
    expect(line.textContent).toContain('Die zwei Ströme tauschen sich aus');
    expect(line.dataset.role).toBe('gate');
    // Simple shows no "word ." row any more; the word lives in the strip.
    p.scrub(0);
    expect(b.element.querySelector('.player-details')?.textContent).toBe('');
  });

  it('the sentence picker is a chip that lists the three sentences in full', async () => {
    setLang('de');
    const b = bar();
    await b.ready;
    const chip = b.element.querySelector<HTMLButtonElement>('.sentence-chip')!;
    expect(chip.textContent).toBe('Anderen Satz wählen');
    expect(chip.title.length).toBeGreaterThan(0);
    chip.click();
    const opts = [...document.querySelectorAll<HTMLElement>('.sentence-pop [data-prompt]')];
    expect(opts.map((o) => o.textContent)).toEqual(['kjv', 'de', 'ternary'].map((id) => trace(id).provenance.prompt));
  });
});

describe('legend', () => {
  it('Simple: a quiet key, always visible, without buttons', () => {
    const onHighlight = vi.fn();
    const legend = createLegend({ onHighlight });
    document.body.appendChild(legend.element);
    expect(legend.element.querySelector('.legend-list')?.closest('[hidden]')).toBeNull();
    expect(legend.element.querySelector<HTMLElement>('.legend-toggle')!.hidden).toBe(true);
    expect(legend.element.querySelectorAll('button.legend-item')).toHaveLength(0);
    const items = [...legend.element.querySelectorAll<HTMLElement>('.legend-item')];
    expect(items.map((x) => x.dataset.role)).toEqual(ROLES);
    items[2]!.dispatchEvent(new Event('pointerenter'));
    expect(onHighlight).toHaveBeenLastCalledWith('expert');
    items[2]!.dispatchEvent(new Event('pointerleave'));
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    legend.dispose();
  });

  it('Advanced: lists the six roles with a shape each; hover previews, click pins and unpins', () => {
    setMode('advanced');
    const onHighlight = vi.fn();
    const legend = createLegend({ onHighlight });
    document.body.appendChild(legend.element);
    const toggle = legend.element.querySelector<HTMLButtonElement>('.legend-toggle')!;
    const list = legend.element.querySelector<HTMLElement>('.legend-list')!;
    expect(list.hidden).toBe(true);
    toggle.click();
    expect(list.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = [...legend.element.querySelectorAll<HTMLButtonElement>('button.legend-item')];
    expect(items.map((x) => x.dataset.role)).toEqual(ROLES);
    expect(ROLES).toHaveLength(6);
    for (const x of items) expect(x.querySelector('svg.legend-shape')).not.toBeNull();
    const router = items[3]!;
    router.click();
    expect(onHighlight).toHaveBeenLastCalledWith('router');
    expect(legend.pinned()).toBe('router');
    expect(router.getAttribute('aria-pressed')).toBe('true');
    router.click();
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    expect(legend.pinned()).toBeNull();
    legend.dispose();
  });

  it('roles match the scene colours of the components', () => {
    expect(roleOf('L12.A.attn')).toBe('streamA');
    expect(roleOf('L12.B.ln2')).toBe('streamB');
    expect(roleOf('L12.A.router')).toBe('router');
    expect(roleOf('L12.expert.3')).toBe('expert');
    expect(roleOf('L13.gate')).toBe('gate');
    expect(matchesRole('L12.expert.3', 'ternary')).toBe(true);
    expect(matchesRole('L12.A.router', 'ternary')).toBe(false);
  });

  it('the highlighter dims non-matching instances and restores them', () => {
    const geo = new THREE.BoxGeometry();
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 2);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.setColorAt(1, new THREE.Color(1, 1, 1));
    mesh.userData.ids = ['L1.expert.0', 'L1.A.router'];
    const root = new THREE.Group();
    root.add(mesh);
    const h = createHighlighter(() => [root]);
    h.show((id) => matchesRole(id, 'router'));
    expect(mesh.instanceColor!.array[0]).toBeCloseTo(HIGHLIGHT_DIM);
    expect(mesh.instanceColor!.array[3]).toBe(1);
    h.show(null);
    expect(mesh.instanceColor!.array[0]).toBe(1);
    expect(h.active()).toBe(false);
  });
});

describe('tour menu', () => {
  it('lists the seven spec titles and says they are coming in this build', () => {
    expect(TOUR_IDS).toHaveLength(7);
    const el = openTourMenu();
    expect(isTourMenuOpen()).toBe(true);
    const titles = [...el.querySelectorAll('.tour-title')].map((x) => x.textContent);
    expect(titles).toEqual(SPEC_TOURS);
    for (const s of el.querySelectorAll('.tour-soon')) expect(s.textContent).toBe('coming in this build');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isTourMenuOpen()).toBe(false);
  });

  it('German titles: seven, one per tour', () => {
    setLang('de');
    const el = openTourMenu();
    const titles = [...el.querySelectorAll('.tour-title')].map((x) => x.textContent ?? '');
    expect(titles).toHaveLength(7);
    expect(new Set(titles).size).toBe(7);
    expect(el.querySelector('h2')?.textContent).toBe('Geführte Touren');
  });

  it('the top bar opens it from the tours button', () => {
    const top = createTopBar(null);
    document.body.appendChild(top.element);
    expect(top.toursButton.textContent).toBe('Guided tours');
    top.toursButton.click();
    expect(isTourMenuOpen()).toBe(true);
    top.dispose();
  });
});

describe('hover tooltip', () => {
  it('names an expert with its layer, in the role colour', () => {
    expect(hoverText('L12.expert.3')).toBe('Expert 3 · layer 12');
    const tip = createHoverTip();
    document.body.appendChild(tip.element);
    tip.show('L12.expert.3');
    expect(tip.element.hidden).toBe(false);
    expect(tip.element.textContent).toBe('Expert 3 · layer 12');
    expect(tip.element.dataset.role).toBe('expert');
    setLang('de');
    tip.refresh();
    expect(tip.element.textContent).toBe('Experte 3 · Ebene 12');
    tip.show(null);
    expect(tip.element.hidden).toBe(true);
  });

  it('hover picking runs at most once per frame, at the last pointer position', () => {
    const dom = document.createElement('canvas');
    const queue: Array<() => void> = [];
    const h = { pickAt: vi.fn(() => 'L1.expert.0' as string | null), onPick: vi.fn(), onEmpty: vi.fn(), onHover: vi.fn() };
    cleanup.push(attachPicking(dom, h, undefined, (cb) => queue.push(cb)));
    for (const x of [10, 20, 30]) dom.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: 5 }));
    expect(h.pickAt).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    queue.shift()!();
    expect(h.pickAt).toHaveBeenCalledTimes(1);
    expect(h.pickAt).toHaveBeenCalledWith(30, 5);
    expect(h.onHover).toHaveBeenCalledWith('L1.expert.0');
  });
});

describe('slab rail', () => {
  it('follows the selection without moving the camera', () => {
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const fly = vi.spyOn(rig, 'flyTo');
    const selection = createSelection();
    const rail = createSlabRail(tower, rig, vi.fn(), selection);
    document.body.appendChild(rail.element);
    const current = () => [...rail.element.querySelectorAll<HTMLElement>('.current')].map((x) => Number(x.dataset.layer));
    expect(current()).toEqual([]);
    selection.set('L20.A.attn');
    expect(current()).toEqual([20]);
    expect(rail.selected()).toBe(20);
    selection.set('L7.expert.2');
    expect(current()).toEqual([7]);
    expect(rail.element.querySelector('[data-layer="7"]')?.getAttribute('aria-current')).toBe('true');
    // A selection without a layer keeps the last one.
    selection.set('embed');
    expect(current()).toEqual([7]);
    expect(fly).not.toHaveBeenCalled();
    rail.dispose();
  });

  it('is labelled at both ends, keyed in one line, and shows the run with a marker and a fill', () => {
    setLang('de');
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const rail = createSlabRail(tower, rig, vi.fn());
    document.body.appendChild(rail.element);
    expect(rail.element.querySelector('.rail-end--first')?.textContent).toBe('Ebene 0');
    expect(rail.element.querySelector('.rail-end--last')?.textContent).toBe('Ebene 45');
    expect(rail.element.querySelector('.rail-legend')?.textContent).toBe('rot = Austausch-Tor zwischen den Strömen');
    rail.flow(12, 0.25);
    expect([...rail.element.querySelectorAll<HTMLElement>('.flow')].map((x) => x.dataset.layer)).toEqual(['12']);
    expect(rail.element.querySelector<HTMLElement>('.rail-progress > span')!.style.transform).toBe('scaleX(0.25)');
    rail.flow(null, 1);
    expect(rail.element.querySelectorAll('.flow')).toHaveLength(0);
    rail.dispose();
  });

  it('fusion layers carry the fusion class', () => {
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const rail = createSlabRail(tower, rig, vi.fn());
    const fusion = [...rail.element.querySelectorAll<HTMLElement>('.fusion')].map((x) => Number(x.dataset.layer));
    expect(fusion).toEqual(a.model.fusion_layers);
  });
});

it('LANGS and MODES are the two each', () => {
  expect(LANGS).toEqual(['de', 'en']);
  expect(MODES).toEqual(['simple', 'advanced']);
});

describe('reduced HUD', () => {
  /** Visible interactive elements of the HUD chrome (panel excluded), grouped by their data-control. */
  function controls(roots: HTMLElement[]) {
    const all = roots.flatMap((r) => [...r.querySelectorAll<HTMLElement>('button, select, input, a[href], [tabindex]')])
      .filter((x) => !x.closest('[hidden]'));
    const orphans = all.filter((x) => !x.closest('[data-control]'));
    const groups = new Set(all.map((x) => x.closest<HTMLElement>('[data-control]')?.dataset.control));
    return { all, orphans, groups };
  }

  it('Simple shows at most five controls: home, tours, preferences, play and the sentence', async () => {
    const top = createTopBar(null);
    const b = bar();
    const legend = createLegend({ onHighlight: vi.fn() });
    document.body.append(top.element, legend.element);
    await b.ready;
    const c = controls([top.element, b.element, legend.element]);
    expect(c.orphans).toEqual([]);
    expect([...c.groups].sort()).toEqual(['home', 'play', 'prefs', 'sentence', 'tours']);
    expect(c.groups.size).toBeLessThanOrEqual(5);
    expect(c.all.filter((x) => x.tagName === 'SELECT' || x.tagName === 'INPUT')).toEqual([]);
    // The transport is Play alone until a run was started and paused.
    expect(c.all.filter((x) => x.closest('[data-control="play"]')).map((x) => x.dataset.action)).toEqual(['play']);
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    const paused = controls([b.element]).all.filter((x) => x.closest('[data-control="play"]')).map((x) => x.dataset.action);
    expect(paused).toEqual(['prev', 'play', 'next']);
    top.dispose();
  });

  it('Advanced adds the gear and the tools drawer, still grouped', async () => {
    setMode('advanced');
    const top = createTopBar(null);
    const b = bar();
    document.body.append(top.element);
    await b.ready;
    const c = controls([top.element, b.element]);
    expect(c.orphans).toEqual([]);
    expect(c.groups.has('tools')).toBe(true);
    expect(top.element.querySelector<HTMLElement>('.settings-btn')!.hidden).toBe(false);
    top.dispose();
  });

  it('the sentence chip opens a popover; a word chip sets the position, the camera stays', async () => {
    const flyTo = vi.fn(() => Promise.resolve());
    const b = createPlayerBar({
      arch: a, tower, rig: { flyTo, overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    document.body.appendChild(b.element);
    await b.ready;
    const chip = b.element.querySelector<HTMLButtonElement>('.sentence-chip')!;
    expect(chip.textContent).toBe('Choose another sentence');
    chip.click();
    const pop = document.querySelector<HTMLElement>('.sentence-pop')!;
    expect(pop.hidden).toBe(false);
    expect(pop.querySelectorAll('[data-prompt]')).toHaveLength(3);
    b.element.querySelector<HTMLElement>('.word-strip [data-pos="1"]')!.click();
    expect(b.selection()?.position).toBe(1);
    pop.querySelector<HTMLElement>('[data-prompt="de"]')!.click();
    expect(b.selection()?.promptId).toBe('de');
    expect(pop.hidden).toBe(true);
    expect(pop.isConnected).toBe(false);
    expect(b.element.querySelector('.word-chip')?.textContent).toBe(trace('de').provenance.prompt.split(/\s+/)[0]);
    expect(flyTo).not.toHaveBeenCalled();
  });

  it('coach marks: three hints, shown once, never again after they end', () => {
    expect(coachSeen()).toBe(false);
    const steps = [
      { key: 'coach.play' as const, target: () => null },
      { key: 'coach.tours' as const, target: () => null },
      { key: 'coach.click' as const, target: () => null },
    ];
    const c = createCoachMarks(steps);
    expect(c.element).not.toBeNull();
    document.body.appendChild(c.element!);
    expect(c.element!.textContent).toContain(t('coach.play'));
    c.next();
    c.next();
    expect(c.element!.textContent).toContain(t('coach.click'));
    expect(c.element!.querySelector('.coach-next')?.textContent).toBe('Got it');
    c.next();
    expect(document.body.contains(c.element)).toBe(false);
    expect(localStorage.getItem(COACH_KEY)).toBe('done');
    expect(createCoachMarks(steps).element).toBeNull();
  });

  it('closing the coach marks early also ends them for good', () => {
    const c = createCoachMarks([{ key: 'coach.play', target: () => null }]);
    document.body.appendChild(c.element!);
    c.element!.querySelector<HTMLElement>('.coach-skip')!.click();
    expect(coachSeen()).toBe(true);
    expect(createCoachMarks([{ key: 'coach.play', target: () => null }]).element).toBeNull();
  });
});
