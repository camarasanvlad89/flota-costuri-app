#!/usr/bin/env node
// `npm run check` (DEV-PLAN 11.3): verificări statice + build + teste.
//   --wip         fișiere lipsă și încălcările regulii „bani” devin avertismente (în timpul dezvoltării în paralel)
//   --no-tests    omite testele   |   --no-build  omite build-ul de probă
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ROOT, Report, listFiles, rel } from './lib/scan.mjs';
import { checkDeps } from './check-deps.mjs';
import { checkStatic } from './check-static.mjs';
import { checkMoney } from './check-money.mjs';
import { verifyVendor } from '../build/vendor.mjs';

const wip = process.argv.includes('--wip');
let ok = true;
const run = (rep) => { const r = rep.print(); ok = ok && r; };

// 1. sintaxă (node --check) pe toate fișierele sursă și de scripturi
{
  const rep = new Report('sintaxă (node --check)');
  const files = [...listFiles(join(APP_ROOT, 'src')), ...listFiles(join(APP_ROOT, 'build')), ...listFiles(join(APP_ROOT, 'scripts')), ...listFiles(join(APP_ROOT, 'tests'))];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status) rep.error(`${rel(f)}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'eroare de sintaxă'}`);
  }
  run(rep);
}
// 2. vendor
{
  const rep = new Report('vendor/ coincide cu VENDOR.lock.json');
  const v = verifyVendor(); if (!v.ok) v.problems.forEach((p) => rep.error(p));
  run(rep);
}
// 3. statice
{ const { rep } = checkDeps({ allowMissing: wip }); run(rep); }
{ const { rep } = checkStatic(); run(rep); }
{
  const { rep } = checkMoney();
  if (wip && rep.errors.length) { rep.errors.forEach((e) => rep.warn(e)); rep.errors = []; }
  run(rep);
}
// 4. build de probă + verificări dist
if (!process.argv.includes('--no-build') && existsSync(join(APP_ROOT, 'src', 'main.js'))) {
  const out = mkdtempSync(join(tmpdir(), 'flota-check-'));
  const r = spawnSync(process.execPath, [join(APP_ROOT, 'build', 'build.mjs'), '--out', out, '--quiet'], { encoding: 'utf8' });
  const rep = new Report('build + verificări dist (CSP, hash-uri, dimensiune, 0 cereri externe)');
  if (r.status) rep.error((r.stderr || r.stdout).trim().split('\n').slice(0, 12).join('\n    '));
  run(rep);
  rmSync(out, { recursive: true, force: true });
} else console.log('omis  build (fără src/main.js sau --no-build)');
// 5. teste
if (!process.argv.includes('--no-tests')) {
  const r = spawnSync(process.execPath, [join(APP_ROOT, 'scripts', 'run-tests.mjs')], { stdio: 'inherit' });
  ok = ok && r.status === 0;
}
console.log(ok ? '\nTOTUL OK' : '\nVERIFICĂRI EȘUATE');
process.exit(ok ? 0 : 1);
