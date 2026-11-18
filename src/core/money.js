// Bani = întregi în unitatea minoră. Fără float pentru sume: BigInt la înmulțiri/împărțiri.
import { fnv1a64 } from './hash.js';

const EXP = { RON: 2, EUR: 2, HUF: 0, PLN: 2, CZK: 2, USD: 2, GBP: 2, CHF: 2, BGN: 2, JPY: 0, ISK: 0 };
const RATE_DEC = 10;
const RATE_SCALE = 10n ** BigInt(RATE_DEC);

export function registerCurrency(code, exp) {
  if (!Number.isInteger(exp) || exp < 0 || exp > 6) throw new RangeError('exponent invalid');
  EXP[String(code).toUpperCase()] = exp;
}
export function currencyExp(code) {
  const e = EXP[String(code).toUpperCase()];
  return e === undefined ? 2 : e;
}

const pow10 = (n) => 10n ** BigInt(n);
const absB = (x) => (x < 0n ? -x : x);

/** a / b cu rotunjire jumătate în sus, în afara lui zero (BigInt). */
function divRound(n, d) {
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  const q = (absB(n) * 2n + d) / (d * 2n);
  return neg ? -q : q;
}
function toSafe(b) {
  if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('rezultat în afara întregilor siguri');
  return Number(b);
}
function assertInt(x, name) {
  if (!Number.isSafeInteger(x)) throw new TypeError(`${name} trebuie să fie întreg sigur: ${x}`);
}

/** round(a*b/c), jumătate în afara lui zero. Aruncă dacă c=0 sau rezultatul nu e întreg sigur. */
export function mulDiv(a, b, c) {
  assertInt(a, 'a'); assertInt(b, 'b'); assertInt(c, 'c');
  if (c === 0) throw new RangeError('împărțire la zero');
  return toSafe(divRound(BigInt(a) * BigInt(b), BigInt(c)));
}

export function sum(values) {
  let s = 0n;
  for (const v of values) { assertInt(v, 'sumă'); s += BigInt(v); }
  return toSafe(s);
}

// ---------- șiruri zecimale ----------
export function toDecimalString(minor, cur) {
  assertInt(minor, 'minor');
  const exp = currencyExp(cur);
  const neg = minor < 0;
  let s = String(Math.abs(minor));
  if (exp > 0) {
    s = s.padStart(exp + 1, '0');
    s = s.slice(0, -exp) + '.' + s.slice(-exp);
  }
  return neg ? '-' + s : s;
}

/** '3542.77' -> 354277. Mai multe zecimale decât exponentul => rotunjire jumătate în afara lui zero. Fără float. */
export function fromDecimalString(s, cur) {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(String(s).trim());
  if (!m) throw new SyntaxError(`șir zecimal invalid: "${s}"`);
  const exp = currencyExp(cur);
  const frac = m[3] || '';
  let v;
  if (frac.length <= exp) v = BigInt(m[2] + frac.padEnd(exp, '0'));
  else {
    const scaled = BigInt(m[2] + frac); // exp + extra zecimale
    v = divRound(scaled, pow10(frac.length - exp));
  }
  return toSafe(m[1] === '-' ? -v : v);
}

// ---------- parseAmount ----------
function plainMinor(intPart, fracPart, cur) {
  return fromDecimalString(fracPart ? `${intPart}.${fracPart}` : intPart, cur);
}

/**
 * Acceptă `1234,56`, `1234.56`, `1 234,56`, `1.234,56`, `-12,5`, `(12,50)`, cu sufix de monedă/„lei”.
 * Un separator unic urmat de exact 3 cifre (`1.234`, `1,234`) este AMBIGUU: se citește implicit ca separator de mii,
 * `ambiguous:true`, `readAs` (șir zecimal al citirii alese) și `alternatives` (citirea zecimală rotunjită), niciodată pe tăcute.
 * Monedele cu 0 zecimale resping zecimale.
 */
