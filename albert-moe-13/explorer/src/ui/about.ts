import type { Architecture } from '../data/architecture';
import { ABOUT, type AboutRecord } from '../data/about';
import { decText, numText } from '../data/labeled';
import { NOTES } from '../content/notes';
import { ICONS } from './icons';
import { getLang, lt, onPrefsChange, t } from './prefs';
import { richT } from './richText';
import type { Lang, StringKey } from './strings';

/** ISO date as people read it: 23.09.2026 in German, 2026-09-23 in English. */
export const dateText = (iso: string, lang: Lang): string => {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!d) return iso;
  return lang === 'de' ? `${d[3]}.${d[2]}.${d[1]}` : `${d[1]}-${d[2]}-${d[3]}`;
};

/**
 * The structure numbers of the About (placeholders -> values), all from architecture.json; the second
 * map holds the texts (formatted values, router word, short SHA).
 */
export function aboutNumbers(arch: Architecture, rec: AboutRecord = ABOUT): Record<string, number> {
  const m = arch.model;
  return {
    layers: m.num_layers, streams: m.num_streams, experts: m.num_experts, topk: m.top_k, gates: m.fusion_layers.length, params: m.params,
    hidden: m.hidden, heads: m.num_heads, ffn: m.ffn_inner, vocab: m.vocab, tensors: arch.checkpoint.tensor_count, context: rec.context,
  };
}

export function aboutTexts(arch: Architecture, rec: AboutRecord, lang: Lang): Record<string, string> {
  const s = rec.surgeries;
  return {
    router: t('role.router'),
    size: decText(arch.checkpoint.bytes / 1e9, 2, lang),
    sha: arch.checkpoint.sha256.slice(0, 7),
    depth: numText(s.depth, lang),
    cord: numText(s.cord, lang),
    from: numText(s.from_layers, lang),
    to: numText(s.to_layers, lang),
    prev: numText(s.last.from_layers, lang),
    date: dateText(s.last.date, lang),
    epoch: numText(rec.training.epoch, lang),
    lossAvg: decText(rec.training.loss_avg, 4, lang),
    lossBest: decText(rec.training.loss_best, 4, lang),
    logDate: dateText(rec.training.log_date, lang),
  };
}

export interface About {
  element: HTMLElement;
  isOpen(): boolean;
  /** Opens the dialog; Esc or Close puts the focus back on `trigger`. */
  open(trigger: HTMLElement): void;
  close(): void;
  paint(): void;
  dispose(): void;
}

export interface AboutDeps {
  arch: Architecture;
  record?: AboutRecord;
  /** The elements behind the dialog; they are inert while it is open. */
  background: () => HTMLElement[];
  doc?: Document;
}

/**
 * The About: a scrollable, focus-trapped dialog opened from the lobby. Blocks: what albert. is, built in
 * house, the numbers, why ternary, how it grew (recorded), the last recorded training state, how to
 * explore, what is real, links. Every number comes from architecture.json or the project record.
 */
