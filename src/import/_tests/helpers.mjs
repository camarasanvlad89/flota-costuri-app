// Ajutoare de test: încarcă SheetJS din vendor/ (sau FLOTA_XLSX_LIB) dacă există.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setXlsxLib } from '../xlsx-reader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../..');
export const REF = path.resolve(appDir, 'tests/fixtures/gps')  // fixture publice, anonimizate (cele reale sunt în tests/private/gps, git-ignorat);
const candidates = [process.env.FLOTA_XLSX_LIB, path.join(appDir, 'vendor/xlsx.full.min.js'), path.join(appDir, 'node_modules/xlsx/dist/xlsx.full.min.js')].filter(Boolean);
export let XLSX = null;
function loadUmd(file) {
  // vendor/ poate fi sub un package.json "type":"module": evaluăm sursa UMD ca script CommonJS
  const m = { exports: {} };
  new Function('module', 'exports', 'require', readFileSync(file, 'utf8')).call(m.exports, m, m.exports, createRequire(import.meta.url));
  return m.exports;
}
for (const c of candidates) {
  if (!existsSync(c)) continue;
  try {
    const lib = loadUmd(c);
    if (typeof lib.read === 'function') { XLSX = lib; setXlsxLib(lib); break; }
  } catch { /* următorul */ }
}
export const HAS_XLSX = !!XLSX;

export const HEADER = ['Data încărcare', 'Data descărcare', 'Nr camion / Nr remorcă', 'Șofer', 'Rută', 'Preț fără TVA', 'TVA', 'Total', 'Observații'];
