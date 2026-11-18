// Import exporturi SafeFleet: „Foaie de activitate zilnică” și „Călătorii”, multi-fișier, idempotent. Nu scrie în store.
// Forme produse (nu există încă în core/types.js; documentate aici):
//   GpsDay  { id, truckId, plate, date, kmM, travelS, drivingS, idleEngineS, pauseS, activeS, startAt, stopAt, idle, source:'daily'|'trips'|'trips+daily',
//             dailyKmM, tripsKmM, tripCount, countries:{[cc]:Meters}, odoStartM?, odoStopM?, importId? }
//   GpsTrip { id, truckId, plate, nr, start, stop, date, from:Addr, to:Addr, kmM, maxKmh, avgKmh, durationS, drivingS, idleS, pauseS, maneuver }
//   Addr    { street, locality, postcode, country, countryCode, raw }
import { normHeader, cellText, isBlank, rowIsEmpty, kmToMeters, secondsCell, parsePlainNumber, parseDayCell, parseDateTimeCell, rowNo } from './cells.js';
import { headerSignature } from './mapping.js';
import { readWorkbook, plateFromFileName } from './xlsx-reader.js';
import { readCsv, decodeText } from './csv.js';
import { countryCodeFromName } from './route.js';
import { normalizePlate } from '../core/plates.js';
import { detId } from '../core/ids.js';
import { eachDay } from '../core/dates.js';

export const MANEUVER_M = 2000; // călătorii sub 2 km = manevre (se grupează la afișare, nu se șterg)
export const ODO_TOLERANCE = 0.005; // 0,5%
export const ODO_WARN = 0.01; // 1% => avertizare

const DAILY_DEFS = {
  day: ['ziua', 'data', 'date', 'day', 'zi', 'datazilei'],
  distance: ['distanta', 'distance', 'distantakm', 'kilometri', 'km', 'mileage', 'parcurs', 'kmparcursi'],
  startAt: ['startactivitate', 'startactivity', 'inceputactivitate'],
  stopAt: ['stopactivitate', 'stopactivity', 'sfarsitactivitate'],
  travelS: ['duratacalatorie', 'traveltime', 'duratadrum'],
  drivingS: ['duratacondus', 'drivingtime'],
  idleEngineS: ['duratastationaremotorpornit', 'engineidling'],
  pauseS: ['duratapauza', 'pausetime'],
  activeS: ['durataactivitate', 'activitytime'],
  plate: ['numardeinmatriculare', 'nrinmatriculare', 'plate', 'platenumber', 'regnumber', 'registrationnumber', 'vehicle', 'vehicul', 'numevehicul'],
};
const TRIP_DEFS = {
  nr: ['nr', 'no', 'numar', 'nrcrt', 'id'],
  start: ['start', 'inceput', 'begin', 'timpstart', 'pornire'],
  stop: ['stop', 'sfarsit', 'end', 'timpstop'],
  posStart: ['pozitiestart', 'startposition', 'from', 'plecare', 'locatiestart', 'startlocation'],
  posStop: ['pozitiestop', 'stopposition', 'to', 'sosire', 'locatiestop', 'stoplocation'],
  driver: ['sofer', 'driver'],
  distance: DAILY_DEFS.distance,
  maxSpeed: ['vitezamaxima', 'maxspeed'],
  avgSpeed: ['vitezamedie', 'avgspeed', 'averagespeed'],
  duration: ['durata', 'duration'],
  driving: ['condus', 'driving'],
  idle: ['stationaremotorpornit', 'idling'],
  pause: ['pauza', 'pause'],
  odoStart: ['odometrustart'],
  odoStop: ['odometrustop'],
  plate: DAILY_DEFS.plate,
};

function matchDefs(row, defs) {
  const cols = {};
  (row || []).forEach((cell, c) => {
    const h = normHeader(cell);
    if (!h) return;
    for (const [f, syn] of Object.entries(defs)) if (syn.includes(h) && cols[f] == null) { cols[f] = c; break; }
  });
  return cols;
}

