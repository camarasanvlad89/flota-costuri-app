// G – Mentenanță simplă (17.3): planuri „următoarea revizie la X km SAU la data Y”, km din GPS, istoric din cheltuieli de service.
// Calcul pur; ceasul (`today`) se injectează. Fără notificări: alerte pe Acasă / Camion.
//
// Colecția `serviceItems`: ServiceItem = {
//   id, subjectType:'truck'|'trailer', subjectId, name, active?:boolean,
//   intervalKmM?: Meters, intervalMonths?: number,          // regula de recurență (opțional)
//   lastDate?: IsoDate, lastKmM?: Meters /* odometru la ultima revizie */,
//   nextKmM?: Meters /* odometru la care e scadentă */, nextDate?: IsoDate /* explicit, altfel lastDate + intervalMonths */,
//   warnKmM?: Meters (implicit 2.000 km), warnDays?: number (implicit 30), note? }
// Alerta apare la pragul de km SAU la dată, oricare vine primul.
import { addDays, addMonths, diffDays } from '../core/dates.js';
import { foldKey } from '../core/text.js';
import { coll, gpsIndex } from './profit.js';

export const MAINT_DEFAULTS = Object.freeze({ warnKmM: 2000000, warnDays: 30 });
const RANK = { ok: 0, soon: 1, overdue: 2 };

/** Odometrul cel mai recent al camionului din GPS (odoStopM de la ultima zi care îl are), sau null. */
export function latestOdometerM(state, truckId, today) {
  const a = gpsIndex(state).get(truckId);
  if (!a) return null;
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i].date > today) continue;
    if (a[i].odoStopM != null) return { odoM: a[i].odoStopM, date: a[i].date };
  }
  return null;
}
/** Σ km GPS ai camionului pe zile > `afterDate` și ≤ `today` (metri). */
export function kmSince(state, truckId, afterDate, today) {
  const a = gpsIndex(state).get(truckId);
  if (!a) return null;
  let s = 0, n = 0;
  for (const d of a) { if (d.date > afterDate && d.date <= today) { s += d.kmM || 0; n++; } }
  return n ? s : null;
}
/** Media zilnică de km în ultimele `days` zile (pentru estimarea datei, orientativ). */
function avgDailyM(state, truckId, today, days = 60) {
  const a = gpsIndex(state).get(truckId);
  if (!a) return null;
  const from = addDays(today, -days);
  let s = 0;
  for (const d of a) if (d.date > from && d.date <= today) s += d.kmM || 0;
  return s > 0 ? s / days : null;
}

/**
 * Starea unui plan de mentenanță.
 * @returns {{ id, name, subjectType, subjectId, state:'ok'|'soon'|'overdue', trigger:'km'|'date'|'both'|null,
 *   remainingKmM:number|null, kmState:string|null, dueKmM:number|null, dueDate:string|null, remainingDays:number|null, dateState:string|null,
 *   currentKmM:number|null, kmSource:'odometer'|'gps-since'|null, etaDate:string|null }}
 */