export function parseAmount(text, cur) {
  try { return parseAmountUnsafe(text, cur); } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: 'Suma prea mare' };
    throw e;
  }
}
function parseAmountUnsafe(text, cur) {
  if (text == null) return { ok: false, error: 'Sumă lipsă' };
  let t = String(text).replace(/[    ]/g, '').replace(/[−–‒]/g, '-');
  if (!t) return { ok: false, error: 'Sumă lipsă' };
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/(lei|ron|eur|euro|huf|ft|pln|czk|usd|gbp|chf|bgn|[€$£]|[A-Za-z]{3})$/i, '');
  t = t.replace(/^(lei|ron|eur|huf|[€$£])/i, '');
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return { ok: false, error: 'Sumă invalidă' };
  const exp = currencyExp(cur);
  const sign = (v) => (neg ? -v : v);
  const done = (minor, extra) => ({ ok: true, minor: sign(minor) + 0, ...extra });
  const fin = (int, frac) => {
    if (frac.length > exp) {
      return exp === 0 ? { ok: false, error: 'Forinții nu au subdiviziuni' } : { ok: false, error: `Prea multe zecimale (maximum ${exp})` };
    }
    return done(plainMinor(int, frac, cur));
  };
  const groupsOk = (s, sep) => { const g = s.split(sep); return /^\d{1,3}$/.test(g[0]) && g.slice(1).every((x) => /^\d{3}$/.test(x)); };

  const lastDot = t.lastIndexOf('.'), lastCom = t.lastIndexOf(',');
  const nDot = (t.match(/\./g) || []).length, nCom = (t.match(/,/g) || []).length;

  if (nDot && nCom) {
    const dec = lastDot > lastCom ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    const di = t.lastIndexOf(dec);
    const ip = t.slice(0, di), fp = t.slice(di + 1);
    if (ip.includes(dec) || fp.includes(thou) || fp.includes(dec) || !groupsOk(ip, thou)) return { ok: false, error: 'Format de sumă invalid' };
    return fin(ip.split(thou).join(''), fp);
  }
  if (!nDot && !nCom) return fin(t, '');
  const sep = nDot ? '.' : ',';
  const n = nDot || nCom;
  if (n > 1) {
    if (!groupsOk(t, sep)) return { ok: false, error: 'Format de sumă invalid' };
    return fin(t.split(sep).join(''), '');
  }
  const [ip, fp] = t.split(sep);
  if (ip === '' && fp === '') return { ok: false, error: 'Sumă invalidă' };
  const ipv = ip === '' ? '0' : ip;
  if (fp.length === 3 && /^[1-9]\d{0,2}$/.test(ip)) {
    const thousands = plainMinor(ip + fp, '', cur);
    if (exp === 0) return done(thousands); // HUF: nu poate fi zecimal
    const dec = fromDecimalString(`${ip}.${fp}`, cur);
    const alt = sign(dec);
    return done(thousands, { ambiguous: true, readAs: toDecimalString(sign(thousands), cur), alternatives: alt === sign(thousands) ? [] : [alt] });
  }
  if (fp === '') return fin(ipv, '');
  return fin(ipv, fp);
}

// ---------- cursuri (RateStr) ----------
function rateToBig(r) {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(String(r).trim());
  if (!m) throw new SyntaxError(`curs invalid: "${r}"`);
  const frac = m[2] || '';
  if (frac.length > RATE_DEC) { // rotunjire la 10 zecimale
    const big = BigInt(m[1] + frac);
    return divRound(big, pow10(frac.length - RATE_DEC));
  }
  return BigInt(m[1] + frac.padEnd(RATE_DEC, '0'));
}
function bigToRate(b) {
  const s = b.toString().padStart(RATE_DEC + 1, '0');
  const int = s.slice(0, -RATE_DEC);
  const frac = s.slice(-RATE_DEC).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}
/** Normalizează un curs: max. 10 zecimale, fără zerouri finale ('5.3442000000' -> '5.3442'). */
export function normRate(r) { return bigToRate(rateToBig(r)); }