const FOOT_KEYS = {
  name: ['numevehicul', 'vehiclename', 'vehicle', 'vehicul'],
  plate: ['numardeinmatriculare', 'nrinmatriculare', 'numarinmatriculare', 'platenumber', 'plate', 'registrationnumber', 'regnumber'],
  odoStart: ['odometrustart'],
  odoStop: ['odometrustop'],
};

/** Subsolul „cheie / valoare” (după rândul de date): nume vehicul, plăcuță, odometru. */
export function readGpsFooter(rows, fromRow = 0) {
  const f = { vehicleName: null, plate: null, odoStartM: null, odoStopM: null };
  for (let i = fromRow; i < rows.length; i++) {
    const r = rows[i];
    if (!r || isBlank(r[0]) || isBlank(r[1])) continue;
    const k = normHeader(r[0]);
    if (FOOT_KEYS.plate.includes(k)) f.plate = normalizePlate(cellText(r[1]));
    else if (k === 'numevehicul' || FOOT_KEYS.name.includes(k)) { if (!f.vehicleName) f.vehicleName = cellText(r[1]); }
    else if (FOOT_KEYS.odoStart.includes(k)) f.odoStartM = kmToMeters(r[1]);
    else if (FOOT_KEYS.odoStop.includes(k)) f.odoStopM = kmToMeters(r[1]);
  }
  if (!f.plate && f.vehicleName) {
    const n = normalizePlate(f.vehicleName);
    if (/^[A-Z]{1,2}\d{2,3}[A-Z]{3}$/.test(n)) f.plate = n;
  }
  return f;
}

/**
 * @param {any[][]} rows
 * @param {{[signature:string]:object}} [saved] mapări salvate pe semnătura antetului
 * @returns {{ kind:'daily'|'trips'|null, mapping:{ kind:string|null, headerRow:number|null, cols:object }, plate:string|null, signature:string|null, confidence:number, footer:object }}
 */
export function detectGpsMapping(rows, saved) {
  let best = null;
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    if (rowIsEmpty(rows[i])) continue;
    const d = matchDefs(rows[i], DAILY_DEFS), t = matchDefs(rows[i], TRIP_DEFS);
    const tripScore = ['start', 'stop', 'posStart', 'posStop', 'distance'].filter((f) => t[f] != null).length;
    const dayScore = ['day', 'distance', 'startAt', 'stopAt', 'drivingS'].filter((f) => d[f] != null).length;
    if (tripScore >= 4 && t.posStart != null && t.posStop != null && t.start != null) {
      if (!best || tripScore > best.score) best = { kind: 'trips', row: i, cols: t, score: tripScore, max: 5 };
    } else if (d.day != null && d.distance != null && dayScore >= 2) {
      if (!best || dayScore > best.score) best = { kind: 'daily', row: i, cols: d, score: dayScore, max: 5 };
    }
  }
  if (!best) return { kind: null, mapping: { kind: null, headerRow: null, cols: {} }, plate: null, signature: null, confidence: 0, footer: readGpsFooter(rows) };
  const signature = headerSignature(rows[best.row]);
  let cols = best.cols;
  if (saved && saved[signature]?.cols) cols = { ...cols, ...saved[signature].cols };
  const footer = readGpsFooter(rows, best.row + 1);
  return {
    kind: best.kind, mapping: { kind: best.kind, headerRow: best.row, cols }, plate: footer.plate || null, signature,
    confidence: Math.min(1, best.score / best.max + (footer.plate ? 0.1 : 0)), footer,
  };
}

/** `[DN19, Orașu Nou, 447220, România]` -> { street, locality, postcode, country, countryCode, raw }. */
export function parseAddress(text) {
  const raw = cellText(text);
  const empty = { street: null, locality: null, postcode: null, country: null, countryCode: null, raw: raw || null };
  if (!raw) return empty;
  const inner = raw.replace(/^\s*\[/, '').replace(/\]\s*$/, '');
  const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return empty;
  const looksPost = (s) => /^[A-Za-z]{0,3}[- ]?\d[\d -]{2,8}$/.test(s);
  const country = parts.length >= 2 ? parts[parts.length - 1] : null;
  const rest = country ? parts.slice(0, -1) : parts;
  let postcode = null, locality = null, street = null;
  if (rest.length && looksPost(rest[rest.length - 1])) {
    postcode = rest[rest.length - 1];
    locality = rest.length >= 2 ? rest[rest.length - 2] : null;
    street = rest.length >= 3 ? rest.slice(0, -2).join(', ') : null;
  } else if (rest.length) {
    locality = rest[rest.length - 1];
    street = rest.length >= 2 ? rest.slice(0, -1).join(', ') : null;
  }
  return { street, locality, postcode, country, countryCode: country ? countryCodeFromName(country) : null, raw };
}

