// Curs valutar (plan 5.3, D9, D11). Sursa implicită = BNR (fișier XML lipit sau curs manual);
// Frankfurter (BCE) = rezervă marcată „indicativ”; offline ⇒ ultimul curs cunoscut, marcat `stale`.
// Cursurile sunt șiruri zecimale (RateStr, până la 10 zecimale); toată aritmetica folosește BigInt, nu float.
// Domeniul nu face I/O direct: `fetch`, ceasul și starea de rețea sunt injectate.

import { currencyExp } from '../core/money.js';

/** @typedef {string} RateStr */
/** @typedef {'ron'|'bnr'|'bnr-manual'|'ecb-v1'|'ecb-v2'|'manual'|'last-known'} FxSource */
/** @typedef {{ ronPerUnit:RateStr, eurPerUnit:RateStr|null, rateDate:string, source:FxSource, manual:boolean, stale:boolean, eurSource?:FxSource|null }} RateResult */

const SCALE_DIGITS = 10;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

export class FxError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'FxError';
    this.code = code; // 'NO_RATE' | 'BAD_RATE' | 'BAD_XML' | 'FETCH_FAILED'
    Object.assign(this, extra || {});
  }
}

// ───────── aritmetică zecimală exactă (RateStr ↔ BigInt scalat la 10^10) ─────────

