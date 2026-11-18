// domain/emptyKm.js: km pe gol = km GPS − km încărcați, per camion și perioadă (zi / săptămână / lună).
// Pur. Garantează `încărcați + goi = GPS` EXACT (în metri întregi) pe fiecare rând (DEV-PLAN 5.8, 17.1).
//
// Două moduri combinate, pe camion:
//  (1) CĂLĂTORII GPS (primar): fiecare cursă se ancorează pe oprirea de încărcare și pe cea de descărcare
//      (potrivire de locuri); călătoriile dintre ele = km încărcați (km GPS reali), cele dintre descărcarea
//      cursei N și încărcarea cursei N+1 = golul dintre curse (`gaps`, mode 'trips').
//  (2) NIVEL DE ZI (rezervă, 5.8): cursele neancorate repartizează `min(L, G)` pe zilele ferestrei lor
//      proporțional cu km GPS ai zilei; zilele de încărcare/descărcare sunt „mixte” (estimare).
// Zi cu călătorii ⇒ km din călătorii (atribuire pe ziua de START); altfel din foaia zilnică.
// Camion fără date GPS: gpsM = null, emptyM = null (necunoscut, nu 0).

import { allocate, mulDiv } from '../core/money.js';
import { addDays, eachDay, monthKey, diffDays } from '../core/dates.js';
import { resolveLoadedKm, courseDays } from './courses.js';
import {
  buildTripIndex, anchorTruckCourses, sortCourses, mergeDailyKm, coverageOf, kmByCountry, longStops, stays,
} from './gpsKm.js';
import { placeKey } from './places.js';
import { nameScore, AUTO_SCORE } from './placeMatch.js';

export { resolveLoadedKm };

/** Prag sub care o zi este „fără activitate” (m). */
export const IDLE_M = 2000;

