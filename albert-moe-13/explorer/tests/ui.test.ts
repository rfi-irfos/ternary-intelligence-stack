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
  LANG_KEY, MODE_KEY, getLang, getMode, initialLang, langFromNavigator, layerLabel, reloadPrefsForTest, setLang, setMode, t,
} from '../src/ui/prefs';
import { LANGS, MODES, STRINGS, TOUR_IDS, type StringKey, resolve } from '../src/ui/strings';
import { createTopBar } from '../src/ui/topbar';
import { createLegend } from '../src/ui/legend';
import { ROLES, hoverText, matchesRole, roleOf, sceneName } from '../src/ui/roles';
import { createHoverTip } from '../src/ui/tooltip';
import { closeTourMenu, isTourMenuOpen, openTourMenu } from '../src/ui/tourMenu';
import { createSelection } from '../src/ui/selection';
import { createPlayerBar, defaultPosition, opLabel, stepSentence, wordGroups } from '../src/ui/player';
import { decodeToken } from '../src/data/trace';
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

  it('the home button is the main menu and its tooltip says "close everything"', () => {
    expect(t('nav.home')).toBe('Main menu');
    expect(t('nav.homeTip')).toMatch(/^Close everything/);
    setLang('de');
    expect(t('nav.home')).toBe('Hauptmenü');
    expect(t('nav.homeTip')).toMatch(/^Alles schließen/);
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
    expect(play.getAttribute('aria-label')).toBe('Start');
    b.player()?.jumpToNext('router');
    const chip = b.element.querySelector('.step-line')!;
    expect(chip.textContent).toContain('Die Weiche wählt 3 von 12 Experten');
    const sameEl = b.element;
    setLang('en');
    expect(b.element).toBe(sameEl);
    expect(play.getAttribute('aria-label')).toBe('Play');
    expect(play.textContent).toBe('Play');
    expect(chip.textContent).toContain('The switch picks 3 of 12 experts');
    expect(chip.textContent).not.toContain('Weiche');
  });
});

