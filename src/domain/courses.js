// domain/courses.js: cursa (transportul): ruta, ID-ul determinist, regula de preț (net/TVA/brut), km încărcați.
// Pur. Banii sunt întregi (Minor); înmulțirile prin `mulDiv` (BigInt, rotunjire jumătate în sus).
// Regulile: DEV-PLAN 5.7 (preț) și 5.8 (km încărcați).

import { detId } from '../core/ids.js';
import { mulDiv } from '../core/money.js';
import { normalizePlate } from '../core/plates.js';
import { eachDay } from '../core/dates.js';
import { parseRoute, normRoute } from './places.js';
import { mergeDailyKm, buildTripIndex, anchorCourse } from './gpsKm.js';

// ruta: implementarea trăiește în places.js (evită ciclul courses <-> gpsKm); reexportată aici (contract 10.6)
export { parseRoute, normRoute };

/** Cote RO (puncte de bază) acceptate ca „valide” la import: 0, 5, 9, 11, 19, 21 %. */
export const VALID_RO_VAT_PCT = [0, 5, 9, 11, 19, 21];

/**
 * Cota standard RO la o dată: din `roVatRates` (colecția din Setări) dacă există, altfel calendarul implicit
 * (24% până în 2015, 20% în 2016, 19% 2017 – iul. 2025, 21% din 1.08.2025).
 * @param {string} date IsoDate
 * @param {Array<{ from:string, standardBp:number, deletedAt?:string }>} [roVatRates]
 * @returns {number} puncte de bază
 */
export function roStandardBp(date, roVatRates) {
  const rows = (roVatRates || []).filter((r) => r && !r.deletedAt && r.from <= date).sort((a, b) => (a.from < b.from ? 1 : -1));
  if (rows.length) return rows[0].standardBp;
  if (date >= '2025-08-01') return 2100;
  if (date >= '2017-01-01') return 1900;
  if (date >= '2016-01-01') return 2000;
  return 2400;
}

/**
 * Cheia de reimport / id determinist al unei curse: `detId(plate, loadDate, unloadDate, normRoute[, ordinal])`.
 * `ordinal` = numărul de ordine (1-based) al rândurilor IDENTICE din aceeași foaie: 1 (sau lipsă/0) = primul
 * (fără sufix, id stabil), 2 = al doilea rând identic etc.
 * @param {{ plate:string, loadDate:string, unloadDate:string, route:string }} c
 * @param {number} [ordinal]
 * @returns {string}
 */
export function courseId(c, ordinal) {
  const parts = [normalizePlate(c.plate), c.loadDate, c.unloadDate, normRoute(c.route)];
  if (ordinal != null && ordinal > 1) parts.push(`#${ordinal}`);
  return detId('crs', ...parts);
}

/**
 * Preț cursă din coloanele G (net), H (TVA), I (total) – DEV-PLAN 5.7.
 *  1. G,H,I ⇒ verificare |G+H−I| ≤ 1 minor; cota efectivă validă dacă ∈ {0,5,9,11,19,21}%; H=0 ⇒ cursă cu 0% (`zero`).
 *  2. G fără H ⇒ TVA = G × cotă (doar `taxed`), `derived`.
 *  3. Doar I ⇒ `taxed`: net = I × 10000/(10000+cotă), `vatDerived`; `zero`/`reverse`: net = I, TVA 0.
 *  4. Nimic ⇒ `missing`.
 * @param {{ net?:number|null, vat?:number|null, gross?:number|null, date:string, company?:object,
 *   vatTreatment?:'taxed'|'zero'|'reverse', rateBp?:number|null, roVatRates?:Array<object> }} i
 * @returns {{ net:number|null, vat:number|null, gross:number|null, vatBp:number|null, vatDerived:boolean,
 *   priceStatus:'ok'|'derived'|'missing', vatTreatment:'taxed'|'zero'|'reverse', warnings:string[] }}
 */
export function priceFromColumns(i) {
  const warnings = [];
  let treatment = i.vatTreatment || 'taxed';
  const has = (v) => v != null && Number.isFinite(v);
  let G = has(i.net) ? i.net : null, H = has(i.vat) ? i.vat : null, I = has(i.gross) ? i.gross : null;
  const defBp = i.rateBp ?? roStandardBp(i.date, i.roVatRates);
  const res = (net, vat, gross, vatBp, vatDerived, priceStatus) => ({ net, vat, gross, vatBp, vatDerived, priceStatus, vatTreatment: treatment, warnings });

  if (G == null && H == null && I == null) {
    warnings.push('NO_PRICE: cursă fără preț');
    return res(null, null, null, null, false, 'missing');
  }
  if (G == null && H != null && I == null) {
    warnings.push('ONLY_VAT: există doar TVA, fără net sau total');
    return res(null, H, null, null, false, 'missing');
  }

  // 1. G, H, I
  if (G != null && H != null && I != null) {
    if (Math.abs(G + H - I) > 1) warnings.push(`TOTAL_MISMATCH: net + TVA ≠ total (${G} + ${H} ≠ ${I})`);
    return finish(G, H, I, false, 'ok');
  }
  // G și H fără I
  if (G != null && H != null) return finish(G, H, G + H, false, 'ok');
  // G fără H
  if (G != null) {
    if (I != null) return finish(G, I - G, I, true, 'derived');
    if (treatment !== 'taxed') return finish(G, 0, G, false, 'derived');
    const vat = mulDiv(G, defBp, 10000);
    return finish(G, vat, G + vat, true, 'derived');
  }
  // fără G
  if (H != null && I != null) return finish(I - H, H, I, true, 'derived');
  // doar I
  if (treatment === 'taxed') {
    const net = mulDiv(I, 10000, 10000 + defBp);
    warnings.push(`GROSS_ONLY: net derivat din total (TVA ${defBp / 100}%)`);
    return res(net, I - net, I, defBp, true, 'derived');
  }
  warnings.push('GROSS_ONLY: doar totalul; fără TVA (tratament ' + treatment + ')');
  return res(I, 0, I, 0, false, 'derived');

  function finish(net, vat, gross, derived, status) {
    let vatBp = null;
    if (net !== 0) {
      vatBp = mulDiv(vat, 10000, net);
      const pct = vatBp / 100;
      const near = VALID_RO_VAT_PCT.find((p) => Math.abs(p - pct) <= 0.5);
      if (near != null) vatBp = near * 100;
      else warnings.push(`RATE_UNKNOWN: cota efectivă ${pct.toFixed(2).replace('.', ',')}% nu e una obișnuită`); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
    } else vatBp = 0;
    if (vat === 0 && net > 0 && treatment === 'taxed') treatment = 'zero';
    return res(net, vat, gross, vatBp, derived, status);
  }
}

