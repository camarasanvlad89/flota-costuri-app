// Acces tolerant la DbState (colecții ca tablouri, Map sau obiecte) + utilitare de agregare exactă.
// Fără import din alte module: exportul citește doar starea primită.

export function coll(state, name) {
  const c = state?.collections?.[name] ?? state?.[name];
  if (!c) return [];
  const arr = Array.isArray(c) ? c : c instanceof Map ? [...c.values()] : Object.values(c);
  return arr.filter((r) => r && !r.deletedAt);
}
export function single(state, name) {
  return state?.singletons?.[name] ?? state?.[name] ?? {};
}
export function byId(arr) {
  const m = new Map();
  for (const r of arr) m.set(r.id, r);
  return m;
}
export function inRange(date, range) {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  return d >= range.from && d <= range.to;
}
export function monthOf(date) { return String(date).slice(0, 7); }
export function curKey(currency) { return currency === 'EUR' ? 'eur' : 'ron'; }
export function sumInts(values) {
  let s = 0;
  for (const v of values) s += v || 0;
  if (!Number.isSafeInteger(s)) throw new Error('Depășire la însumare');
  return s;
}
export function pctRatio(a, b) { return b ? a / b : null; }
export function gpsMeters(d) {
  return d?.kmM ?? d?.meters ?? d?.distanceM ?? (typeof d?.km === 'number' ? Math.round(d.km * 1000) : 0) ?? 0; // money-ok: nu sunt bani (afișare, km, procente sau pondere)
}
export function kmStr(meters) { // exact, 3 zecimale; kilometri nu sunt bani
  const m = Math.round(meters || 0); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
  const neg = m < 0, a = Math.abs(m);
  return (neg ? '-' : '') + Math.floor(a / 1000) + '.' + String(a % 1000).padStart(3, '0'); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
}
export function truckLabel(t) { return t ? (t.plateDisplay || t.plate || t.name || t.id) : ''; }

/** round(a*b/c), jumătate în sus (în afara lui zero), cu BigInt; rezultat întreg sigur. */
export function roundDiv(a, b, c) {
  if (!c) return 0;
  const A = BigInt(a) * BigInt(b), C = BigInt(c);
  const neg = (A < 0n) !== (C < 0n);
  const an = A < 0n ? -A : A, cn = C < 0n ? -C : C;
  let q = an / cn;
  if ((an % cn) * 2n >= cn) q += 1n;
  const r = Number(neg ? -q : q);
  if (!Number.isSafeInteger(r)) throw new Error('Depășire la împărțire');
  return r;
}

/** Raport a/b ca șir cu 6 zecimale (valoare în cache pentru celule procentuale). */
export function ratioStr(a, b) {
  if (!b) return '0';
  return String(Math.round((a / b) * 1e6) / 1e6); // money-ok: raport/procent pentru afișare, nu bani
}
/** Numărul de luni (inclusiv) dintr-un interval {from,to}. */
export function monthsInRange(range) {
  const a = String(range.from).slice(0, 7), b = String(range.to).slice(0, 7);
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5)) - Number(a.slice(5))) + 1;
}
