// Profit pe camion / flotă (secțiunile 5.4, 5.5, 8.1, 10.7 din docs/DEV-PLAN.md).
// Calcul pur: primește starea ca argument, nu citește din store, nu are I/O. Toți banii sunt întregi (Minor);
// împărțirile trec prin mulDiv/allocate din core/money.js.
//
// Convenții (abateri / precizări față de 10.7, vezi raportul modulului):
//  - Pnl.cost  = costuri DIRECTE (țintite pe camion / remorca lui atribuită), nete de recuperări.
//  - Pnl.costTotal = cost + overhead repartizat + amortizare (dacă e inclusă). profitOp = revenue − costTotal.
//  - Interval = { from, to } inclusiv. O intrare aparține intervalului după „data de ancorare”: data ei dacă
//    accrualMonth = luna datei, altfel prima zi a lunii accrualMonth. Cotele de `spread` se ancorează în ziua 1 a lunii.
//  - Starea (DbState) se citește tolerant: state.collections[nume] | state[nume], tablou | Map | obiect pe id.
import { allocate, convert, mulDiv, rateDiv } from '../core/money.js';
import { daysInMonth, diffDays, eachDay, eachMonth, monthKey, monthRange } from '../core/dates.js';
import { depreciationForMonth } from './financing.js';
import { computeEmptyKm } from './emptyKm.js';
import { allocateOverhead, fleetDaysBasis } from './allocation.js';
import { computeMonthTotals } from './closing.js';

// ---------------------------------------------------------------- selectoare tolerante
const EMPTY = Object.freeze([]);

/** Colecție ca tablou, fără înregistrări șterse logic. */
export function coll(state, name) {
  if (!state) return EMPTY;
  const raw = state.collections?.[name] ?? state[name];
  if (!raw) return EMPTY;
  const arr = Array.isArray(raw) ? raw : raw instanceof Map ? [...raw.values()] : Object.values(raw);
  return arr.filter((r) => r && !r.deletedAt);
}
export function singleton(state, key) {
  return state?.singletons?.[key] ?? state?.[key] ?? null;
}
export const COMPANY_DEFAULTS = Object.freeze({
  name: '', countryCode: 'RO', vatPayer: true, reportingCurrency: 'RON', revenueRecognition: 'prorata',
  overheadAllocation: 'daysInFleet', profitIncludesDepreciation: true, closedThrough: null, homeBase: 'Orașu Nou',
  longStopHours: 6, excludeAutoPendingFromProfit: false, noDocCeilingMinor: 20000, noDocCeilingMonthlyPerTruckMinor: 100000,
});
export function companyOf(state) {
  return { ...COMPANY_DEFAULTS, ...(singleton(state, 'company') || {}) };
}

/** Memoizare pe referința stării (starea e imuabilă, referință nouă la fiecare revizie). */
const MEMO = new WeakMap();
export function memo(state, key, fn) {
  if (!state || typeof state !== 'object') return fn();
  let m = MEMO.get(state);
  if (!m) { m = new Map(); MEMO.set(state, m); }
  if (m.has(key)) return m.get(key);
  const v = fn();
  m.set(key, v);
  return v;
}

export const monthOf = (d) => d.slice(0, 7);
const maxD = (a, b) => (a > b ? a : b);
const minD = (a, b) => (a < b ? a : b);
export function rangeOfMonth(m) { return monthRange(m); }
export function clipRange(r, s) {
  const from = maxD(r.from, s.from), to = minD(r.to, s.to);
  return from > to ? null : { from, to };
}
export function rangeDays(r) { return diffDays(r.from, r.to) + 1; }
const inRange = (d, r) => d >= r.from && d <= r.to;

const BNR_SOURCES = new Set(['bnr', 'bnr-manual', 'ron']);
export const isBnrSource = (s) => BNR_SOURCES.has(s);

// ---------------------------------------------------------------- indexuri
function trucksOf(state) { return coll(state, 'trucks'); }

/** { truckId: [{date, kmM}] } sortat după dată. */
export function gpsIndex(state) {
  return memo(state, 'gpsIndex', () => {
    const m = new Map();
    for (const d of coll(state, 'gpsDays')) {
      if (!d.truckId || !d.date) continue;
      let a = m.get(d.truckId);
      if (!a) m.set(d.truckId, (a = []));
      a.push(d);
    }
    for (const a of m.values()) a.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return m;
  });
}
/** Σ km GPS (metri) ale camionului în interval; null dacă nu există nicio zi GPS în interval. */
export function gpsKmInRange(state, truckId, range) {
  const a = gpsIndex(state).get(truckId);
  if (!a) return null;
  let s = 0, n = 0;
  for (const d of a) {
    if (d.date < range.from) continue;
    if (d.date > range.to) break;
    s += d.kmM || 0; n++;
  }
  return n ? s : null;
}

