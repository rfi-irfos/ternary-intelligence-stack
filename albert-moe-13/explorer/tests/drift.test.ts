// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { ABOUT } from '../src/data/about';
import { validateArchitecture } from '../src/data/architecture';
import { CAVEATS } from '../src/content/caveats';
import { NOTES } from '../src/content/notes';
import { createSound } from '../src/audio/sound';
import { createLobby } from '../src/ui/lobby';
import { setLang, setMode } from '../src/ui/prefs';
import { STRINGS, type StringKey } from '../src/ui/strings';

/**
 * Drift guard (npm run drift). The About and the caveat texts name numbers that the data also knows
 * (layers, streams, experts, parameters, gates, depth surgeries). A number written directly before one
 * of these nouns must equal the data value; the About templates must not contain such a number at all
 * (they use placeholders). When the data changes and a text still says the old number, this test fails.
 *
 * Covers: "<number> <noun>" in EN and DE, digits (with 1,234 / 1.234 grouping) and the number words
 * two..twelve / zwei..zwölf, in the About (templates and rendered, both languages) and in all caveat
 * texts (title, body, table cells, label, evidence). It cannot cover: a number far from its noun
 * ("layer 35", "ep8938"), numbers without a noun, a wrong noun, prose that describes a number
 * ("about half"), tables of log values, and numbers in tour texts (their own tests).
 */

const a = validateArchitecture(arch);
const N = a.model;
const NOUNS: Array<{ name: string; rx: string; value: number }> = [
  { name: 'layers', rx: 'layers?|Ebenen?', value: N.num_layers },
  { name: 'streams', rx: 'streams?|Str(?:ö|oe)me?', value: N.num_streams },
  { name: 'experts', rx: '(?:shared |gemeinsame[n]? )?(?:experts?|Experten)', value: N.num_experts },
  { name: 'parameters', rx: 'parameters?|Parameter[n]?', value: N.params },
  { name: 'gates', rx: '(?:exchange |anastomosis |Austausch-)?(?:gates?|Tore?)', value: N.fusion_layers.length },
  { name: 'surgeries', rx: 'depth surgeries|Tiefen-Eingriffe[n]?', value: ABOUT.surgeries.depth },
];
const WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, 'zwölf': 12,
};
const NUM = `(\\d[\\d.,]*\\d|\\d|${Object.keys(WORDS).join('|')})`;

/** Numeric value of a written number: 331,140,622 and 331.140.622 are grouped integers; 0,5 is a decimal. */
function value(tok: string): number {
  const w = WORDS[tok.toLowerCase()];
  if (w !== undefined) return w;
  if (/^\d{1,3}([.,]\d{3})+$/.test(tok)) return Number(tok.replace(/[.,]/g, ''));
  return Number(tok.replace(',', '.'));
}

interface Finding { text: string; noun: string; found: number; expected: number }

/** Every "<number> <noun>" in `text`, with the number's value and the data value of the noun. */
function mentions(text: string): Finding[] {
  const out: Finding[] = [];
  for (const n of NOUNS) {
    const rx = new RegExp(`(?<![\\w.,])${NUM}[ \\u00a0](?:${n.rx})(?![\\wäöüß])`, 'gi');
    for (const m of text.matchAll(rx)) out.push({ text: m[0], noun: n.name, found: value(m[1]!), expected: n.value });
  }
  return out;
}

/** The mentions whose number differs from the data (`allow` lists reviewed exceptions). */
const findDrift = (text: string, allow: number[] = []): Finding[] => mentions(text).filter((f) => f.found !== f.expected && !allow.includes(f.found));

/** A template that writes a data number before a data noun (instead of a placeholder), right or wrong. */
const typedConstants = (template: string): string[] => mentions(template).map((f) => f.text);

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  document.body.innerHTML = '';
  setLang('en');
  setMode('simple');
});

const aboutKeys = (Object.keys(STRINGS.en) as StringKey[]).filter((k) => k.startsWith('about.'));
const flat = (e: unknown): string[] => (typeof e === 'string' ? [e] : [(e as { simple: string }).simple, (e as { advanced: string }).advanced]);

