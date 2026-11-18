// domain/gpsKm.js: km GPS pe zi, odometru, km pe țară, opriri lungi, manevre și ANCORAREA curselor pe călătoriile GPS.
// Pur (fără DOM/I/O). Surse: `GpsDay` (foaia zilnică) și `GpsTrip` (export „Călătorii” cu adrese).
//
// Forme acceptate (tolerant la numele câmpurilor, ca importul GPS să poată evolua):
//   GpsDay  { truckId, date:IsoDate, kmM:Meters, odoStartM?, odoStopM?, drivingS? }
//   GpsTrip { id?, truckId, start:'YYYY-MM-DDTHH:mm:ss', stop:'…', startPos, stopPos, distanceM:Meters }
//     startPos/stopPos = text `[stradă, localitate, cod, Țară]` sau obiect { locality, country, … };
//     distanța poate veni și ca `meters`/`distM`/`kmM`; `km` (număr) e convertit în metri.
// Convenție: o călătorie intră în ziua ei de START (și una peste miezul nopții rămâne în ziua de start; testat).

import { addDays } from '../core/dates.js';
import { placeKey, countryCodeFromName } from './places.js';
import { parseGpsAddress, nameScore, AUTO_SCORE, CONFIRM_SCORE } from './placeMatch.js';
import { parseRoute } from './places.js';

/** Metri sub care o călătorie este „manevră” (se grupează la afișare, nu se șterge). */
export const MANEUVER_M = 2000;

/** Secunde de la o dată-oră ISO fără fus (ora locală tratată ca UTC; diferențele sunt corecte în afara schimbării orei). */
export function tsOf(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000);
}

const asMeters = (o) => {
  const v = o.distanceM ?? o.meters ?? o.distM ?? o.kmM;
  if (v != null && Number.isFinite(+v)) return Math.round(+v);
  if (o.km != null && Number.isFinite(+o.km)) return Math.round(+o.km * 1000);
  return 0;
};

/**
 * @typedef {{ id:string|null, truckId:string|null, start:string, stop:string, startTs:number, stopTs:number, date:string,
 *   distM:number, startPos:import('./placeMatch.js').GpsAddress, stopPos:import('./placeMatch.js').GpsAddress, raw:object }} NormTrip
 */
/** @param {object} t @returns {NormTrip|null} */
export function normTrip(t) {
  if (!t) return null;
  if (t.startTs != null && t.stopTs != null && t.distM != null && t.raw) return t; // deja normalizată
  const start = t.start ?? t.startTime, stop = t.stop ?? t.stopTime ?? t.end;
  const startTs = tsOf(start);
  if (startTs == null) return null;
  const stopTs = tsOf(stop) ?? startTs;
  return {
    id: t.id ?? null, truckId: t.truckId ?? null,
    start, stop: stop ?? start, startTs, stopTs,
    date: String(start).slice(0, 10),
    distM: asMeters(t),
    startPos: parseGpsAddress(t.startPos ?? t.posStart ?? t.from ?? null),
    stopPos: parseGpsAddress(t.stopPos ?? t.posStop ?? t.to ?? null),
    raw: t,
  };
}

