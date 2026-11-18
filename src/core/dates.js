// Date calendaristice ca șiruri ISO 'YYYY-MM-DD'. Fără Date în API-ul public (Date doar intern, în UTC).
const p2 = (n) => String(n).padStart(2, '0');
const p4 = (n) => String(n).padStart(4, '0');
const DAY = 86400000;

// Date.UTC tratează anii 0..99 ca 1900+; evităm prin setUTCFullYear
function utc(y, m1, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m1 - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}
function dim(y, m1) { return utc(y, m1 + 1, 0).getUTCDate(); }
export function daysInMonth(year, month1) { return dim(year, month1); }

function mk(y, m, d) { return `${p4(y)}-${p2(m)}-${p2(d)}`; }
function fromDt(dt) { return mk(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
function toDt(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return utc(y, m, d);
}
const toDays = (iso) => Math.round(toDt(iso).getTime() / DAY);
const fromDays = (n) => fromDt(new Date(n * DAY));

/** @param {{now():number}} [clock] */
export function todayLocal(clock) {
  const d = new Date(clock ? clock.now() : Date.now());
  return mk(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function isIsoDate(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= dim(y, mo);
}

function valid(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || m < 1 || m > 12 || d < 1) return null;
  return d <= dim(y, m) ? mk(y, m, d) : null;
}
const y2 = (y) => (y < 100 ? 2000 + y : y);

function fromExcelSerial(n) {
  if (!Number.isFinite(n)) return null;
  const s = Math.floor(n);
  if (s < 61 || s > 2958465) return null; // înainte de 1.3.1900 nu e fiabil (bug-ul 1900 din Excel)
  return fromDays(s - 25569);
}

/**
 * '20.08.2025', '20/08/2025', '2025-08-20', '2025. 08. 20.', 'yyyymmdd', serial Excel, Date (câmpuri locale).
 * Număr (sau șir numeric) = serial Excel. Întoarce null dacă nu e o dată calendaristică validă.
 * @param {string|number|Date} input @param {'dmy'|'ymd'|'excel'} [hint]
 */
export function parseDate(input, hint) {
  if (input == null || input === '') return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : valid(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  if (typeof input === 'number') return fromExcelSerial(input);
  const s = String(input).trim();
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s))) return valid(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\.?$/.exec(s))) return valid(+m[1], +m[2], +m[3]);
  if (/^\d{8}$/.test(s) && hint !== 'excel') return valid(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  if (/^\d+(\.\d+)?$/.test(s) && (hint === 'excel' || !/[.]/.test(s) || /^\d{5,}/.test(s))) {
    if (hint === 'excel' || /^\d{5,7}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s));
  }
  if ((m = /^(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2}|\d{4})\.?$/.exec(s))) {
    return valid(y2(+m[3]), +m[2], +m[1]);
  }
  return null;
}

export function fmtDate(d) {
  const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y}`;
}

export function addDays(d, n) { return fromDays(toDays(d) + n); }

export function clampDay(year, month1, day) {
  return mk(year, month1, Math.max(1, Math.min(day, dim(year, month1))));
}

export function addMonths(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12 + 12) % 12 + 1;
  return clampDay(ny, nm, day);
}

export function monthKey(d) { return d.slice(0, 7); }

export function monthRange(mk_) {
  const [y, m] = mk_.split('-').map(Number);
  return { from: mk(y, m, 1), to: mk(y, m, dim(y, m)) };
}

export function eachDay(from, to) {
  const out = [];
  for (let a = toDays(from), b = toDays(to); a <= b; a++) out.push(fromDays(a));
  return out;
}

export function eachMonth(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${p4(y)}-${p2(m)}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** b - a, în zile */
export function diffDays(a, b) { return toDays(b) - toDays(a); }

/** Număr de zile comune a două intervale inclusive (0 dacă nu se suprapun). */
export function overlapDays(a, b) {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from > to ? 0 : diffDays(from, to) + 1;
}
