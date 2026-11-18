// Migrări de schemă (3.4). Pure și idempotente; operează pe forma logică DbDoc.
import { SCHEMA_VERSION, APP_MAX_SCHEMA, validateDoc } from './schema.js';
import { StoreError, clone } from './util.js';

/** @type {Array<{from:number,to:number,up:(doc:any)=>any}>} Schema v1 este prima: nu există încă migrări. */
export const migrations = [];

/**
 * @returns {{ doc:any, migrated:boolean, from:number }}
 * @throws StoreError('APP_TOO_OLD') dacă datele sunt mai noi decât aplicația; StoreError('BAD_DOC') dacă documentul e invalid.
 */
export function migrate(input, { target = SCHEMA_VERSION, registry = migrations, appMax = APP_MAX_SCHEMA } = {}) {
  const v = validateDoc(input);
  if (!v.ok) throw new StoreError('BAD_DOC', v.errors.join(' '));
  const from = input.schemaVersion;
  if (from > appMax) throw new StoreError('APP_TOO_OLD', `Datele au schema ${from}, aplicația înțelege până la ${appMax}.`, { schemaVersion: from });
  if (from === target) return { doc: input, migrated: false, from };
  let doc = clone(input);
  while (doc.schemaVersion < target) {
    const m = registry.find((x) => x.from === doc.schemaVersion);
    if (!m) throw new StoreError('BAD_DOC', `Lipsește migrarea de la schema ${doc.schemaVersion}.`);
    doc = m.up(doc);
    doc.schemaVersion = m.to;
  }
  return { doc, migrated: true, from };
}
