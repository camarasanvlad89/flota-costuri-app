// Încarcă SheetJS vendored în Node (pentru make-fixtures și teste), fără npm.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { APP_ROOT } from './scan.mjs';

let cached = null;
export function loadXlsx() {
  if (cached) return cached;
  const src = readFileSync(join(APP_ROOT, 'vendor', 'xlsx.full.min.js'), 'utf8');
  const m = { exports: {} };
  vm.runInThisContext(`(function(module, exports){${src}\n})`, { filename: 'xlsx.full.min.js' })(m, m.exports);
  cached = m.exports;
  return cached;
}
/** Rânduri brute (matrice) dintr-un buffer .xlsx. @returns {Record<string, any[][]>} */
export function sheetsOf(buf, opts = {}) {
  const X = loadXlsx(); const wb = X.read(buf, { cellDates: false });
  const out = {};
  for (const n of wb.SheetNames) out[n] = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true, ...opts });
  return out;
}