export function createAbout(deps: AboutDeps): About {
  const doc = deps.doc ?? document;
  const rec = deps.record ?? ABOUT;
  const { arch } = deps;
  const box = doc.createElement('div');
  box.className = 'lobby-about';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'lobby-about-heading');
  box.hidden = true;
  box.tabIndex = -1;
  const head = doc.createElement('header');
  const h = doc.createElement('h3');
  h.id = 'lobby-about-heading';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'hud-icon lobby-about-close';
  close.innerHTML = ICONS.close;
  head.append(h, close);
  const body = doc.createElement('div');
  body.className = 'about-body';
  box.append(head, body);

  let trigger: HTMLElement | null = null;
  let hidden: HTMLElement[] = [];

  const section = (cls: string, titleKey: StringKey): { sec: HTMLElement; add(...n: Array<HTMLElement>): void } => {
    const sec = doc.createElement('section');
    sec.className = `about-sec ${cls}`;
    const hh = doc.createElement('h4');
    hh.textContent = t(titleKey);
    sec.append(hh);
    return { sec, add: (...n) => sec.append(...n) };
  };
  const para = (cls: string, html: string): HTMLElement => {
    const p = doc.createElement('p');
    p.className = cls;
    p.innerHTML = html;
    return p;
  };
  const tag = (): HTMLElement => {
    const s = doc.createElement('span');
    s.className = 'kind-tag';
    s.dataset.kind = 'recorded';
    s.textContent = t('about.growthTag');
    return s;
  };
  const link = (href: string, key: StringKey): HTMLElement => {
    const li = doc.createElement('li');
    const a = doc.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = t(key);
    li.append(a);
    return li;
  };

  const paint = (): void => {
    const lang = getLang();
    const nums = aboutNumbers(arch, rec);
    const txt = aboutTexts(arch, rec, lang);
    box.setAttribute('aria-label', t('about.heading'));
    h.textContent = t('about.heading');
    close.setAttribute('aria-label', t('about.close'));
    close.title = t('about.close');
    const secs: HTMLElement[] = [];

    const what = section('about-what', 'about.whatTitle');
    what.add(para('about-text', richT('about.what', {})));
    secs.push(what.sec);

    const built = section('about-built', 'about.builtTitle');
    built.add(para('about-text', richT('about.built', {})));
    secs.push(built.sec);

    const nsec = section('about-numbers', 'about.numbersTitle');
    const ul = doc.createElement('ul');
    ul.className = 'about-list';
    for (const k of ['about.nLayers', 'about.nExperts', 'about.nGates', 'about.nParams', 'about.nFile'] as const) {
      const li = doc.createElement('li');
      li.innerHTML = richT(k, nums, txt);
      ul.append(li);
    }
    nsec.add(ul);
    secs.push(nsec.sec);

    const card = section('about-card', 'about.cardTitle');
    for (const k of ['about.cardArch', 'about.cardTrain', 'about.cardLimits'] as const) card.add(para('about-text', richT(k, nums, txt)));
    secs.push(card.sec);

    const why = section('about-why', 'about.whyTitle');
    why.add(para('about-text', richT('about.why', {})));
    secs.push(why.sec);

    const grow = section('about-growth', 'about.growthTitle');
    const gp = para('about-text', richT('about.growth', {}, txt));
    gp.append(' ', tag());
    grow.add(gp, para('about-src', richT('about.growthSrc', {})));
    secs.push(grow.sec);

    const st = section('about-state', 'about.stateTitle');
    const sp = para('about-text', richT('about.state', {}, { ...txt, date: txt.logDate ?? '' }));
    sp.append(' ', tag());
    st.add(sp);
    secs.push(st.sec);

    const ex = section('about-explore', 'about.exploreTitle');
    ex.add(para('about-text', richT('about.explore', nums)));
    secs.push(ex.sec);

    const real = section('about-realbox', 'about.title');
    real.add(
      para('about-real', richT('about.real', nums)),
      para('about-illustrative', richT('about.illustrative', {})),
    );
    secs.push(real.sec);

    const notes = doc.createElement('section');
    notes.className = 'about-sec about-notes';
    const nh = doc.createElement('h4');
    nh.textContent = lt(NOTES.title);
    notes.append(nh);
    for (const x of NOTES.paragraphs) {
      const p = doc.createElement('p');
      p.className = 'about-text';
      p.textContent = lt(x, { ...txt, layers: String(nums.layers) });
      notes.append(p);
    }
    const so = doc.createElement('p');
    so.className = 'about-signoff';
    so.textContent = NOTES.signoff;
    notes.append(so);
    secs.push(notes);

    const lk = section('about-links', 'about.linksTitle');
    const lul = doc.createElement('ul');
    lul.className = 'about-list about-links';
    lul.append(link(rec.links.repo, 'about.repo'), link(rec.links.huggingface, 'about.hf'));
    lk.add(lul, para('about-credits', richT('about.credits', {})));
    secs.push(lk.sec);

    body.replaceChildren(...secs);
  };

  const focusables = (): HTMLElement[] =>
    [...box.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hidden);

  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0] as HTMLElement;
    const last = f[f.length - 1] as HTMLElement;
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || active === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });

  close.addEventListener('click', () => api.close());

  const api: About = {
    element: box,
    isOpen: () => !box.hidden,
    open(from) {
      trigger = from;
      paint();
      box.hidden = false;
      box.scrollTop = 0;
      body.scrollTop = 0;
      hidden = deps.background();
      for (const x of hidden) x.setAttribute('inert', '');
      from.setAttribute('aria-expanded', 'true');
      box.focus({ preventScroll: true });
    },
    close() {
      if (box.hidden) return;
      box.hidden = true;
      for (const x of hidden) x.removeAttribute('inert');
      hidden = [];
      trigger?.setAttribute('aria-expanded', 'false');
      if (trigger?.isConnected) trigger.focus();
    },
    paint,
    dispose() {
      offPrefs();
      box.remove();
    },
  };
  const offPrefs = onPrefsChange(() => { if (!box.hidden) paint(); });
  return api;
}
