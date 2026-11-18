#!/usr/bin/env node
// Rulează toate testele unitare cu `node --test` (zero dependențe): tests/unit/**, tests/export/*, src/**/*.test.*, src/**/_tests/*.test.*
// Argumente fără `--` = filtre de cale (substring). `--fixtures` regenerează fixture-urile înainte.
import { spawnSync } from 'node:child_process';
import { listFiles, APP_ROOT, rel } from './lib/scan.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));
const re = /\.test\.m?js$/;
const SKIP = /(^|[\\/])(node_modules|dist|dist-dev|e2e|fixtures[\\/]mini-app)([\\/]|$)/;
let files = [
  ...listFiles(join(APP_ROOT, 'tests', 'unit'), re, SKIP), ...listFiles(join(APP_ROOT, 'tests', 'export'), re, SKIP),
  ...listFiles(join(APP_ROOT, 'src'), re, SKIP),
];
files = [...new Set(files)];
if (filters.length) files = files.filter((f) => filters.some((x) => rel(f).includes(x)));
if (!files.length) { console.error('niciun fișier de test găsit'); process.exit(1); }
if (args.includes('--fixtures')) {
  const r = spawnSync(process.execPath, [join(APP_ROOT, 'scripts', 'make-fixtures.mjs')], { stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}
console.log(`${files.length} fișiere de test`);
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', cwd: APP_ROOT });
process.exit(r.status ?? 1);
