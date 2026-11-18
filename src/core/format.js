// Formatator determinist ro-RO, fără Intl: grupare '.', zecimală ',', NBSP înaintea unității, minus U+2212.
import { currencyExp } from './money.js';

const NBSP = ' ';
const MINUS = '−';

function group(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function pad(digits, dec) { return dec > 0 ? digits.padStart(dec + 1, '0') : digits; }
function compose(absDigits, dec) {
  const s = pad(absDigits, dec);
  return dec > 0 ? group(s.slice(0, -dec)) + ',' + s.slice(-dec) : group(s);
}
/** Semn: minus tipografic pentru negative nenule; '+' opțional pentru pozitive. */
function signed(str, neg, nonZero, plus) {
  if (nonZero && neg) return MINUS + str;
  if (nonZero && plus) return '+' + str;
  return str;
}

/** @param {number} minor întreg */
export function fmtMoney(minor, cur, o = {}) {
  if (!Number.isSafeInteger(minor)) throw new TypeError(`fmtMoney: întreg așteptat, primit ${minor}`);
  const dec = currencyExp(cur);
  const abs = String(Math.abs(minor));
  const body = compose(abs, dec);
  const code = String(cur).toUpperCase();
  const unit = !o.code && code === 'RON' ? 'lei' : !o.code && code === 'EUR' ? '€' : code;
  return signed(body, minor < 0, minor !== 0, o.sign) + NBSP + unit;
}

/** Rotunjire jumătate în afara lui zero pe valoarea zecimală exactă a lui n.toFixed (suficient pentru afișare nemonetară). */
export function fmtNumber(n, decimals = 0, o = {}) {
  if (!Number.isFinite(n)) return '–';
  const fixed = Math.abs(n).toFixed(decimals); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
  const [i, f] = fixed.split('.');
  const body = group(i) + (f ? ',' + f : '');
  return signed(body, n < 0, /[1-9]/.test(fixed), o.sign);
}

/** Metri întregi -> km: 8376300 -> '8.376,3 km' */
export function fmtKm(m, decimals = 1) {
  if (!Number.isFinite(m)) return '–';
  const d = Math.max(0, Math.min(3, decimals));
  const neg = m < 0;
  const unit = 10 ** (3 - d);
  const q = Math.floor((Math.abs(Math.round(m)) + unit / 2) / unit); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
  const body = compose(String(q), d);
  return signed(body, neg, q !== 0) + NBSP + 'km';
}

/** 0.125 -> '12,5%' */
export function fmtPct(ratio, decimals = 1) {
  if (!Number.isFinite(ratio)) return '–';
  const fixed = Math.abs(ratio * 100).toFixed(decimals); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
  const [i, f] = fixed.split('.');
  return signed(group(i) + (f ? ',' + f : ''), ratio < 0, /[1-9]/.test(fixed)) + '%';
}

/** '5.3442' -> '5,3442' (minimum 4 zecimale, maximum 10). */
export function fmtRate(r) {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(String(r).trim());
  if (!m) return String(r);
  let f = (m[2] || '').replace(/0+$/, '').padEnd(4, '0');
  return group(m[1]) + ',' + f;
}