const idleText = (v) => /^\(?\s*necunoscut/i.test(cellText(v));
const noneText = (v) => /^\(?\s*(niciunul|none|-)/i.test(cellText(v));

function odometerCheck(sumM, f) {
  if (f.odoStartM == null || f.odoStopM == null) return null;
  const odoDeltaM = f.odoStopM - f.odoStartM;
  const diffM = Math.abs(odoDeltaM - sumM);
  const pct = odoDeltaM > 0 ? diffM / odoDeltaM : null;
  return { sumM, odoDeltaM, diffM, diffPct: pct, withinTolerance: pct == null ? null : pct <= ODO_TOLERANCE, aboveWarning: pct != null && pct > ODO_WARN };
}

/**
 * @param {any[][]} rows
 * @param {{kind:string, headerRow:number, cols:object}} mapping
 * @param {{ plate?:string|null, file?:string }} o
 * @returns {{ kind, plate:string|null, days:object[], trips:object[], issues:Array, odometerCheck:object|null, footer:object, summary:object }}
 */
export function parseGpsRows(rows, mapping, o = {}) {
  const kind = mapping.kind;
  const cols = mapping.cols || {};
  const issues = [];
  const issue = (i, severity, code, message) => issues.push({ row: rowNo(i), severity, code, message });
  const footer = readGpsFooter(rows, (mapping.headerRow ?? 0) + 1);
  const filePlate = o.file ? plateFromFileName(o.file) : null;
  const plate = normalizePlate(o.plate || footer.plate || filePlate || '') || null;
  const days = [], trips = [];
  if (mapping.headerRow == null) { issues.push({ row: 0, severity: 'error', code: 'no_header', message: 'Antetul nu a fost găsit' }); return { kind, plate, days, trips, issues, odometerCheck: null, footer, summary: {} }; }
  if (!plate && cols.plate == null) issues.push({ row: 0, severity: 'error', code: 'plate_missing', message: 'Plăcuța camionului nu a fost găsită (subsol, coloană sau nume fișier): alegeți camionul' });

  const first = mapping.headerRow + 1;
  if (kind === 'daily') {
    const seen = new Set();
    let started = false;
    for (let i = first; i < rows.length; i++) {
      const r = rows[i] || [];
      if (rowIsEmpty(r) || isBlank(r[cols.day])) { if (started) break; continue; }
      const date = parseDayCell(r[cols.day]);
      if (!date) { if (started) break; issue(i, 'warn', 'bad_date', `Zi necitibilă: „${cellText(r[cols.day])}”`); continue; }
      started = true;
      const rowPlate = cols.plate != null && !isBlank(r[cols.plate]) ? normalizePlate(cellText(r[cols.plate])) : plate;
      const km = idleText(r[cols.distance]) ? 0 : kmToMeters(r[cols.distance]);
      if (km == null) { issue(i, isBlank(r[cols.distance]) ? 'warn' : 'error', 'bad_distance', `Distanță necitibilă: „${cellText(r[cols.distance])}”`); continue; }
      if (km < 0) { issue(i, 'error', 'negative_distance', 'Distanță negativă'); continue; }
      const key = `${rowPlate}|${date}`;
      if (seen.has(key)) { issue(i, 'warn', 'duplicate_day', `Ziua ${date} apare de două ori în fișier: se păstrează prima`); continue; }
      seen.add(key);
      const startAt = cols.startAt != null && !idleText(r[cols.startAt]) ? parseDateTimeCell(r[cols.startAt])?.dateTime ?? null : null;
      const stopAt = cols.stopAt != null && !idleText(r[cols.stopAt]) ? parseDateTimeCell(r[cols.stopAt])?.dateTime ?? null : null;
      days.push({
        plate: rowPlate, date, kmM: km,
        travelS: cols.travelS != null ? secondsCell(r[cols.travelS]) : null,
        drivingS: cols.drivingS != null ? secondsCell(r[cols.drivingS]) : null,
        idleEngineS: cols.idleEngineS != null ? secondsCell(r[cols.idleEngineS]) : null,
        pauseS: cols.pauseS != null ? secondsCell(r[cols.pauseS]) : null,
        activeS: cols.activeS != null ? secondsCell(r[cols.activeS]) : null,
        startAt, stopAt, idle: km === 0, source: 'daily',
      });
    }
    const sumM = days.reduce((s, d) => s + d.kmM, 0);
    const chk = new Set(days.map((d) => d.plate)).size <= 1 ? odometerCheck(sumM, footer) : null;
    if (chk && chk.diffPct != null) {
      if (chk.aboveWarning) issues.push({ row: 0, severity: 'warn', code: 'odometer_mismatch', message: `Suma zilnică (${sumM / 1000} km) diferă de odometru (${chk.odoDeltaM / 1000} km) cu ${(chk.diffPct * 100).toFixed(2)}%` }); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
      else if (!chk.withinTolerance) issues.push({ row: 0, severity: 'info', code: 'odometer_diff', message: `Diferență de odometru ${(chk.diffM / 1000).toFixed(1)} km (${(chk.diffPct * 100).toFixed(2)}%), peste toleranța de 0,5%` }); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
    }
    const dates = days.map((d) => d.date).sort();
    return { kind, plate, days, trips, issues, odometerCheck: chk, footer, summary: { count: days.length, sumM, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null, idleDays: days.filter((d) => d.idle).length } };
  }

  // trips
  const seen = new Set();
  let started = false;
  for (let i = first; i < rows.length; i++) {
    const r = rows[i] || [];
    if (rowIsEmpty(r)) { if (started) break; continue; }
    const st = parseDateTimeCell(r[cols.start]);
    if (!st) { if (started) break; issue(i, 'info', 'bad_start', `Rând ignorat înainte de date: „${cellText(r[cols.start])}”`); continue; }
    started = true;
    const sp = cols.stop != null ? parseDateTimeCell(r[cols.stop]) : null;
    const km = kmToMeters(r[cols.distance]);
    if (km == null) { issue(i, 'error', 'bad_distance', `Distanță necitibilă: „${cellText(r[cols.distance])}”`); continue; }
    if (km < 0) { issue(i, 'error', 'negative_distance', 'Distanță negativă'); continue; }
    const rowPlate = cols.plate != null && !isBlank(r[cols.plate]) ? normalizePlate(cellText(r[cols.plate])) : plate;
    const key = `${rowPlate}|${st.dateTime}`;
    if (seen.has(key)) { issue(i, 'warn', 'duplicate_trip', `Călătorie dublă la ${st.dateTime}: ignorată`); continue; }
    seen.add(key);
    if (sp && sp.dateTime < st.dateTime) issue(i, 'warn', 'stop_before_start', 'Stop înaintea startului');
    const from = parseAddress(r[cols.posStart]), to = parseAddress(r[cols.posStop]);
    if (!from.locality && !to.locality) issue(i, 'info', 'no_address', 'Fără adresă de start/stop');
    trips.push({
      plate: rowPlate, nr: cols.nr != null ? cellText(r[cols.nr]) || null : null,
      start: st.dateTime, stop: sp ? sp.dateTime : null, date: st.date, from, to, kmM: km,
      maxKmh: cols.maxSpeed != null ? parsePlainNumber(r[cols.maxSpeed]) : null,
      avgKmh: cols.avgSpeed != null ? parsePlainNumber(r[cols.avgSpeed]) : null,
      durationS: cols.duration != null ? secondsCell(r[cols.duration]) : null,
      drivingS: cols.driving != null ? secondsCell(r[cols.driving]) : null,
      idleS: cols.idle != null ? secondsCell(r[cols.idle]) : null,
      pauseS: cols.pause != null ? secondsCell(r[cols.pause]) : null,
      maneuver: km < MANEUVER_M,
    });
    if (cols.odoStart != null && !noneText(r[cols.odoStart])) { const v = kmToMeters(r[cols.odoStart]); if (v != null) trips[trips.length - 1].odoStartM = v; }
    if (cols.odoStop != null && !noneText(r[cols.odoStop])) { const v = kmToMeters(r[cols.odoStop]); if (v != null) trips[trips.length - 1].odoStopM = v; }
  }
  const sumM = trips.reduce((s, t) => s + t.kmM, 0);
  const byCountry = {};
  for (const t of trips) { const cc = t.to.countryCode || 'XX'; byCountry[cc] = (byCountry[cc] || 0) + t.kmM; }
  const dates = trips.map((t) => t.date).sort();
  return { kind, plate, days, trips, issues, odometerCheck: null, footer, summary: { count: trips.length, sumM, maneuvers: trips.filter((t) => t.maneuver).length, byCountry, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null } };
}

/** Grupează călătoriile consecutive sub 2 km în „manevre” (pentru afișare). */
export function groupManeuvers(trips) {
  const out = [];
  for (const t of trips) {
    const last = out[out.length - 1];
    if (t.maneuver && last && last.maneuver) { last.items.push(t); last.kmM += t.kmM; last.stop = t.stop; last.to = t.to; }
    else out.push({ maneuver: t.maneuver, items: [t], kmM: t.kmM, start: t.start, stop: t.stop, from: t.from, to: t.to, date: t.date });
  }
  return out;
}

/**
 * Îmbină rezultate de la mai multe fișiere (zilnic + călătorii, mai multe camioane) pe plăcuță.
 * Călătoriile sunt sursa primară pe intervalul lor; foaia zilnică umple restul și servește la verificare încrucișată.
 * @returns {{ plates:string[], days:object[], trips:object[], checks:Array, issues:Array }}
 */
export function buildGpsDataset(parsedList) {
  const list = Array.isArray(parsedList) ? parsedList : [parsedList];
  const byPlate = new Map();
  const issues = [];
  const get = (p) => { if (!byPlate.has(p)) byPlate.set(p, { daily: new Map(), trips: new Map(), odo: [] }); return byPlate.get(p); };
  for (const p of list) {
    for (const i of p.issues || []) issues.push({ ...i, file: p.file });
    for (const d of p.days || []) {
      if (!d.plate) continue;
      const g = get(d.plate);
      g.daily.set(d.date, d); // ultimul fișier câștigă pe aceeași zi
    }
    for (const t of p.trips || []) {
      if (!t.plate) continue;
      get(t.plate).trips.set(t.start, t);
    }
    if (p.odometerCheck && p.plate) get(p.plate).odo.push({ odoDeltaM: p.odometerCheck.odoDeltaM, footer: p.footer });
  }
  const days = [], trips = [], checks = [];
  for (const [plate, g] of byPlate) {
    const tl = [...g.trips.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
    trips.push(...tl);
    const tripDates = tl.map((t) => t.date);
    const cov = tripDates.length ? [tripDates[0], tripDates[tripDates.length - 1]] : null;
    const tripsByDay = new Map();
    for (const t of tl) { if (!tripsByDay.has(t.date)) tripsByDay.set(t.date, []); tripsByDay.get(t.date).push(t); }
    const allDates = new Set(g.daily.keys());
    if (cov) for (const d of eachDay(cov[0], cov[1])) allDates.add(d);
    let tripsTotal = 0, dailyTotal = 0, overlapDailyTotal = 0, overlapTripsTotal = 0;
    const dayDiffs = [];
    for (const date of [...allDates].sort()) {
      const daily = g.daily.get(date);
      const inCov = cov && date >= cov[0] && date <= cov[1];
      if (inCov) {
        const ts = tripsByDay.get(date) || [];
        const tripsKm = ts.reduce((s, t) => s + t.kmM, 0);
        const countries = {};
        for (const t of ts) { const cc = t.to.countryCode || 'XX'; countries[cc] = (countries[cc] || 0) + t.kmM; }
        tripsTotal += tripsKm;
        if (daily) { overlapDailyTotal += daily.kmM; overlapTripsTotal += tripsKm; dailyTotal += daily.kmM; if (Math.abs(daily.kmM - tripsKm) > Math.max(1000, daily.kmM * ODO_TOLERANCE)) dayDiffs.push({ date, dailyKmM: daily.kmM, tripsKmM: tripsKm }); }
        days.push({
          plate, date, kmM: tripsKm, idle: tripsKm === 0, source: daily ? 'trips+daily' : 'trips', dailyKmM: daily ? daily.kmM : null, tripsKmM: tripsKm, tripCount: ts.length, countries,
          travelS: daily?.travelS ?? null, drivingS: daily?.drivingS ?? (ts.length ? ts.reduce((s, t) => s + (t.drivingS || 0), 0) : null), idleEngineS: daily?.idleEngineS ?? null,
          pauseS: daily?.pauseS ?? null, activeS: daily?.activeS ?? null, startAt: daily?.startAt ?? (ts[0]?.start ?? null), stopAt: daily?.stopAt ?? (ts.length ? (ts[ts.length - 1].stop ?? null) : null),
        });
      } else if (daily) {
        dailyTotal += daily.kmM;
        days.push({ ...daily, dailyKmM: daily.kmM, tripsKmM: null, tripCount: 0, countries: {}, source: 'daily' });
      }
    }
    const odoDelta = g.odo.length ? g.odo[0].odoDeltaM : null;
    const chk = { plate, tripsKmM: tripsTotal, dailyKmM: dailyTotal, overlapTripsKmM: overlapTripsTotal, overlapDailyKmM: overlapDailyTotal, odoDeltaM: odoDelta, dayDiffs };
    chk.tripsVsDailyPct = overlapDailyTotal > 0 && cov ? Math.abs(overlapTripsTotal - overlapDailyTotal) / overlapDailyTotal : null;
    chk.tripsVsDailyOk = chk.tripsVsDailyPct == null ? null : chk.tripsVsDailyPct <= ODO_TOLERANCE;
    chk.tripsVsOdoPct = odoDelta && tripsTotal ? Math.abs(odoDelta - tripsTotal) / odoDelta : null;
    chk.tripsVsOdoOk = chk.tripsVsOdoPct == null ? null : chk.tripsVsOdoPct <= ODO_TOLERANCE;
    if (chk.tripsVsDailyPct != null && !chk.tripsVsDailyOk) issues.push({ row: 0, severity: 'warn', code: 'trips_vs_daily', message: `${plate}: călătoriile (${overlapTripsTotal / 1000} km) diferă de foaia zilnică (${overlapDailyTotal / 1000} km) cu ${(chk.tripsVsDailyPct * 100).toFixed(2)}%` }); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
    for (const x of dayDiffs.slice(0, 20)) issues.push({ row: 0, severity: 'info', code: 'trips_vs_daily_day', message: `${plate} ${x.date}: zilnic ${x.dailyKmM / 1000} km, călătorii ${x.tripsKmM / 1000} km` });
    checks.push(chk);
  }
  return { plates: [...byPlate.keys()], days, trips, checks, issues };
}

const dayCmp = ['kmM', 'travelS', 'drivingS', 'idleEngineS', 'pauseS', 'activeS', 'startAt', 'stopAt', 'source', 'tripCount', 'dailyKmM', 'tripsKmM'];
const tripCmp = ['stop', 'kmM', 'maxKmh', 'avgKmh', 'durationS', 'drivingS', 'idleS', 'pauseS'];

export function matchTruck(plate, trucks) {
  const p = normalizePlate(plate);
  return (trucks || []).find((t) => !t.deletedAt && (normalizePlate(t.plate) === p || normalizePlate(t.gpsVehicleId) === p || (t.gpsPlates || []).map(normalizePlate).includes(p))) || null;
}
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Plan idempotent: reimportul înlocuiește aceeași zi / aceeași călătorie a aceluiași camion.
 * `parsed` = rezultat parseGpsRows, listă de rezultate sau datasetul de la buildGpsDataset.
 * @returns {{ add:object[], replace:object[], unchanged:string[], unmatchedPlates:string[], trips:{add:object[],replace:object[],unchanged:string[]}, dataset:object }}
 */
export function planGpsImport(parsed, existingDays = [], trucks = [], existingTrips = []) {
  const dataset = Array.isArray(parsed) ? buildGpsDataset(parsed) : (parsed.plates && parsed.checks ? parsed : buildGpsDataset([parsed]));
  const exDays = new Map((existingDays || []).filter((d) => !d.deletedAt).map((d) => [d.id, d]));
  const exTrips = new Map((existingTrips || []).filter((d) => !d.deletedAt).map((d) => [d.id, d]));
  const unmatched = new Set();
  const out = { add: [], replace: [], unchanged: [], unmatchedPlates: [], trips: { add: [], replace: [], unchanged: [] }, dataset };
  const truckOf = new Map();
  for (const p of dataset.plates) { const t = matchTruck(p, trucks); if (t) truckOf.set(p, t); else unmatched.add(p); }
  for (const d of dataset.days) {
    const t = truckOf.get(d.plate);
    if (!t) continue;
    const id = detId('gpd', t.id, d.date);
    const rec = { ...d, id, truckId: t.id };
    const ex = exDays.get(id);
    if (!ex) out.add.push(rec);
    else if (dayCmp.every((f) => sameJson(ex[f], rec[f])) && sameJson(ex.countries, rec.countries)) out.unchanged.push(id);
    else out.replace.push(rec);
  }
  for (const tr of dataset.trips) {
    const t = truckOf.get(tr.plate);
    if (!t) continue;
    const id = detId('gpt', t.id, tr.start);
    const rec = { ...tr, id, truckId: t.id };
    const ex = exTrips.get(id);
    if (!ex) out.trips.add.push(rec);
    else if (tripCmp.every((f) => sameJson(ex[f], rec[f])) && sameJson(ex.from, rec.from) && sameJson(ex.to, rec.to)) out.trips.unchanged.push(id);
    else out.trips.replace.push(rec);
  }
  out.unmatchedPlates = [...unmatched];
  return out;
}

/**
 * Citește mai multe fișiere deodată (.xlsx / .csv), detectează tipul, potrivește după plăcuță și îmbină.
 * @param {Array<File>} files
 * @param {{ plates?:{[fileName:string]:string}, savedMappings?:object, readWorkbookImpl?:Function }} [o]
 * @returns {Promise<{ files:Array, dataset:object, issues:Array }>}
 */
export async function parseGpsFiles(files, o = {}) {
  const results = [];
  const read = o.readWorkbookImpl || readWorkbook;
  for (const f of files) {
    const name = f.name || 'fisier';
    const sheets = [];
    try {
      if (/\.(csv|txt)$/i.test(name)) {
        const text = decodeText(await f.arrayBuffer());
        sheets.push({ name: 'csv', rows: readCsv(text).rows });
      } else {
        const wb = await read(f);
        for (const s of wb.sheets) if (s.rows.length) sheets.push(s);
      }
    } catch (e) {
      results.push({ file: name, kind: null, error: `Fișier necitibil: ${e.message}`, issues: [], days: [], trips: [] });
      continue;
    }
    let found = false;
    for (const s of sheets) {
      const det = detectGpsMapping(s.rows, o.savedMappings);
      if (!det.kind) continue;
      found = true;
      const override = o.plates?.[name];
      const parsed = parseGpsRows(s.rows, det.mapping, { plate: override || det.plate, file: name });
      results.push({ file: name, sheet: s.name, signature: det.signature, confidence: det.confidence, needsPlate: !parsed.plate && det.mapping.cols.plate == null, ...parsed });
    }
    if (!found) results.push({ file: name, kind: null, error: 'Format GPS nerecunoscut (nu s-a găsit antetul „Ziua/Distanță” sau „Poziție Start/Stop”): folosiți maparea manuală', issues: [], days: [], trips: [] });
  }
  const ok = results.filter((r) => r.kind);
  const dataset = buildGpsDataset(ok);
  return { files: results, dataset, issues: dataset.issues };
}

