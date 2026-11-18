// Calitatea datelor (5.8 „Panou de calitate”, 8.2 AC5, 8.9 AC5, 17.3 I) — domain/quality.js.
// dataQuality(state, range) ⇒ QualityIssue[] = { code, severity:'info'|'warn'|'error', truckId?, date?, refs:[{type,id}], message, count? }
// Calcul pur, din stare. Mesajele sunt în română și sunt gata de afișat; `code` este stabil (pentru linkuri și teste).
import { addDays, diffDays, eachDay, fmtDate } from '../core/dates.js';
import { fmtKm, fmtNumber } from '../core/format.js';
import { mergeDailyKm, coverageOf } from './gpsKm.js';
import { verifyClosure } from './closing.js';
import { noDocReport } from './reports.js';
import { coll, memo, isBnrSource } from './profit.js';

const SEV = { error: 0, warn: 1, info: 2 };
const inR = (d, r) => d >= r.from && d <= r.to;
const windowOf = (c) => ({ from: c.loadDate, to: c.unloadDate >= c.loadDate ? c.unloadDate : c.loadDate });
const ovl = (a, b) => (a.from > b.from ? a.from : b.from) <= (a.to < b.to ? a.to : b.to);
const overlapN = (a, b) => {
  const f = a.from > b.from ? a.from : b.from, t = a.to < b.to ? a.to : b.to;
  return f > t ? 0 : diffDays(f, t) + 1;
};

/** Km pe zi ale unui camion (călătorii = sursa primară, foaia zilnică = rezervă): Map<IsoDate, {m, source}>. */
function dayKmOf(state, truckId) {
  return memo(state, 'dayKm|' + truckId, () => {
    const days = coll(state, 'gpsDays').filter((d) => d.truckId === truckId);
    const trips = coll(state, 'gpsTrips').filter((t) => t.truckId === truckId);
    return mergeDailyKm(days, trips);
  });
}
function coverageForTruck(state, truckId) {
  return memo(state, 'cov|' + truckId, () => coverageOf(coll(state, 'gpsDays').filter((d) => d.truckId === truckId), coll(state, 'gpsTrips').filter((t) => t.truckId === truckId)));
}
function kmInWindow(state, truckId, w) {
  const m = dayKmOf(state, truckId);
  let s = 0;
  for (const [d, v] of m) if (d >= w.from && d <= w.to) s += v.m;
  return s;
}

// --------------------------------------------------------------------------- e-Transport (17.3 I): doar evidență
/**
 * Starea UIT a unei curse. Valabilitate 5 zile de la emitere (`uit.issuedAt`) sau, dacă lipsește, de la data încărcării.
 * Nu se transmite nimic către e-Transport; este doar evidență și memento.
 * @returns {{ state:'missing'|'ok'|'expiring'|'expired', validUntil:string|null, daysLeft:number|null }}
 */
export function uitStatus(course, today) {
  if (!course?.uit?.code) return { state: 'missing', validUntil: null, daysLeft: null };
  const start = (course.uit.issuedAt || course.loadDate || '').slice(0, 10);
  if (!start) return { state: 'ok', validUntil: null, daysLeft: null };
  const validUntil = addDays(start, 5);
  const daysLeft = diffDays(today, validUntil);
  const unload = course.unloadDate || course.loadDate;
  if (unload && unload > validUntil) return { state: 'expired', validUntil, daysLeft };
  if (daysLeft <= 1 && daysLeft >= 0 && unload && unload >= today) return { state: 'expiring', validUntil, daysLeft };
  return { state: 'ok', validUntil, daysLeft };
}

/** Curse fără UIT (informare, în listă și în De verificat) + memento de valabilitate. `onlyRecent` = ultimele N zile. */
export function uitIssues(state, today, o = {}) {
  const horizon = o.onlyRecentDays ?? 60;
  const out = [];
  for (const c of coll(state, 'courses')) {
    if (!c.loadDate) continue;
    if (c.loadDate && diffDays(c.loadDate, today) > horizon) continue;
    const s = uitStatus(c, today);
    if (s.state === 'ok') continue;
    out.push({
      code: s.state === 'missing' ? 'UIT_MISSING' : s.state === 'expired' ? 'UIT_EXPIRED' : 'UIT_EXPIRING',
      severity: s.state === 'missing' ? 'info' : 'warn', truckId: c.truckId, date: c.loadDate, refs: [{ type: 'course', id: c.id }],
      message: s.state === 'missing' ? `Cursa ${fmtDate(c.loadDate)} (${c.routeRaw || ''}): lipsă UIT.`
        : s.state === 'expired' ? `Cursa ${fmtDate(c.loadDate)}: descărcarea este după valabilitatea UIT (${fmtDate(s.validUntil)}).`
          : `Cursa ${fmtDate(c.loadDate)}: UIT expiră la ${fmtDate(s.validUntil)}.`,
    });
  }
  return out;
}

