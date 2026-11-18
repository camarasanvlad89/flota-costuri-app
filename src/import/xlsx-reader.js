// Citire registre .xlsx (SheetJS CE, vendored). Biblioteca se injectează (`setXlsxLib`) sau se ia din `globalThis.XLSX`
// (scriptul `vendor/xlsx.full.min.js` o definește). Fără rețea.
import { normalizePlate } from '../core/plates.js';

let injected = null;
/** Injectează biblioteca SheetJS (shell/build sau teste). */
export function setXlsxLib(lib) { injected = lib; }
export function getXlsxLib() {
  const lib = injected || globalThis.XLSX;
  if (!lib || typeof lib.read !== 'function') throw new Error('SheetJS nu este încărcat (vendor/xlsx.full.min.js)');
  return lib;
}

const PLATE_RE = /^([A-Z]{1,2}\d{2,3}[A-Z]{3})(20\d{2})?$/;

/**
 * Plăcuță și an din numele foii: 'XX01DEM 2025' | 'XX-00-DEM' | 'xx 00 dem 2025' | 'Munka1' (=> null).
 * @returns {{ plate:string|null, year:number|null }}
 */
export function detectSheetInfo(name) {
  const raw = String(name ?? '').toUpperCase();
  const stripped = raw.replace(/[\s\-_.]+/g, '');
  let m = PLATE_RE.exec(stripped);
  if (m) return { plate: m[1], year: m[2] ? +m[2] : null };
  for (const tok of raw.split(/[\s_]+/)) {
    m = PLATE_RE.exec(tok.replace(/-/g, ''));
    if (m) return { plate: m[1], year: m[2] ? +m[2] : yearIn(raw) };
  }
  m = /([A-Z]{1,2}\d{2,3}[A-Z]{3})/.exec(stripped);
  if (m) {
    const rest = stripped.replace(m[1], '');
    const y = /(20\d{2})/.exec(rest);
    return { plate: normalizePlate(m[1]), year: y ? +y[1] : null };
  }
  return { plate: null, year: null };
}
function yearIn(s) { const m = /\b(20\d{2})\b/.exec(s); return m ? +m[1] : null; }

/** Plăcuță din numele fișierului: 'calatorii_pentru_cj_26_bod.xlsx' => 'XX00DEM'. */
export function plateFromFileName(name) {
  const base = String(name ?? '').replace(/\.[A-Za-z0-9]+$/, '').toUpperCase();
  const m = /(?:^|[^A-Z0-9])([A-Z]{1,2})[\s_\-]?(\d{2,3})[\s_\-]?([A-Z]{3})(?![A-Z0-9])/.exec(base);
  return m ? m[1] + m[2] + m[3] : null;
}

/**
 * @param {File|ArrayBuffer|Uint8Array} input
 * @returns {Promise<{ file:string, sheets:Array<{ name:string, plate:string|null, year:number|null, rows:any[][], rowCount:number, defaultSelected:boolean }> }>}
 */
export async function readWorkbook(input) {
  const XLSX = getXlsxLib();
  let file = 'registru.xlsx', data = input;
  if (input && typeof input.arrayBuffer === 'function') { file = input.name || file; data = await input.arrayBuffer(); }
  const wb = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array', cellDates: false, cellText: false });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const { plate, year } = detectSheetInfo(name);
    let last = rows.length;
    while (last > 0 && rows[last - 1].every((c) => c == null || c === '')) last--;
    rows.length = last;
    return { name, plate, year, rows, rowCount: rows.length, defaultSelected: !!plate && rows.length > 0 };
  });
  return { file, sheets };
}
