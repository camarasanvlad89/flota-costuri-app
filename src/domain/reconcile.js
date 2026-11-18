// domain/reconcile.js: „Confruntare GPS vs facturat” (DEV-PLAN 17.1). Pur.
// Pe camion și lună: fiecare cursă facturată cu dovada GPS pe zilele ei (km, activ/inactiv, opriri la locurile
// indicate) și STEAGURI cu severitate, stare (neconfirmat / explicat / ignorat) și notă.
//
//   IDLE_ON_COURSE          high    cursă facturată, camion inactiv/0 km pe toate zilele ei
//   LOW_KM_VS_ROUTE         medium  km GPS implauzibil de puțini față de distanța cursei
//   PLACE_NOT_VISITED       medium  nicio oprire GPS lângă locul de încărcare/descărcare la datele indicate
//   UNCOVERED_ACTIVE_PERIOD medium  zile active GPS fără cursă (consecutive grupate, cu km)
//   COURSE_OVERLAP          high    două curse suprapuse pe același camion (lanțul în aceeași zi NU)
//   COURSE_NO_PRICE         medium  cursă fără preț
//   NO_GPS_RANGE            info    cursă în afara intervalului GPS importat („fără date GPS”)
//
// Id de steag determinist (detId(code, truckId, refKey)); starea și nota se păstrează la reanalizare.

import { detId } from '../core/ids.js';
import { eachDay, monthKey } from '../core/dates.js';
import { courseDays, coursesOverlap } from './courses.js';
import { prepareTruck, IDLE_M } from './emptyKm.js';

/** @typedef {{ id:string, code:string, severity:'high'|'medium'|'info', status:'neconfirmat'|'explicat'|'ignorat', note:string,
 *   truckId:string, month:string|null, date:string|null, refs:Array<{type:string,id:string}>, message:string, detail?:object, updatedAt?:string }} Flag */

export const FLAG_CODES = ['IDLE_ON_COURSE', 'LOW_KM_VS_ROUTE', 'PLACE_NOT_VISITED', 'UNCOVERED_ACTIVE_PERIOD', 'COURSE_OVERLAP', 'COURSE_NO_PRICE', 'NO_GPS_RANGE'];
export const FLAG_SEVERITY = {
  IDLE_ON_COURSE: 'high', COURSE_OVERLAP: 'high',
  LOW_KM_VS_ROUTE: 'medium', PLACE_NOT_VISITED: 'medium', UNCOVERED_ACTIVE_PERIOD: 'medium', COURSE_NO_PRICE: 'medium',
  NO_GPS_RANGE: 'info',
};
export const FLAG_STATUSES = ['neconfirmat', 'explicat', 'ignorat'];

/**
 * @param {{ truckIds?:string[], courses:object[], gpsDays:object[], gpsTrips:object[], aliases?:object[],
 *   existingFlags?:Flag[], range?:{from:string,to:string}, coverage?:{[truckId:string]:{from:string,to:string}},
 *   idleM?:number, lowKmRatio?:number, uncoveredMinM?:number, now?:string }} i
 * @returns {{ evidence:Array<object>, flags:Flag[], staleFlagIds:string[], uncoveredPeriods:Array<object>, monthly:Array<object>,
 *   matchesToConfirm:Array<object>, unassigned:string[] }}
 */
