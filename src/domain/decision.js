// F – Rapoarte de decizie pe cursă (17.3): cost/km și profit/km reale pe cursă, pe „culoar” (origine → destinație) și pe client,
// preț de echilibru/km și calculatorul „Merită cursa?” cu costul curent/km din date reale (fereastra mobilă de 3 luni, 5.4).
// Informativ: nu este o recomandare; costurile reale ale unei curse depind de ce a fost introdus în aplicație.
//
// Model de cost al unei curse (documentat în UI):
//   cost variabil = cost variabil/km (varKm, 3 luni complete dinaintea lunii cursei) × (km încărcați + km pe gol de dinaintea cursei)
//   cost fix      = (costuri directe fără varKm + costuri comune repartizate + amortizare, aceeași fereastră) ÷ zilele active ale camionului × zilele cursei
//   cost cursă    = variabil + fix;  preț de echilibru/km = cost cursă ÷ km încărcați;  profit = venit net − cost cursă.
import { mulDiv } from '../core/money.js';
import { diffDays } from '../core/dates.js';
import { foldKey } from '../core/text.js';
import { computeEmptyKm } from './emptyKm.js';
import { coll, companyOf, memo, costRates, gpsKmInRange } from './profit.js';

const MILLI = 1000000;
const cur0 = (o) => (o && o.currency === 'EUR' ? 'EUR' : 'RON');
const monthOf = (d) => d.slice(0, 7);

/** Ratele de cost ale unui camion pentru luna `asOf` (memoizat pe stare). */
export function ratesFor(state, truckId, asOf, cur = 'RON') {
  return memo(state, `rates|${truckId}|${monthOf(asOf)}|${cur}`, () => costRates(state, truckId, asOf, { currency: cur }));
}

/** Km pe gol de dinaintea fiecărei curse: Map<courseId, meters> (din golurile motorului km pe gol). */
function emptyBeforeMap(state, truckId) {
  return memo(state, 'emptyBefore|' + truckId, () => {
    const cs = coll(state, 'courses').filter((c) => c.truckId === truckId && c.loadDate);
    const m = new Map();
    if (cs.length < 2) return m;
    const from = cs.reduce((a, c) => (c.loadDate < a ? c.loadDate : a), cs[0].loadDate);
    const to = cs.reduce((a, c) => ((c.unloadDate || c.loadDate) > a ? (c.unloadDate || c.loadDate) : a), cs[0].unloadDate || cs[0].loadDate);
    const r = computeEmptyKm({
      truckIds: [truckId], range: { from, to }, granularity: 'month', courses: cs,
      gpsDays: coll(state, 'gpsDays').filter((d) => d.truckId === truckId), gpsTrips: coll(state, 'gpsTrips').filter((t) => t.truckId === truckId),
      aliases: coll(state, 'aliases'), company: companyOf(state),
    });
    for (const g of r.gaps || []) m.set(g.beforeCourseId, (m.get(g.beforeCourseId) || 0) + (g.emptyM || 0));
    return m;
  });
}

/** Prețul care acoperă exact costul pe `kmM` metri, dat un preț de echilibru în miimi de unitate minoră / km. */
export function priceAtKm(perKmMilli, kmM) { return mulDiv(perKmMilli, kmM, MILLI); }

/**
 * Economia reală a unei curse.
 * @param {object} state @param {object} course @param {{currency?:'RON'|'EUR', includeEmptyBefore?:boolean}} [o]
 * @returns {{ courseId, truckId, currency, revenue, loadedM:number|null, emptyBeforeM:number, days:number, costVar:number|null, costFixed:number|null, cost:number|null,
 *   profit:number|null, marginPct:number|null, revenuePerKmMilli:number|null, costPerKmMilli:number|null, profitPerKmMilli:number|null,
 *   breakEvenPerKmMilli:number|null, kmSource:string|null, confidence:string|null, approx:boolean, warnings:string[] }}
 */
