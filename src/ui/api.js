// Punte spre funcțiile de domeniu/import/export, rezolvate după NUME la apelare. Ecranele nu calculează bani:
// apelează aici (10.4–10.10). Dacă o funcție lipsește, ecranul afișează o stare „indisponibil”, nu se prăbușește.
import * as vat from '../domain/vat.js';
import * as fx from '../domain/fx.js';
import * as entry from '../domain/entry.js';
import * as recurring from '../domain/recurring.js';
import * as financing from '../domain/financing.js';
import * as closing from '../domain/closing.js';
import * as courses from '../domain/courses.js';
import * as places from '../domain/places.js';
import * as routing from '../domain/routing.js';
import * as placeMatch from '../domain/placeMatch.js';
import * as reconcile from '../domain/reconcile.js';
import * as gpsKm from '../domain/gpsKm.js';
import * as emptyKm from '../domain/emptyKm.js';
import * as allocation from '../domain/allocation.js';
import * as profit from '../domain/profit.js';
import * as reports from '../domain/reports.js';
import * as quality from '../domain/quality.js';
import * as demoSeed from '../domain/demo-seed.js';
import * as expiry from '../domain/expiry.js';
import * as diurna from '../domain/diurna.js';
import * as maintenance from '../domain/maintenance.js';
import * as decision from '../domain/decision.js';
import * as xlsxReader from '../import/xlsx-reader.js';
import * as csv from '../import/csv.js';
import * as mapping from '../import/mapping.js';
import * as coursesImporter from '../import/courses-importer.js';
import * as gpsImporter from '../import/gps-importer.js';
import * as expensesImporter from '../import/expenses-importer.js';
import * as einvoice from '../import/einvoice.js';
import * as workbook from '../export/workbook.js';
import * as csvExport from '../export/csv-export.js';
import * as ledger from '../export/ledger.js';
import * as download from '../export/download.js';
import * as backup from '../store/backup.js';

const MODULES = [
  vat, fx, entry, recurring, financing, closing, courses, places, routing, placeMatch, reconcile, gpsKm, emptyKm,
  allocation, profit, reports, quality, demoSeed, expiry, diurna, maintenance, decision,
  xlsxReader, csv, mapping, coursesImporter, gpsImporter, expensesImporter, einvoice, workbook, csvExport, ledger, download, backup,
];

export { COURSE_FIELD_LABELS } from '../import/mapping.js';

export class MissingApi extends Error {
  constructor(name) { super(`MissingApi: ${name}`); this.name = 'MissingApi'; this.apiName = name; }
}
/** Funcția numită `name` din primul modul care o exportă, sau `null`. */
export function api(name) {
  for (const m of MODULES) if (m && typeof m[name] === 'function') return m[name];
  return null;
}
export const has = (name) => api(name) !== null;
export function call(name, ...args) {
  const fn = api(name);
  if (!fn) throw new MissingApi(name);
  return fn(...args);
}
/** Apel tolerant: întoarce `fallback` dacă lipsește funcția sau aruncă. */
export function tryCall(name, args, fallback) {
  try {
    const fn = api(name);
    return fn ? fn(...args) : fallback;
  } catch (e) {
    if (e instanceof MissingApi) return fallback;
    if (typeof console !== 'undefined') console.warn(`[ui/api] ${name}:`, e);
    return fallback;
  }
}
