// Backup JSON obligatoriu (4.10). Nu conține nicio taină: tokenul Google nu există pe disc, nu există token SafeFleet.
import { SCHEMA_VERSION, validateDoc, countsOf, emptyDoc } from './schema.js';
import { defaultCategories } from '../data/categories-default.js';
import { defaultCountries, defaultRoVatRates } from '../data/vat-defaults.js';
import { defaultCurrencies } from '../data/currencies.js';
import { migrate } from './migrations.js';
import { StoreError } from './util.js';

export const BACKUP_FORMAT = 'flota-backup';
export const RESTORE_CONFIRM_WORD = 'RESTAUREAZĂ';

/** Document „Începe gol”: fără date, dar cu valorile implicite (categorii, țări și cote TVA, valute, cote RO). */
export function buildEmptyDb() {
  const doc = emptyDoc();
  doc.collections.categories = defaultCategories();
  doc.collections.countries = defaultCountries();
  doc.collections.currencies = defaultCurrencies();
  doc.collections.roVatRates = defaultRoVatRates();
  return doc;
}

/** Completează valorile implicite lipsă într-un store existent (instalări „Începe gol” dinaintea corecției, cont Drive nou). */
export async function ensureDefaults(store) {
  const st = store.state();
  const missing = { categories: defaultCategories, countries: defaultCountries, currencies: defaultCurrencies, roVatRates: defaultRoVatRates };
  const now = new Date().toISOString();
  for (const [col, make] of Object.entries(missing)) {
    if ((st.collections?.[col] || []).length) continue;
    await store.putMany(col, make().map((r) => ({ ...r, createdAt: r.createdAt || now, updatedAt: now })));
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

/** Nume de fișier cu data locală: flota-backup-YYYY-MM-DD-HHmm.json */
export function backupFilename(date = new Date(), prefix = 'flota-backup') {
  return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

/**
 * @param {object} state  un `Store` (are exportDoc) sau direct un DbDoc
 * @param {{ now?:Date, appVersion?:string }} [o]
 * @returns {{ filename:string, json:string }}
 */
export function exportBackup(state, o = {}) {
  const doc = state && typeof state.exportDoc === 'function' ? state.exportDoc() : state;
  const now = o.now || new Date();
  const envelope = {
    format: BACKUP_FORMAT,
    schemaVersion: doc.schemaVersion ?? SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: o.appVersion || (state && state.appVersion) || 'dev',
    counts: countsOf(doc),
    doc,
  };
  return { filename: backupFilename(now), json: JSON.stringify(envelope) };
}

/** @returns {{ ok:true, doc:object, warnings:string[], migrated:boolean } | { ok:false, error:string }} */
export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'Fișierul nu este JSON valid.' }; }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Fișierul nu are structura unui backup.' };
  const doc = obj.format === BACKUP_FORMAT ? obj.doc : obj.collections ? obj : null; // acceptă și un DbDoc gol de envelope
  if (!doc) return { ok: false, error: 'Fișierul nu este un backup Flota Costuri.' };
  const v = validateDoc(doc);
  if (!v.ok) return { ok: false, error: 'Backup invalid: ' + v.errors.slice(0, 3).join(' ') };
  const warnings = [];
  let migrated;
  try {
    migrated = migrate(doc);
  } catch (e) {
    if (e instanceof StoreError && e.code === 'APP_TOO_OLD') return { ok: false, error: 'Backup-ul este făcut cu o versiune mai nouă a aplicației. Actualizează aplicația.' };
    return { ok: false, error: e.message || String(e) };
  }
  if (migrated.migrated) warnings.push(`Backup-ul a fost migrat de la schema ${migrated.from} la ${SCHEMA_VERSION}.`);
  const known = new Set(Object.keys(migrated.doc.collections));
  if (!known.size) warnings.push('Backup-ul nu conține nicio colecție.');
  return { ok: true, doc: migrated.doc, warnings, migrated: migrated.migrated };
}

/** Compară starea curentă cu backup-ul (pentru ecranul de confirmare). Restaurarea creează mereu o epocă nouă (4.8). */
export function planRestore(current, incoming) {
  const cur = current && typeof current.exportDoc === 'function' ? current.exportDoc() : current;
  return {
    mode: 'newEpoch',
    counts: { current: countsOf(cur), incoming: countsOf(incoming) },
    confirmWord: RESTORE_CONFIRM_WORD,
    preBackupFilename: `flota-backup-inainte-de-restaurare-${new Date().toISOString().slice(0, 10)}.json`,
  };
}

/** Compară cuvântul tastat de utilizator (insensibil la diacritice și majuscule). */
export function confirmWordOk(typed) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  return norm(typed) === norm(RESTORE_CONFIRM_WORD);
}

/**
 * Flux complet de restaurare: salvează înainte, apoi înlocuiește cu epocă nouă.
 * @returns {{ preBackup:{filename,json}, done:Promise<void> }}
 */
export function restoreFromBackup(store, incomingDoc, { now = new Date() } = {}) {
  const pre = exportBackup(store, { now });
  pre.filename = `flota-backup-inainte-de-restaurare-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  return { preBackup: pre, done: store.replaceDoc(incomingDoc, { reason: 'restore', newEpoch: true }) };
}