export function courseEconomics(state, course, o = {}) {
  const cur = cur0(o);
  const warnings = [];
  const revenue = (cur === 'EUR' ? course.eur?.net : course.ron?.net) ?? 0;
  const out = {
    courseId: course.id, truckId: course.truckId, currency: cur, revenue, loadedM: null, emptyBeforeM: 0, days: 0, costVar: null, costFixed: null, cost: null,
    profit: null, marginPct: null, revenuePerKmMilli: null, costPerKmMilli: null, profitPerKmMilli: null, breakEvenPerKmMilli: null,
    kmSource: course.loadedKm?.source || null, confidence: course.loadedKm?.confidence || null, approx: false, warnings,
  };
  const unload = course.unloadDate >= course.loadDate ? course.unloadDate : course.loadDate;
  out.days = diffDays(course.loadDate, unload) + 1;
  let km = course.loadedKm?.meters ?? null;
  if (km == null) {
    const g = gpsKmInRange(state, course.truckId, { from: course.loadDate, to: unload });
    if (g) { km = g; out.kmSource = 'gps-window'; out.confidence = 'low'; warnings.push('Km încărcați lipsesc: se folosește fereastra GPS (orientativ).'); }
  }
  if (!km) { warnings.push('Fără km încărcați: costul pe km nu se poate calcula.'); return out; }
  out.loadedM = km;
  out.approx = out.confidence === 'medium' || out.confidence === 'low';
  const rates = ratesFor(state, course.truckId, course.loadDate, cur);
  if (rates.varPerKmMilli === null) { warnings.push('Fără km GPS în fereastra de 3 luni: cost/km necunoscut.'); return out; }
  if (o.includeEmptyBefore !== false) out.emptyBeforeM = emptyBeforeMap(state, course.truckId).get(course.id) || 0;
  out.costVar = mulDiv(rates.varPerKmMilli, km + out.emptyBeforeM, MILLI);
  out.costFixed = rates.days ? mulDiv(rates.fixedCost, out.days, rates.days) : 0;
  out.cost = out.costVar + out.costFixed;
  out.profit = revenue - out.cost;
  out.marginPct = revenue ? out.profit / revenue : null;
  out.revenuePerKmMilli = mulDiv(revenue, MILLI, km);
  out.costPerKmMilli = mulDiv(out.cost, MILLI, km);
  out.profitPerKmMilli = out.revenuePerKmMilli - out.costPerKmMilli;
  out.breakEvenPerKmMilli = out.costPerKmMilli;
  return out;
}

const laneOf = (c) => {
  const o = foldKey(c.origin || (c.routeRaw || '').split(' - ')[0] || '');
  const d = foldKey((c.destinations && c.destinations.length ? c.destinations[c.destinations.length - 1] : (c.routeRaw || '').split(' - ').slice(1).join(' ')) || c.destCountry || '');
  return o && d ? `${o} → ${d}` : null;
};
function aggregate(list) {
  const a = { count: 0, withKm: 0, revenue: 0, cost: 0, profit: 0, loadedM: 0, revenueKm: 0, noKm: 0 };
  for (const e of list) {
    a.count++;
    if (e.cost === null || !e.loadedM) { a.noKm++; continue; }
    a.withKm++; a.revenue += e.revenue; a.cost += e.cost; a.profit += e.profit; a.loadedM += e.loadedM;
  }
  a.revenuePerKmMilli = a.loadedM ? mulDiv(a.revenue, MILLI, a.loadedM) : null;
  a.costPerKmMilli = a.loadedM ? mulDiv(a.cost, MILLI, a.loadedM) : null;
  a.profitPerKmMilli = a.loadedM ? mulDiv(a.profit, MILLI, a.loadedM) : null;
  a.breakEvenPerKmMilli = a.costPerKmMilli;
  return a;
}

/**
 * Raportul de decizie pe interval: pe cursă, pe culoar și pe client (când există `clientName`).
 * Rândurile cu cost necalculabil rămân listate (cost null) și nu intră în agregări.
 */
