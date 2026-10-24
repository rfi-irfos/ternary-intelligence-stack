// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import arch from '../public/data/architecture.json';
import { ABOUT, type AboutRecord } from '../src/data/about';
import { type Architecture, validateArchitecture } from '../src/data/architecture';
import { decText, numText } from '../src/data/labeled';
import { createSound } from '../src/audio/sound';
import { createAbout } from '../src/ui/about';
import { NOTES } from '../src/content/notes';
import { createLobby } from '../src/ui/lobby';
import { getLang, setLang, setMode } from '../src/ui/prefs';
import { STRINGS, type StringKey } from '../src/ui/strings';

const a = validateArchitecture(arch);
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  document.body.innerHTML = '';
  document.body.className = '';
  setLang('en');
  setMode('simple');
  localStorage.clear();
});

function lobbyApp(architecture: Architecture = a) {
  const lobby = createLobby({ arch: architecture, onChoose: () => undefined, sound: createSound({ create: () => null }) });
  document.body.append(lobby.element);
  lobby.show();
  cleanup.push(() => lobby.dispose());
  const btn = lobby.element.querySelector<HTMLButtonElement>('.lobby-about-btn')!;
  const box = lobby.element.querySelector<HTMLElement>('.lobby-about')!;
  return { lobby, btn, box };
}

const BLOCKS = ['about-what', 'about-built', 'about-card', 'about-numbers', 'about-why', 'about-growth', 'about-state', 'about-explore', 'about-realbox', 'about-notes', 'about-links'];
const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

const card = readFileSync('../../MODEL_CARD.md', 'utf8');
const hf = readFileSync('../../docs/hf-model-card-draft.md', 'utf8');

describe('About: model card facts and notes', () => {
  it('the model-card block states the facts of MODEL_CARD.md, the HF draft and the data', () => {
    const m = a.model;
    const { btn, box } = lobbyApp();
    btn.click();
    const text = box.querySelector('.about-card')!.textContent!;
    // [what the About says, what MODEL_CARD.md and the HF draft say]
    const facts: Array<[string, string]> = [
      [`${numText(m.vocab)} byte-level`, `${numText(m.vocab)} tokens`],
      [`${m.hidden} → ${numText(m.ffn_inner)} → ${m.hidden}`, `${m.hidden}→${m.ffn_inner}→${m.hidden}`],
      [`context of ${ABOUT.context} tokens`, `${ABOUT.context} tokens`],
      [`${m.num_experts} experts per layer`, `Experts per layer | ${m.num_experts}`],
      [`${m.num_heads} attention heads per stream`, `${m.num_heads} heads per stream`],
      [`${numText(a.checkpoint.tensor_count)} float32 tensors`, `${a.checkpoint.tensor_count} tensors`],
    ];
    for (const [inAbout, inDocs] of facts) {
      expect(text.replace(/\s+/g, ' '), `About: ${inAbout}`).toContain(inAbout);
      expect(card, `MODEL_CARD: ${inDocs}`).toContain(inDocs);
      expect(hf, `HF draft: ${inDocs}`).toContain(inDocs);
    }
    for (const doc of [card, hf]) {
      expect(doc).toContain(numText(m.params));
      expect(doc).toContain(`${m.num_layers} per stream`);
      expect(doc).toContain(`**${m.fusion_layers.length}**`);
      expect(doc).toContain(`${ABOUT.surgeries.depth} depth`);
      expect(doc).toContain(`**${ABOUT.training.epoch}**`);
      expect(doc).toContain(`**${ABOUT.training.loss_avg}**`);
    }
    const num = box.querySelector('.about-numbers')!.textContent!;
    expect(num).toContain(numText(m.params));
    expect(text).toContain('AdamW');
    expect(text.toLowerCase()).toContain('pending');
  });

  it('the notes come from src/content/notes.ts in both languages, signed RFI-IRFOS only', () => {
    for (const lang of ['en', 'de'] as const) {
      setLang(lang);
      const { btn, box } = lobbyApp();
      btn.click();
      const sec = box.querySelector('.about-notes')!;
      expect(sec.querySelector('h4')!.textContent).toBe(NOTES.title[lang]);
      expect(sec.querySelectorAll('p.about-text').length).toBe(NOTES.paragraphs.length);
      expect(sec.querySelector('.about-signoff')!.textContent).toBe('RFI-IRFOS');
      expect(sec.textContent).not.toMatch(/\{\w+\}/);
      expect(sec.textContent).toContain(String(ABOUT.surgeries.depth));
    }
  });

  it('notes.ts carries no draft marks and no typed numbers (placeholders only)', () => {
    const src = readFileSync('src/content/notes.ts', 'utf8');
    expect(src).not.toContain('DRAFT');
    const body = src.slice(src.indexOf('export const NOTES'));
    expect(body).not.toMatch(/\b\d{2,}\b/);
  });
});

