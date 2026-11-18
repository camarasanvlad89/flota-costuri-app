import { currencyExp } from '../core/money.js';
// CSV conform 5.1: zecimal cu virgulă, fără separator de mii, delimitator ';' + BOM,
// numerele rămân numere (nefiind puse între ghilimele), datele dd.mm.yyyy.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})(?::\d{2})?$/;

function formulaGuard(s) {
  // protecție împotriva injecției de formule la deschiderea în Excel
  if (/^[=@\t\r]/.test(s) || /^[+-][^0-9.,\s]/.test(s)) return "'" + s;
  return s;
}

export function formatCsvCell(v, delimiter = ';') {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    s = String(v);
    if (/e/i.test(s)) s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, ''); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
    if (delimiter === ';') s = s.replace('.', ',');
    return s;
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'da' : 'nu';
  s = String(v);
  let m = ISO_DATE.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  m = ISO_DT.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]} ${m[4]}`;
  s = formulaGuard(s);
  if (s.includes(delimiter) || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function buildCsv(rows, opts = {}) {
  const delimiter = opts.delimiter || ';';
  const bom = opts.bom !== false;
  const lines = rows.map((r) => r.map((c) => formatCsvCell(c, delimiter)).join(delimiter));
  return (bom ? '﻿' : '') + lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

/** Sumă minoră -> număr zecimal pentru CSV (șir cu virgulă, fără mii). Exact, fără float. */
export function minorToCsv(minor, exp, delimiter = ';') {
  const s = minorToDecimal(minor, exp);
  return delimiter === ';' ? s.replace('.', ',') : s;
}

/** Sumă minoră întreagă -> șir zecimal exact ('3542.77', HUF '123456'). */
export function minorToDecimal(minor, exp = 2) {
  if (minor === null || minor === undefined || minor === '') return '';
  if (!Number.isSafeInteger(minor)) throw new Error('Suma trebuie să fie întreg minor: ' + minor);
  const neg = minor < 0;
  const abs = String(Math.abs(minor));
  let out;
  if (exp <= 0) out = abs;
  else {
    const p = abs.padStart(exp + 1, '0');
    out = p.slice(0, -exp) + '.' + p.slice(-exp);
  }
  return neg && /[1-9]/.test(out) ? '-' + out : out;
}

export function currencyExpLocal(code) {
  return currencyExp(code); // o singură sursă de adevăr: tabelul din core/money.js (completat din Setări > Valute)
}