export function cmpRate(a, b) {
  const x = rateToBig(a), y = rateToBig(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
/** a / b cu 10 zecimale (jumătate în sus), normalizat. */
export function rateDiv(a, b) {
  const y = rateToBig(b);
  if (y === 0n) throw new RangeError('împărțire la zero (curs)');
  return bigToRate(divRound(rateToBig(a) * RATE_SCALE, y));
}
/** a * b cu 10 zecimale, normalizat. */
export function rateMul(a, b) {
  return bigToRate(divRound(rateToBig(a) * rateToBig(b), RATE_SCALE));
}

/**
 * Convertește o sumă minoră: `ratePerUnit` = unități MAJORE ale monedei țintă pentru 1 unitate MAJORĂ a monedei sursă.
 * Ține cont de exponenți (HUF 0 zecimale). Aceeași monedă => neschimbat.
 */
export function convert(minor, fromCur, toCur, ratePerUnit) {
  assertInt(minor, 'minor');
  if (String(fromCur).toUpperCase() === String(toCur).toUpperCase()) return minor;
  const num = BigInt(minor) * rateToBig(ratePerUnit) * pow10(currencyExp(toCur));
  const den = RATE_SCALE * pow10(currencyExp(fromCur));
  return toSafe(divRound(num, den));
}

// ---------- repartizare ----------
const W_SCALE = 1000000;
function weightsToBig(weights) {
  if (!Array.isArray(weights) || !weights.length) throw new RangeError('ponderi lipsă');
  const w = weights.map((x) => {
    if (!Number.isFinite(x) || x < 0) throw new RangeError('pondere invalidă');
    return Number.isInteger(x) ? BigInt(x) * BigInt(W_SCALE) : BigInt(Math.round(x * W_SCALE)); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
  });
  const S = w.reduce((a, b) => a + b, 0n);
  if (S === 0n) throw new RangeError('suma ponderilor este 0');
  return { w, S };
}

/** Repartizare cu suma exactă: părți rotunjite în jos, restul pe ultima parte cu pondere > 0. */
export function allocate(total, weights) {
  assertInt(total, 'total');
  const { w, S } = weightsToBig(weights);
  const neg = total < 0, T = BigInt(Math.abs(total));
  const out = w.map((x) => (T * x) / S);
  let rest = T - out.reduce((a, b) => a + b, 0n);
  let last = w.length - 1;
  while (last > 0 && w[last] === 0n) last--;
  out[last] += rest;
  return out.map((x) => toSafe(neg ? -x : x));
}

/**
 * Metoda celui mai mare rest; la rest egal ordinea o dă hash(seedKey+index) (deterministic, fără părtinire de poziție).
 */
// finalizator (splitmix64) ca ultimele caractere ale cheii să influențeze toți biții (FNV simplu e părtinitor pe chei care diferă doar la sfârșit)
function mix64(x) {
  const M = (1n << 64n) - 1n;
  x = BigInt(x) & M;
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M;
  return x ^ (x >> 31n);
}
export function allocateFair(total, weights, seedKey) {
  assertInt(total, 'total');
  const { w, S } = weightsToBig(weights);
  const neg = total < 0, T = BigInt(Math.abs(total));
  const base = w.map((x) => (T * x) / S);
  const rem = w.map((x, i) => (T * x) % S);
  let left = Number(T - base.reduce((a, b) => a + b, 0n));
  const order = w.map((x, i) => i).filter((i) => w[i] > 0n).sort((i, j) => {
    if (rem[i] !== rem[j]) return rem[i] > rem[j] ? -1 : 1;
    const hi = mix64(fnv1a64(String(seedKey) + '|' + i)), hj = mix64(fnv1a64(String(seedKey) + '|' + j));
    return hi < hj ? -1 : hi > hj ? 1 : i - j;
  });
  for (let k = 0; k < left; k++) base[order[k % order.length]] += 1n;
  return base.map((x) => toSafe(neg ? -x : x));
}
