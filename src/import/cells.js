// Ajutoare comune pentru celule de foaie de calcul: text, numere, date, durate, km. Fără float la bani.
import { parseDate, isIsoDate } from '../core/dates.js';
import { parseAmount, fromDecimalString, currencyExp } from '../core/money.js';
import { foldKey } from '../core/text.js';

const NBSP_RE = /[   ]/g;

export function isBlank(v) {
  return v == null || (typeof v === 'string' && v.replace(NBSP_RE, ' ').trim() === '');
}

export function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(NBSP_RE, ' ').trim();
}

/** Antet normalizat: litere mici, fără diacritice, doar a-z0-9. 'Nr camion / Nr remorcă' => 'nrcamionnrremorca'. */
export function normHeader(s) {
  return foldKey(cellText(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function rowIsEmpty(row) {
  return !row || row.every(isBlank);
}

/** Număr JS -> șir zecimal simplu (fără notație științifică). */
export function numToDecimalString(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(10);
  return s;
}

/**
 * Celulă de sumă -> Minor.
 * Număr: exact (fără float la însumare; rotunjire jumătate în afara lui zero la exponentul monedei).
 * Text: `parseAmount` (virgulă/punct, mii cu `.`/spațiu); un singur separator + 3 cifre = ambiguu (semnalat).
 * @returns {{ok:true, minor:number, ambiguous?:boolean, readAs?:string}|{ok:false, empty:boolean, error?:string}}
 */
export function parseMoneyCell(v, cur) {
  if (isBlank(v)) return { ok: false, empty: true };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { ok: false, empty: false, error: 'Număr invalid' };
    return { ok: true, minor: fromDecimalString(numToDecimalString(v), cur) + 0 };
  }
  const t = cellText(v);
  if (/^[-–—.]+$/.test(t)) return { ok: false, empty: true };
  const r = parseAmount(t, cur);
  if (!r.ok) return { ok: false, empty: false, error: r.error };
  return r;
}

/** Număr simplu (fără monedă) ca număr JS: pentru valori nemonetare (viteze, litri). null dacă nu e număr. */
export function parsePlainNumber(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = cellText(v).replace(/[^\d,.\-]/g, '');
  if (!t || !/\d/.test(t)) return null;
  if (t.includes(',') && t.includes('.')) {
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Kilometri -> metri (întreg), fără erori de float: '471,624' | 471.624 | '~358257.9 km' | '52,4 km/h' (=> 52400).
 * null dacă nu e număr.
 */
export function kmToMeters(v) {
  if (isBlank(v)) return null;
  let s;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    s = v.toFixed(6);
  } else {
    s = cellText(v).replace(/[~≈]/g, '').replace(/\s*km(\/h)?\s*$/i, '').replace(/\s/g, '');
    const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(s);
    if (!m) {
      const dual = /^(-?)(\d{1,3}(?:[.,]\d{3})+)[.,](\d+)$/.exec(s); // 1.234,567
      if (!dual) return null;
      s = `${dual[1]}${dual[2].replace(/[.,]/g, '')}.${dual[3]}`;
    } else s = `${m[1]}${m[2]}${m[3] != null ? '.' + m[3] : ''}`;
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] || '').padEnd(4, '0');
  let meters = Number(m[2]) * 1000 + Number(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) meters += 1;
  return m[1] === '-' ? -meters : meters;
}

/** Durată în secunde (uneori cu zecimale) -> secunde întregi. */
export function secondsCell(v) {
  const n = parsePlainNumber(v);
  return n == null ? null : Math.round(n);
}

const p2 = (n) => String(n).padStart(2, '0');

/**
 * Serial Excel cu fracție de zi -> { date:'YYYY-MM-DD', dateTime:'YYYY-MM-DDTHH:mm:ss' } (ora locală, fără fus).
 * Acceptă și șiruri 'dd.mm.yyyy hh:mm(:ss)' / ISO.
 */
export function parseDateTimeCell(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 61) return null;
    const total = Math.round(v * 86400);
    const day = Math.floor(total / 86400);
    const sod = total - day * 86400;
    const date = parseDate(day, 'excel');
    if (!date) return null;
    return { date, dateTime: `${date}T${p2(Math.floor(sod / 3600))}:${p2(Math.floor((sod % 3600) / 60))}:${p2(sod % 60)}` };
  }
  const t = cellText(v);
  const m = /^(.*?)[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  const datePart = m ? m[1] : t;
  const date = parseDate(datePart.trim());
  if (!date || !isIsoDate(date)) return null;
  const hh = m ? +m[2] : 0, mm = m ? +m[3] : 0, ss = m && m[4] ? +m[4] : 0;
  return { date, dateTime: `${date}T${p2(hh)}:${p2(mm)}:${p2(ss)}` };
}

/** Zi calendaristică dintr-o celulă (serial / dd.mm.yyyy / ISO). */
export function parseDayCell(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return parseDate(Math.floor(v), 'excel');
  return parseDate(cellText(v));
}

/** Cifre după rotunjire pentru comparații (nu pentru bani). */
export function minorExp(cur) { return currencyExp(cur); }

/** Număr de rând afișat (1-based) pentru un indice 0-based. */
export const rowNo = (i) => i + 1;

/** Numele coloanei Excel (0 => A). */
export function colName(i) {
  let s = '', n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