/** Intervalul restrâns la acoperirea GPS a camionului (prima..ultima zi GPS), ca costul și km să fie pe aceeași perioadă. null dacă nu se suprapun. */
function clipToGps(state, truckId, range) {
  const a = gpsIndex(state).get(truckId);
  if (!a || !a.length) return null;
  const from = a[0].date > range.from ? a[0].date : range.from;
  const to = a[a.length - 1].date < range.to ? a[a.length - 1].date : range.to;
  return from <= to ? { from, to } : null;
}

function closuresByMonth(state) {
  return memo(state, 'closures', () => {
    const m = new Map();
    for (const c of coll(state, 'closures')) m.set(c.month ?? c.id, c);
    return m;
  });
}

function assignmentsOf(state) {
  return memo(state, 'assignments', () => {
    const m = new Map();
    for (const a of coll(state, 'trailerAssignments')) {
      let l = m.get(a.trailerId);
      if (!l) m.set(a.trailerId, (l = []));
      l.push(a);
    }
    return m;
  });
}
/** Camionul căruia i-a fost atribuită remorca la dată (sau null ⇒ cost comun). */
export function truckForTrailer(state, trailerId, date) {
  const l = assignmentsOf(state).get(trailerId);
  if (!l) return null;
  let best = null;
  for (const a of l) {
    if (a.from <= date && (!a.to || a.to >= date)) { if (!best || a.from > best.from) best = a; }
  }
  return best ? best.truckId : null;
}

// ---------------------------------------------------------------- linii de cost
/**
 * Transformă intrările în „linii” atomice, datate: o intrare ⇒ 1 linie, sau N linii pentru `spread`.
 * kind: 'cost' | 'cashOnly' | 'revenue' | 'recovery'. v = { RON, EUR } (Minor; recuperarea e negativă).
 */
export function ledgerLines(state) {
  return memo(state, 'ledgerLines', () => {
    const company = companyOf(state);
    const truckIds = new Set(trucksOf(state).map((t) => t.id));
    const cats = new Map(coll(state, 'categories').map((c) => [c.id, c]));
    const lines = [];
    const push = (e, kind, anchor, v, catId, truckId, noDocVal) => {
      lines.push({
        entryId: e.id, kind, anchor, month: monthOf(anchor), v, noDoc: noDocVal, categoryId: catId, truckId,
        provisional: e.status === 'auto_pending', source: e.fx?.source ?? null, documentation: e.documentation,
        // valoarea înghețată în moneda de raportare lipsește (ex. intrare RON fără curs EUR): costul nu apare în acea monedă
        missing: { RON: !(e.ron && e.ron.cost != null || e.ron && e.ron.net != null), EUR: !(e.eur && (e.eur.cost != null || e.eur.net != null)) },
      });
    };
    for (const e of coll(state, 'entries')) {
      if (e.parentDocId) continue;                       // detaliu al unui document consolidat: costul îl poartă părintele
      if (e.status === 'auto_pending' && company.excludeAutoPendingFromProfit) continue;
      const acc = e.accrualMonth || monthOf(e.date);
      const anchor = monthOf(e.date) === acc ? e.date : acc + '-01';
      let truckId = null;
      if (e.target?.type === 'truck') truckId = truckIds.has(e.target.truckId) ? e.target.truckId : null;
      else if (e.target?.type === 'trailer') truckId = truckForTrailer(state, e.target.trailerId, e.date);
      if (e.kind === 'income') {
        if (e.incomeType === 'other') push(e, 'revenue', anchor, { RON: e.ron?.net ?? 0, EUR: e.eur?.net ?? 0 }, e.categoryId, truckId, 0);
        else if (e.incomeType === 'recovery') {
          const target = cats.get(e.categoryId)?.offsetsCategoryId || e.categoryId;
          push(e, 'recovery', anchor, { RON: -(e.ron?.net ?? 0), EUR: -(e.eur?.net ?? 0) }, target, truckId, 0);
        }
        continue;                                        // 'freight': venitul vine doar din curse (D12)
      }
      const cashOnly = e.costClass === 'cashOnly';
      const rc = e.ron?.cost ?? 0, ec = e.eur?.cost ?? 0;
      const none = e.documentation === 'none';
      const kind = cashOnly ? 'cashOnly' : 'cost';
      const sp = e.spread;
      if (sp && sp.from && sp.to && !cashOnly) {
        const months = eachMonth(sp.from.slice(0, 7), sp.to.slice(0, 7));
        if (months.length > 1) {
          const w = months.map(() => 1);
          const r = allocate(rc, w), el = allocate(ec, w);
          months.forEach((m, i) => push(e, kind, m + '-01', { RON: r[i], EUR: el[i] }, e.categoryId, truckId, none ? { RON: r[i], EUR: el[i] } : 0));
          continue;
        }
      }
      push(e, kind, anchor, { RON: rc, EUR: ec }, e.categoryId, truckId, none ? { RON: rc, EUR: ec } : 0);
    }
    return lines;
  });
}
const noDocOf = (line, cur) => (line.noDoc ? line.noDoc[cur] : 0);

