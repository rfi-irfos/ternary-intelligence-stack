import type { Architecture } from '../data/architecture';
import { APP_NAME } from '../content/brand';
import { CAVEATS, CAVEAT_IDS } from '../content/caveats';
import { DEFAULT_SITE_URL, fallbackMeta } from '../site/seo';
import { type Lang, LANGS, type StringKey, tr } from '../ui/strings';

/**
 * The page shown when the browser has no WebGL 2 (spec §8): the architecture and the caveats as plain
 * HTML tables, built at build time from public/data/architecture.json and src/content/caveats.ts (the
 * source of CAVEATS.md; a test keeps the .md in step). Both languages are in the page; a few lines of
 * script pick one (the saved choice, else the browser language) and the DE | EN buttons switch it.
 * No WebGL, no framework and no network request: it works as one file.
 */

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LOCALE: Record<Lang, string> = { en: 'en-US', de: 'de-DE' };
const int = (n: number, lang: Lang): string => n.toLocaleString(LOCALE[lang]);
const num = (n: number, lang: Lang): string => {
  const s = String(+n.toPrecision(4));
  return lang === 'de' ? s.replace('.', ',') : s;
};
const shapeText = (shape: number[]): string => `[${shape.join(' × ')}]`;

const th = (s: string, scope: 'col' | 'row' = 'col'): string => `<th scope="${scope}">${esc(s)}</th>`;
const td = (s: string, cls = ''): string => `<td${cls ? ` class="${cls}"` : ''}>${esc(s)}</td>`;

function modelTable(a: Architecture, lang: Lang): string {
  const T = (k: StringKey): string => tr(k, lang, 'advanced');
  const m = a.model;
  const rows: Array<[string, string]> = [
    [T('fallback.m.num_layers'), int(m.num_layers, lang)],
    [T('fallback.m.num_streams'), int(m.num_streams, lang)],
    [T('fallback.m.num_experts'), int(m.num_experts, lang)],
    [T('fallback.m.top_k'), int(m.top_k, lang)],
    [T('fallback.m.hidden'), int(m.hidden, lang)],
    [T('fallback.m.ffn_inner'), int(m.ffn_inner, lang)],
    [T('fallback.m.num_heads'), int(m.num_heads, lang)],
    [T('fallback.m.head_dim'), int(m.head_dim, lang)],
    [T('fallback.m.vocab'), int(m.vocab, lang)],
    [T('fallback.m.params'), int(m.params, lang)],
    [T('fallback.m.tau_top'), num(m.tau_top, lang)],
    [T('fallback.m.fusion'), m.fusion_layers.join(', ')],
    [T('fallback.m.file'), a.checkpoint.file],
    [T('fallback.m.bytes'), int(a.checkpoint.bytes, lang)],
    [T('fallback.m.sha'), a.checkpoint.sha256],
    [T('fallback.m.tensors'), int(a.checkpoint.tensor_count, lang)],
  ];
  return `<table><caption>${esc(T('fallback.modelCap'))}</caption><thead><tr>${th(T('fallback.name'))}${th(T('fallback.value'))}</tr></thead><tbody>${
    rows.map(([k, v]) => `<tr>${th(k, 'row')}${td(v, 'mono')}</tr>`).join('')}</tbody></table>`;
}

function layersTable(a: Architecture, lang: Lang): string {
  const T = (k: StringKey): string => tr(k, lang, 'advanced');
  const rows = a.layers.map((l) =>
    `<tr>${th(String(l.index + 1), 'row')}${td(String(l.index))}${td(l.fusion ? T('fallback.yes') : T('fallback.no'))}${td(num(l.tau, lang))}</tr>`);
  return `<table><caption>${esc(T('fallback.layersCap'))}</caption><thead><tr>${th(T('fallback.layerNo'))}${th(T('fallback.index'))}${th(T('fallback.gate'))}${th('tau')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function componentTables(a: Architecture, lang: Lang): string {
  const T = (k: StringKey): string => tr(k, lang, 'advanced');
  const out = [`<p>${esc(T('fallback.componentsCap'))}</p>`];
  for (const [name, c] of Object.entries(a.components)) {
    const cap = `${name}: ${T('fallback.instances')} ${int(c.instances, lang)}, ${T('fallback.paramsEach')} ${int(c.params_per_instance, lang)}`;
    const rows = c.tensors.map((x) =>
      `<tr>${th(x.pattern, 'row')}${td(shapeText(x.shape), 'mono')}${td(x.dtype)}${td(x.ternary ? T('fallback.yes') : T('fallback.no'))}</tr>`);
    out.push(`<table><caption>${esc(cap)}</caption><thead><tr>${th(T('fallback.tensor'))}${th(T('fallback.shape'))}${th(T('fallback.dtype'))}${th(T('fallback.ternary'))}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
  }
  return out.join('');
}

