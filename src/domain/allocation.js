// Alocarea costurilor comune (overhead), secțiunea 5.5 din docs/DEV-PLAN.md.
// O singură funcție pentru țintele `fleet` și `company`: același cost dă același rezultat indiferent de țintă.
// Fără I/O, fără acces la store. Restul se împarte cu allocateFair (metoda celui mai mare rest, seed determinist).
import { allocateFair } from '../core/money.js';
import { diffDays } from '../core/dates.js';

/** Zilele (inclusiv) în care camionul face parte din flotă în interval. activeFrom/activeTo goale = deschis. */
export function daysInFleet(truck, range) {
  const from = truck.activeFrom && truck.activeFrom > range.from ? truck.activeFrom : range.from;
  const to = truck.activeTo && truck.activeTo < range.to ? truck.activeTo : range.to;
  return from > to ? 0 : diffDays(from, to) + 1;
}

/** Baza „zile în flotă” per camion (se îngheață în Closure.allocationBasis). */
export function fleetDaysBasis(trucks, range) {
  const out = {};
  for (const t of trucks) out[t.id] = daysInFleet(t, range);
  return out;
}

/**
 * Repartizează `overheadMinor` pe camioane.
 *  - 'daysInFleet' (implicit): ponderi = zile active în interval (sau `basis` înghețat dintr-un Closure);
 *  - 'km': ponderi = km GPS (`kmByTruck`, metri); un camion care stă primește 0; dacă toți au 0 km ⇒ revine la zile;
 *  - 'equal': ponderi egale între camioanele active cel puțin o zi în interval.
 * Suma părților = overheadMinor exact. Dacă nu există niciun camion eligibil, rezultatul e {} (costul rămâne nerepartizat).
 * @param {{overheadMinor:number, trucks:Array, range:{from:string,to:string}, mode?:string, kmByTruck?:Object, seedKey:string, basis?:Object}} i
 * @returns {Object<string, number>}
 */
export function allocateOverhead(i) {
  const { overheadMinor, trucks, range, seedKey } = i;
  const mode = i.mode || 'daysInFleet';
  if (!Number.isSafeInteger(overheadMinor)) throw new TypeError('overheadMinor trebuie să fie întreg');
  if (!overheadMinor) return Object.fromEntries(trucks.map((t) => [t.id, 0]));
  const days = i.basis ? Object.fromEntries(trucks.map((t) => [t.id, i.basis[t.id] || 0])) : fleetDaysBasis(trucks, range);
  let weights;
  if (mode === 'km') {
    weights = trucks.map((t) => (days[t.id] > 0 ? Math.max(0, (i.kmByTruck && i.kmByTruck[t.id]) || 0) : 0));
    if (weights.every((w) => w === 0)) weights = trucks.map((t) => days[t.id]);
  } else if (mode === 'equal') {
    weights = trucks.map((t) => (days[t.id] > 0 ? 1 : 0));
  } else {
    weights = trucks.map((t) => days[t.id]);
  }
  if (weights.every((w) => w === 0)) return {};
  // ordinea fixă după id: rezultatul nu depinde de ordinea listei de camioane
  const order = trucks.map((t, k) => k).sort((a, b) => (trucks[a].id < trucks[b].id ? -1 : trucks[a].id > trucks[b].id ? 1 : 0));
  const parts = allocateFair(overheadMinor, order.map((k) => weights[k]), seedKey);
  const out = {};
  for (const t of trucks) out[t.id] = 0;
  order.forEach((k, n) => { out[trucks[k].id] = parts[n]; });
  return out;
}