// ---------------------------------------------------------------- venit din curse
const REV_CACHE = new WeakMap();
function daySlices(course, cur) {
  let m = REV_CACHE.get(course);
  if (!m) REV_CACHE.set(course, (m = {}));
  if (m[cur]) return m[cur];
  const net = (cur === 'EUR' ? course.eur?.net : course.ron?.net) ?? 0;
  const days = eachDay(course.loadDate, course.unloadDate >= course.loadDate ? course.unloadDate : course.loadDate);
  const parts = allocate(net, days.map(() => 1));
  return (m[cur] = { days, parts, net });
}

/** Venitul unei curse în `month` după modul de recunoaștere (5.4). Util și pentru închidere. */
export function courseRevenueForMonth(course, mode, month, cur = 'RON') {
  return courseRevenueSlice(course, mode, month, cur, null);
}
function courseRevenueSlice(course, mode, month, cur, range) {
  const net = (cur === 'EUR' ? course.eur?.net : course.ron?.net) ?? 0;
  if (!net || !course.loadDate) return 0;
  const unload = course.unloadDate >= course.loadDate ? course.unloadDate : course.loadDate;
  if (mode === 'load') {
    const d = course.loadDate;
    return monthOf(d) === month && (!range || inRange(d, range)) ? net : 0;
  }
  if (mode === 'unload') {
    return monthOf(unload) === month && (!range || inRange(unload, range)) ? net : 0;
  }
  const { days, parts } = daySlices(course, cur);
  let s = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (monthOf(d) !== month) continue;
    if (range && !inRange(d, range)) continue;
    s += parts[i];
  }
  return s;
}

function recognitionFor(state, month, requested) {
  const cl = closuresByMonth(state).get(month);
  return cl?.recognition || requested || companyOf(state).revenueRecognition || 'prorata';
}

/** Venitul unei curse în interval, cu modul de recunoaștere al fiecărei luni (luna închisă ⇒ modul din Closure). */
export function courseRevenueInRange(state, course, range, cur, requested) {
  if (!course.loadDate) return 0;
  const unload = course.unloadDate >= course.loadDate ? course.unloadDate : course.loadDate;
  const months = eachMonth(monthOf(course.loadDate), monthOf(unload));
  let s = 0;
  for (const m of months) {
    const mr = rangeOfMonth(m);
    if (!clipRange(range, mr)) continue;
    s += courseRevenueSlice(course, recognitionFor(state, m, requested), m, cur, range);
  }
  return s;
}

function coursesByTruck(state) {
  return memo(state, 'coursesByTruck', () => {
    const m = new Map();
    for (const c of coll(state, 'courses')) {
      const k = c.truckId || '';
      let a = m.get(k);
      if (!a) m.set(k, (a = []));
      a.push(c);
    }
    return m;
  });
}

// ---------------------------------------------------------------- finanțare / conversii
function eurPerRon(state, asOf) {
  return memo(state, 'eurPerRon|' + asOf, () => {
    let best = null;
    for (const e of coll(state, 'entries')) {
      const g = e.ron?.gross, el = e.eur?.gross;
      if (!g || !el || e.date > asOf) continue;
      if (!best || e.date > best.date) best = { date: e.date, eur: el, ron: g };
    }
    if (!best) for (const e of coll(state, 'entries')) {
      if (e.ron?.gross && e.eur?.gross) { best = { date: e.date, eur: e.eur.gross, ron: e.ron.gross }; break; }
    }
    return best;
  });
}
/** Conversie RON↔EUR cu raportul valorilor înghețate recente (RateStr exact). Alte monede ⇒ null. */
export function toReporting(state, minor, fromCur, cur, asOf) {
  if (fromCur === cur) return minor;
  const r = eurPerRon(state, asOf);
  if (r === null) return null;
  if (fromCur === 'RON' && cur === 'EUR') return convert(minor, 'RON', 'EUR', rateDiv(String(r.eur), String(r.ron)));
  if (fromCur === 'EUR' && cur === 'RON') return convert(minor, 'EUR', 'RON', rateDiv(String(r.ron), String(r.eur)));
  return null;
}

