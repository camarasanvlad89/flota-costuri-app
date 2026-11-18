// D – Diurnă externă (17.3): zile în străinătate pe șofer / camion din țările călătoriilor GPS (și, ca estimare, din curse),
// sume zilnice pe țară în EUR și plafon scutit, foaie de deplasare printabilă. Calcul pur; fără I/O.
//
// IMPORTANT: sumele zilnice, plafonul scutit și regula pentru zilele de capăt sunt VALORI DE PORNIRE EDITABILE
// (singleton `diurna`), marcate „de verificat cu contabilul”. Nu sunt consultanță fiscală.
//
// Regula de numărare a unei zile (`countMode`):
//  - 'anyPresence' (implicit): ziua se numără dacă în ea camionul a fost, la un moment dat, în afara țării firmei
//    (include zilele de plecare și de întoarcere; o noapte petrecută în străinătate continuă zilele următoare);
//  - 'nightAbroad': ziua se numără doar dacă la sfârșitul ei camionul se află în străinătate (zilele de întoarcere nu).
// Țara zilei (pentru cotă) = țara străină cu cei mai mulți km din acea zi (după țara de sosire a călătoriilor), altfel cea de la sfârșitul zilei.
import { mulDiv, convert } from '../core/money.js';
import { diffDays, eachDay, addDays, fmtDate } from '../core/dates.js';
import { fmtMoney } from '../core/format.js';
import { normTrips, coverageOf } from './gpsKm.js';
import { coll, companyOf, singleton } from './profit.js';

export const DIURNA_NOTE = 'de verificat cu contabilul';

/** Valori de pornire (EUR, în cenți). NU sunt valori legale garantate; se editează în Setări. */
export const DIURNA_DEFAULTS = Object.freeze({
  defaultRateEur: 3500,           // 35,00 EUR / zi, valoare de pornire
  ratesEur: {},                   // { HU: 4000, DE: 5000, ... } suprascrie valoarea implicită pe țară
  taxFreeBaseEur: 3500,           // baza legală pe zi, de verificat
  taxFreeMultiplier: 2.5,         // plafonul scutit = bază × multiplicator, de verificat (sector privat)
  ceilingEurByCountry: {},        // plafon scutit explicit pe țară (cenți), dacă diferă
  edgeDayPct: 100,                // % din cotă pentru prima și ultima zi a unei deplasări (100 = zi întreagă), de verificat
  countMode: 'anyPresence',
  verified: false,
});
export function diurnaConfig(state) {
  const c = singleton(state, 'diurna') || {};
  return { ...DIURNA_DEFAULTS, ...c, ratesEur: { ...DIURNA_DEFAULTS.ratesEur, ...(c.ratesEur || {}) }, ceilingEurByCountry: { ...(c.ceilingEurByCountry || {}) } };
}

const ceilingFor = (cfg, cc) => cfg.ceilingEurByCountry[cc] ?? mulDiv(cfg.taxFreeBaseEur, Math.round(cfg.taxFreeMultiplier * 100), 100); // money-ok: multiplicator în sutimi
const rateFor = (cfg, cc) => cfg.ratesEur[cc] ?? cfg.defaultRateEur;

/** Zilele petrecute în străinătate de un camion din călătorii: Map<IsoDate,{ countries:Set, kmByCountry:{}, endCountry:string }>. */
function gpsAbroadDays(trips, home) {
  const ts = normTrips(trips);
  const days = new Map();
  if (!ts.length) return { days, coverage: null };
  const cov = coverageOf([], trips);
  const get = (d) => { let x = days.get(d); if (!x) days.set(d, (x = { presence: new Set(), km: {}, end: null })); return x; };
  const cc = (pos) => (pos && pos.countryCode) || null;
  let at = home;                 // țara la începutul zilei curente (reportată), necunoscută la început ⇒ țara de acasă
  const allDays = eachDay(cov.from, cov.to);
  const byDay = new Map();
  for (const t of ts) { const k = t.date; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); }
  for (const d of allDays) {
    const x = get(d);
    x.presence.add(at);
    const list = byDay.get(d) || [];
    for (const t of list) {
      const s = cc(t.startPos) || at, e = cc(t.stopPos) || s;
      x.presence.add(s); x.presence.add(e);
      x.km[e] = (x.km[e] || 0) + t.distM;
      // o călătorie peste miezul nopții atinge și ziua de sosire
      const sd = t.stop.slice(0, 10);
      if (sd > d) for (const dd of eachDay(addDays(d, 1), sd)) { const y = get(dd); y.presence.add(s); y.presence.add(e); }
      at = e;
    }
    x.end = at;
  }
  return { days, coverage: cov };
}