/** Luni la 00:00 ca bucket de săptămână (ISO). @param {string} date @returns {string} */
export function weekStart(date) {
  const dow = (new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}
const bucketOf = (date, g) => (g === 'day' ? date : g === 'week' ? weekStart(date) : monthKey(date));

/**
 * Pregătește analiza unui camion (reutilizabil de `reconcile`).
 * @returns {{ truckId:string, courses:object[], days:object[], trips:object[], index:object, km:Map<string,{m:number,source:string}>,
 *   coverage:{from:string,to:string}|null, anchors:Map<string,object> }}
 */
export function prepareTruck(truckId, { courses, gpsDays, gpsTrips, aliases, coverage, tolDays }) {
  const cs = sortCourses((courses || []).filter((c) => c.truckId === truckId && !c.deletedAt && c.loadDate));
  const days = (gpsDays || []).filter((d) => d.truckId === truckId && !d.deletedAt);
  const trips = (gpsTrips || []).filter((t) => t.truckId === truckId && !t.deletedAt);
  const km = mergeDailyKm(days, trips);
  const cov = coverage?.[truckId] || coverageOf(days, trips);
  const index = buildTripIndex(trips);
  const anchors = index.trips.length ? anchorTruckCourses(cs, index, { aliases, tolDays }) : new Map();
  return { truckId, courses: cs, days, trips, index, km, coverage: cov, anchors };
}

const issue = (code, severity, truckId, message, o = {}) => ({ code, severity, truckId, date: o.date ?? null, refs: o.refs ?? [], message });

/**
 * @param {{ truckIds:string[], range:{from:string,to:string}, granularity:'day'|'week'|'month', courses:object[],
 *   gpsDays:object[], gpsTrips:object[], costs?:{[truckId:string]:number}, costsFull?:{[truckId:string]:number},
 *   aliases?:object[], coverage?:{[truckId:string]:{from:string,to:string}}, company?:{homeBase?:string,longStopHours?:number}, idleM?:number }} i
 *   `costs[truckId]` = cost variabil pe km în RON minor (bani/km); `costsFull` = cost complet pe km.
 * @returns {{ rows:Array<{ truckId:string, bucket:string, from:string, to:string, gpsM:number|null, loadedM:number, emptyM:number|null,
 *     pctEmpty:number|null, idleDays:number, mixedDays:number, emptyCostRon:number|null, flags:string[] }>,
 *   gaps:Array<{ truckId:string, afterCourseId:string, beforeCourseId:string, from:string, to:string, emptyM:number, mode:'trips'|'days', mixedDays:string[] }>,
 *   perDriver:Array<object>, issues:object[], byTruck:{[truckId:string]:object}, totals:object, trend:object[], trucksWithoutGps:string[] }}
 */
export function computeEmptyKm(i) {
  const range = i.range, gran = i.granularity || 'month';
  const idleM = i.idleM ?? IDLE_M;
  const rows = [], gaps = [], issues = [], byTruck = {};
  const trend = new Map();
  const trucksWithoutGps = [];
  const allDates = eachDay(range.from, range.to);
  const inRange = (d) => d >= range.from && d <= range.to;

  for (const truckId of i.truckIds || []) {
    const T = prepareTruck(truckId, { courses: i.courses, gpsDays: i.gpsDays, gpsTrips: i.gpsTrips, aliases: i.aliases, coverage: i.coverage });
    const cs = T.courses;
    const buckets = new Map(); // bucket -> acc
    const getB = (b, date) => {
      let a = buckets.get(b);
      if (!a) {
        a = { bucket: b, from: date, to: date, gps: 0, loaded: 0, idle: 0, mixed: 0, covered: 0, total: 0, estimated: false };
        buckets.set(b, a);
      }
      if (date < a.from) a.from = date;
      if (date > a.to) a.to = date;
      return a;
    };

    if (!T.coverage) {
      if (cs.length) issues.push(issue('NO_GPS_TRUCK', 'warn', truckId, 'Camion fără date GPS: km pe gol necunoscut.'));
      trucksWithoutGps.push(truckId);
      for (const d of allDates) { const a = getB(bucketOf(d, gran), d); a.total++; }
      for (const a of buckets.values()) {
        rows.push({ truckId, bucket: a.bucket, from: a.from, to: a.to, gpsM: null, loadedM: 0, emptyM: null, pctEmpty: null, idleDays: 0, mixedDays: 0, emptyCostRon: null, flags: ['NO_GPS'] });
      }
      byTruck[truckId] = { truckId, gpsM: null, loadedM: 0, emptyM: null, pctEmpty: null, idleDays: 0, activeDays: 0, emptyCostRon: null, emptyCostFullRon: null, courseCount: cs.length, anchoredCourses: 0, countries: {}, longStops: [], time: null, revenueMinor: 0, revenuePerLoadedKm: null, revenuePerTotalKm: null };
      continue;
    }

    // 1) etichetarea călătoriilor (încărcat = 1, gol între curse = 2)
    const trips = T.index.trips;
    const label = new Int8Array(trips.length);
    const labeledByDay = new Map(), loadedByDay = new Map();
    const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    const anchored = cs.filter((c) => T.anchors.get(c.id)?.ok);
    const anchoredOrder = [...anchored].sort((a, b) => T.anchors.get(a.id).tripFrom - T.anchors.get(b.id).tripFrom);
    const courseLoaded = new Map();
    for (const c of anchoredOrder) {
      const a = T.anchors.get(c.id);
      let sum = 0;
      for (let k = a.tripFrom; k < a.tripTo; k++) {
        if (label[k]) continue;
        label[k] = 1; sum += trips[k].distM;
        bump(loadedByDay, trips[k].date, trips[k].distM); bump(labeledByDay, trips[k].date, trips[k].distM);
      }
      courseLoaded.set(c.id, sum);
    }
    const gapTrips = new Map(); // `${aId}|${bId}` -> meters
    for (let n = 0; n + 1 < cs.length; n++) {
      const a = T.anchors.get(cs[n].id), b = T.anchors.get(cs[n + 1].id);
      if (!a?.ok || !b?.ok) continue;
      let sum = 0;
      for (let k = a.tripTo; k < b.tripFrom; k++) {
        if (label[k]) continue;
        label[k] = 2; sum += trips[k].distM; bump(labeledByDay, trips[k].date, trips[k].distM);
      }
      gapTrips.set(`${cs[n].id}|${cs[n + 1].id}`, sum);
    }

    // 2) cursele neancorate: alocare pe zile (algoritmul din 5.8) peste kilometrii rămași
    const g = (d) => Math.max(0, (T.km.get(d)?.m || 0) - (labeledByDay.get(d) || 0));
    const shareByDay = new Map();
    const mixedSet = new Set();
    const unanchored = cs.filter((c) => !T.anchors.get(c.id)?.ok);
    const ctx = { gpsDays: T.days, gpsTrips: T.trips, aliases: i.aliases, tripIndexByTruck: new Map([[truckId, T.index]]) };
    for (const c of unanchored) {
      const W = courseDays(c);
      const gc = W.reduce((s, d) => s + g(d), 0);
      const touchesRange = W.some(inRange);
      const covered = T.coverage && W.some((d) => d >= T.coverage.from && d <= T.coverage.to);
      const ref = [{ type: 'course', id: c.id }];
      if (!covered) continue; // „fără date GPS” e semnalat de confruntare (NO_GPS_RANGE)
      if (gc === 0) {
        if (touchesRange) issues.push(issue('COURSE_NO_GPS', 'warn', truckId, 'Cursă fără km GPS în fereastra ei de zile.', { date: c.loadDate, refs: ref }));
        continue;
      }
      const lk = c.loadedKm && c.loadedKm.meters != null ? c.loadedKm : resolveLoadedKm(c, ctx);
      const L = lk.meters;
      if (L == null) {
        if (touchesRange) issues.push(issue('COURSE_NO_LOADED_KM', 'info', truckId, 'Cursă fără km încărcați: contează ca gol până se introduc.', { date: c.loadDate, refs: ref }));
        continue;
      }
      if (L > gc * 1.03 && touchesRange) issues.push(issue('LOADED_KM_GT_GPS', 'warn', truckId, 'Km încărcați depășesc km GPS din fereastra cursei.', { date: c.loadDate, refs: ref })); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
      const target = Math.min(L, gc);
      const days = W.filter((d) => g(d) > 0);
      if (target > 0 && days.length) {
        const parts = allocate(target, days.map(g));
        days.forEach((d, n) => bump(shareByDay, d, parts[n]));
      }
      if (W.length > 1) { mixedSet.add(c.loadDate); mixedSet.add(c.unloadDate); } else mixedSet.add(c.loadDate);
    }

    // verificări pentru cursele ancorate
    for (const c of anchored) {
      const a = T.anchors.get(c.id);
      const ref = [{ type: 'course', id: c.id }];
      const declared = c.loadedKm && c.loadedKm.meters != null && c.loadedKm.source !== 'gps-trips' ? c.loadedKm.meters : null;
      const touches = courseDays(c).some(inRange);
      if (declared != null && a.meters > 0 && touches && Math.abs(declared - a.meters) / a.meters > 0.15) {
        issues.push(issue('ESTIMATE_VS_GPS', 'warn', truckId, 'Km declarați/estimați diferă cu peste 15% de km GPS între opriri.', { date: c.loadDate, refs: ref }));
      }
      if (a.needsConfirm && touches) issues.push(issue('PLACE_MATCH_CONFIRM', 'info', truckId, 'Potrivire de loc cu scor mediu: cere confirmare.', { date: c.loadDate, refs: ref }));
    }

    // 3) pe zile și pe găleți
    const clipFrom = T.coverage.from > range.from ? T.coverage.from : range.from;
    const clipTo = T.coverage.to < range.to ? T.coverage.to : range.to;
    const dayRec = new Map();
    if (clipFrom <= clipTo) {
      for (const d of eachDay(clipFrom, clipTo)) {
        const gd = T.km.get(d)?.m || 0;
        const gres = g(d);
        const loaded = (loadedByDay.get(d) || 0) + Math.min(gres, shareByDay.get(d) || 0);
        dayRec.set(d, { g: gd, loaded });
        const a = getB(bucketOf(d, gran), d);
        a.gps += gd; a.loaded += loaded; a.covered++;
        if (gd < idleM) a.idle++;
        if (mixedSet.has(d) && gd > 0) a.mixed++;
        if ((shareByDay.get(d) || 0) > 0) a.estimated = true;
      }
    }
    // numărul de zile din interval aparținând fiecărei găleți (pentru PARTIAL_GPS)
    for (const d of allDates) {
      const b = bucketOf(d, gran);
      const a = buckets.get(b);
      if (a) a.total++;
    }
    const costKm = i.costs?.[truckId], costFull = i.costsFull?.[truckId];
    let tG = 0, tL = 0, idleDays = 0, activeDays = 0;
    for (const a of [...buckets.values()].sort((x, y) => (x.bucket < y.bucket ? -1 : 1))) {
      const empty = a.gps - a.loaded;
      const flags = [];
      if (a.covered < a.total) flags.push('PARTIAL_GPS');
      if (a.mixed > 0) flags.push('MIXED_DAYS');
      if (a.estimated) flags.push('ESTIMATED');
      rows.push({
        truckId, bucket: a.bucket, from: a.from, to: a.to, gpsM: a.gps, loadedM: a.loaded, emptyM: empty,
        pctEmpty: a.gps > 0 ? empty / a.gps : null, idleDays: a.idle, mixedDays: a.mixed,
        emptyCostRon: costKm != null ? mulDiv(empty, costKm, 1000) : null, flags,
      });
      tG += a.gps; tL += a.loaded; idleDays += a.idle;
    }
    for (const [d, r] of dayRec) {
      if (r.g >= idleM) activeDays++;
      const mk = monthKey(d);
      let t = trend.get(mk);
      if (typeof t !== 'object') { t = { month: mk, gpsM: 0, loadedM: 0, emptyM: 0, pctEmpty: null }; trend.set(mk, t); }
      t.gpsM += r.g; t.loadedM += r.loaded; t.emptyM += r.g - r.loaded;
    }

    // 4) goluri între curse
    for (let n = 0; n + 1 < cs.length; n++) {
      const a = cs[n], b = cs[n + 1];
      const aa = T.anchors.get(a.id), ab = T.anchors.get(b.id);
      if (aa?.ok && ab?.ok) {
        const from = aa.unload.date, to = ab.load.date;
        if (to < range.from || from > range.to) continue;
        gaps.push({ truckId, afterCourseId: a.id, beforeCourseId: b.id, from, to, emptyM: gapTrips.get(`${a.id}|${b.id}`) || 0, mode: 'trips', mixedDays: [] });
      } else {
        const from = a.unloadDate, to = b.loadDate;
        if (to < range.from || from > range.to) continue;
        let emptyM = 0;
        const mixed = [];
        if (to > from) {
          if (diffDays(from, to) > 1) for (const d of eachDay(addDays(from, 1), addDays(to, -1))) { const r = dayRec.get(d); if (r) emptyM += r.g - r.loaded; }
          for (const d of [from, to]) if ((dayRec.get(d)?.g || 0) > 0 && !mixed.includes(d)) mixed.push(d);
        }
        gaps.push({ truckId, afterCourseId: a.id, beforeCourseId: b.id, from, to, emptyM, mode: 'days', mixedDays: mixed });
      }
    }

    // 5) derivate: țări, opriri lungi, timp, venit
    const hasTrips = trips.length > 0;
    const rangeTrips = trips.filter((t) => inRange(t.date));
    const homeBase = i.company?.homeBase;
    let time = null;
    if (hasTrips && rangeTrips.length) {
      const st = stays(rangeTrips);
      let homeS = 0;
      if (homeBase) {
        const hk = placeKey(homeBase);
        for (const s of st) if (s.dwellS != null && nameScore(hk, placeKey(s.locality)).score >= AUTO_SCORE) homeS += s.dwellS;
      }
      let loadedS = 0;
      for (const c of anchored) {
        const a = T.anchors.get(c.id);
        if (courseDays(c).some(inRange)) loadedS += Math.max(0, a.endTs - a.startTs);
      }
      const spanS = rangeTrips[rangeTrips.length - 1].stopTs - rangeTrips[0].startTs;
      time = { spanS, loadedS, homeS, emptyS: Math.max(0, spanS - loadedS - homeS), note: 'orientativ: opririle la bază sunt incluse în „bază”' };
    }
    let revenue = 0;
    for (const c of cs) if (c.unloadDate >= range.from && c.unloadDate <= range.to && c.priceStatus !== 'missing') revenue += c.ron?.net ?? 0;
    byTruck[truckId] = {
      truckId, gpsM: tG, loadedM: tL, emptyM: tG - tL, pctEmpty: tG > 0 ? (tG - tL) / tG : null,
      idleDays, activeDays,
      emptyCostRon: costKm != null ? mulDiv(tG - tL, costKm, 1000) : null,
      emptyCostFullRon: costFull != null ? mulDiv(tG - tL, costFull, 1000) : null,
      courseCount: cs.length, anchoredCourses: anchored.length,
      countries: hasTrips ? kmByCountry(rangeTrips).byCountry : {},
      longStops: hasTrips ? longStops(rangeTrips, { hours: i.company?.longStopHours ?? 6, homeBase, aliases: i.aliases, range }) : [],
      time,
      revenueMinor: revenue,
      revenuePerLoadedKm: tL > 0 ? mulDiv(revenue, 1000, tL) : null,
      revenuePerTotalKm: tG > 0 ? mulDiv(revenue, 1000, tG) : null,
    };
  }

  const withGps = Object.values(byTruck).filter((t) => t.gpsM != null);
  const tot = withGps.reduce((s, t) => ({ gpsM: s.gpsM + t.gpsM, loadedM: s.loadedM + t.loadedM, emptyM: s.emptyM + t.emptyM, emptyCostRon: s.emptyCostRon + (t.emptyCostRon || 0) }), { gpsM: 0, loadedM: 0, emptyM: 0, emptyCostRon: 0 });
  const totals = { ...tot, pctEmpty: tot.gpsM > 0 ? tot.emptyM / tot.gpsM : null, trucks: withGps.length };
  const trendArr = [...trend.values()].filter((t) => typeof t === 'object').sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((t) => ({ ...t, pctEmpty: t.gpsM > 0 ? t.emptyM / t.gpsM : null }));

  return { rows, gaps, perDriver: [], issues, byTruck, totals, trend: trendArr, trucksWithoutGps };
}