function divRound(n, d) {
  // împărțire BigInt, jumătate în afara lui zero
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  const an = neg ? -n : n;
  let q = an / d;
  if ((an % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

/** Număr (inclusiv notație științifică din JSON) sau șir ⇒ șir zecimal simplu. */
export function toDecimalStr(x) {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new FxError('BAD_RATE', 'Curs invalid.');
    x = String(x);
  }
  let s = String(x).trim().replace(',', '.');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) throw new FxError('BAD_RATE', 'Curs invalid: ' + JSON.stringify(x));
  let [, sign, int, frac = '', exp] = m;
  if (exp) {
    const e = parseInt(exp, 10);
    const digits = int + frac;
    let pointPos = int.length + e;
    if (pointPos <= 0) { int = '0'; frac = '0'.repeat(-pointPos) + digits; }
    else if (pointPos >= digits.length) { int = digits + '0'.repeat(pointPos - digits.length); frac = ''; }
    else { int = digits.slice(0, pointPos); frac = digits.slice(pointPos); }
  }
  return (sign === '-' ? '-' : '') + int + (frac ? '.' + frac : '');
}

/** RateStr ⇒ BigInt scalat la 10^10 (rotunjit la a 10-a zecimală dacă are mai multe). */
export function rateToScaled(r) {
  const s = toDecimalStr(r);
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  let v = BigInt(i) * SCALE + BigInt(f.slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0'));
  if (f.length > SCALE_DIGITS && f.charCodeAt(SCALE_DIGITS) >= 53) v += 1n; // cifra a 11-a >= 5
  return neg ? -v : v;
}

/** BigInt scalat ⇒ RateStr fără zerouri de coadă ('5.3442', '1'). */
export function scaledToRate(v) {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = a / SCALE;
  const f = (a % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + i.toString() + (f ? '.' + f : '');
}

export const rateMul = (a, b) => scaledToRate(divRound(rateToScaled(a) * rateToScaled(b), SCALE));
export function rateDivide(a, b) {
  const d = rateToScaled(b);
  if (d === 0n) throw new FxError('BAD_RATE', 'Împărțire la un curs 0.');
  return scaledToRate(divRound(rateToScaled(a) * SCALE, d));
}
export function rateCompare(a, b) {
  const x = rateToScaled(a), y = rateToScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export const isPositiveRate = (r) => { try { return rateToScaled(r) > 0n; } catch { return false; } };

/**
 * Convertește o sumă în unitate minoră între monede: rate = unități `to` pentru 1 unitate `from` (în unități majore).
 * rezultat = rotunjire(minor · rate · 10^expTo / 10^expFrom). HUF (0 zecimale) și RON/EUR (2) tratate corect.
 * @returns {number}
 */
export function convertMinor(minor, fromCur, toCur, rate) {
  if (!Number.isSafeInteger(minor)) throw new RangeError('Suma trebuie să fie un întreg (unitate minoră).');
  const r = rateToScaled(rate);
  const ef = currencyExp(fromCur), et = currencyExp(toCur);
  const num = BigInt(minor) * r * 10n ** BigInt(et);
  const den = SCALE * 10n ** BigInt(ef);
  const out = divRound(num, den);
  if (out > BigInt(Number.MAX_SAFE_INTEGER) || out < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Rezultatul depășește întregul sigur.');
  return Number(out);
}

/**
 * Curs încrucișat din cotații „unități per 1 EUR”: întoarce câte unități `to` face 1 unitate `from`.
 * perEur.EUR este implicit '1'. Exemplu: crossRate({RON:'5.3442', HUF:'364.08'}, 'HUF', 'RON') = 5.3442/364.08.
 * @param {Object<string,RateStr>} perEur
 * @returns {RateStr}
 */
export function crossRate(perEur, from, to) {
  const get = (c) => {
    if (c === 'EUR') return '1';
    const v = perEur && perEur[c];
    if (v == null) throw new FxError('NO_RATE', 'Lipsește cursul pentru ' + c, { currency: c });
    return v;
  };
  if (from === to) return '1';
  return rateDivide(get(to), get(from));
}

// ───────── zile lucrătoare ─────────

const toUtc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export function shiftDate(iso, days) { return fromUtc(toUtc(iso) + days * 86400000); }
/** Ultima zi lucrătoare (luni–vineri) <= data; sărbătorile legale nu sunt cunoscute aici. */
export function lastBusinessDay(iso) {
  let ms = toUtc(iso);
  for (;;) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) return fromUtc(ms);
    ms -= 86400000;
  }
}

// ───────── BNR XML ─────────

/**
 * Parsează fișierul XML BNR (zilnic nbrfxrates.xml sau anual nbrfxrates<AAAA>.xml). Fără DOM.
 * `Multiplier` (de ex. HUF=100) se aplică: rezultatul este RON pentru 1 unitate. Include și EUR.
 * @returns {{ date:string, rates:Object<string,RateStr>, cubes:Array<{date:string, rates:Object<string,RateStr>}> }}
 *   `date`/`rates` = cel mai recent Cube; `cubes` = toate zilele din fișier.
 */
export function parseBnrXml(xml) {
  const text = String(xml || '');
  const cubes = [];
  const cubeRe = /<Cube\b([^>]*)>([\s\S]*?)<\/Cube>/gi;
  let m;
  while ((m = cubeRe.exec(text))) {
    const dm = /date\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/i.exec(m[1]);
    if (!dm) continue;
    const rates = {};
    const rateRe = /<Rate\b([^>]*)>\s*([^<\s][^<]*?)\s*<\/Rate>/gi;
    let r;
    while ((r = rateRe.exec(m[2]))) {
      const cm = /currency\s*=\s*["']([A-Za-z]{3})["']/i.exec(r[1]);
      if (!cm) continue;
      const mm = /multiplier\s*=\s*["'](\d+)["']/i.exec(r[1]);
      const mult = mm ? BigInt(mm[1]) : 1n;
      if (mult <= 0n) continue;
      let v;
      try { v = rateToScaled(r[2]); } catch { continue; }
      if (v <= 0n) continue;
      rates[cm[1].toUpperCase()] = scaledToRate(divRound(v, mult));
    }
    if (Object.keys(rates).length) cubes.push({ date: dm[1], rates });
  }
  if (!cubes.length) throw new FxError('BAD_XML', 'Fișierul nu pare a fi un XML de cursuri BNR (nu s-a găsit niciun <Cube date="..."> cu cursuri).');
  cubes.sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = cubes[cubes.length - 1];
  return { date: last.date, rates: last.rates, cubes };
}

// ───────── serviciul de curs ─────────

const rateId = (source, cur, date) => `rate_${source}_${cur}_${date}`;

/**
 * Înregistrări în colecția `rates`:
 *   { id, date, currency, source:'bnr'|'ecb-v1'|'ecb-v2'|'manual', ronPerUnit:RateStr|null, perEur:RateStr|null, createdAt, updatedAt }
 *   BNR și manual stochează `ronPerUnit`; BCE stochează `perEur` (unități per 1 EUR, inclusiv pentru RON).
 *
 * @param {{ store:{ list:(col:string, pred?:Function)=>any[], putMany:(col:string, recs:any[])=>Promise<any> },
 *           fetchImpl:typeof fetch, clock:{now():number}, isOnline:()=>boolean, enabled?:boolean,
 *           frankfurterBase?:string, frankfurterVersion?:'v1'|'v2', timeoutMs?:number }} deps
 */
export function createFxService(deps) {
  const { store, fetchImpl, clock, isOnline } = deps;
  const base = (deps.frankfurterBase || 'https://api.frankfurter.dev').replace(/\/$/, '');
  const version = deps.frankfurterVersion === 'v2' ? 'v2' : 'v1';
  const ecbSource = version === 'v2' ? 'ecb-v2' : 'ecb-v1';
  const timeoutMs = deps.timeoutMs || 8000;
  const inflight = new Map();
  const aliasDate = new Map(); // dată cerută ⇒ ultima zi publicată de BCE (sărbători), doar în sesiune
  const nowIso = () => new Date(clock && clock.now ? clock.now() : Date.now()).toISOString();
  const enabled = () => deps.enabled !== false;

  // ── index în memorie, reconstruit când colecția își schimbă mărimea sau după scrieri proprii ──
  let idx = null;
  let idxLen = -1;
  function index() {
    const all = store.list('rates') || [];
    if (idx && all.length === idxLen) return idx;
    const byKey = new Map(); // `${source}|${cur}|${date}` ⇒ rec
    const dates = new Map(); // `${source}|${cur}` ⇒ date[] sortat
    for (const r of all) {
      byKey.set(`${r.source}|${r.currency}|${r.date}`, r);
      const k = `${r.source}|${r.currency}`;
      if (!dates.has(k)) dates.set(k, []);
      dates.get(k).push(r.date);
    }
    for (const arr of dates.values()) arr.sort();
    idx = { byKey, dates };
    idxLen = all.length;
    return idx;
  }
  const invalidate = () => { idx = null; idxLen = -1; };
  const latestOnOrBefore = (source, cur, date, maxBackDays = 3650) => {
    const arr = index().dates.get(`${source}|${cur}`);
    if (!arr) return null;
    let lo = 0, hi = arr.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= date) { best = arr[mid]; lo = mid + 1; } else hi = mid - 1; }
    if (best && best >= shiftDate(date, -maxBackDays)) return best;
    return null;
  };
  const hasAfter = (source, cur, date) => {
    const arr = index().dates.get(`${source}|${cur}`);
    return !!arr && arr.length > 0 && arr[arr.length - 1] > date;
  };
  const rec = (source, cur, date) => index().byKey.get(`${source}|${cur}|${date}`) || null;

  // ── rezolvare din cache ──
  /** BNR: cursul pentru `cur` la ziua BNR cea mai recentă <= target, cu eventuală umplere a unei zile libere (gap = sărbătoare). */
  function fromBnr(cur, target) {
    const eurDate = latestOnOrBefore('bnr', 'EUR', target, 7);
    if (!eurDate) return null;
    // zi lipsă între două zile publicate = sărbătoare ⇒ rămâne „bnr”, nu „stale”
    const gapFilled = eurDate !== target;
    if (gapFilled && !hasAfter('bnr', 'EUR', target) ) return null; // nu știm dacă BNR a publicat între timp: tratăm ca absent
    const eur = rec('bnr', 'EUR', eurDate);
    if (!eur) return null;
    if (cur === 'RON') return { ronPerUnit: '1', eurRon: eur.ronPerUnit, rateDate: eurDate, source: 'bnr', eurSource: 'bnr' };
    if (cur === 'EUR') return { ronPerUnit: eur.ronPerUnit, eurRon: eur.ronPerUnit, rateDate: eurDate, source: 'bnr', eurSource: 'bnr' };
    const x = rec('bnr', cur, eurDate);
    if (!x) return null;
    return { ronPerUnit: x.ronPerUnit, eurRon: eur.ronPerUnit, rateDate: eurDate, source: 'bnr', eurSource: 'bnr' };
  }
  function fromEcb(source, cur, date) {
    const ron = rec(source, 'RON', date);
    if (!ron) return null;
    if (cur === 'RON') return { ronPerUnit: '1', eurRon: ron.perEur, rateDate: date, source, eurSource: source };
    if (cur === 'EUR') return { ronPerUnit: ron.perEur, eurRon: ron.perEur, rateDate: date, source, eurSource: source };
    const x = rec(source, cur, date);
    if (!x) return null;
    return { ronPerUnit: crossRate({ RON: ron.perEur, [cur]: x.perEur }, cur, 'RON'), eurRon: ron.perEur, rateDate: date, source, eurSource: source };
  }
  /** Cursul manual salvat în `rates` pentru ziua exactă. */
  function fromManualRec(cur, date) {
    const r = rec('manual', cur, date);
    if (!r) return null;
    return { ronPerUnit: r.ronPerUnit, rateDate: date, source: 'manual' };
  }

  function finish(cur, picked, extra) {
    const stale = !!extra.stale;
    let eurPerUnit = null;
    if (cur === 'EUR') eurPerUnit = '1';
    else if (picked.eurRon) eurPerUnit = rateDivide(picked.ronPerUnit, picked.eurRon);
    return {
      ronPerUnit: picked.ronPerUnit, eurPerUnit, rateDate: picked.rateDate,
      source: cur === 'RON' ? 'ron' : (extra.source || picked.source),
      manual: !!extra.manual, stale,
      eurSource: picked.eurSource || null,
    };
  }

  // ── Frankfurter ──
  async function fetchJson(url) {
    if (inflight.has(url)) return inflight.get(url);
    const p = (async () => {
      const init = {};
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeoutMs);
      const res = await fetchImpl(url, init);
      if (!res || !res.ok) throw new FxError('FETCH_FAILED', 'Serviciul de curs a răspuns cu eroare' + (res ? ' (' + res.status + ')' : '') + '.');
      return res.json();
    })().finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }
  /** Normalizează răspunsul v1 ({date, rates} sau {rates:{zi:{...}}}) sau v2 (tablou {date,quote,rate}) în { [date]: {CUR: num} }. */
  function normalizeEcb(json) {
    const out = {};
    if (Array.isArray(json)) {
      for (const r of json) {
        if (!r || !r.date || !r.quote || r.rate == null) continue;
        (out[r.date] ||= {})[String(r.quote).toUpperCase()] = r.rate;
      }
    } else if (json && json.rates) {
      const vals = Object.values(json.rates);
      if (vals.length && typeof vals[0] === 'object') {
        for (const [d, rs] of Object.entries(json.rates)) out[d] = { ...rs };
      } else if (json.date) out[json.date] = { ...json.rates };
    }
    return out;
  }
  async function storeEcb(byDate) {
    const t = nowIso();
    const recs = [];
    for (const [date, rs] of Object.entries(byDate)) {
      for (const [cur, v] of Object.entries(rs)) {
        recs.push({ id: rateId(ecbSource, cur, date), date, currency: cur, source: ecbSource, ronPerUnit: null, perEur: toDecimalStr(v), createdAt: t, updatedAt: t });
      }
    }
    if (recs.length) { await store.putMany('rates', recs); invalidate(); }
    return recs.length;
  }
  function ecbUrl(from, to, symbols) {
    const syms = symbols.join(',');
    if (version === 'v2') {
      // v2 (formă verificată la 18.11.2026): /v2/rates?base=EUR&quotes=RON,HUF&date=AAAA-LL-ZZ
      return from === to
        ? `${base}/v2/rates?base=EUR&quotes=${syms}&date=${from}`
        : `${base}/v2/rates?base=EUR&quotes=${syms}&from=${from}&to=${to}`;
    }
    return from === to ? `${base}/v1/${from}?symbols=${syms}` : `${base}/v1/${from}..${to}?symbols=${syms}`;
  }
  const canFetch = () => enabled() && typeof isOnline === 'function' && isOnline() && typeof fetchImpl === 'function';
  async function fetchEcb(cur, date) {
    const symbols = cur === 'EUR' || cur === 'RON' ? ['RON'] : ['RON', cur];
    const json = await fetchJson(ecbUrl(date, date, symbols));
    const byDate = normalizeEcb(json);
    await storeEcb(byDate);
    return Object.keys(byDate);
  }

  // ── API public ──
  /**
   * Cursul pentru moneda și data dată. Ordinea: BNR (ziua lucrătoare) ⇒ BCE din cache ⇒ BCE prin rețea ⇒ ultimul curs cunoscut (stale).
   * RON ⇒ source 'ron', ronPerUnit '1' (eurPerUnit vine din cursul EUR/RON al zilei).
   * Fără niciun curs ⇒ aruncă FxError cod 'NO_RATE' (UI cere curs manual; RON cu eurPerUnit nul e permis, vezi mai jos).
   * Pentru RON, dacă nu există deloc un curs EUR ⇒ întoarce eurPerUnit:null, stale:true (intrarea se poate salva fără valoare EUR).
   * @returns {Promise<RateResult>}
   */
  async function getRate(cur, date) {
    if (!/^[A-Z]{3}$/.test(cur)) throw new FxError('BAD_RATE', 'Monedă invalidă: ' + cur);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FxError('BAD_RATE', 'Dată invalidă: ' + date);
    const target0 = lastBusinessDay(date);
    let target = aliasDate.get(target0) || target0;
    const tryCache = () => {
      const m = fromManualRec(cur, date); // un curs manual salvat explicit pentru ziua exactă are prioritate
      if (m) {
        const eur = cur === 'EUR' ? { eurRon: m.ronPerUnit } : (fromBnr('EUR', target) || fromEcb(ecbSource, 'EUR', target) || null);
        const eurRon = cur === 'EUR' ? m.ronPerUnit : eur && eur.eurRon;
        return finish(cur, { ...m, eurRon, eurSource: eur ? eur.source : null }, { manual: true, source: 'manual' });
      }
      const b = fromBnr(cur, target);
      if (b) return finish(cur, b, {});
      for (const s of ['ecb-v1', 'ecb-v2']) { const e = fromEcb(s, cur, target); if (e) return finish(cur, e, {}); }
      return null;
    };
    let r = tryCache();
    if (r) return r;
    if (canFetch()) {
      try {
        const got = await fetchEcb(cur, date);
        r = tryCache();
        if (r) return r;
        // Frankfurter întoarce ultima zi disponibilă <= data cerută (weekend/sărbătoare): folosim exact acea dată
        const d = got.filter((x) => x <= date).sort().pop();
        if (d) { const e = fromEcb(ecbSource, cur, d); if (e) { aliasDate.set(target0, d); return finish(cur, e, {}); } }
      } catch { /* cădere la ultimul curs cunoscut */ }
    }
    const lk = lastKnown(cur, date);
    if (lk) return lk;
    if (cur === 'RON') return { ronPerUnit: '1', eurPerUnit: null, rateDate: date, source: 'ron', manual: false, stale: true, eurSource: null };
    throw new FxError('NO_RATE', `Nu există niciun curs pentru ${cur} (data ${date}). Introdu un curs manual.`, { currency: cur, date });
  }

  /** Cel mai apropiat curs cunoscut (preferă <= data), oricare sursă ⇒ stale. */
  function lastKnown(cur, date) {
    const cand = [];
    for (const s of ['bnr', 'manual', 'ecb-v1', 'ecb-v2']) {
      const probe = cur === 'RON' || cur === 'EUR' ? (s === 'bnr' || s === 'manual' ? 'EUR' : 'RON') : cur;
      const arr = index().dates.get(`${s}|${probe}`) || [];
      for (const d of arr) cand.push({ s, d });
    }
    if (!cand.length) return null;
    const before = cand.filter((c) => c.d <= date).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : prio(a.s) - prio(b.s)));
    const after = cand.filter((c) => c.d > date).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : prio(a.s) - prio(b.s)));
    for (const c of [...before, ...after]) {
      let p = null;
      if (c.s === 'bnr') p = fromBnrExact(cur, c.d);
      else if (c.s === 'manual') p = manualExact(cur, c.d);
      else p = fromEcb(c.s, cur, c.d);
      if (p) return { ...finish(cur, p, { stale: true, source: 'last-known', manual: c.s === 'manual' }), source: cur === 'RON' ? 'ron' : 'last-known' };
    }
    return null;
  }
  function prio(s) { return s === 'bnr' ? 0 : s === 'manual' ? 1 : 2; }
  function fromBnrExact(cur, d) {
    const eur = rec('bnr', 'EUR', d);
    if (!eur) return null;
    if (cur === 'RON') return { ronPerUnit: '1', eurRon: eur.ronPerUnit, rateDate: d, source: 'bnr', eurSource: 'bnr' };
    if (cur === 'EUR') return { ronPerUnit: eur.ronPerUnit, eurRon: eur.ronPerUnit, rateDate: d, source: 'bnr', eurSource: 'bnr' };
    const x = rec('bnr', cur, d);
    return x ? { ronPerUnit: x.ronPerUnit, eurRon: eur.ronPerUnit, rateDate: d, source: 'bnr', eurSource: 'bnr' } : null;
  }
  function manualExact(cur, d) {
    if (cur === 'RON') {
      const e = rec('manual', 'EUR', d);
      return e ? { ronPerUnit: '1', eurRon: e.ronPerUnit, rateDate: d, source: 'manual', eurSource: 'manual' } : null;
    }
    const x = rec('manual', cur, d);
    if (!x) return null;
    const e = cur === 'EUR' ? x : rec('manual', 'EUR', d);
    return { ronPerUnit: x.ronPerUnit, eurRon: e ? e.ronPerUnit : null, rateDate: d, source: 'manual', eurSource: e ? 'manual' : null };
  }

  /** Aduce din BCE cursurile pentru un interval (o singură cerere), ca să fie în cache pentru intrările/șabloanele viitoare. */
  async function prefetch(curs, from, to) {
    if (!canFetch()) return;
    const symbols = [...new Set(['RON', ...curs.filter((c) => c !== 'EUR')])];
    try {
      const json = await fetchJson(ecbUrl(from, to, symbols));
      await storeEcb(normalizeEcb(json));
    } catch { /* prefetch este doar o optimizare */ }
  }

  /**
   * Curs introdus manual de utilizator (sincron). `eurRon` opțional = cursul EUR/RON al zilei, pentru valoarea EUR înghețată;
   * dacă lipsește, se caută în cache (BNR, apoi BCE, apoi manual), altfel eurPerUnit rămâne null.
   * @returns {RateResult}
   */
  function fromManual(cur, date, ronPerUnit, source = 'manual', eurRon) {
    const rate = toDecimalStr(ronPerUnit);
    if (!isPositiveRate(rate)) throw new FxError('BAD_RATE', 'Cursul trebuie să fie un număr pozitiv.');
    let eurPerUnit = null, eurSource = null;
    if (cur === 'EUR') { eurPerUnit = '1'; eurSource = source; }
    else {
      let er = eurRon ? toDecimalStr(eurRon) : null;
      if (er) eurSource = source;
      if (!er) {
        const t = lastBusinessDay(date);
        const p = fromBnr('EUR', t) || fromEcb(ecbSource, 'EUR', t) || (rec('manual', 'EUR', date) ? { eurRon: rec('manual', 'EUR', date).ronPerUnit, source: 'manual' } : null);
        if (p) { er = p.eurRon || p.ronPerUnit; eurSource = p.source; }
      }
      if (er) eurPerUnit = cur === 'RON' ? rateDivide('1', er) : rateDivide(rate, er);
    }
    return { ronPerUnit: cur === 'RON' ? '1' : rate, eurPerUnit, rateDate: date, source: cur === 'RON' ? 'ron' : source, manual: true, stale: false, eurSource };
  }

  /** Salvează un curs manual în cache pentru ziua exactă (vizibil și pentru intrările următoare din aceeași zi). */
  async function saveManualRate(cur, date, ronPerUnit) {
    const t = nowIso();
    const r = { id: rateId('manual', cur, date), date, currency: cur, source: 'manual', ronPerUnit: toDecimalStr(ronPerUnit), perEur: null, createdAt: t, updatedAt: t };
    await store.putMany('rates', [r]);
    invalidate();
    return r;
  }

  /** „Lipește XML BNR”: parsează și salvează toate zilele din fișier. Întoarce { days, rates, from, to }. */
  async function importBnrXml(xml) {
    const parsed = parseBnrXml(xml);
    const t = nowIso();
    const recs = [];
    for (const cube of parsed.cubes) {
      for (const [cur, v] of Object.entries(cube.rates)) {
        recs.push({ id: rateId('bnr', cur, cube.date), date: cube.date, currency: cur, source: 'bnr', ronPerUnit: v, perEur: null, createdAt: t, updatedAt: t });
      }
    }
    await store.putMany('rates', recs);
    invalidate();
    return { days: parsed.cubes.length, rates: recs.length, from: parsed.cubes[0].date, to: parsed.cubes[parsed.cubes.length - 1].date };
  }

  /** Câte din sumele dintr-o listă folosesc un curs care nu e BNR (pentru avertizarea de pe Acasă). */
  function isNonBnrSource(source) { return !(source === 'bnr' || source === 'bnr-manual' || source === 'ron'); }

  return { getRate, prefetch, fromManual, parseBnrXml, saveManualRate, importBnrXml, isNonBnrSource, _invalidate: invalidate };
}

