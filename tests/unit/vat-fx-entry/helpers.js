// Ajutoare comune pentru testele modulului „TVA, curs, intrare”.
import { defaultCountries } from '../../../src/data/vat-defaults.js';
import { defaultCategories } from '../../../src/data/categories-default.js';

export const COMPANY = Object.freeze({
  vatPayer: true, countryCode: 'RO', reportingCurrency: 'RON',
  noDocCeilingMinor: 20000, noDocCeilingMonthlyPerTruckMinor: 100000, closedThrough: null,
});
export const countries = defaultCountries();
export const categories = defaultCategories();

// Curs fix „pinned” (11.4): EUR/RON = 5,3442; EUR/HUF = 364,08 (valori de test, nu o afirmație despre BCE).
export const PINNED = { RON: '5.3442', HUF: '364.08' };
export const RATE_EUR = { ronPerUnit: '5.3442', eurPerUnit: '1', rateDate: '2026-11-17', source: 'bnr', manual: false, stale: false, eurSource: 'bnr' };
export const RATE_HUF = { ronPerUnit: '0.0146786421', eurPerUnit: '0.0027466491', rateDate: '2026-11-17', source: 'bnr', manual: false, stale: false, eurSource: 'bnr' };
export const RATE_RON = { ronPerUnit: '1', eurPerUnit: '0.1871187456', rateDate: '2026-11-17', source: 'ron', manual: false, stale: false, eurSource: 'bnr' };

export function ctx(rate, extra) {
  return { company: { ...COMPANY }, countries, categories, rate, now: '2026-11-18T10:00:00Z', ...extra };
}

/** Magazin în memorie minimal (list/putMany) pentru fx. */
export function memStore(initial = []) {
  const m = new Map(initial.map((r) => [r.id, r]));
  return {
    list: (col) => (col === 'rates' ? [...m.values()] : []),
    putMany: async (col, recs) => { for (const r of recs) m.set(r.id, r); },
    size: () => m.size,
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