// --------------------------------------------------------------------------- panoul de calitate
/**
 * @param {object} state
 * @param {{from:string,to:string}} range
 * @param {{today?:string, gapMinM?:number, includeUit?:boolean}} [o]
 */
export function dataQuality(state, range, o = {}) {
  const issues = [];
  const add = (code, severity, message, extra = {}) => issues.push({ code, severity, refs: [], ...extra, message });
  const trucks = coll(state, 'trucks');
  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const label = (id) => truckById.get(id)?.plateDisplay || truckById.get(id)?.plate || id || '?';
  const minKmDay = o.minDayM ?? 1000;
  const courses = coll(state, 'courses').filter((c) => c.loadDate && ovl(windowOf(c), range));
  const byTruck = new Map();
  for (const c of courses) {
    if (!byTruck.has(c.truckId)) byTruck.set(c.truckId, []);
    byTruck.get(c.truckId).push(c);
  }

  // 1. plăcuțe GPS fără potrivire cu un camion
  const unmatched = new Map();
  for (const d of coll(state, 'gpsDays')) if (!d.truckId || !truckById.has(d.truckId)) unmatched.set(d.plate || d.truckId || '(fără plăcuță)', (unmatched.get(d.plate || d.truckId || '(fără plăcuță)') || 0) + 1);
  for (const t of coll(state, 'gpsTrips')) if (!t.truckId || !truckById.has(t.truckId)) unmatched.set(t.plate || t.truckId || '(fără plăcuță)', (unmatched.get(t.plate || t.truckId || '(fără plăcuță)') || 0) + 1);
  for (const [plate, n] of unmatched) {
    add('GPS_PLATE_UNMATCHED', 'error', `Date GPS pentru plăcuța ${plate} (${n} înregistrări) nu se potrivesc cu niciun camion.`, { count: n, refs: [{ type: 'plate', id: String(plate) }] });
  }

  // 2. pe camion
  for (const t of trucks) {
    const cs = byTruck.get(t.id) || [];
    const cov = coverageForTruck(state, t.id);
    const dayKm = dayKmOf(state, t.id);
    if (!cov) {
      if (cs.length) add('TRUCK_NO_GPS', 'info', `${label(t.id)}: are curse în perioadă, dar nu are date GPS importate (km pe gol: necunoscut).`, { truckId: t.id, count: cs.length });
      continue;
    }
    const wins = cs.map(windowOf);
    // 2a. zile cu GPS fără cursă (grupate în perioade consecutive)
    let run = null;
    const flush = () => {
      if (!run) return;
      add('GPS_DAYS_NO_COURSE', 'warn', `${label(t.id)}: ${run.days} ${run.days === 1 ? 'zi' : 'zile'} cu GPS fără cursă (${fmtDate(run.from)}${run.from !== run.to ? '–' + fmtDate(run.to) : ''}), ${fmtKm(run.m, 1)}.`,
        { truckId: t.id, date: run.from, count: run.days, refs: [{ type: 'gpsDays', id: `${t.id}|${run.from}|${run.to}` }] });
      run = null;
    };
    for (const d of eachDay(range.from < cov.from ? cov.from : range.from, range.to > cov.to ? cov.to : range.to)) {
      const v = dayKm.get(d);
      const covered = wins.some((w) => d >= w.from && d <= w.to);
      if (v && v.m >= minKmDay && !covered) {
        if (run && diffDays(run.to, d) === 1) { run.to = d; run.days++; run.m += v.m; } else { flush(); run = { from: d, to: d, days: 1, m: v.m }; }
      } else flush();
    }
    flush();
    // 2b. zile fără GPS în interiorul perioadei acoperite, în ferestre de cursă
    let missingDays = 0;
    for (const w of wins) for (const d of eachDay(w.from < cov.from ? cov.from : w.from, w.to > cov.to ? cov.to : w.to)) if (inR(d, range) && !dayKm.has(d)) missingDays++;
    if (missingDays) add('GPS_DAYS_MISSING', 'warn', `${label(t.id)}: ${missingDays} zile din curse nu au nicio înregistrare GPS (deși există GPS în perioadă).`, { truckId: t.id, count: missingDays });
    // 2c. curse în afara intervalului GPS
    const outside = cs.filter((c) => c.loadDate > cov.to || c.unloadDate < cov.from);
    if (outside.length) add('COURSES_OUTSIDE_GPS', 'info', `${label(t.id)}: ${outside.length} curse sunt în afara intervalului GPS importat (${fmtDate(cov.from)}–${fmtDate(cov.to)}).`, { truckId: t.id, count: outside.length, refs: outside.map((c) => ({ type: 'course', id: c.id })) });
    // 2d. curse cu GPS acoperit, dar fără km; km încărcați > GPS; estimare vs GPS
    for (const c of cs) {
      const w = windowOf(c);
      if (w.from < cov.from || w.to > cov.to) continue;
      const g = kmInWindow(state, t.id, w);
      const ref = [{ type: 'course', id: c.id }];
      if (g === 0) add('COURSE_NO_GPS', 'warn', `${label(t.id)}: cursa ${fmtDate(c.loadDate)}–${fmtDate(c.unloadDate)} (${c.routeRaw || ''}) nu are km GPS în fereastră.`, { truckId: t.id, date: c.loadDate, refs: ref });
      const L = c.loadedKm?.meters;
      if (L != null && g > 0 && L * 100 > g * 103) add('LOADED_GT_GPS', 'warn', `${label(t.id)}: cursa ${fmtDate(c.loadDate)}: km încărcați (${fmtKm(L, 1)}) depășesc km GPS din fereastră (${fmtKm(g, 1)}).`, { truckId: t.id, date: c.loadDate, refs: ref });
      else if (L != null && g > 0 && c.loadedKm?.source === 'route' && Math.abs(L - g) / g > 0.15 && L < g) {
        add('ESTIMATE_VS_GPS', 'info', `${label(t.id)}: cursa ${fmtDate(c.loadDate)}: distanța estimată (${fmtKm(L, 1)}) diferă cu peste 15% de km GPS din fereastră (${fmtKm(g, 1)}); fereastra poate include și parcursul pe gol.`, { truckId: t.id, date: c.loadDate, refs: ref });
      }
    }
  }

  // 3. curse: preț lipsă, km încărcați lipsă, suprapuneri
  const noKm = new Map();
  for (const c of courses) {
    const ref = [{ type: 'course', id: c.id }];
    if (c.priceStatus === 'missing') add('COURSE_NO_PRICE', 'warn', `Cursa ${fmtDate(c.loadDate)} (${label(c.truckId)}, ${c.routeRaw || ''}) nu are preț.`, { truckId: c.truckId, date: c.loadDate, refs: ref });
    if (c.loadedKm?.meters == null) (noKm.get(c.truckId) || noKm.set(c.truckId, []).get(c.truckId)).push(c);
  }
  for (const [tid, list] of noKm) {
    add('COURSE_NO_LOADED_KM', 'info', `${label(tid)}: ${list.length} curse nu au km încărcați; km pe gol folosește călătoriile GPS sau fereastra GPS.`, { truckId: tid, count: list.length, refs: list.map((c) => ({ type: 'course', id: c.id })) });
  }
  for (const [tid, cs] of byTruck) {
    const sorted = [...cs].sort((a, b) => (a.loadDate < b.loadDate ? -1 : a.loadDate > b.loadDate ? 1 : a.id < b.id ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].loadDate > windowOf(sorted[i]).to) break;
        if (overlapN(windowOf(sorted[i]), windowOf(sorted[j])) > 1) {
          add('COURSE_OVERLAP', 'error', `${label(tid)}: cursele ${fmtDate(sorted[i].loadDate)}–${fmtDate(sorted[i].unloadDate)} și ${fmtDate(sorted[j].loadDate)}–${fmtDate(sorted[j].unloadDate)} se suprapun.`,
            { truckId: tid, date: sorted[j].loadDate, refs: [{ type: 'course', id: sorted[i].id }, { type: 'course', id: sorted[j].id }] });
        }
      }
    }
  }

  // 4. locuri nerezolvate (candidate neconfirmate)
  const pending = coll(state, 'places').filter((p) => p.confirmed === false);
  if (pending.length) add('PLACE_UNRESOLVED', 'warn', `${pending.length} locuri așteaptă confirmare.`, { count: pending.length, refs: pending.map((p) => ({ type: 'place', id: p.id })) });

  // 5. consum de combustibil față de normă
  const entries = coll(state, 'entries');
  const parents = new Set(entries.filter((e) => e.parentDocId && e.fuel).map((e) => e.parentDocId));
  for (const t of trucks) {
    if (!t.normFuelL100) continue;
    let ml = 0;
    for (const e of entries) {
      if (e.kind !== 'expense' || !e.fuel || e.target?.truckId !== t.id || !inR(e.date, range) || parents.has(e.id)) continue;
      ml += e.fuel.ml || 0;
    }
    let gps = 0;
    for (const [d, v] of dayKmOf(state, t.id)) if (inR(d, range)) gps += v.m;
    if (!ml || !gps) continue;
    const l100 = (ml * 100) / gps;                       // ml/m = L/1000·... : ml·100/m = L / 100 km
    const dev = (l100 - t.normFuelL100) / t.normFuelL100;
    if (Math.abs(dev) > 0.15) {
      const long = diffDays(range.from, range.to) >= 27;
      add('FUEL_CONSUMPTION', long ? 'warn' : 'info', `${label(t.id)}: consum ${fmtNumber(l100, 1)} L/100 km față de norma ${fmtNumber(t.normFuelL100, 1)} (${fmtNumber(dev * 100, 0, { sign: true })}%).`, { truckId: t.id, refs: [{ type: 'truck', id: t.id }] });
    }
  }

  // 6. luni închise modificate
  const months = new Set();
  for (const c of coll(state, 'closures')) if (c.month && (c.month + '-31') >= range.from && (c.month + '-01') <= range.to) months.add(c.month);
  for (const m of months) {
    const v = verifyClosure(state, m);
    if (v.closed && !v.ok) add('CLOSED_MONTH_CHANGED', 'error', `Luna închisă ${m} s-a schimbat față de închidere.`, { refs: [{ type: 'month', id: m }] });
  }

  // 7. cursuri ne-BNR / vechi
  let nonBnr = 0, stale = 0;
  for (const rec of [...entries.filter((e) => inR(e.docDate || e.date, range)), ...courses]) {
    if (!rec.fx || rec.fx.source === 'ron') continue;
    if (!isBnrSource(rec.fx.source)) nonBnr++;
    if (rec.fx.stale) stale++;
  }
  if (nonBnr) add('FX_NOT_BNR', 'info', `${nonBnr} sume folosesc un curs care nu este BNR.`, { count: nonBnr });
  if (stale) add('FX_STALE', 'warn', `${stale} sume folosesc un curs vechi / estimat.`, { count: stale });

  // 8. fără document peste plafon fără justificare
  const nd = noDocReport(state, range);
  const miss = nd.rows.filter((r) => r.missingJustification);
  if (miss.length) add('NODOC_NO_JUSTIFICATION', 'error', `${miss.length} cheltuieli fără document peste plafon nu au justificare.`, { count: miss.length, refs: miss.map((r) => ({ type: 'entry', id: r.entryId })) });
  const over = nd.monthly.filter((m) => m.overCeiling);
  if (over.length) add('NODOC_MONTHLY_CEILING', 'warn', `${over.length} combinații lună/camion depășesc plafonul lunar pentru cheltuieli fără document.`, { count: over.length });

  // 9. e-Transport (informare)
  if (o.includeUit !== false && o.today) {
    const us = uitIssues(state, o.today).filter((u) => inR(u.date, range));
    const missing = us.filter((u) => u.code === 'UIT_MISSING');
    if (missing.length) add('UIT_MISSING', 'info', `${missing.length} curse fără cod UIT (e-Transport, doar evidență).`, { count: missing.length, refs: missing.flatMap((u) => u.refs) });
    for (const u of us) if (u.code !== 'UIT_MISSING') issues.push(u);
  }

  issues.sort((a, b) => SEV[a.severity] - SEV[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || ((a.date || '') < (b.date || '') ? -1 : 1));
  return issues;
}

/** Numărul de probleme pe severitate (pentru insigne). */
export function qualitySummary(issues) {
  const s = { error: 0, warn: 0, info: 0 };
  for (const i of issues) s[i.severity]++;
  return s;
}