const DEPRECIATED_TYPES = new Set(['financial', 'credit', 'cash']);
function depreciationFor(state, truckId, range, cur, onSkip) {
  let total = 0;
  for (const f of coll(state, 'financing')) {
    if (f.truckId !== truckId || !DEPRECIATED_TYPES.has(f.type)) continue;
    for (const m of eachMonth(monthOf(range.from), monthOf(range.to))) {
      const full = depreciationForMonth(f, m);
      if (!full) continue;
      const mr = rangeOfMonth(m);
      const seg = clipRange(range, mr);
      if (!seg) continue;
      const part = rangeDays(seg) === rangeDays(mr) ? full : mulDiv(full, rangeDays(seg), rangeDays(mr));
      const conv = toReporting(state, part, f.currency || 'RON', cur, seg.to);
      if (conv !== null) total += conv; else if (onSkip) onSkip(f);
    }
  }
  return total;
}

// ---------------------------------------------------------------- repartizarea costurilor comune pe luni
function activeTrucks(state, range) {
  return trucksOf(state).filter((t) => (!t.activeFrom || t.activeFrom <= range.to) && (!t.activeTo || t.activeTo >= range.from));
}

/** Parte din costurile comune per camion pentru fiecare lună din interval. */
function overheadByTruck(state, range, cur, lines, o = {}) {
  const company = companyOf(state);
  const trucks = trucksOf(state);
  const res = { byTruck: new Map(), noDocByTruck: new Map(), unallocated: 0, unallocatedNoDoc: 0 };
  for (const t of trucks) { res.byTruck.set(t.id, 0); res.noDocByTruck.set(t.id, 0); }
  const pool = new Map(), poolNd = new Map();
  for (const l of lines) {
    if (l.truckId || (l.kind !== 'cost' && l.kind !== 'recovery' && l.kind !== 'revenue')) continue;
    if (l.kind === 'revenue' || !inRange(l.anchor, range)) continue;
    pool.set(l.month, (pool.get(l.month) || 0) + l.v[cur]);
    poolNd.set(l.month, (poolNd.get(l.month) || 0) + noDocOf(l, cur));
  }
  for (const [m, total] of pool) {
    const mr = rangeOfMonth(m);
    const cl = closuresByMonth(state).get(m);
    const kmByTruck = {};
    for (const t of trucks) { const k = gpsKmInRange(state, t.id, mr); if (k) kmByTruck[t.id] = k; }
    const common = { trucks, range: mr, mode: company.overheadAllocation || 'daysInFleet', kmByTruck, basis: o.basis || cl?.allocationBasis };
    const parts = allocateOverhead({ ...common, overheadMinor: total, seedKey: m });
    const nd = poolNd.get(m) || 0;
    const partsNd = nd ? allocateOverhead({ ...common, overheadMinor: nd, seedKey: m + '|nodoc' }) : {};
    let given = 0, givenNd = 0;
    for (const [id, v] of Object.entries(parts)) { res.byTruck.set(id, (res.byTruck.get(id) || 0) + v); given += v; }
    for (const [id, v] of Object.entries(partsNd)) { res.noDocByTruck.set(id, (res.noDocByTruck.get(id) || 0) + v); givenNd += v; }
    res.unallocated += total - given;
    res.unallocatedNoDoc += nd - givenNd;
  }
  return res;
}

// ---------------------------------------------------------------- Pnl
function emptyKmFor(state, truckId, range) {
  return memo(state, `emptyKm|${truckId}|${range.from}|${range.to}`, () => {
    const gpsDays = (gpsIndex(state).get(truckId) || []);
    if (!gpsDays.length) return { gpsM: null, loadedM: 0, emptyM: null };
    const trips = coll(state, 'gpsTrips').filter((t) => t.truckId === truckId);
    const courses = coursesByTruck(state).get(truckId) || [];
    const r = computeEmptyKm({ truckIds: [truckId], range, granularity: 'month', courses, gpsDays, gpsTrips: trips, aliases: coll(state, 'aliases'), company: companyOf(state) });
    let gps = 0, loaded = 0, empty = 0, any = false;
    for (const row of r.rows) {
      if (row.truckId !== truckId || row.gpsM === null || row.gpsM === undefined) continue;
      any = true; gps += row.gpsM; loaded += row.loadedM || 0; empty += row.emptyM || 0;
    }
    return any ? { gpsM: gps, loadedM: loaded, emptyM: empty } : { gpsM: null, loadedM: 0, emptyM: null };
  });
}