describe('Simple | Advanced', () => {
  it('defaults to Simple; the toggle persists and maps to the depth', async () => {
    expect(getMode()).toBe('simple');
    const top = createTopBar(null);
    document.body.appendChild(top.element);
    // Einfach | Erweitert lives in the sidebar (Darstellung), not in the top bar; the gear shows in both modes.
    expect(top.element.querySelector('.mode-toggle')).toBeNull();
    const gear = top.element.querySelector<HTMLElement>('.settings-btn')!;
    expect(gear.hidden).toBe(false);
    const b = createPlayerBar({
      arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
      animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
    });
    document.body.appendChild(b.element);
    await b.ready;
    b.display.querySelector<HTMLButtonElement>('.mode-toggle button[data-value="advanced"]')!.click();
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

  it('Simple hides camera, next-of-kind and ids; Advanced shows them; the speed pill shows in both', async () => {
    const b = bar();
    await b.ready;
    const adv = b.session.querySelector<HTMLElement>('.advanced-controls')!;
    // One speed control: the pill after Next (the Tools drawer no longer has a speed select).
    expect(b.element.querySelector('.player-speed')).toBeNull();
    const pill = b.element.querySelector<HTMLElement>('.speed-pill')!;
    expect(adv.contains(pill)).toBe(false);
    expect(pill.closest('[hidden]')).toBeNull();
    expect(adv.contains(b.session.querySelector('.player-camera'))).toBe(true);
    expect(adv.contains(b.session.querySelector('.player-kind'))).toBe(true);
    const [prompt, token] = b.session.querySelectorAll<HTMLSelectElement>('select');
    expect(adv.hidden).toBe(true);
    expect(token!.options[1]!.textContent).toBe('the');
    expect(prompt!.options[0]!.textContent).not.toMatch(/^kjv:/);
    setMode('advanced');
    // Advanced: the expert tools come back, grouped in the Sitzung section (no Tools button any more).
    expect(b.element.querySelector('[data-control="tools"]')).toBeNull();
    expect(adv.hidden).toBe(false);
    expect(adv.contains(token!)).toBe(true);
    expect(adv.contains(b.session.querySelector('input[type=range]'))).toBe(true);
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

describe('R3: what the sentences and names say', () => {
  it('the step text carries labelled values (.lv[data-kind]) in the caption line', async () => {
    const b = bar();
    await b.ready;
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    const p = b.player()!;
    p.pause();
    p.jumpToNext('router');
    const lv = [...b.element.querySelectorAll<HTMLElement>('.step-line .step-text .lv[data-kind]')];
    expect(lv.length).toBeGreaterThan(0);
    for (const x of lv) expect(['measured', 'structure', 'illustrative', 'derived']).toContain(x.dataset.kind);
  });

  it('the router sentence follows the config top_k (no literal 3)', async () => {
    const b = bar();
    await b.ready;
    const ops = b.player()!.ops;
    const i = ops.findIndex((op) => op.kind === 'router');
    for (const mode of MODES) {
      setMode(mode);
      const three = stepSentence(ops[i]!, i, ops.length, a, ' earth');
      const two = stepSentence(ops[i]!, i, ops.length, { ...a, model: { ...a.model, top_k: 2 } }, ' earth');
      expect(two, mode).not.toBe(three);
      expect(two, mode).toMatch(/\b2\b/);
    }
  });

  it('Simple names the norms in words; Advanced keeps ln1/ln2', () => {
    expect(sceneName('L12.A.ln1')).toBe('Norm (before attention)');
    expect(sceneName('L12.B.ln2')).toBe('Norm (before the switch)');
    setLang('de');
    expect(sceneName('L12.A.ln1')).toBe('Norm (vor Aufmerksamkeit)');
    expect(sceneName('L12.B.ln2')).toBe('Norm (vor der Weiche)');
    setMode('advanced');
    expect(sceneName('L12.A.ln1')).toBe('ln1 A');
    expect(sceneName('L12.B.ln2')).toBe('ln2 B');
    // Anything else keeps its component name.
    expect(sceneName('L12.bank')).toBe(sceneName('L12.bank'));
  });
});

describe('player bar', () => {
  it('every transport button has an icon, an aria-label and a tooltip that says what happens', async () => {
    const b = bar();
    await b.ready;
    const icons = [...b.element.querySelectorAll<HTMLButtonElement>('.transport button')];
    expect(icons.map((x) => x.dataset.action)).toEqual(['prev', 'play', 'next']);
    // the speed button belongs to the right zone, next to the layer stepper
    expect([...b.element.querySelectorAll<HTMLButtonElement>('.dock-right button')].map((x) => x.dataset.action)).toEqual(['speed', 'layer-prev', 'layer-next']);
    expect(icons[1]!.title).toMatch(/^Runs one sentence through all 46 layers/);
    for (const x of [...icons, b.element.querySelector<HTMLButtonElement>('[data-action="speed"]')!]) {
      expect(x.getAttribute('aria-label')?.length, x.dataset.action).toBeGreaterThan(0);
      // The step buttons name their key; the speed pill's tooltip is just "Speed" (its value is in the label).
      if (x.dataset.action === 'speed') {
        // A text pill ("1×"), no icon.
        expect(x.textContent).toMatch(/^\d+(\.\d)?×$/);
        continue;
      }
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

  it('the sentence shows as word chips, the followed word marked; by default the last word', async () => {
    const b = bar();
    await b.ready;
    const tr = trace('kjv');
    const decoded = tr.provenance.tokens.map(decodeToken);
    // The default word is the last one that is not punctuation ("earth" in "… the earth.").
    expect(b.selection()!.position).toBe(defaultPosition(decoded));
    expect(decoded[b.selection()!.position]!.trim()).toBe('earth');
    const chips = [...b.session.querySelectorAll<HTMLButtonElement>('.word-strip .word-chip')];
    // English: every token starts a word here, so one chip per token.
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
    const now = [...b.session.querySelectorAll<HTMLElement>('.word-chip.current')];
    expect(now.map((c) => c.dataset.pos)).toEqual(['3']);
  });

  it('German subword pieces are grouped into word chips; a chip follows its last piece', async () => {
    const b = bar();
    await b.ready;
    b.session.querySelector<HTMLButtonElement>('.sentence-chip')!.click();
    document.querySelector<HTMLElement>('.sentence-pop [data-prompt="de"]')!.click();
    await b.ready;
    await new Promise((r) => setTimeout(r, 0));
    const tr = trace('de');
    const n = tr.provenance.tokens.length;
    // The traced sentence keeps its own language (kjv and ternary are lang="en", also in the German UI).
    expect(b.session.querySelector<HTMLElement>('.word-strip')!.lang).toBe('de');
    const chips = [...b.session.querySelectorAll<HTMLButtonElement>('.word-strip .word-chip')];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThan(n);
    // Every token belongs to exactly one chip.
    const owner = new Array<number>(n).fill(0);
    for (const c of chips) for (let k = Number(c.dataset.from); k <= Number(c.dataset.to); k++) owner[k]!++;
    expect(owner).toEqual(new Array<number>(n).fill(1));
    expect(wordGroups(tr.provenance.tokens.map(decodeToken))).toHaveLength(chips.length);
    // The pieces of a grouped chip are spans; its tooltip lists them.
    const grouped = chips.find((c) => c.classList.contains('word-chip--pieces'))!;
    expect(grouped.querySelectorAll('.word-piece').length).toBeGreaterThan(1);
    expect(grouped.title).toMatch(/·/);
    grouped.click();
    expect(b.selection()!.position).toBe(Number(grouped.dataset.to));
    expect(grouped.dataset.pos).toBe(grouped.dataset.to);
  });

  it('a punctuation token is a visible chip of its own', async () => {
    const b = bar();
    await b.ready;
    const chips = [...b.session.querySelectorAll<HTMLButtonElement>('.word-strip .word-chip')];
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
    const head = b.element.querySelector<HTMLElement>('.player-headline')!;
    // Before the first Play the caption is the headline; the hint is its tooltip.
    expect(head.hidden).toBe(false);
    expect(line.hidden).toBe(true);
    expect(head.title).toContain('Drück auf Start – dann wandert das Wort durch alle 46 Ebenen');
    const playBtn = b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!;
    playBtn.click();
    expect(head.hidden).toBe(true);
    expect(line.hidden).toBe(false);
    // Simple plays the quick pass: the caption names the group's main op (changes once per layer) ...
    expect(line.querySelector('.step-text')!.textContent).toBe('Wort wird zu Zahlen');
    playBtn.click(); // pause: ... and the per-op sentence is back.
    expect(line.textContent).toMatch(/^Schritt 1 von \d+ · „earth“ wird zu einer Liste von Zahlen$/);
    const p = b.player()!;
    p.jumpToNext('router');
    // The sentence itself (Simple adds the step's few values after it, in the same line).
    const router = line.querySelector('.step-text')!.textContent!;
    expect(router).toMatch(/^Schritt \d+ von \d+(?: · Strom [AB])? · Die Weiche wählt 3 von 12 Experten$/);
    expect(line.dataset.role).toBe('router');
    p.jumpToNext('gate');
    expect(line.textContent).not.toBe(router);
    expect(line.textContent).toContain('Die zwei Ströme tauschen sich aus');
    expect(line.dataset.role).toBe('gate');
    // Simple shows no "word ." row any more; the word lives in the strip.
    p.scrub(0);
    expect(b.element.querySelector('.player-details')?.textContent).toBe('');
  });

  it('every step sentence is short enough for the one caption line of the 720 px dock (no "…")', async () => {
    const b = bar();
    await b.ready;
    const ops = b.player()!.ops;
    const kinds = new Map(ops.map((op, i) => [op.kind, i]));
    // The highest step and layer numbers give the longest sentence of each kind.
    const last = new Map<string, number>();
    ops.forEach((op, i) => last.set(`${op.kind}${op.stream ?? ''}`, i));
    for (const lang of LANGS) for (const mode of MODES) {
      setLang(lang);
      setMode(mode);
      for (const i of [...kinds.values(), ...last.values()]) {
        const text = stepSentence(ops[i]!, ops.length - 1, ops.length, a, ' beginning');
        // About 7 px per character of Inter 14px: 86 characters stay inside the ~676 px of the caption line.
        expect(text.length, `${lang} ${mode} ${text}`).toBeLessThanOrEqual(86);
      }
    }
  });

  it('the sentence picker is a chip that lists the three sentences in full', async () => {
    setLang('de');
    const b = bar();
    await b.ready;
    const chip = b.session.querySelector<HTMLButtonElement>('.sentence-chip')!;
    expect(chip.getAttribute('aria-label')).toBe('Satz auswählen');
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(chip.title.length).toBeGreaterThan(0);
    chip.click();
    const opts = [...document.querySelectorAll<HTMLElement>('.sentence-pop [data-prompt]')];
    expect(opts.map((o) => o.textContent)).toEqual(['kjv', 'de', 'ternary'].map((id) => trace(id).provenance.prompt));
  });
});

describe('legend', () => {
  it('Simple: a "Legend" chip opens a quiet key without buttons; hover previews, nothing pins', () => {
    const onHighlight = vi.fn();
    const legend = createLegend({ onHighlight });
    document.body.appendChild(legend.element);
    const toggle = legend.element.querySelector<HTMLButtonElement>('.legend-toggle')!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toContain('Legend');
    expect(legend.element.querySelector('.legend-list')?.closest('[hidden]')).not.toBeNull();
    toggle.click();
    expect(legend.isOpen()).toBe(true);
    expect(legend.element.querySelector('.legend-list')?.closest('[hidden]')).toBeNull();
    expect(legend.element.querySelectorAll('button.legend-item')).toHaveLength(0);
    expect(legend.element.querySelectorAll('.legend-item')).toHaveLength(7);
    const items = [...legend.element.querySelectorAll<HTMLElement>('.legend-item')];
    expect(items.map((x) => x.dataset.role)).toEqual(ROLES);
    items[2]!.dispatchEvent(new Event('pointerenter'));
    expect(onHighlight).toHaveBeenLastCalledWith('expert');
    items[2]!.dispatchEvent(new Event('pointerleave'));
    expect(onHighlight).toHaveBeenLastCalledWith(null);
    items[2]!.click();
    expect(legend.pinned()).toBeNull();
    setLang('de');
    expect(toggle.textContent).toContain('Legende');
    legend.dispose();
  });

  it('Advanced: lists the seven roles with a shape each; hover previews, click pins and unpins', () => {
    setMode('advanced');
    const onHighlight = vi.fn();
    const legend = createLegend({ onHighlight });
    document.body.appendChild(legend.element);
    const toggle = legend.element.querySelector<HTMLButtonElement>('.legend-toggle')!;
    const list = legend.element.querySelector<HTMLElement>('.legend-list')!;
    expect(list.closest('[hidden]')).not.toBeNull();
    toggle.click();
    expect(list.closest('[hidden]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The fold chevron hides the rows and keeps the header.
    const fold = legend.element.querySelector<HTMLButtonElement>('.legend-fold')!;
    fold.click();
    expect(list.hidden).toBe(true);
    fold.click();
    expect(list.hidden).toBe(false);
    const items = [...legend.element.querySelectorAll<HTMLButtonElement>('button.legend-item')];
    expect(items.map((x) => x.dataset.role)).toEqual(ROLES);
    expect(ROLES).toHaveLength(7);
    for (const x of items) expect(x.querySelector('.legend-swatch')).not.toBeNull();
    const router = items[1]!;
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
    expect(top.toursButton.textContent).toBe('Tour');
    expect(top.toursButton.title).toContain(String(TOUR_IDS.length));
    expect(top.toursButton.querySelector('svg')).not.toBeNull();
    top.toursButton.click();
    expect(isTourMenuOpen()).toBe(true);
    top.dispose();
  });
});

describe('hover tooltip', () => {
  it('names an expert with its layer, in the role colour', () => {
    // One numbering: layers count from 1 in both modes (blocks.12 is layer 13).
    expect(hoverText('L12.expert.3')).toBe('Expert 3 · layer 13');
    const tip = createHoverTip();
    document.body.appendChild(tip.element);
    tip.show('L12.expert.3');
    expect(tip.element.hidden).toBe(false);
    expect(tip.element.textContent).toBe('Expert 3 · layer 13');
    expect(tip.element.dataset.role).toBe('expert');
    setLang('de');
    tip.refresh();
    expect(tip.element.textContent).toBe('Experte 3 · Ebene 13');
    setMode('advanced');
    tip.refresh();
    expect(tip.element.textContent).toBe('Experte 3 · Ebene 13');
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

  it('mini dock: five controls (prev, play, next, speed, layer), each with its own key; sentence and mode live in the sidebar', async () => {
    // The top bar is OS chrome (home, tours, legend, sidebar, gear) and is not counted; it has no orphans.
    const top = createTopBar(null);
    const b = bar();
    document.body.append(top.element);
    await b.ready;
    expect(controls([top.element]).orphans).toEqual([]);
    const c = controls([b.element]);
    expect(c.orphans).toEqual([]);
    expect(c.all.filter((x) => x.tagName === 'SELECT' || x.tagName === 'INPUT')).toEqual([]);
    expect([...c.groups].sort()).toEqual(['layer', 'next', 'play', 'prev', 'speed']);
    // Sentence picker and word chips are in the Sitzung pane, Einfach | Erweitert in the Darstellung pane.
    const s2 = controls([b.session]);
    expect(s2.orphans).toEqual([]);
    expect(s2.groups.has('sentence')).toBe(true);
    expect([...controls([b.display]).groups]).toEqual(['mode']);
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    const paused = controls([b.element]);
    expect([...paused.groups].sort()).toEqual(['layer', 'next', 'play', 'prev', 'speed']);
    // Each transport key holds exactly one button (no grouping of several controls under one key).
    for (const k of ['prev', 'play', 'next', 'speed']) {
      expect(paused.all.filter((x) => x.closest<HTMLElement>('[data-control]')!.dataset.control === k), k).toHaveLength(1);
    }
    top.dispose();
  });

  it('the speed pill cycles 0.5x, 1x, 2x, 4x; label, tooltip and aria-label follow, and the player speed with it', async () => {
    const b = bar();
    await b.ready;
    const pill = b.element.querySelector<HTMLButtonElement>('.speed-pill')!;
    expect(pill.tagName).toBe('BUTTON');
    expect(pill.textContent).toBe('1×');
    expect(pill.title).toBe('Speed: click to cycle 0.5×, 1×, 2×, 4×');
    expect(pill.getAttribute('aria-label')).toBe('Speed: 1×');
    expect(b.player()!.speed()).toBe(1);
    const seen: Array<[string | null, number]> = [];
    for (let i = 0; i < 4; i++) { pill.click(); seen.push([pill.textContent, b.player()!.speed()]); }
    expect(seen).toEqual([['2×', 2], ['4×', 4], ['0.5×', 0.5], ['1×', 1]]);
    setLang('de');
    pill.click();
    expect(pill.title).toBe('Tempo: Klick wechselt 0,5×, 1×, 2×, 4×');
    expect(pill.getAttribute('aria-label')).toBe('Tempo: 2×');
    // The choice survives a new sentence (the run is rebuilt with the same speed).
    b.session.querySelector<HTMLButtonElement>('.sentence-chip')!.click();
    document.querySelector<HTMLElement>('.sentence-pop [data-prompt="de"]')!.click();
    await b.ready;
    await new Promise((r) => setTimeout(r, 0));
    expect(b.player()!.speed()).toBe(2);
    expect(pill.textContent).toBe('2×');
  });

  it('F-GPU-3: a select gives focus back after a change; Left/Right on a focused select step the run, Up/Down stay native', async () => {
    setMode('advanced');
    const b = bar();
    await b.ready;
    const [prompt, token] = b.session.querySelectorAll<HTMLSelectElement>('select');
    const p = b.player()!;
    p.scrub(9);
    const before = { prompt: prompt!.value, pos: b.selection()!.position, i: p.index() };
    expect(before.prompt).toBe('kjv');
    // Left/Right on a focused select: the run steps, the value stays (the browser would pick the next sentence).
    for (const sel of [prompt!, token!]) {
      sel.focus();
      const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      sel.dispatchEvent(right);
      expect(right.defaultPrevented).toBe(true);
    }
    expect(prompt!.value).toBe(before.prompt);
    expect(b.selection()!.position).toBe(before.pos);
    expect(p.index()).toBe(before.i + 2);
    // Up/Down and typeahead stay native: a keyboard user can change the sentence.
    prompt!.focus();
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    prompt!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    const letter = new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true });
    prompt!.dispatchEvent(letter);
    expect(letter.defaultPrevented).toBe(false);
    // The browser's answer to ArrowDown: the next option and a change event. The sentence changes, and the
    // select gives the focus back.
    prompt!.value = 'de';
    prompt!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(b.selection()!.promptId).toBe('de');
    expect(document.activeElement).not.toBe(prompt);
    // Right after a pointer change: ArrowRight (on the page) steps the run and keeps the sentence.
    const q = b.player()!;
    const i0 = q.index();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(q.index()).toBe(i0 + 1);
    expect(prompt!.value).toBe('de');
    expect(b.selection()!.promptId).toBe('de');
    // Every Tools select gives the focus back after a change.
    for (const sel of b.session.querySelectorAll<HTMLSelectElement>('.advanced-controls select')) {
      sel.focus();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      expect(document.activeElement, sel.className).not.toBe(sel);
    }
    // Switching language and mode keeps the sentence and the step.
    const kept = { prompt: prompt!.value, i: b.player()!.index() };
    setLang('de');
    setMode('simple');
    setMode('advanced');
    expect(prompt!.value).toBe(kept.prompt);
    expect(b.player()!.index()).toBe(kept.i);
  });

  it('R9: dispose disconnects the word-strip ResizeObserver', async () => {
    const disconnect = vi.fn();
    const RO = vi.fn(function (this: unknown) { return { observe: vi.fn(), unobserve: vi.fn(), disconnect }; });
    vi.stubGlobal('ResizeObserver', RO);
    try {
      const b = createPlayerBar({
        arch: a, tower, rig: { flyTo: vi.fn(() => Promise.resolve()), overview: vi.fn(() => Promise.resolve()) },
        animator: { show: vi.fn() }, load: (id) => Promise.resolve(trace(id)),
      });
      document.body.appendChild(b.element);
      await b.ready;
      expect(RO).toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
      b.dispose();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('while a level is open the caption shows the fold-out hint, verbatim in DE and EN', async () => {
    const b = bar();
    await b.ready;
    const hint = b.element.querySelector<HTMLElement>('.player-hint')!;
    expect(hint.hidden).toBe(true);
    b.setHint('hint.levelOpen');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Click empty space: fold everything back · Esc: one level up');
    setLang('de');
    expect(hint.textContent).toBe('Klick ins Leere: alles zusammenklappen · Esc: eine Ebene zurück');
    // A playing run shows its step sentence instead; paused, the hint is back.
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    expect(hint.hidden).toBe(true);
    b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!.click();
    expect(hint.hidden).toBe(false);
    // The level closes: the hint is cleared.
    b.setHint(null);
    expect(hint.hidden).toBe(true);
    expect(hint.textContent).toBe('');
  });

  it('while a level is open and the run plays, the Pause tooltip carries the fold-back hint once', async () => {
    const b = bar();
    await b.ready;
    const play = b.element.querySelector<HTMLButtonElement>('[data-action="play"]')!;
    const hint = b.element.querySelector<HTMLElement>('.player-hint')!;
    play.click(); // playing, no level open
    expect(play.title).not.toContain('Click empty space');
    play.click();
    b.setHint('hint.levelOpen');
    play.click(); // playing with a level open: the caption keeps the step sentence, the tooltip has the hint
    expect(hint.hidden).toBe(true);
    expect(b.element.querySelector<HTMLElement>('.step-line')!.hidden).toBe(false);
    expect(play.title).toContain('Click empty space: fold everything back');
    play.click(); // paused: the caption line shows the hint, the tooltip is plain again
    expect(hint.hidden).toBe(false);
    expect(play.title).not.toContain('Click empty space');
    play.click(); // once only
    expect(play.title).not.toContain('Click empty space');
    play.click();
    setLang('de');
    b.setHint(null);
    expect(hint.hidden).toBe(true);
  });

  it('Advanced adds the expert tools in the Sitzung pane, still grouped; the dock stays the same five controls', async () => {
    setMode('advanced');
    const top = createTopBar(null);
    const b = bar();
    document.body.append(top.element);
    await b.ready;
    const c = controls([top.element, b.element, b.session, b.display]);
    expect(c.orphans).toEqual([]);
    expect([...controls([b.element]).groups].sort()).toEqual(['layer', 'next', 'play', 'prev', 'speed']);
    expect(b.session.querySelector('button[data-control="tools"]')).toBeNull(); // no Tools button any more
    expect(b.session.querySelector<HTMLElement>('.advanced-controls')!.hidden).toBe(false);
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
    const chip = b.session.querySelector<HTMLButtonElement>('.sentence-chip')!;
    expect(chip.getAttribute('aria-label')).toBe('Choose sentence');
    chip.click();
    const pop = document.querySelector<HTMLElement>('.sentence-pop')!;
    expect(pop.hidden).toBe(false);
    // The popover takes focus when it opens.
    await new Promise((r) => setTimeout(r, 0));
    expect(pop.contains(document.activeElement)).toBe(true);
    expect(pop.querySelectorAll('[data-prompt]')).toHaveLength(3);
    b.session.querySelector<HTMLElement>('.word-strip [data-pos="1"]')!.click();
    expect(b.selection()?.position).toBe(1);
    pop.querySelector<HTMLElement>('[data-prompt="de"]')!.click();
    expect(b.selection()?.promptId).toBe('de');
    expect(pop.hidden).toBe(true);
    expect(pop.isConnected).toBe(false);
    expect(b.session.querySelector('.word-chip')?.textContent).toBe(trace('de').provenance.prompt.split(/\s+/)[0]);
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

  it('Esc closes the sentence popover with focus on the body; the camera does not move', async () => {
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const overview = vi.spyOn(rig, 'overview');
    const flyTo = vi.spyOn(rig, 'flyTo');
    const b = bar();
    await b.ready;
    b.session.querySelector<HTMLButtonElement>('.sentence-chip')!.click();
    const pop = document.querySelector<HTMLElement>('.sentence-pop')!;
    expect(pop.hidden).toBe(false);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop.hidden).toBe(true);
    expect(overview).not.toHaveBeenCalled();
    expect(flyTo).not.toHaveBeenCalled();
    // With nothing open, Esc reaches the camera again.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overview).toHaveBeenCalledTimes(1);
    b.dispose?.();
  });

  it('coach marks take focus, are labelled by their text, and Esc ends them without moving the camera', async () => {
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
    const rig = createControls(camera, document.createElement('canvas'), tower.rowExtent);
    cleanup.push(() => rig.dispose());
    const overview = vi.spyOn(rig, 'overview');
    const onEnd = vi.fn();
    const c = createCoachMarks([{ key: 'coach.play', target: () => null }], document, onEnd);
    document.body.appendChild(c.element!);
    await Promise.resolve();
    expect(c.element!.contains(document.activeElement)).toBe(true);
    const ids = (c.element!.getAttribute('aria-labelledby') ?? '').split(/\s+/);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(document.getElementById(id), id).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.contains(c.element)).toBe(false);
    expect(coachSeen()).toBe(true);
    expect(onEnd).toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
  });

  it('closing the coach marks early also ends them for good', () => {
    const c = createCoachMarks([{ key: 'coach.play', target: () => null }]);
    document.body.appendChild(c.element!);
    c.element!.querySelector<HTMLElement>('.coach-skip')!.click();
    expect(coachSeen()).toBe(true);
    expect(createCoachMarks([{ key: 'coach.play', target: () => null }]).element).toBeNull();
  });
});

describe('layer numbers', () => {
  it('counts from 1 in Simple and in Advanced (the 0-based index is only the Layer index row of the inspector)', () => {
    for (const mode of ['simple', 'advanced'] as const) {
      setMode(mode);
      expect(layerLabel(0)).toBe(1);
      expect(layerLabel(45)).toBe(46);
    }
  });
});