/** Zilele (inclusiv capetele) ferestrei unei curse. @param {{loadDate:string,unloadDate:string}} c @returns {string[]} */
export function courseDays(c) {
  const to = c.unloadDate && c.unloadDate >= c.loadDate ? c.unloadDate : c.loadDate;
  return eachDay(c.loadDate, to);
}

/**
 * Suprapunere reală pe același camion: ≥ 2 zile comune. Lanțul în aceeași zi (descărcare = încărcarea următoarei)
 * sau două curse scurte în aceeași zi NU sunt suprapuneri (DEV-PLAN 5.7, 17.1).
 * @param {{loadDate:string,unloadDate:string}} a @param {{loadDate:string,unloadDate:string}} b
 * @returns {boolean}
 */
export function coursesOverlap(a, b) {
  const from = a.loadDate > b.loadDate ? a.loadDate : b.loadDate;
  const aTo = a.unloadDate >= a.loadDate ? a.unloadDate : a.loadDate, bTo = b.unloadDate >= b.loadDate ? b.unloadDate : b.loadDate;
  const to = aTo < bTo ? aTo : bTo;
  if (from > to) return false;
  return eachDay(from, to).length >= 2;
}

/**
 * Km încărcați ai unei curse, după prioritatea 5.8:
 *  1. coloană `km` / editare manuală (protejat), 2. călătorii GPS (ancorare pe opriri), 3. distanță rutieră
 *  estimată (`ctx.estimate`, de la `routing.estimateCourse`), 4. fereastra GPS pe zile (doar rezervă, „orientativ”).
 * @param {object} c cursa
 * @param {{ places?:Map, routeCache?:Map, gpsDays?:object[], gpsTrips?:object[], estimate?:object|null, aliases?:object[],
 *   tripIndexByTruck?:Map<string,object>, now?:string, tolDays?:number }} ctx
 * @returns {{ meters:number|null, source:'column'|'gps-trips'|'route'|'gps-window'|'manual'|null,
 *   confidence:'high'|'medium'|'low', at:string|null, detail?:object }}
 */
export function resolveLoadedKm(c, ctx = {}) {
  const at = ctx.now ?? null;
  const cur = c.loadedKm;
  if (cur && (cur.source === 'column' || cur.source === 'manual') && cur.meters != null) return cur;
  if ((c.manualFields || []).includes('loadedKm') && cur && cur.meters != null) return cur;

  const tripsAll = ctx.gpsTrips || [];
  let index = ctx.tripIndexByTruck?.get(c.truckId);
  if (!index) {
    const mine = tripsAll.filter((t) => t.truckId === c.truckId);
    if (mine.length) index = buildTripIndex(mine);
  }
  if (index) {
    const a = anchorCourse(c, index, { aliases: ctx.aliases, tolDays: ctx.tolDays });
    if (a.ok) {
      return {
        meters: a.meters, source: 'gps-trips', confidence: a.confidence, at,
        detail: { load: a.load.locality, unload: a.unload.locality, loadScore: a.load.score, unloadScore: a.unload.score, needsConfirm: a.needsConfirm },
      };
    }
  }
  if (ctx.estimate && ctx.estimate.meters != null) return ctx.estimate;

  // 4. fereastra GPS (rezervă)
  const days = (ctx.gpsDays || []).filter((d) => d.truckId === c.truckId);
  const km = mergeDailyKm(days, tripsAll.filter((t) => t.truckId === c.truckId));
  let g = 0, any = false;
  for (const d of courseDays(c)) {
    const e = km.get(d);
    if (e) { g += e.m; any = true; }
  }
  if (any && g > 0) return { meters: g, source: 'gps-window', confidence: 'low', at, detail: { note: 'orientativ: include deplasarea spre încărcare și alte curse din aceeași zi' } };
  return { meters: null, source: null, confidence: 'low', at, detail: ctx.estimate?.detail };
}

/**
 * Verificare încrucișată: km estimați (rută) vs km GPS pe fereastră; diferență > 15% ⇒ avertizare.
 * @param {{ meters:number|null }} estimate @param {number} gpsWindowM
 * @returns {{ diffPct:number|null, warn:boolean }}
 */
export function compareWithGps(estimate, gpsWindowM) {
  if (!estimate || estimate.meters == null || !gpsWindowM) return { diffPct: null, warn: false };
  const diffPct = Math.abs(estimate.meters - gpsWindowM) / gpsWindowM;
  return { diffPct, warn: diffPct > 0.15 };
}

/** Venitul unei curse = net (în moneda cursei). Rotunjit exact; `null` dacă lipsește prețul. @param {object} c @returns {number|null} */
export function courseNet(c) {
  return c.priceStatus === 'missing' ? null : c.net ?? null;
}