export function decisionReport(state, range, o = {}) {
  const courses = coll(state, 'courses').filter((c) => c.loadDate && c.loadDate >= range.from && c.loadDate <= range.to && c.priceStatus !== 'missing');
  const list = courses.map((c) => ({ ...courseEconomics(state, c, o), loadDate: c.loadDate, unloadDate: c.unloadDate, routeRaw: c.routeRaw, lane: laneOf(c), clientName: c.clientName || null }));
  const group = (keyOf) => {
    const m = new Map();
    for (const e of list) { const k = keyOf(e); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return [...m.entries()].map(([key, es]) => ({ key, ...aggregate(es), courseIds: es.map((e) => e.courseId) }))
      .sort((a, b) => (b.profit - a.profit) || (a.key < b.key ? -1 : 1));
  };
  return {
    courses: list.sort((a, b) => (a.loadDate < b.loadDate ? -1 : a.loadDate > b.loadDate ? 1 : a.courseId < b.courseId ? -1 : 1)),
    lanes: group((e) => e.lane),
    clients: group((e) => (e.clientName ? foldKey(e.clientName) : null)),
    total: aggregate(list), currency: cur0(o),
    note: 'Informativ: costul unei curse este o alocare din costurile introduse; nu este o recomandare.',
  };
}

/**
 * Calculatorul „Merită cursa?” cu costul curent/km din date reale (aceleași rate ca în raport, fereastra de 3 luni complete).
 * @param {object} state
 * @param {{ truckId?:string, priceMinor:number, loadedKm:number (km, întreg sau zecimal), emptyKm?:number, days?:number, asOf:string, minMarginPct?:number }} i
 *   fără `truckId` se folosește media flotei. Prețul e în moneda de raportare `o.currency`.
 */
export function worthIt(state, i, o = {}) {
  const cur = cur0(o);
  const loadedM = Math.round(i.loadedKm * 1000); // money-ok: km → metri, nu bani
  const emptyM = Math.round((i.emptyKm || 0) * 1000); // money-ok: km → metri, nu bani
  const days = i.days ?? 1;
  if (!(loadedM > 0)) throw new RangeError('km încărcați trebuie să fie > 0');
  const ids = i.truckId ? [i.truckId] : coll(state, 'trucks').map((t) => t.id);
  let varCost = 0, fixed = 0, gps = 0, fdays = 0, win = null;
  for (const id of ids) {
    const r = ratesFor(state, id, i.asOf, cur);
    if (!r.gpsM) continue;
    varCost += r.varCost; fixed += r.fixedCost; gps += r.gpsM; fdays += r.days; win = r.window;
  }
  if (!gps) return { ok: false, reason: 'Nu există km GPS și costuri în ultimele 3 luni pentru acest calcul.', currency: cur };
  const varPerKmMilli = mulDiv(varCost, MILLI, gps);
  const costVar = mulDiv(varPerKmMilli, loadedM + emptyM, MILLI);
  const costFixed = mulDiv(fixed, days, fdays);
  const cost = costVar + costFixed;
  const profit = i.priceMinor - cost;
  const margin = i.priceMinor ? profit / i.priceMinor : null;
  const minMargin = i.minMarginPct ?? 0.05;
  const verdict = profit < 0 ? 'sub-cost' : margin !== null && margin < minMargin ? 'la-limita' : 'peste-cost';
  const breakEvenPerKmMilli = mulDiv(cost, MILLI, loadedM);
  return {
    ok: true, currency: cur, priceMinor: i.priceMinor, cost, costVar, costFixed, profit, marginPct: margin, verdict,
    breakEvenPerKmMilli, priceAtMargin: minMargin < 1 ? mulDiv(cost, 10000, 10000 - Math.round(minMargin * 10000)) : null, // money-ok: marjă în puncte de bază
    revenuePerKmMilli: mulDiv(i.priceMinor, MILLI, loadedM), window: win, basis: i.truckId ? 'camion' : 'media flotei',
    note: 'Informativ: calculat din costurile și km din ultimele 3 luni complete.',
  };
}