describe('drift guard: the checker', () => {
  it('finds a wrong number before a data noun and accepts the right one (digits, grouping, words, German)', () => {
    expect(findDrift('The model has 40 layers and 2 streams.').map((f) => f.noun)).toEqual(['layers']);
    expect(findDrift(`The model has ${N.num_layers} layers.`)).toEqual([]);
    expect(findDrift('Es gibt elf gemeinsame Experten und 331.140.621 Parameter.').map((f) => f.noun).sort()).toEqual(['experts', 'parameters']);
    expect(findDrift('Es gibt 331.140.622 Parameter in 46 Ebenen mit zwei Strömen.')).toEqual([]);
    expect(findDrift('three streams').length).toBe(1);
    expect(findDrift('38 layers', [38])).toEqual([]);
  });
  it('rejects typed constants in a template', () => {
    expect(typedConstants('46 layers per stream')).toEqual(['46 layers']);
    expect(typedConstants('47 Ebenen je Strom')).toEqual(['47 Ebenen']);
    expect(typedConstants('{layers} layers per stream')).toEqual([]);
  });
});

describe('drift guard: the About', () => {
  it('has no data number typed in any template (EN and DE); every number comes from a placeholder', () => {
    expect(aboutKeys.length).toBeGreaterThan(20);
    for (const lang of ['en', 'de'] as const) {
      for (const k of aboutKeys) {
        for (const text of flat(STRINGS[lang][k])) expect(typedConstants(text), `${lang} ${k}`).toEqual([]);
      }
    }
  });
  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: the rendered About matches the data`, () => {
      setLang(lang);
      const lobby = createLobby({ arch: a, onChoose: () => undefined, sound: createSound({ create: () => null }) });
      document.body.append(lobby.element);
      lobby.show();
      cleanup.push(() => lobby.dispose());
      lobby.element.querySelector<HTMLButtonElement>('.lobby-about-btn')!.click();
      // one line per block element, so that neighbouring list items do not run together
      const text = [...lobby.element.querySelectorAll('.lobby-about h4, .lobby-about p, .lobby-about li')].map((x) => x.textContent).join('\n');
      expect(text.length).toBeGreaterThan(800);
      expect(findDrift(text)).toEqual([]);
      // the numbers are really present (a text without them would pass the check above)
      expect(mentions(text).map((f) => f.noun)).toEqual(expect.arrayContaining(['layers', 'streams', 'experts', 'parameters', 'gates', 'surgeries']));
    });
  }
});

describe('drift guard: the notes', () => {
  it('have no data number typed before a data noun, in EN and DE', () => {
    for (const x of NOTES.paragraphs) for (const lang of ['en', 'de'] as const) expect(typedConstants(x[lang]), x[lang]).toEqual([]);
  });
});

describe('drift guard: the caveat texts', () => {
  // Reviewed exceptions: a number that names a different thing than the noun suggests.
  const ALLOW: Record<string, number[]> = {
    // A6 contrasts the config's 38 layers with the checkpoint's 46.
    A6: [38],
    // A2 "adds about half of the other at 7 layers": the 7 layers that carry a gate.
    A2: [N.fusion_layers.length],
  };
  it('every number before a data noun equals the data, apart from the reviewed exceptions', () => {
    for (const [id, c] of Object.entries(CAVEATS)) {
      for (const lang of ['en', 'de'] as const) {
        const parts = [c.title[lang], c.body[lang], c.evidence[lang], c.label?.[lang] ?? '', ...(c.table?.rows.flat() ?? [])];
        expect(findDrift(parts.join('\n'), ALLOW[id] ?? []), `${id} ${lang}`).toEqual([]);
      }
    }
  });
  it('notices drift: with the data changed, the A6 text (46 layers) fails', () => {
    const body = CAVEATS.A6.body.en;
    expect(findDrift(body, [38]).length).toBe(0);
    expect(findDrift(body.replace('46 layers', '47 layers'), [38]).map((f) => f.found)).toEqual([47]);
  });
});
