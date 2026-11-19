#!/usr/bin/env node
// Generează docs/GHID-UTILIZATOR.md din același modul de conținut ca ecranul #/ghid (src/ui/guide/content.js).
// Rulare: npm run guide   (opțional: node scripts/guide-md.mjs <cale-ieșire>)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? resolve(process.argv[2]) : resolve(APP, '..', 'docs', 'GHID-UTILIZATOR.md');
const { toMarkdown, GUIDE } = await import(pathToFileURL(resolve(APP, 'src/ui/guide/content.js')).href);
mkdirSync(dirname(out), { recursive: true });
const md = toMarkdown(GUIDE);
writeFileSync(out, md);
console.log(`ghid: ${out} (${GUIDE.sections.length} capitole, ${GUIDE.sections.reduce((n, s) => n + s.cards.length, 0)} secțiuni, ${md.length} caractere)`);