const CONF_ORDER = { high: 3, medium: 2, low: 1 };

/** Fereastra mobilă de 3 luni pentru costurile varKm (5.4): intervalul întreg dacă ≥ 3 luni, altfel 3 luni care se termină în luna intervalului. */
export function rollingWindow(range) {
  const months = eachMonth(monthOf(range.from), monthOf(range.to));
  if (months.length >= 3) return { range, rolling: false };
  return { range: { from: monthShift(monthOf(range.to), -2) + '-01', to: range.to }, rolling: true };
}

function varKmCategories(state) {
  return memo(state, 'varKmCats', () => new Set(coll(state, 'categories').filter((c) => c.varKm).map((c) => c.id)));
}

/** Σ costuri directe pe camion în interval: { all, varKm } (Minor în moneda de raportare, nete de recuperări). */
function directCostIn(state, truckId, range, cur) {
  const vk = varKmCategories(state);
  let all = 0, varKm = 0;
  for (const l of ledgerLines(state)) {
    if (l.truckId !== truckId || l.kind === 'revenue' || l.kind === 'cashOnly' || !inRange(l.anchor, range)) continue;
    all += l.v[cur];
    if (vk.has(l.categoryId)) varKm += l.v[cur];
  }
  return { all, varKm };
}

/**
 * Rate de cost pentru un camion la o dată (folosite de „Merită cursa?” și de profit/km).
 * varPerKmMilli = cost variabil pe km în miimi de unitate minoră (Minor·1000/km); fixedPerDay = Minor/zi.
 */