/** Zilele „în străinătate” după regula aleasă. */
function isAbroadDay(x, home, mode) {
  if (mode === 'nightAbroad') return !!x.end && x.end !== home;
  for (const c of x.presence) if (c && c !== home) return true;
  return false;
}
function dayCountry(x, home) {
  let best = null, bestKm = -1;
  for (const [c, km] of Object.entries(x.km)) if (c !== home && km > bestKm) { best = c; bestKm = km; }
  if (best) return best;
  if (x.end && x.end !== home) return x.end;
  for (const c of x.presence) if (c && c !== home) return c;
  return null;
}

function driverOnDay(courses, date) {
  let best = null;
  for (const c of courses) {
    if (!c.loadDate || c.loadDate > date) continue;
    const u = c.unloadDate >= c.loadDate ? c.unloadDate : c.loadDate;
    if (u < date) continue;
    if (!best || c.loadDate >= best.loadDate) best = c;
  }
  return best;
}

/**
 * Raportul de diurnă externă pe interval.
 * @param {object} state @param {{from:string,to:string}} range
 * @param {{ driverId?:string, truckId?:string, ronPerEur?:string, config?:object }} [o]
 *   `ronPerEur` (RateStr) opțional: adaugă contravaloarea în RON a sumelor.
 */
export function diurnaReport(state, range, o = {}) {
  const cfg = { ...diurnaConfig(state), ...(o.config || {}) };
  const home = companyOf(state).countryCode || 'RO';
  const trucks = coll(state, 'trucks');
  const drivers = new Map(coll(state, 'drivers').map((d) => [d.id, d]));
  const courses = coll(state, 'courses');
  const rows = [];
  const warnings = [];
  let estimated = 0, unknownDriver = 0;

  for (const t of trucks) {
    if (o.truckId && o.truckId !== t.id) continue;
    const tcs = courses.filter((c) => c.truckId === t.id && c.loadDate);
    const trips = coll(state, 'gpsTrips').filter((x) => x.truckId === t.id);
    const { days, coverage } = gpsAbroadDays(trips, home);
    const abroad = new Map();
    for (const d of eachDay(range.from, range.to)) {
      const x = days.get(d);
      if (x && coverage && d >= coverage.from && d <= coverage.to) {
        if (isAbroadDay(x, home, cfg.countMode)) abroad.set(d, { country: dayCountry(x, home), source: 'gps' });
        continue;
      }
      // estimare din curse (fără GPS pentru ziua respectivă)
      const c = driverOnDay(tcs, d);
      if (c) {
        const cc = c.destCountry && c.destCountry !== home ? c.destCountry : c.originCountry && c.originCountry !== home ? c.originCountry : null;
        if (cc) abroad.set(d, { country: cc, source: 'curse', courseId: c.id });
      }
    }
    // zilele de capăt ale fiecărei deplasări (serii consecutive de zile străine)
    const sorted = [...abroad.keys()].sort();
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      const a = abroad.get(d);
      const prevAbroad = i > 0 && diffDays(sorted[i - 1], d) === 1;
      const nextAbroad = i + 1 < sorted.length && diffDays(d, sorted[i + 1]) === 1;
      const edge = !prevAbroad || !nextAbroad;
      const c = driverOnDay(tcs, d);
      const drv = c?.driverId ? drivers.get(c.driverId) : null;
      const driverKey = c?.driverId || (c?.driverRaw ? 'raw:' + c.driverRaw : null);
      if (o.driverId && o.driverId !== driverKey) continue;
      const cc = a.country || home;
      const baseRate = rateFor(cfg, cc);
      const rate = edge && cfg.edgeDayPct !== 100 ? mulDiv(baseRate, cfg.edgeDayPct, 100) : baseRate;
      const ceiling = ceilingFor(cfg, cc);
      const taxFree = Math.min(rate, ceiling);
      if (a.source === 'curse') estimated++;
      if (!driverKey) unknownDriver++;
      rows.push({
        date: d, truckId: t.id, truckPlate: t.plateDisplay || t.plate, driverId: driverKey, driverName: drv?.name || c?.driverRaw || 'necunoscut',
        country: cc, source: a.source, edge, rateEur: rate, taxFreeEur: taxFree, taxableEur: rate - taxFree, courseId: c?.id || a.courseId || null,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.truckId < b.truckId ? -1 : 1));

  const byDriver = new Map();
  for (const r of rows) {
    const k = r.driverId || 'necunoscut';
    const d = byDriver.get(k) || { driverId: r.driverId, driverName: r.driverName, days: 0, byCountry: {}, amountEur: 0, taxFreeEur: 0, taxableEur: 0, trucks: new Set() };
    d.days++; d.byCountry[r.country] = (d.byCountry[r.country] || 0) + 1;
    d.amountEur += r.rateEur; d.taxFreeEur += r.taxFreeEur; d.taxableEur += r.taxableEur; d.trucks.add(r.truckPlate);
    byDriver.set(k, d);
  }
  const drv = [...byDriver.values()].map((d) => ({ ...d, trucks: [...d.trucks] })).sort((a, b) => (a.driverName < b.driverName ? -1 : 1));
  const byTruck = {};
  for (const r of rows) {
    const b = byTruck[r.truckId] || (byTruck[r.truckId] = { truckId: r.truckId, plate: r.truckPlate, days: 0, amountEur: 0 });
    b.days++; b.amountEur += r.rateEur;
  }
  const tot = { days: rows.length, amountEur: 0, taxFreeEur: 0, taxableEur: 0 };
  for (const r of rows) { tot.amountEur += r.rateEur; tot.taxFreeEur += r.taxFreeEur; tot.taxableEur += r.taxableEur; }
  if (o.ronPerEur) for (const k of ['amountEur', 'taxFreeEur', 'taxableEur']) tot[k.replace('Eur', 'Ron')] = convert(tot[k], 'EUR', 'RON', o.ronPerEur);
  if (!cfg.verified) warnings.push(`Sumele zilnice, plafonul scutit și regula zilelor de capăt sunt valori de pornire: ${DIURNA_NOTE}.`);
  if (estimated) warnings.push(`${estimated} zile sunt estimate din curse (fără GPS): ${DIURNA_NOTE}.`);
  if (unknownDriver) warnings.push(`${unknownDriver} zile nu au șofer identificat în tabelul de curse.`);
  return { rows, byDriver: drv, byTruck: Object.values(byTruck), totals: tot, warnings, config: cfg, note: DIURNA_NOTE, range };
}

/**
 * Foaia de deplasare a unui șofer: deplasările (serii consecutive de zile în străinătate) cu țări, zile și sume.
 * @param {ReturnType<typeof diurnaReport>} report @param {string|null} driverId (cheia din `byDriver`)
 */
export function travelSheet(report, driverId, o = {}) {
  const rows = report.rows.filter((r) => (r.driverId || null) === (driverId || null));
  const byDay = new Map();
  for (const r of rows) { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); }
  const dates = [...byDay.keys()].sort();
  const trips = [];
  for (const d of dates) {
    const last = trips[trips.length - 1];
    const rs = byDay.get(d);
    if (last && diffDays(last.to, d) === 1) { last.to = d; last.days++; last.rows.push(...rs); }
    else trips.push({ from: d, to: d, days: 1, rows: [...rs] });
  }
  const out = trips.map((t) => {
    const byC = {};
    let amount = 0, taxFree = 0, taxable = 0;
    for (const r of t.rows) { byC[r.country] = (byC[r.country] || 0) + 1; amount += r.rateEur; taxFree += r.taxFreeEur; taxable += r.taxableEur; }
    return { from: t.from, to: t.to, days: t.days, countries: byC, trucks: [...new Set(t.rows.map((r) => r.truckPlate))], amountEur: amount, taxFreeEur: taxFree, taxableEur: taxable, estimated: t.rows.some((r) => r.source === 'curse') };
  });
  const dName = rows[0]?.driverName || o.driverName || '';
  const tot = out.reduce((a, t) => ({ days: a.days + t.days, amountEur: a.amountEur + t.amountEur, taxFreeEur: a.taxFreeEur + t.taxFreeEur, taxableEur: a.taxableEur + t.taxableEur }), { days: 0, amountEur: 0, taxFreeEur: 0, taxableEur: 0 });
  return { driverId: driverId || null, driverName: dName, range: report.range, trips: out, totals: tot, note: report.note, warnings: report.warnings };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (m) => fmtMoney(m, 'EUR');

/**
 * Document HTML complet pentru tipărire / „Salvează ca PDF” din browser (stil `@media print` inclus).
 * Tot textul dinamic este escapat. Se deschide într-o fereastră nouă sau se descarcă; nu se transmite nicăieri.
 * @param {ReturnType<typeof travelSheet>} sheet @param {{company?:string}} [o]
 */
export function travelSheetHtml(sheet, o = {}) {
  const rowsHtml = sheet.trips.map((t) => `<tr><td>${esc(fmtDate(t.from))}</td><td>${esc(fmtDate(t.to))}</td><td>${esc(Object.entries(t.countries).map(([c, n]) => `${c} (${n})`).join(', '))}</td><td>${esc(t.trucks.join(', '))}</td><td class="n">${t.days}</td><td class="n">${esc(eur(t.amountEur))}</td><td class="n">${esc(eur(t.taxFreeEur))}</td><td class="n">${esc(eur(t.taxableEur))}</td></tr>`).join('');
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Foaie de deplasare ${esc(sheet.driverName)}</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}.sub{color:#444;margin-bottom:16px}
table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #888;padding:6px 8px;text-align:left}th{background:#eee}.n{text-align:right;white-space:nowrap}
.note{border:1px dashed #a60;padding:8px;margin:12px 0;background:#fff8e6}.sign{display:flex;gap:48px;margin-top:48px}.sign div{flex:1;border-top:1px solid #000;padding-top:4px}
@media print{body{margin:12mm}.noprint{display:none}}
</style></head><body><button class="noprint" onclick="window.print()">Tipărește</button>
<h1>Foaie de deplasare externă</h1>
<div class="sub">${o.company ? esc(o.company) + ' · ' : ''}Șofer: <b>${esc(sheet.driverName || 'necunoscut')}</b> · Perioada ${esc(fmtDate(sheet.range.from))} – ${esc(fmtDate(sheet.range.to))}</div>
<table><thead><tr><th>Plecare</th><th>Întoarcere</th><th>Țări (zile)</th><th>Camion</th><th>Zile</th><th>Diurnă</th><th>Scutit</th><th>Impozabil</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="8">Nicio deplasare în perioadă.</td></tr>'}</tbody>
<tfoot><tr><th colspan="4">Total</th><th class="n">${sheet.totals.days}</th><th class="n">${esc(eur(sheet.totals.amountEur))}</th><th class="n">${esc(eur(sheet.totals.taxFreeEur))}</th><th class="n">${esc(eur(sheet.totals.taxableEur))}</th></tr></tfoot></table>
<div class="note">Sume zilnice și plafon scutit: valori editabile, ${esc(sheet.note)}. ${esc((sheet.warnings || []).join(' '))}</div>
<div class="sign"><div>Șofer</div><div>Administrator</div></div></body></html>`;
}
