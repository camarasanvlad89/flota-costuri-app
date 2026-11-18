// Fuziune three-way cu bază (4.7). Funcții pure.
import { stableEqual, isPlainObject } from './util.js';
import { FIELD_MERGE_COLLECTIONS, UNION_COLLECTIONS } from './schema.js';

const META_KEYS = new Set(['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', '_rev']);

/** Regula de departajare (4.7 pct. 3): updatedAt, apoi recurring.versionFrom, fx.stale=false, updatedBy lexicografic. @returns {'L'|'R'} */
export function pickWinner(L, R) {
  const a = L.updatedAt || '', b = R.updatedAt || '';
  if (a !== b) return a > b ? 'L' : 'R';
  const va = L.recurring?.versionFrom || '', vb = R.recurring?.versionFrom || '';
  if (va !== vb) return va > vb ? 'L' : 'R';
  const sa = L.fx?.stale === true, sb = R.fx?.stale === true;
  if (sa !== sb) return sa ? 'R' : 'L';
  const ua = L.updatedBy || '', ub = R.updatedBy || '';
  if (ua !== ub) return ua > ub ? 'L' : 'R';
  return 'L';
}

function diffKeys(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) if (!META_KEYS.has(k) && !stableEqual(a[k], b[k])) out.push(k);
  return out;
}

/** Regula 5: `skipped`/`deleted` cu auto=false bat `generated`; `open` bate `skipped` doar dacă e mai nou. */
function occurrenceWinner(L, R) {
  const hard = (r) => (r.state === 'skipped' || r.state === 'deleted') && r.auto === false;
  if (hard(L) && R.state === 'generated') return 'L';
  if (hard(R) && L.state === 'generated') return 'R';
  return null;
}

/**
 * @param {object|undefined} L local  @param {object|undefined} R la distanță  @param {object|undefined} B bază
 * @param {{ collection?:string, deviceId?:string }} o
 * @returns {{ rec: object|undefined, conflict: null|{ fields:string[], kept:'local'|'remote' } }}
 */
export function mergeRecord(L, R, B, o = {}) {
  const col = o.collection;
  const out = (rec, conflict = null) => ({ rec, conflict });
  if (!L && !R) return out(undefined);
  if (!L) return out(R);
  if (!R) return out(L);
  if (stableEqual(L, R)) return out(L);
  if (B) {
    if (stableEqual(L, B)) return out(R);
    if (stableEqual(R, B)) return out(L);
  }
  const union = UNION_COLLECTIONS.has(col);
  const side = (w) => (w === 'L' ? 'local' : 'remote');
  const ld = !!L.deletedAt, rd = !!R.deletedAt;

  // Editat vs șters (pct. 4)
  if (ld !== rd) {
    const del = ld ? L : R, edit = ld ? R : L;
    const delSide = ld ? 'L' : 'R';
    if ((del.deletedAt || '') > (edit.updatedAt || '')) return out(del, { fields: ['deletedAt'], kept: side(delSide) });
    const { deletedAt, ...alive } = edit;
    return out(alive, { fields: ['deletedAt'], kept: side(ld ? 'R' : 'L') }); // înviere, logată
  }
  if (ld && rd) return out(pickWinner(L, R) === 'L' ? L : R);

  if (col === 'occurrences') {
    const w = occurrenceWinner(L, R);
    if (w) return out(w === 'L' ? L : R, { fields: ['state'], kept: side(w) });
  }

  const winner = pickWinner(L, R);

  // Fuziune pe câmp (pct. 2)
  if (FIELD_MERGE_COLLECTIONS.has(col) && isPlainObject(L) && isPlainObject(R)) {
    const merged = {};
    const conflicts = [];
    const keys = new Set([...Object.keys(L), ...Object.keys(R)]);
    for (const k of keys) {
      if (META_KEYS.has(k)) continue;
      const vl = L[k], vr = R[k], vb = B ? B[k] : undefined;
      let v;
      if (stableEqual(vl, vr)) v = vl;
      else if (B && stableEqual(vl, vb)) v = vr;
      else if (B && stableEqual(vr, vb)) v = vl;
      else { v = winner === 'L' ? vl : vr; conflicts.push(k); }
      if (v !== undefined) merged[k] = v;
    }
    const w = winner === 'L' ? L : R;
    const rec = { ...merged, id: L.id ?? R.id };
    rec.createdAt = L.createdAt ?? R.createdAt;
    if (L.createdBy ?? R.createdBy) rec.createdBy = L.createdBy ?? R.createdBy;
    rec.updatedAt = (L.updatedAt || '') >= (R.updatedAt || '') ? L.updatedAt : R.updatedAt;
    rec.updatedBy = w.updatedBy;
    for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
    if (!stableEqual(rec, L) && !stableEqual(rec, R) && o.deviceId) rec.updatedBy = o.deviceId; // trebuie împins din acest dispozitiv
    return out(rec, conflicts.length ? { fields: conflicts, kept: side(winner) } : null);
  }

  // Înregistrare întreagă, updatedAt mai mare
  const rec = winner === 'L' ? L : R;
  if (union) return out(rec);
  return out(rec, { fields: diffKeys(L, R), kept: side(winner) });
}

const SNAP_SINGLETONS = 'singletons';

function toRecMap(arr) {
  const m = new Map();
  for (const r of arr || []) if (r && r.id) m.set(r.id, r);
  return m;
}

function singletonsToArr(obj) {
  return Object.entries(obj || {}).map(([k, v]) => ({ id: k, ...v }));
}

/**
 * Fuzionează trei instantanee `{ singletons:{k:value}, collections:{col:Rec[]} }`.
 * @returns {{ doc:{singletons:object, collections:object}, conflicts:Array<{collection:string,id:string,fields:string[],kept:string}> }}
 */
export function mergeDocs(local, remote, base, o = {}) {
  const conflicts = [];
  const cols = new Set([...Object.keys(local?.collections || {}), ...Object.keys(remote?.collections || {})]);
  const outCols = {};
  const mergeCol = (name, la, ra, ba) => {
    const lm = toRecMap(la), rm = toRecMap(ra), bm = toRecMap(ba);
    const ids = new Set([...lm.keys(), ...rm.keys()]);
    const res = [];
    for (const id of ids) {
      const r = mergeRecord(lm.get(id), rm.get(id), bm.get(id), { collection: name, deviceId: o.deviceId });
      if (r.rec) res.push(r.rec);
      if (r.conflict) conflicts.push({ collection: name, id, ...r.conflict });
    }
    return res;
  };
  for (const c of cols) outCols[c] = mergeCol(c, local?.collections?.[c], remote?.collections?.[c], base?.collections?.[c]);
  const sing = mergeCol(SNAP_SINGLETONS, singletonsToArr(local?.singletons), singletonsToArr(remote?.singletons), singletonsToArr(base?.singletons));
  const singletons = {};
  for (const r of sing) { const { id, ...v } = r; singletons[id] = v; }
  return { doc: { singletons, collections: outCols }, conflicts };
}