describe('About dialog', () => {
  it('opens from the footer button, is a labelled modal dialog, and the background is inert', () => {
    const { lobby, btn, box } = lobbyApp();
    expect(box.hidden).toBe(true);
    btn.click();
    expect(lobby.aboutOpen()).toBe(true);
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent).toBe('About albert.');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(lobby.element.querySelector('.lobby-inner')!.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it('Esc closes it and the focus returns to the button; so does the Close button', () => {
    const { lobby, btn, box } = lobbyApp();
    btn.click();
    box.dispatchEvent(esc());
    expect(lobby.aboutOpen()).toBe(false);
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(lobby.element.querySelector('.lobby-inner')!.hasAttribute('inert')).toBe(false);
    btn.click();
    box.querySelector<HTMLButtonElement>('.lobby-about-close')!.click();
    expect(lobby.aboutOpen()).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('Tab stays inside: from the last control it wraps to the first, Shift+Tab from the dialog to the last', () => {
    const { btn, box } = lobbyApp();
    btn.click();
    const f = [...box.querySelectorAll<HTMLElement>('button, a[href]')];
    expect(f.length).toBeGreaterThanOrEqual(3);
    f[f.length - 1]!.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    f[f.length - 1]!.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(f[0]);
    box.focus();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(f[f.length - 1]);
  });

  it('leaving the lobby closes it', () => {
    const { lobby, btn } = lobbyApp();
    btn.click();
    lobby.hide();
    expect(lobby.aboutOpen()).toBe(false);
  });

  for (const lang of ['en', 'de'] as const) {
    it(`${lang}: every block is present, filled and free of raw placeholders`, () => {
      setLang(lang);
      const { btn, box } = lobbyApp();
      btn.click();
      for (const b of BLOCKS) {
        const sec = box.querySelector(`.${b}`);
        expect(sec, b).not.toBeNull();
        expect(sec!.querySelector('h4')!.textContent!.length, b).toBeGreaterThan(3);
        expect(sec!.textContent!.length, b).toBeGreaterThan(40);
      }
      expect(box.textContent).not.toMatch(/\{\w+\}/);
      expect(box.querySelector('.about-realbox h4')!.textContent).toBe(lang === 'de' ? 'Was ist hier echt?' : 'What is real here?');
      expect(box.querySelector('.about-credits')!.textContent).toContain('RFI-IRFOS');
    });
  }

  it('the numbers follow the data, not constants: another architecture changes the text', () => {
    const other = { ...a, model: { ...a.model, params: 1234567, num_experts: 7, top_k: 2, num_streams: 3 } } as Architecture;
    const { btn, box } = lobbyApp(other);
    btn.click();
    const num = box.querySelector('.about-numbers')!;
    expect(num.textContent).toContain(`${numText(46)} layers per stream, 3 streams`);
    expect(num.textContent).toContain('7 shared experts per layer');
    expect(num.textContent).toContain('picks 2 of them');
    expect(num.textContent).toContain('1,234,567 parameters');
    expect(num.querySelector('[data-v="gates"]')!.textContent).toBe(String(a.model.fusion_layers.length));
    expect(num.textContent).toContain(`${decText(a.checkpoint.bytes / 1e9, 2, 'en')} GB`);
    expect(num.textContent).toContain(a.checkpoint.sha256.slice(0, 7));
  });

  it('the project record is shown from data: another record changes growth and training state', () => {
    const rec: AboutRecord = {
      ...ABOUT,
      training: { ...ABOUT.training, epoch: 4242, loss_avg: 1.5, loss_best: 1.25, log_date: '2027-01-02' },
      surgeries: { ...ABOUT.surgeries, depth: 9, last: { id: 'S9', from_layers: 6, to_layers: 7, date: '2027-01-03' } },
    };
    const root = document.createElement('div');
    document.body.append(root);
    const dlg = createAbout({ arch: a, record: rec, background: () => [] });
    root.append(dlg.element);
    cleanup.push(() => dlg.dispose());
    const trigger = document.createElement('button');
    root.append(trigger);
    dlg.open(trigger);
    const state = dlg.element.querySelector('.about-state')!.textContent!;
    expect(state).toContain('Epoch 4,242');
    expect(state).toContain('loss_avg 1.5000');
    expect(state).toContain('loss_best 1.2500');
    expect(state).toContain('2027-01-02');
    const growth = dlg.element.querySelector('.about-growth')!.textContent!;
    expect(growth).toContain('9 depth surgeries');
    expect(growth).toContain('from 6 to');
    expect(growth).toContain('2027-01-03');
    expect(dlg.element.querySelector('.about-growth .kind-tag')!.textContent).toBe('recorded');
    expect(dlg.element.querySelector('.about-state .kind-tag')!.textContent).toBe('recorded');
  });

  it('shows the recorded training state of the docs (epoch, loss_avg, loss_best) in both languages', () => {
    const { btn, box } = lobbyApp();
    btn.click();
    expect(box.querySelector('.about-state')!.textContent).toContain(`Epoch ${numText(ABOUT.training.epoch, 'en')}, loss_avg ${decText(ABOUT.training.loss_avg, 4, 'en')}`);
    setLang('de');
    btn.click();
    btn.click();
    const de = box.querySelector('.about-state')!.textContent!;
    expect(de).toContain(`Epoche ${numText(ABOUT.training.epoch, 'de')}`);
    expect(de).toContain(decText(ABOUT.training.loss_best, 4, 'de'));
    expect(getLang()).toBe('de');
  });

  it('the links are the strings of the repo docs; no time-bound wording sits in the texts', () => {
    const { btn, box } = lobbyApp();
    btn.click();
    const hrefs = [...box.querySelectorAll<HTMLAnchorElement>('a[href]')].map((x) => x.getAttribute('href'));
    expect(hrefs).toEqual([ABOUT.links.repo, ABOUT.links.huggingface]);
    const readme = readFileSync('../../README.md', 'utf8');
    for (const h of hrefs) expect(readme, h!).toContain(h!);
    for (const x of box.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      expect(x.rel).toContain('noopener');
      expect(x.target).toBe('_blank');
    }
    const keys = (Object.keys(STRINGS.en) as StringKey[]).filter((k) => k.startsWith('about.'));
    expect(keys.length).toBeGreaterThan(20);
    for (const lang of ['en', 'de'] as const) {
      for (const k of keys) {
        const e = STRINGS[lang][k];
        const text = typeof e === 'string' ? e : `${e.simple} ${e.advanced}`;
        expect(text, `${lang} ${k}`).not.toMatch(/paused|pausiert|training now|trainiert gerade|answers? your|beantwortet/i);
      }
    }
  });

  it('German About texts have no negation words and no English giveaways', () => {
    const negations = [/\bnicht/i, /\bnichts\b/i, /\bkein/i, /\bohne\b/i, /\bnie\b/i, /\bniemals\b/i, /\bweder\b/i];
    const giveaways = [' the ', ' and ', ' of ', 'which', 'each', 'stream '];
    const keys = (Object.keys(STRINGS.de) as StringKey[]).filter((k) => k.startsWith('about.') || k === 'lobby.about');
    for (const k of keys) {
      const e = STRINGS.de[k];
      const de = ` ${(typeof e === 'string' ? e : `${e.simple} ${e.advanced}`).toLowerCase()} `;
      for (const n of negations) expect(n.test(de), `${k} ${n}`).toBe(false);
      for (const g of giveaways) expect(de.includes(g), `${k} "${g}"`).toBe(false);
    }
    setLang('de');
    const { btn, box } = lobbyApp();
    btn.click();
    expect(box.textContent!.toLowerCase()).not.toContain('checkpoint');
  });

  it('the router word follows the mode (Weiche in Simple, Router in Advanced)', () => {
    setLang('de');
    const { btn, box } = lobbyApp();
    btn.click();
    const simple = box.querySelector('.about-numbers')!.textContent!;
    setMode('advanced');
    btn.click();
    btn.click();
    const adv = box.querySelector('.about-numbers')!.textContent!;
    expect(simple).toContain('Weiche');
    expect(adv).toContain('Router');
  });
});