export function costRates(state, truckId, asOf, o = {}) {
  const cur = o.currency || 'RON';
  const wnd = o.window || completeMonthsWindow(asOf);
  const calc = (w0) => {
    const w = clipToGps(state, truckId, w0) || w0;
    const gpsM = gpsKmInRange(state, truckId, w);
    const dc = directCostIn(state, truckId, w, cur);
    return { w, gpsM, dc };
  };
  let r = calc(wnd);
  if (!o.window && (!r.gpsM || !r.dc.all)) r = calc({ from: monthShift(monthOf(asOf), -2) + '-01', to: asOf });
  const w = r.w;
  const lines = ledgerLines(state);
  const oh = overheadByTruck(state, w, cur, lines);
  const overhead = oh.byTruck.get(truckId) || 0;
  const dep = depreciationFor(state, truckId, w, cur);
  const incl = o.includeDepreciation ?? companyOf(state).profitIncludesDepreciation;
  const fixed = r.dc.all - r.dc.varKm + overhead + (incl ? dep : 0);
  const t = trucksOf(state).find((x) => x.id === truckId);
  const days = t ? Math.max(1, (() => {
    const c = clipRange(w, { from: t.activeFrom || w.from, to: t.activeTo || w.to });
    return c ? rangeDays(c) : 0;
  })()) : rangeDays(w);
  const km = r.gpsM;
  return {
    window: w, currency: cur, gpsM: km, days, varCost: r.dc.varKm, fixedCost: fixed,
    varPerKmMilli: km ? mulDiv(r.dc.varKm, 1000000, km) : null,
    fullPerKmMilli: km ? mulDiv(r.dc.varKm + fixed, 1000000, km) : null,
    fixedPerDay: days ? mulDiv(fixed, 1, days) : null,
  };
}
function monthShift(m, k) {
  let [y, mm] = m.split('-').map(Number);
  mm += k;
  while (mm < 1) { mm += 12; y--; }
  while (mm > 12) { mm -= 12; y++; }
  return `${String(y).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}
/** Ultimele 3 luni complete dinaintea lunii datei. */
function completeMonthsWindow(asOf) {
  const m = monthOf(asOf);
  return { from: monthShift(m, -3) + '-01', to: monthRange(monthShift(m, -1)).to };
}

function pnlKey(range, o) {
  return `pnl|${range.from}|${range.to}|${o.currency || 'RON'}|${o.recognition || ''}|${o.includeDepreciation ?? ''}|${o.basis ? JSON.stringify(o.basis) : ''}`;
}

function computeAll(state, range, o = {}) {
  return memo(state, pnlKey(range, o), () => {
    const cur = o.currency === 'EUR' ? 'EUR' : 'RON';
    const company = companyOf(state);
    const includeDep = o.includeDepreciation ?? company.profitIncludesDepreciation;
    const trucks = trucksOf(state);
    const lines = ledgerLines(state);
    const oh = overheadByTruck(state, range, cur, lines, o);
    const out = {};
    const truckSet = new Set(trucks.map((t) => t.id));
    const recogLabel = (() => {
      const set = new Set(eachMonth(monthOf(range.from), monthOf(range.to)).map((m) => recognitionFor(state, m, o.recognition)));
      return set.size === 1 ? [...set][0] : 'mixt';
    })();

    for (const t of trucks) {
      out[t.id] = {
        revenue: 0, cost: 0, overhead: oh.byTruck.get(t.id) || 0, depreciation: 0, depreciationIncluded: !!includeDep, cashOnly: 0,
        provisionalCount: 0, recognition: recogLabel, fxSources: [], nonBnrCount: 0, currency: cur,
        profitOp: 0, profitDoc: 0, noDocCost: oh.noDocByTruck.get(t.id) || 0, costTotal: 0,
        km: { gpsM: null, loadedM: 0, emptyM: null }, perKm: { revenue: null, cost: null, profit: null, estimated: false },
        byCategory: [], refs: { entryIds: [], courseIds: [] }, lowConfidence: false, kmConfidence: null,
      };
    }
    const cat = new Map();
    const warn = { missingConversionEntries: [], missingConversionCourses: [], depreciationUnconverted: 0 };
    const seenEntry = new Set();
    const srcByTruck = new Map(trucks.map((t) => [t.id, new Set()]));
    const nonBnr = new Map(trucks.map((t) => [t.id, new Set()]));
    let unallocatedRevenue = 0;
    for (const l of lines) {
      if (!inRange(l.anchor, range)) continue;
      if (l.kind === 'revenue' && (!l.truckId || !truckSet.has(l.truckId))) { unallocatedRevenue += l.v[cur]; continue; }   // alt venit comun
      if (l.missing && l.missing[cur] && l.entryId && !warn.missingConversionEntries.includes(l.entryId)) warn.missingConversionEntries.push(l.entryId);
      if (!l.truckId || !truckSet.has(l.truckId)) continue;
      const p = out[l.truckId];
      const v = l.v[cur];
      if (l.kind === 'revenue') p.revenue += v;
      else if (l.kind === 'cashOnly') p.cashOnly += v;
      else {
        p.cost += v;
        p.noDocCost += noDocOf(l, cur);
        let c = cat.get(l.truckId);
        if (!c) cat.set(l.truckId, (c = new Map()));
        const r = c.get(l.categoryId) || { categoryId: l.categoryId, cost: 0, noDoc: 0 };
        r.cost += v; r.noDoc += noDocOf(l, cur);
        c.set(l.categoryId, r);
      }
      if (!seenEntry.has(l.truckId + '|' + l.entryId)) {
        seenEntry.add(l.truckId + '|' + l.entryId);
        p.refs.entryIds.push(l.entryId);
        if (l.provisional) p.provisionalCount++;
        if (l.source) { srcByTruck.get(l.truckId).add(l.source); if (!isBnrSource(l.source)) nonBnr.get(l.truckId).add(l.entryId); }
      }
    }
    const unalloc = [];
    for (const [tid, list] of coursesByTruck(state)) {
      for (const c of list) {
        const rev = courseRevenueInRange(state, c, range, cur, o.recognition);
        if (cur === 'EUR' && !(c.eur && c.eur.net != null) && (c.ron?.net || 0) && c.loadDate && inRange(c.loadDate, range)) warn.missingConversionCourses.push(c.id);
        if (!rev && !(c.loadDate && inRange(c.loadDate, range))) continue;
        if (!truckSet.has(tid)) { unallocatedRevenue += rev; if (rev) unalloc.push(c.id); continue; }
        const p = out[tid];
        p.revenue += rev;
        if (rev || (c.loadDate && inRange(c.loadDate, range))) p.refs.courseIds.push(c.id);
        if (c.fx?.source) { srcByTruck.get(tid).add(c.fx.source); if (!isBnrSource(c.fx.source)) nonBnr.get(tid).add(c.id); }
        const conf = c.loadedKm?.confidence;
        if (rev && conf && (p.kmConfidence === null || CONF_ORDER[conf] < CONF_ORDER[p.kmConfidence])) p.kmConfidence = conf;
      }
    }
    const win = rollingWindow(range);
    for (const t of trucks) {
      const p = out[t.id];
      p.depreciation = depreciationFor(state, t.id, range, cur, () => { warn.depreciationUnconverted++; });
      p.costTotal = p.cost + p.overhead + (includeDep ? p.depreciation : 0);
      p.profitOp = p.revenue - p.costTotal;
      p.profitDoc = p.revenue - (p.costTotal - p.noDocCost);
      p.fxSources = [...srcByTruck.get(t.id)].sort();
      p.nonBnrCount = nonBnr.get(t.id).size;
      p.byCategory = [...(cat.get(t.id)?.values() || [])].sort((a, b) => b.cost - a.cost);
      p.lowConfidence = p.kmConfidence === 'low';
      const km = emptyKmFor(state, t.id, range);
      p.km = km;
      // acoperire GPS incompletă (km doar pentru o parte din interval): venitul/costul pe interval ≠ km ⇒ „—”, nu o valoare înșelătoare
      const span = clipToGps(state, t.id, range);
      const covered = span ? rangeDays(span) / rangeDays(range) : 0;
      p.perKm.coverage = covered;
      if (km.gpsM && covered >= 0.9) {
        // venit / km total, cost / km = (varKm pe fereastră ÷ km fereastră) + (restul costurilor pe interval ÷ km interval)
        // costul variabil și km pe ACEEAȘI acoperire GPS: fereastra mobilă se restrânge la zilele cu date GPS
        const wRange = win.rolling ? (clipToGps(state, t.id, win.range) || range) : range;
        const wDc = directCostIn(state, t.id, wRange, cur);
        const wKm = win.rolling ? gpsKmInRange(state, t.id, wRange) : km.gpsM;
        const rangeDc = directCostIn(state, t.id, range, cur);
        const fixedPart = rangeDc.all - rangeDc.varKm + p.overhead + (includeDep ? p.depreciation : 0);
        const varMilli = wKm ? mulDiv(wDc.varKm, 1000000, wKm) : 0;
        const fixedMilli = mulDiv(fixedPart, 1000000, km.gpsM);
        const costMilli = varMilli + fixedMilli;
        const revMilli = mulDiv(p.revenue, 1000000, km.gpsM);
        p.perKm = {
          revenue: mulDiv(revMilli, 1, 1000), cost: mulDiv(costMilli, 1, 1000), profit: mulDiv(revMilli - costMilli, 1, 1000),
          estimated: win.rolling && rangeDays(range) < daysInMonth(+range.to.slice(0, 4), +range.to.slice(5, 7)),
        };
      }
    }
    return { warnings: warn, trucks: out, unallocatedOverhead: oh.unallocated, unallocatedNoDoc: oh.unallocatedNoDoc, unallocatedRevenue, unallocatedCourseIds: unalloc };
  });
}
/**
 * Pnl al unui camion într-un interval.
 * @param {object} state @param {string} truckId @param {{from:string,to:string}} range
 * @param {{currency?:'RON'|'EUR', recognition?:string, includeDepreciation?:boolean}} [o]
 */
export function truckPnl(state, truckId, range, o = {}) {
  const all = computeAll(state, range, o).trucks;
  if (!all[truckId]) throw new RangeError('camion necunoscut: ' + truckId);
  return all[truckId];
}

const SUM_KEYS = ['revenue', 'cost', 'overhead', 'depreciation', 'cashOnly', 'provisionalCount', 'profitOp', 'profitDoc', 'noDocCost', 'costTotal', 'nonBnrCount'];
/** Pnl pe flotă: total = Σ camioane + costurile comune nerepartizate (AC2 din 8.1). */
export function fleetPnl(state, range, o = {}) {
  const all = computeAll(state, range, o);
  const total = {
    revenue: 0, cost: 0, overhead: 0, depreciation: 0, cashOnly: 0, provisionalCount: 0, profitOp: 0, profitDoc: 0, noDocCost: 0,
    costTotal: 0, nonBnrCount: 0, currency: o.currency === 'EUR' ? 'EUR' : 'RON', recognition: null, fxSources: [],
    km: { gpsM: null, loadedM: 0, emptyM: null }, refs: { entryIds: [], courseIds: [] },
  };
  const srcs = new Set();
  let anyGps = false, gps = 0, loaded = 0, empty = 0;
  for (const p of Object.values(all.trucks)) {
    for (const k of SUM_KEYS) total[k] += p[k];
    total.recognition = p.recognition;
    p.fxSources.forEach((s) => srcs.add(s));
    total.refs.entryIds.push(...p.refs.entryIds); total.refs.courseIds.push(...p.refs.courseIds);
    if (p.km.gpsM !== null) { anyGps = true; gps += p.km.gpsM; loaded += p.km.loadedM; empty += p.km.emptyM || 0; }
  }
  total.revenue += all.unallocatedRevenue;
  total.overhead += all.unallocatedOverhead;
  total.costTotal += all.unallocatedOverhead;
  total.noDocCost += all.unallocatedNoDoc;
  total.profitOp = total.revenue - total.costTotal;
  total.profitDoc = total.revenue - (total.costTotal - total.noDocCost);
  total.fxSources = [...srcs].sort();
  if (anyGps) total.km = { gpsM: gps, loadedM: loaded, emptyM: empty };
  total.includeDepreciation = o.includeDepreciation ?? companyOf(state).profitIncludesDepreciation;
  return {
    total, warnings: all.warnings, trucks: all.trucks, unallocatedOverhead: all.unallocatedOverhead, unallocatedRevenue: all.unallocatedRevenue,
  };
}

/**
 * Clasamentul camioanelor pentru Acasă: cel mai slab primul (după profit operațional).
 * Rândurile cu încredere scăzută a km nu afișează valori pe km decât cu `includeApprox`.
 */
export function fleetRanking(state, range, o = {}) {
  const f = fleetPnl(state, range, o);
  const trucks = trucksOf(state);
  const rows = trucks.map((t) => {
    const p = f.trucks[t.id];
    const hide = p.lowConfidence && !o.includeApprox;
    return {
      truckId: t.id, plate: t.plate, plateDisplay: t.plateDisplay || t.plate, revenue: p.revenue, cost: p.costTotal, profit: p.profitOp,
      profitPerKm: hide ? null : p.perKm.profit, revenuePerKm: hide ? null : p.perKm.revenue,
      pctEmpty: p.km.gpsM ? (p.km.emptyM || 0) / p.km.gpsM : null, approx: p.kmConfidence === 'medium' || p.kmConfidence === 'low',
      lowConfidence: p.lowConfidence, gpsM: p.km.gpsM, provisionalCount: p.provisionalCount,
    };
  });
  rows.sort((a, b) => a.profit - b.profit || (a.plate < b.plate ? -1 : 1));
  return { rows, total: f.total, unallocatedOverhead: f.unallocatedOverhead };
}

/** Km GPS pe flotă în interval (pentru ponderi). */
export function fleetGpsKm(state, range) {
  const out = {};
  for (const t of trucksOf(state)) { const k = gpsKmInRange(state, t.id, range); if (k) out[t.id] = k; }
  return out;
}


/**
 * Adaptor pentru `closeMonth(store, month, { compute })` din closing.js: totalurile înghețate în Closure sunt EXACT cele ale
 * rapoartelor (profit.js). `lines` / `provisionalCount` rămân cele din closing.js, ca hash-ul `snapshotHash` să fie verificabil
 * de `verifyClosure`. Folosire: `closeMonth(store, m, { ackWarnings, compute: closingCompute })`.
 */
export function closingCompute(state, month, o = {}) {
  const base = computeMonthTotals(state, month, o);
  const range = rangeOfMonth(month);
  const f = fleetPnl(state, range, { currency: 'RON', recognition: o.recognition, basis: o.basis || base.allocationBasis });
  const byTruck = {};
  for (const [id, p] of Object.entries(f.trucks)) {
    if (!(id in base.allocationBasis) && !p.revenue && !p.cost && !p.overhead) continue;
    const dep = p.depreciationIncluded ? p.depreciation : 0;
    byTruck[id] = { revenue: p.revenue, cost: p.cost, overhead: p.overhead, depreciation: dep, cashOnly: p.cashOnly, profit: p.profitOp };
  }
  const t = f.total;
  const totals = {
    fleet: {
      revenue: t.revenue, cost: t.costTotal, profit: t.profitOp, depreciation: t.includeDepreciation ? t.depreciation : 0,
      cashOnly: t.cashOnly, unallocatedOverhead: f.unallocatedOverhead,
    },
    byTruck,
  };
  return { ...base, totals };
}