function caveatBlocks(lang: Lang): string {
  const T = (k: StringKey): string => tr(k, lang, 'advanced');
  return CAVEAT_IDS.map((id) => {
    const c = CAVEATS[id];
    const table = c.table
      ? `<table><thead><tr>${c.table.head.map((h) => th(h[lang])).join('')}</tr></thead><tbody>${
        c.table.rows.map((r) => `<tr>${r.map((cell, i) => (i === 0 ? th(cell, 'row') : td(cell, 'mono'))).join('')}</tr>`).join('')}</tbody></table>`
      : '';
    return `<article class="caveat"><h3>${esc(id)}. ${esc(c.title[lang])}</h3><p>${esc(c.body[lang])}</p>${table}${
      c.label ? `<p class="tag">${esc(c.label[lang])}</p>` : ''}<p class="evidence">${esc(T('fallback.evidence'))}: ${esc(c.evidence[lang])}</p></article>`;
  }).join('');
}

function section(a: Architecture, lang: Lang, base: string): string {
  const T = (k: StringKey): string => tr(k, lang, 'advanced');
  return `<div data-l="${lang}" lang="${lang}">
<h1>${esc(APP_NAME)} – ${esc(T('fallback.title'))}</h1>
<p>${esc(T('fallback.intro'))}</p>
<p><a href="${esc(base)}">${esc(T('fallback.retry'))}</a></p>
<h2>${esc(T('fallback.model'))}</h2>
${modelTable(a, lang)}
<h2>${esc(T('fallback.layers'))}</h2>
${layersTable(a, lang)}
<h2>${esc(T('fallback.components'))}</h2>
${componentTables(a, lang)}
<h2>${esc(T('fallback.caveats'))}</h2>
${caveatBlocks(lang)}
</div>`;
}

const STYLE = `
html { background: #000; color: #e8eefc; font: 400 16px/1.5 Inter, system-ui, sans-serif; }
body { margin: 0 auto; max-width: 960px; padding: 24px 16px 64px; }
h1 { font: 700 28px/1.2 "Space Grotesk", Inter, system-ui, sans-serif; margin: 0 0 12px; }
h2 { font: 600 22px/1.3 "Space Grotesk", Inter, system-ui, sans-serif; margin: 36px 0 8px; }
h3 { font: 600 17px/1.3 "Space Grotesk", Inter, system-ui, sans-serif; margin: 20px 0 6px; }
a { color: #22d3ee; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 20px; font-size: 14px; }
caption { text-align: left; padding: 4px 0 6px; color: #e8eefc; font-weight: 600; }
th, td { text-align: left; padding: 5px 10px; border: 1px solid #34457a; vertical-align: top; }
thead th { background: #141e3c; }
tbody th { font-weight: 500; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.caveat { border-top: 1px solid #34457a; padding-top: 4px; }
.evidence, .tag { font-size: 14px; }
.lang-switch { display: flex; gap: 8px; justify-content: flex-end; }
.lang-switch button { font: inherit; color: #e8eefc; background: #141e3c; border: 1px solid #34457a; border-radius: 8px; padding: 4px 12px; cursor: pointer; }
.lang-switch button[aria-pressed="true"] { border-color: #22d3ee; }
:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
html:not([lang="de"]) [data-l="de"], html[lang="de"] [data-l="en"] { display: none; }
`;

const SCRIPT = `
(function () {
  var d = document.documentElement, l = null;
  try { l = localStorage.getItem('albert.lang'); } catch (e) {}
  if (l !== 'de' && l !== 'en') l = (navigator.language || '').toLowerCase().indexOf('de') === 0 ? 'de' : 'en';
  function set(v) {
    d.lang = v;
    var b = document.querySelectorAll('.lang-switch button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(b[i].getAttribute('data-set') === v));
  }
  set(l);
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-set]') : null;
    if (!t) return;
    var v = t.getAttribute('data-set');
    try { localStorage.setItem('albert.lang', v); } catch (e2) {}
    set(v);
  });
})();
`;

/** The whole fallback page as one HTML document. `base` is the address of the app (the retry link). */
export function renderFallbackPage(a: Architecture, base = './', site = DEFAULT_SITE_URL): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(APP_NAME)} – ${esc(tr('fallback.title', 'en', 'advanced'))}</title>
${fallbackMeta(a, site)}
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<style>${STYLE}</style>
</head>
<body>
<div class="lang-switch" role="group" aria-label="DE | EN">${LANGS.map((l) => `<button type="button" data-set="${l}" lang="${l}" aria-pressed="false">${l.toUpperCase()}</button>`).join('')}</div>
<main>
${LANGS.map((l) => section(a, l, base)).join('\n')}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
