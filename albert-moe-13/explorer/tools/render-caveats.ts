// Run with Node >= 22.18 (native type stripping): node tools/render-caveats.ts
import { writeFileSync } from 'node:fs';
import { renderCaveats } from '../src/content/caveats.ts';

writeFileSync(new URL('../CAVEATS.md', import.meta.url), renderCaveats());
