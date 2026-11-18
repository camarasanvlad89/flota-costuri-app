// Schema v1: lista colecțiilor, singletons, valori implicite, validare.
import { EPOCH0, isPlainObject, clone } from './util.js';

export const SCHEMA_VERSION = 1;
/** Cea mai nouă schemă pe care această versiune a aplicației o poate citi. */
export const APP_MAX_SCHEMA = 1;
export const APP_VERSION_MIN = '1.0.0';

export const COLLECTIONS = [
  'trucks', 'trailers', 'trailerAssignments', 'drivers', 'categories', 'countries', 'currencies', 'roVatRates',
  'entries', 'templates', 'templateEvents', 'occurrences', 'financing',
  'courses', 'places', 'aliases', 'routeCache', 'gpsDays', 'gpsTrips', 'rates', 'closures', 'flags', 'importLogs', 'audit',
  'expiries', 'serviceItems', 'uitRules', 'supplierRules',
];

export const SINGLETON_KEYS = ['company', 'ui', 'importMappings', 'fx', 'benchmarks', 'a11y'];

/** Obiectele din IDB: colecțiile + singletons + base (stare sincronizată) + outbox + kv (stare strict locală). */
export const STORE_NAMES = [...COLLECTIONS, 'singletons', 'base', 'outbox', 'kv'];

/** Colecții cu fuziune pe câmp (4.7 pct. 2). */
export const FIELD_MERGE_COLLECTIONS = new Set(['entries', 'courses', 'templates', 'trucks']);
/** Colecții de tip „uniune pe id” (înregistrări practic imuabile). */
export const UNION_COLLECTIONS = new Set(['audit', 'importLogs', 'rates', 'routeCache']);

export function isCollection(name) {
  return name === 'singletons' || COLLECTIONS.includes(name);
}

const DEFAULTS = {
  company: {
    name: '', cui: '', vatPayer: true, countryCode: 'RO', reportingCurrency: 'RON', fiscalYearStartMonth: 1,
    noDocCeilingMinor: 20000, noDocCeilingMonthlyPerTruckMinor: 100000,
    revenueRecognition: 'prorata', overheadAllocation: 'daysInFleet', profitIncludesDepreciation: true,
    closedThrough: null, homeBase: 'Orașu Nou', longStopHours: 6, excludeAutoPendingFromProfit: false,
  },
  ui: {},
  importMappings: {},
  fx: { enabled: true, preferredSource: 'bnr' },
  benchmarks: {},
  a11y: { hotkeys: true },
};

/** Valoarea implicită a unui singleton (fără `id`); `updatedAt` = epoca 0 ca să piardă la orice fuziune. */
export function defaultSingleton(key) {
  return { ...clone(DEFAULTS[key] ?? {}), updatedAt: EPOCH0, updatedBy: 'default' };
}

export function emptyDoc() {
  const singletons = {};
  for (const k of SINGLETON_KEYS) singletons[k] = defaultSingleton(k);
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = [];
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { docId: null, epoch: { id: null, no: 0 }, appVersionMin: APP_VERSION_MIN, devices: {} },
    singletons,
    collections,
  };
}

/** @returns {{ ok:boolean, errors:string[] }} */
export function validateDoc(doc) {
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ['Documentul nu este un obiect.'] };
  if (!Number.isInteger(doc.schemaVersion)) errors.push('schemaVersion lipsește sau nu este întreg.');
  if (!isPlainObject(doc.collections)) errors.push('collections lipsește.');
  else {
    for (const [name, arr] of Object.entries(doc.collections)) {
      if (!Array.isArray(arr)) { errors.push(`Colecția ${name} nu este un tablou.`); continue; }
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        if (!isPlainObject(r) || typeof r.id !== 'string' || !r.id) { errors.push(`${name}[${i}]: înregistrare fără id.`); break; }
      }
    }
  }
  if (doc.singletons !== undefined && !isPlainObject(doc.singletons)) errors.push('singletons nu este un obiect.');
  return { ok: errors.length === 0, errors };
}

/** Numără principalele colecții și ultima modificare (pentru ecranul „Drive vs local”, 4.8). */
export function countsOf(doc) {
  const c = doc?.collections || {};
  const live = (n) => (c[n] || []).filter((r) => !r.deletedAt);
  let last = null;
  for (const arr of Object.values(c)) for (const r of arr) if (r.updatedAt && (!last || r.updatedAt > last)) last = r.updatedAt;
  return { trucks: live('trucks').length, entries: live('entries').length, courses: live('courses').length, lastModified: last };
}