export function reconcile(i) {
  const idleM = i.idleM ?? IDLE_M;
  const lowRatio = i.lowKmRatio ?? 0.5;
  const prev = new Map((i.existingFlags || []).filter((f) => !f.deletedAt).map((f) => [f.id, f]));
  const flags = new Map();
  const evidence = [], uncoveredPeriods = [], monthly = [], matchesToConfirm = [], unassigned = [];
  const live = (i.courses || []).filter((c) => !c.deletedAt && c.loadDate);
  for (const c of live) if (!c.truckId) unassigned.push(c.id);
  const truckIds = i.truckIds || [...new Set([...live.map((c) => c.truckId), ...(i.gpsDays || []).map((d) => d.truckId), ...(i.gpsTrips || []).map((t) => t.truckId)].filter(Boolean))];
  const inRange = (c) => !i.range || (c.unloadDate >= i.range.from && c.loadDate <= i.range.to);

  const addFlag = (code, truckId, refKey, message, o = {}) => {
    const id = detId('flg', code, truckId, refKey);
    const old = prev.get(id);
    const f = {
      id, code, severity: FLAG_SEVERITY[code], status: old?.status || 'neconfirmat', note: old?.note || '',
      truckId, month: o.month ?? (o.date ? monthKey(o.date) : null), date: o.date ?? null,
      refs: o.refs || [], message, detail: o.detail, updatedAt: old?.updatedAt ?? i.now,
    };
    flags.set(id, f);
    return id;
  };

  for (const truckId of truckIds) {
    const T = prepareTruck(truckId, { courses: live, gpsDays: i.gpsDays, gpsTrips: i.gpsTrips, aliases: i.aliases, coverage: i.coverage });
    const cs = T.courses;
    const cov = T.coverage;
    const hasData = (d) => !!cov && d >= cov.from && d <= cov.to;
    const kmOf = (d) => T.km.get(d)?.m || 0;
    const covered = new Set(); // zile acoperite de cel puțin o cursă

    for (const c of cs) {
      const W = courseDays(c);
      for (const d of W) covered.add(d);
      const ev = {
        courseId: c.id, truckId, loadDate: c.loadDate, unloadDate: c.unloadDate, route: c.routeRaw ?? null, priceStatus: c.priceStatus ?? null,
        days: W.map((d) => ({ date: d, kmM: hasData(d) ? kmOf(d) : null, hasData: hasData(d), active: hasData(d) && kmOf(d) >= idleM })),
        gpsKmM: 0, activeDays: 0, idleDays: 0, noDataDays: 0, anchor: null, flagIds: [], support: 'none',
      };
      for (const d of ev.days) {
        if (!d.hasData) ev.noDataDays++;
        else { ev.gpsKmM += d.kmM; if (d.active) ev.activeDays++; else ev.idleDays++; }
      }
      const a = T.anchors.get(c.id) || null;
      if (a) {
        ev.anchor = {
          ok: a.ok, reason: a.reason ?? null, meters: a.ok ? a.meters : null, needsConfirm: !!a.needsConfirm,
          load: a.load ? { locality: a.load.locality, time: a.load.time, score: a.load.score } : null,
          unload: a.unload ? { locality: a.unload.locality, time: a.unload.time, score: a.unload.score } : null,
        };
        if (a.ok && a.needsConfirm) matchesToConfirm.push({ courseId: c.id, truckId, load: ev.anchor.load, unload: ev.anchor.unload });
      }
      const ref = [{ type: 'course', id: c.id }];
      const month = monthKey(c.loadDate);
      const route = c.routeRaw || [c.origin, ...(c.destinations || [])].filter(Boolean).join(' - ');
      const add = (code, refKey, msg, o = {}) => ev.flagIds.push(addFlag(code, truckId, refKey, msg, { date: c.loadDate, month, refs: ref, ...o }));

      if (c.priceStatus === 'missing') add('COURSE_NO_PRICE', c.id, `Cursa ${route} nu are preț.`);

      const covDays = ev.days.filter((d) => d.hasData);
      if (!cov || covDays.length === 0) {
        add('NO_GPS_RANGE', c.id, `Cursa ${route}: fără date GPS pentru datele ei.`);
        ev.support = 'noGps';
      } else {
        if (ev.activeDays === 0) {
          add('IDLE_ON_COURSE', c.id, `Cursa ${route}: camionul a fost inactiv (sub ${Math.round(idleM / 1000)} km/zi) pe toate zilele ei. Dată sau plăcuță greșită?`, { detail: { gpsKmM: ev.gpsKmM } }); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
          ev.support = 'unsupported';
        } else {
          const expected = c.loadedKm && ['column', 'manual', 'route'].includes(c.loadedKm.source) ? c.loadedKm.meters : null;
          if (expected && ev.noDataDays === 0 && ev.gpsKmM < expected * lowRatio) {
            add('LOW_KM_VS_ROUTE', c.id, `Cursa ${route}: ${(ev.gpsKmM / 1000).toFixed(0)} km GPS față de ${(expected / 1000).toFixed(0)} km așteptați.`, { detail: { gpsKmM: ev.gpsKmM, expectedM: expected } }); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
          }
          ev.support = 'supported';
        }
        // opriri la locurile indicate (doar dacă camionul a fost activ și există călătorii pe fereastră;
        // camionul inactiv are deja IDLE_ON_COURSE, fără steag dublu)
        if (ev.activeDays > 0 && a && !a.ok && (a.reason === 'LOAD_NOT_VISITED' || a.reason === 'UNLOAD_NOT_VISITED')) {
          const which = a.reason === 'LOAD_NOT_VISITED' ? 'load' : 'unload';
          add('PLACE_NOT_VISITED', `${c.id}:${which}`, `Cursa ${route}: nicio oprire GPS la locul de ${which === 'load' ? 'încărcare' : 'descărcare'} la datele indicate.`, { detail: { which } });
          ev.support = 'unsupported';
        }
      }
      evidence.push(ev);
    }

    // suprapuneri
    for (let n = 0; n < cs.length; n++) {
      for (let m = n + 1; m < cs.length && cs[m].loadDate <= cs[n].unloadDate; m++) {
        if (!coursesOverlap(cs[n], cs[m])) continue;
        const [x, y] = [cs[n].id, cs[m].id].sort();
        const id = addFlag('COURSE_OVERLAP', truckId, `${x}:${y}`, `Cursele ${cs[n].routeRaw ?? cs[n].id} și ${cs[m].routeRaw ?? cs[m].id} se suprapun pe același camion.`,
          { date: cs[m].loadDate, refs: [{ type: 'course', id: cs[n].id }, { type: 'course', id: cs[m].id }] });
        for (const e of evidence) if (e.courseId === cs[n].id || e.courseId === cs[m].id) e.flagIds.push(id);
      }
    }

    // perioade active fără factură
    let periods = [];
    if (cov) {
      const active = eachDay(cov.from, cov.to).filter((d) => kmOf(d) >= idleM && !covered.has(d));
      let cur = null;
      for (const d of active) {
        if (cur && nextDay(cur.to) === d) { cur.to = d; cur.days++; cur.kmM += kmOf(d); }
        else { cur = { truckId, from: d, to: d, days: 1, kmM: kmOf(d) }; periods.push(cur); }
      }
      if (i.range) periods = periods.filter((p) => p.to >= i.range.from && p.from <= i.range.to);
      for (const p of periods) {
        p.flagId = addFlag('UNCOVERED_ACTIVE_PERIOD', truckId, p.from, `Perioadă fără factură: ${p.days} zi/zile active, ${(p.kmM / 1000).toFixed(0)} km (posibilă muncă nefacturată sau deplasare pe gol).`, // money-ok: nu sunt bani (afișare, km, procente sau pondere)
          { date: p.from, refs: [], detail: { from: p.from, to: p.to, days: p.days, kmM: p.kmM } });
      }
      uncoveredPeriods.push(...periods);
    }

    // sumar lunar
    const months = new Set();
    for (const c of cs) months.add(monthKey(c.loadDate));
    if (cov) for (const d of eachDay(cov.from, cov.to)) months.add(monthKey(d));
    for (const month of [...months].sort()) {
      const mc = evidence.filter((e) => e.truckId === truckId && monthKey(e.loadDate) === month);
      let kmTotal = 0, kmIn = 0;
      if (cov) for (const d of eachDay(cov.from, cov.to)) if (monthKey(d) === month) { const k = kmOf(d); kmTotal += k; if (covered.has(d)) kmIn += k; }
      monthly.push({
        truckId, month,
        courses: mc.length,
        withSupport: mc.filter((e) => e.support === 'supported').length,
        withoutSupport: mc.filter((e) => e.support === 'unsupported').length,
        noGps: mc.filter((e) => e.support === 'noGps').length,
        uncoveredActiveDays: periods.filter((p) => monthKey(p.from) === month || monthKey(p.to) === month)
          .reduce((s, p) => s + eachDay(p.from, p.to).filter((d) => monthKey(d) === month).length, 0),
        kmTotalM: kmTotal, kmInInvoicedWindowsM: kmIn, kmOutsideM: kmTotal - kmIn,
      });
    }
  }

  let out = [...flags.values()];
  if (i.range) out = out.filter((f) => !f.date || (f.date <= i.range.to && (f.detail?.to ?? f.date) >= i.range.from));
  const rank = { high: 0, medium: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.date || '') .localeCompare(b.date || '') || a.id.localeCompare(b.id));
  const stale = [...prev.keys()].filter((id) => !flags.has(id));
  return { evidence: evidence.filter((e) => !i.range || inRange(e)), flags: out, staleFlagIds: stale, uncoveredPeriods, monthly, matchesToConfirm, unassigned };
}

function nextDay(d) {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Setează starea și nota unui steag (păstrate la reanalizare, id determinist). Imuabil.
 * @param {Flag} flag @param {{ status?:Flag['status'], note?:string }} patch @param {string} [now]
 * @returns {Flag}
 */
export function setFlagStatus(flag, patch, now) {
  if (patch.status && !FLAG_STATUSES.includes(patch.status)) throw new RangeError(`stare necunoscută: ${patch.status}`);
  return { ...flag, status: patch.status ?? flag.status, note: patch.note ?? flag.note, updatedAt: now ?? flag.updatedAt };
}

/** Steaguri deschise (neconfirmate) pe camion/lună – pentru KPI. @param {Flag[]} flags @returns {{high:number,medium:number,info:number,total:number}} */
export function openFlagCounts(flags) {
  const out = { high: 0, medium: 0, info: 0, total: 0 };
  for (const f of flags) if (f.status === 'neconfirmat') { out[f.severity]++; out.total++; }
  return out;
}