export function serviceStatus(state, item, today, o = {}) {
  const warnKm = item.warnKmM ?? MAINT_DEFAULTS.warnKmM;
  const warnDays = item.warnDays ?? MAINT_DEFAULTS.warnDays;
  const out = {
    id: item.id, name: item.name, subjectType: item.subjectType, subjectId: item.subjectId, state: 'ok', trigger: null,
    remainingKmM: null, kmState: null, dueKmM: null, dueDate: null, remainingDays: null, dateState: null, currentKmM: null, kmSource: null, etaDate: null,
  };
  // --- km
  const dueKm = item.nextKmM ?? (item.lastKmM != null && item.intervalKmM ? item.lastKmM + item.intervalKmM : null);
  out.dueKmM = dueKm;
  if (item.subjectType === 'truck' || o.currentKmM != null) {
    let remaining = null;
    if (o.currentKmM != null && dueKm != null) { out.currentKmM = o.currentKmM; out.kmSource = 'odometer'; remaining = dueKm - o.currentKmM; }
    else {
      const odo = dueKm != null ? latestOdometerM(state, item.subjectId, today) : null;
      if (odo && dueKm != null) { out.currentKmM = odo.odoM; out.kmSource = 'odometer'; remaining = dueKm - odo.odoM; }
      else if (item.intervalKmM && item.lastDate) {
        const k = kmSince(state, item.subjectId, item.lastDate, today);
        if (k !== null) { out.currentKmM = k; out.kmSource = 'gps-since'; remaining = item.intervalKmM - k; }
      }
    }
    if (remaining !== null) {
      out.remainingKmM = remaining;
      out.kmState = remaining <= 0 ? 'overdue' : remaining <= warnKm ? 'soon' : 'ok';
      const per = avgDailyM(state, item.subjectId, today);
      if (per && remaining > 0) out.etaDate = addDays(today, Math.ceil(remaining / per)); // money-ok: zile estimate din km, nu bani
    }
  }
  // --- dată
  const dueDate = item.nextDate ?? (item.lastDate && item.intervalMonths ? addMonths(item.lastDate, item.intervalMonths) : null);
  out.dueDate = dueDate;
  if (dueDate) {
    out.remainingDays = diffDays(today, dueDate);
    out.dateState = out.remainingDays < 0 ? 'overdue' : out.remainingDays <= warnDays ? 'soon' : 'ok';
  }
  // --- „oricare vine primul”
  const rk = out.kmState ? RANK[out.kmState] : 0, rd = out.dateState ? RANK[out.dateState] : 0;
  const worst = Math.max(rk, rd);
  out.state = worst === 2 ? 'overdue' : worst === 1 ? 'soon' : 'ok';
  if (worst > 0) out.trigger = rk === rd ? 'both' : rk > rd ? 'km' : 'date';
  return out;
}

/**
 * Alertele de mentenanță (starea 'soon' sau 'overdue'), cele depășite primele.
 */
export function maintenanceAlerts(state, today) {
  const out = [];
  const trucks = new Map(coll(state, 'trucks').map((t) => [t.id, t]));
  const trailers = new Map(coll(state, 'trailers').map((t) => [t.id, t]));
  for (const it of coll(state, 'serviceItems')) {
    if (it.active === false) continue;
    const s = serviceStatus(state, it, today);
    if (s.state === 'ok') continue;
    const subj = it.subjectType === 'truck' ? trucks.get(it.subjectId) : trailers.get(it.subjectId);
    out.push({ ...s, subjectName: subj ? (subj.plateDisplay || subj.plate) : it.subjectId });
  }
  out.sort((a, b) => RANK[b.state] - RANK[a.state] || (a.remainingDays ?? 1e9) - (b.remainingDays ?? 1e9) || (a.id < b.id ? -1 : 1));
  return out;
}

/** Planul actualizat după o revizie făcută (se scrie cu `put`): reportează lastDate/lastKmM și recalculează scadențele. */
export function completeService(item, done, nowIso) {
  const next = { ...item, lastDate: done.date, updatedAt: nowIso };
  if (done.kmM != null) next.lastKmM = done.kmM;
  if (item.intervalKmM && next.lastKmM != null) next.nextKmM = next.lastKmM + item.intervalKmM;
  else if (item.intervalKmM) next.nextKmM = null;
  if (item.intervalMonths) next.nextDate = addMonths(done.date, item.intervalMonths);
  return next;
}

/** Categoriile de service/întreținere: `category.maintenance === true` sau nume/grup care conține service, revizie, reparații, întreținere, anvelope. */
export function maintenanceCategoryIds(state) {
  const re = /SERVICE|REVIZ|REPARAT|INTRETINERE|ANVELOP/;
  return new Set(coll(state, 'categories').filter((c) => c.maintenance === true || re.test(foldKey(`${c.name || ''} ${c.group || ''}`))).map((c) => c.id));
}

/** Istoricul de service: cheltuielile din categoriile de service ale unui camion (sau ale tuturor), cele mai noi primele. */
export function serviceHistory(state, truckId, o = {}) {
  const ids = o.categoryIds || maintenanceCategoryIds(state);
  return coll(state, 'entries')
    .filter((e) => e.kind === 'expense' && ids.has(e.categoryId) && !e.parentDocId && (!truckId || e.target?.truckId === truckId))
    .map((e) => ({ entryId: e.id, date: e.date, supplier: e.supplier, note: e.note, categoryId: e.categoryId, currency: e.currency, orig: e.orig?.gross ?? 0, ron: e.ron?.gross ?? 0, ronCost: e.ron?.cost ?? 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.entryId < b.entryId ? 1 : -1));
}
