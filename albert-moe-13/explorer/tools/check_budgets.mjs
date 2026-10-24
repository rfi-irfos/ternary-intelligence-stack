// Asset budgets of the built explorer (Task 16). Run after `npm run build`: `npm run budgets`.
//   initial load : JS + CSS that index.html pulls in at start, plus architecture.json, all gzipped   <= 5 MB
//   whole dist/  : every file, raw bytes                                                               <= 40 MB
//   each .glb    : raw bytes                                                                           <= 6 MB
// The measured numbers are always printed, pass or fail. Exit code 1 on any failure.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const MB = 1024 * 1024;
export const BUDGETS = { initialGzip: 5 * MB, totalDist: 40 * MB, glb: 6 * MB };

/** Files (dist-relative, no leading slash) that index.html loads at start: scripts, module preloads, stylesheets. */
export function initialAssets(html) {
  const found = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const isLink = /^<link/i.test(tag);
    if (isLink && !/\brel\s*=\s*["']?(?:stylesheet|modulepreload)\b/i.test(tag)) continue;
    const m = tag.match(isLink ? /\bhref\s*=\s*["']([^"']+)["']/i : /\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!m) continue;
    const url = m[1];
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) continue; // external
    const path = url.replace(/[?#].*$/, '').replace(/^\.?\//, '');
    if (/\.(?:js|mjs|css)$/i.test(path)) found.add(path);
  }
  return [...found].sort();
}

/**
 * Pure verdict. `initial` = gzip bytes of the initial JS+CSS+architecture.json, `total` = raw bytes of dist/,
 * `glbs` = [{ path, bytes }]. Returns the lines to print and whether every budget holds.
 */
export function evaluate({ initial, total, glbs }, budgets = BUDGETS) {
  const checks = [
    { name: 'initial JS+CSS+architecture.json (gzip)', value: initial, limit: budgets.initialGzip },
    { name: 'dist/ total', value: total, limit: budgets.totalDist },
    ...glbs.map((g) => ({ name: `glb ${g.path}`, value: g.bytes, limit: budgets.glb })),
  ].map((c) => ({ ...c, ok: c.value <= c.limit }));
  return { checks, ok: checks.every((c) => c.ok) };
}

const fmt = (n) => (n >= MB ? `${(n / MB).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export function report(result) {
  return result.checks
    .map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${fmt(c.value)} (limit ${fmt(c.limit)})`)
    .concat(result.ok ? 'budgets: PASS' : 'budgets: FAIL')
    .join('\n');
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** Measures a built dist/ directory. */
export function measure(dist) {
  const files = walk(dist);
  const total = files.reduce((s, f) => s + statSync(f).size, 0);
  const glbs = files.filter((f) => f.endsWith('.glb')).map((f) => ({ path: relative(dist, f), bytes: statSync(f).size }));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initialFiles = initialAssets(html);
  const arch = join(dist, 'data', 'architecture.json');
  if (existsSync(arch)) initialFiles.push('data/architecture.json');
  const initial = initialFiles.reduce((s, f) => s + gzipSync(readFileSync(join(dist, f)), { level: 9 }).length, 0);
  return { initial, total, glbs, initialFiles };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2] ?? 'dist';
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`budgets: ${dist}/index.html not found. Run "npm run build" first.`);
    process.exit(2);
  }
  const m = measure(dist);
  console.log(`initial files: ${m.initialFiles.join(', ')}`);
  const result = evaluate(m);
  console.log(report(result));
  process.exit(result.ok ? 0 : 1);
}