/** @param {object[]} trips @returns {NormTrip[]} sortate după start, fără călătorii șterse sau neparsabile */
export function normTrips(trips) {
  const seen = new Set();
  const out = [];
  for (const t of trips || []) {
    if (!t || t.deletedAt) continue;
    const n = normTrip(t);
    if (!n) continue;
    const key = `${n.truckId ?? ''}|${n.start}`; // reimport idempotent: același camion + același start = aceeași călătorie
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.sort((a, b) => a.startTs - b.startTs || a.stopTs - b.stopTs);
}

/** @param {object} d @returns {{ truckId:string|null, date:string, kmM:number, odoStartM:number|null, odoStopM:number|null }|null} */
export function normDay(d) {
  if (!d || d.deletedAt || !d.date) return null;
  return { truckId: d.truckId ?? null, date: d.date, kmM: asMeters(d), odoStartM: d.odoStartM ?? null, odoStopM: d.odoStopM ?? null };
}

/**
 * Km pe zi: din călătorii (sursa primară) acolo unde există călătorii în acea zi, altfel din foaia zilnică.
 * @param {object[]} days @param {object[]} trips  (ale unui singur camion)
 * @returns {Map<string,{ m:number, source:'trips'|'daily' }>}
 */
export function mergeDailyKm(days, trips) {
  const out = new Map();
  for (const t of normTrips(trips)) {
    const e = out.get(t.date);
    if (e) e.m += t.distM; else out.set(t.date, { m: t.distM, source: 'trips' });
  }
  for (const raw of days || []) {
    const d = normDay(raw);
    if (!d || out.has(d.date)) continue;
    out.set(d.date, { m: d.kmM, source: 'daily' });
  }
  return out;
}

/** Intervalul acoperit de date GPS (zile + călătorii) al unui camion. @returns {{from:string,to:string}|null} */
export function coverageOf(days, trips) {
  let from = null, to = null;
  const upd = (d) => { if (!from || d < from) from = d; if (!to || d > to) to = d; };
  for (const raw of days || []) { const d = normDay(raw); if (d) upd(d.date); }
  for (const t of normTrips(trips)) { upd(t.date); upd(t.stop.slice(0, 10)); }
  return from ? { from, to } : null;
}

/**
 * Verificare odometru: suma kilometrilor vs diferența odometrului (toleranță 0,5%).
 * Exemplul real: 8.376,3 km vs 8.377,4 km => în toleranță.
 * @param {{ sumM:number, odoStartM?:number|null, odoStopM?:number|null, tolerance?:number }} i
 * @returns {{ sumM:number, odoDeltaM:number|null, diffM:number|null, diffPct:number|null, withinTolerance:boolean|null }}
 */
export function odometerCheck(i) {
  const tol = i.tolerance ?? 0.005;
  if (i.odoStartM == null || i.odoStopM == null) return { sumM: i.sumM, odoDeltaM: null, diffM: null, diffPct: null, withinTolerance: null };
  const odoDeltaM = i.odoStopM - i.odoStartM;
  const diffM = Math.abs(odoDeltaM - i.sumM);
  const base = Math.max(odoDeltaM, i.sumM, 1);
  const diffPct = diffM / base;
  return { sumM: i.sumM, odoDeltaM, diffM, diffPct, withinTolerance: diffPct <= tol };
}

/**
 * Km pe țară după țara de SOSIRE a fiecărei călătorii (țara de plecare dacă lipsește).
 * @param {object[]} trips @param {{from?:string,to?:string}} [range]
 * @returns {{ byCountry:{[cc:string]:number}, totalM:number }}
 */
export function kmByCountry(trips, range) {
  const byCountry = {};
  let totalM = 0;
  for (const t of normTrips(trips)) {
    if (range?.from && t.date < range.from) continue;
    if (range?.to && t.date > range.to) continue;
    const p = t.stopPos.countryCode || t.startPos.countryCode || t.stopPos.country || t.startPos.country || '??';
    byCountry[p] = (byCountry[p] || 0) + t.distM;
    totalM += t.distM;
  }
  return { byCountry, totalM };
}

/**
 * Grupează călătoriile consecutive sub `minM` (manevre) într-un singur element; restul rămân călătorii.
 * @param {object[]} trips @param {number} [minM]
 * @returns {Array<{ type:'trip'|'maneuver', start:string, stop:string, distM:number, startPos:object, stopPos:object, count:number, trips:NormTrip[] }>}
 */
export function groupManeuvers(trips, minM = MANEUVER_M) {
  const out = [];
  for (const t of normTrips(trips)) {
    const man = t.distM < minM;
    const last = out[out.length - 1];
    if (man && last && last.type === 'maneuver') {
      last.stop = t.stop; last.stopPos = t.stopPos; last.distM += t.distM; last.count++; last.trips.push(t);
    } else {
      out.push({ type: man ? 'maneuver' : 'trip', start: t.start, stop: t.stop, distM: t.distM, startPos: t.startPos, stopPos: t.stopPos, count: 1, trips: [t] });
    }
  }
  return out;
}

/**
 * Opriri (șederi): de la sosirea la o localitate până la plecarea următoarei călătorii care nu este manevră în
 * aceeași localitate.
 * @param {object[]} trips
 * @param {{ minManeuverM?:number }} [o]
 * @returns {Array<{ arrive:string, depart:string|null, arriveTs:number, departTs:number|null, dwellS:number|null,
 *   pos:object, locality:string|null, countryCode:string|null, arrivalTripIdx:number, absorbed:number }>}
 */
export function stays(trips, o = {}) {
  const minM = o.minManeuverM ?? MANEUVER_M;
  const ts = normTrips(trips);
  const out = [];
  const sameLoc = (a, b) => placeKey(a.locality) === placeKey(b.locality) && placeKey(a.locality) !== '';
  for (let i = 0; i < ts.length; i++) {
    const pos = ts[i].stopPos;
    let j = i + 1;
    while (j < ts.length && ts[j].distM < minM && sameLoc(ts[j].stopPos, pos) && sameLoc(ts[j].startPos, pos)) j++;
    const depart = j < ts.length ? ts[j].start : null;
    const departTs = j < ts.length ? ts[j].startTs : null;
    out.push({
      arrive: ts[i].stop, depart, arriveTs: ts[i].stopTs, departTs,
      dwellS: departTs != null ? Math.max(0, departTs - ts[i].stopTs) : null,
      pos, locality: pos.locality, countryCode: pos.countryCode, arrivalTripIdx: i, absorbed: j - i - 1,
    });
    i = j - 1;
  }
  return out;
}

/**
 * Opriri lungi (> `hours`) cu locul și marcajul „la bază”.
 * @param {object[]} trips
 * @param {{ hours?:number, homeBase?:string, aliases?:object[], range?:{from?:string,to?:string} }} [o]
 * @returns {Array<{ locality:string|null, countryCode:string|null, arrive:string, depart:string, hours:number, isHome:boolean }>}
 */
export function longStops(trips, o = {}) {
  const hours = o.hours ?? 6;
  const home = o.homeBase ? placeKey(o.homeBase) : '';
  const out = [];
  for (const s of stays(trips)) {
    if (s.dwellS == null || s.dwellS < hours * 3600) continue;
    if (o.range?.from && s.arrive.slice(0, 10) < o.range.from) continue;
    if (o.range?.to && s.arrive.slice(0, 10) > o.range.to) continue;
    out.push({
      locality: s.locality, countryCode: s.countryCode, arrive: s.arrive, depart: s.depart,
      hours: Math.round((s.dwellS / 3600) * 10) / 10,
      isHome: !!home && nameScore(home, placeKey(s.locality)).score >= AUTO_SCORE,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Ancorarea curselor pe călătorii

/**
 * Index pentru călătoriile unui camion: evenimente de „sosire” (k=0: plecarea primei călătorii; k=i+1: sosirea
 * călătoriei i) și sume prefix pentru Σ distanțe pe intervale de călătorii.
 * @param {object[]} rawTrips
 */
export function buildTripIndex(rawTrips) {
  const trips = normTrips(rawTrips);
  const events = [];
  const mkEv = (k, time, ts, pos) => ({ k, time, ts, date: time.slice(0, 10), pos, locKey: placeKey(pos.locality) });
  if (trips.length) events.push(mkEv(0, trips[0].start, trips[0].startTs, trips[0].startPos));
  trips.forEach((t, i) => {
    events.push(mkEv(i + 1, t.stop, t.stopTs, t.stopPos));
    // plecarea din același loc (oprire lungă: sosire cu zile înainte, plecare la data încărcării) = eveniment propriu cu același k
    const nx = trips[i + 1];
    if (nx && nx.startPos && placeKey(nx.startPos.locality) === placeKey(t.stopPos.locality) && nx.start.slice(0, 10) !== t.stop.slice(0, 10)) events.push(mkEv(i + 1, nx.start, nx.startTs, nx.startPos));
  });
  const prefix = [0];
  for (const t of trips) prefix.push(prefix[prefix.length - 1] + t.distM);
  const sumM = (a, b) => (b <= a ? 0 : prefix[Math.min(b, trips.length)] - prefix[Math.max(a, 0)]);
  return { trips, events, prefix, sumM };
}

function makeMatcher(aliases) {
  const set = new Set();
  for (const a of aliases || []) if (a && !a.deletedAt) set.add(`${placeKey(a.name)}|${placeKey(a.locality)}`);
  const memo = new Map();
  return (nameKey, ev) => {
    if (!nameKey || !ev.locKey) return { score: 0, via: 'none' };
    const mk = `${nameKey}|${ev.locKey}`;
    let r = memo.get(mk);
    if (!r) {
      r = set.has(mk) ? { score: 1, via: 'alias' } : nameScore(nameKey, ev.locKey);
      memo.set(mk, r);
    }
    return r;
  };
}

/**
 * Ancorează o cursă pe călătorii: caută oprirea de ÎNCĂRCARE (localitatea originii, în ±`tolDays` zile de
 * `loadDate`) și oprirea de DESCĂRCARE (ultima destinație, în ±`tolDays` zile de `unloadDate`, după încărcare).
 * Km încărcați = Σ distanțe ale călătoriilor dintre cele două opriri (km GPS reali).
 * @param {{ origin?:string, destinations?:string[], routeRaw?:string, loadDate:string, unloadDate:string }} course
 * @param {ReturnType<typeof buildTripIndex>} index
 * @param {{ aliases?:object[], tolDays?:number, minK?:number, matcher?:Function }} [o]
 * @returns {{ ok:boolean, reason?:string, load:object|null, unload:object|null, startTs?:number, endTs?:number,
 *   tripFrom?:number, tripTo?:number, meters?:number, confidence?:'high'|'medium', needsConfirm?:boolean, viaVisited?:number }}
 */
export function anchorCourse(course, index, o = {}) {
  const fail = (reason, load = null) => ({ ok: false, reason, load, unload: null });
  if (!index || !index.trips.length) return fail('NO_TRIPS');
  const tol = o.tolDays ?? 1;
  const matcher = o.matcher || makeMatcher(o.aliases);
  let origin = course.origin, dests = course.destinations;
  if ((origin == null || origin === '') && course.routeRaw) {
    const r = parseRoute(course.routeRaw);
    origin = r.origin; dests = r.destinations;
  }
  const loadDate = course.loadDate, unloadDate = course.unloadDate || course.loadDate;
  if (!loadDate) return fail('NO_DATES');
  const winLo = addDays(loadDate, -tol), winHi = addDays(unloadDate, tol);
  const inWindow = index.events.some((e) => e.date >= winLo && e.date <= winHi);
  if (!inWindow) return fail('NO_TRIPS_IN_WINDOW');
  if (!origin) return fail('NO_ORIGIN');
  const originKey = placeKey(origin);
  const minK = o.minK ?? 0;

  const pick = (nameKey, dLo, dHi, centerDate, fromK) => {
    let best = null;
    for (const e of index.events) {
      if (e.k < fromK) continue;
      if (e.date < dLo) continue;
      if (e.date > dHi) break;
      const m = matcher(nameKey, e);
      if (m.score < CONFIRM_SCORE) continue;
      const dist = Math.abs(dayDiff(centerDate, e.date));
      const adj = m.score - 0.03 * dist;
      if (!best || adj > best.adj + 1e-9) best = { e, m, adj };
    }
    return best && { k: best.e.k, ts: best.e.ts, time: best.e.time, date: best.e.date, score: best.m.score, via: best.m.via, locality: best.e.pos.locality };
  };

  const load = pick(originKey, addDays(loadDate, -tol), addDays(loadDate, tol), loadDate, minK);
  if (!load) return fail('LOAD_NOT_VISITED');
  if (!dests || !dests.length) return fail('COUNTRY_ONLY', load);
  const destKey = placeKey(dests[dests.length - 1]);
  const unload = pick(destKey, addDays(unloadDate, -tol), addDays(unloadDate, tol), unloadDate, load.k + 1);
  if (!unload) return { ok: false, reason: 'UNLOAD_NOT_VISITED', load, unload: null };
  let viaVisited = 0;
  for (const d of (dests || []).slice(0, -1)) {
    const k = placeKey(d);
    if (index.events.some((e) => e.k > load.k && e.k < unload.k && matcher(k, e).score >= AUTO_SCORE)) viaVisited++;
  }
  const minScore = Math.min(load.score, unload.score);
  return {
    ok: true, load, unload,
    startTs: load.ts, endTs: unload.ts, tripFrom: load.k, tripTo: unload.k,
    meters: index.prefix[unload.k] - index.prefix[load.k],
    confidence: minScore >= AUTO_SCORE ? 'high' : 'medium',
    needsConfirm: minScore < AUTO_SCORE,
    viaVisited,
  };
}

function dayDiff(a, b) { // b - a în zile, ISO
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

/** Ordinea curselor unui camion: după încărcare, apoi descărcare, apoi id. */
export function sortCourses(courses) {
  return [...courses].sort((a, b) => (a.loadDate < b.loadDate ? -1 : a.loadDate > b.loadDate ? 1 : 0)
    || (a.unloadDate < b.unloadDate ? -1 : a.unloadDate > b.unloadDate ? 1 : 0)
    || ((a.sheet && b.sheet && a.sheet.row != null && b.sheet.row != null && a.sheet.row !== b.sheet.row) ? a.sheet.row - b.sheet.row : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Ancorează în ordine toate cursele unui camion (fiecare încărcare nu poate fi înaintea descărcării anterioare).
 * @param {object[]} courses  ale unui singur camion
 * @param {ReturnType<typeof buildTripIndex>} index
 * @param {{ aliases?:object[], tolDays?:number }} [o]
 * @returns {Map<string, ReturnType<typeof anchorCourse>>}
 */
export function anchorTruckCourses(courses, index, o = {}) {
  const matcher = makeMatcher(o.aliases);
  const out = new Map();
  let minK = 0;
  for (const c of sortCourses(courses)) {
    const a = anchorCourse(c, index, { ...o, matcher, minK });
    out.set(c.id, a);
    if (a.ok) minK = a.unload.k;
  }
  return out;
}
