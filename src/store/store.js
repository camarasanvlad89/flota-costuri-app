// Store: starea aplicației, persistată per înregistrare în IndexedDB (4.1–4.3, 10.8).
//
// Garanții:
//  - put/putMany/remove/batch/setSingleton AȘTEAPTĂ commit-ul tranzacției IDB (înregistrările + `outbox` în aceeași tranzacție)
//    înainte să actualizeze memoria și să emită `store:changed` (4.3).
//  - fiecare înregistrare are un `rev` local (în IDB, ca `_rev`, nu apare în `state()` și nu se sincronizează); scrierea
//    verifică în tranzacție că `rev`-ul stocat e cel pe care îl are fila; la diferență, schimbarea se reaplică prin fuziune
//    three-way, iar dacă rămâne conflict real se aruncă StoreError('CONFLICT') (4.2 pct. 3).
//  - ștergerea este logică (pietre de mormânt permanente).
//
// DbState (extensie față de plan, documentată): { rev, singletons:{company,...}, collections:{trucks:[],...},
//   + scurtături la nivel superior: state.entries, state.trucks, ... și state.company, state.fx, ... }.
import { COLLECTIONS, SINGLETON_KEYS, SCHEMA_VERSION, APP_MAX_SCHEMA, APP_VERSION_MIN, defaultSingleton, isCollection, validateDoc } from './schema.js';
import { migrate } from './migrations.js';
import { mergeRecord } from './merge.js';
import { listen } from './crosstab.js';
import { StoreError, stableEqual, strip, randId, monthOf, EPOCH0, isoFromClock, clone } from './util.js';

/** Câmpuri editabile și într-o lună închisă (5.9). */
const META_OK = new Set(['note', 'foreignVatStatus', 'justification', 'updatedAt', 'updatedBy']);
/** Câmpuri păstrate în piatra de mormânt ca să rămână în același fișier-an la sincronizare. */
const BUCKET_FIELDS = ['accrualMonth', 'date', 'loadDate', 'unloadDate', 'day', 'start', 'startAt'];

const keyOf = (col, id) => `${col}/${id}`;

/** @returns {Store} */
export function createStore(deps) {
  const { db, bus, deviceId, tabId = 'tab0', channel, appVersion = 'dev' } = deps;
  const clock = deps.clock || { now: () => Date.now() };
  const iso = () => isoFromClock(clock);
  const emitBus = (name, payload) => { if (bus) bus.emit(name, payload); };

  /** @type {Map<string, Map<string, any>>} */
  const recs = new Map();
  const revs = new Map();
  const outboxMap = new Map();
  const kv = new Map();
  const liveCache = new Map();
  const subs = new Set();
  let rev = 0;
  let stateCache = null;
  let inited = false;

  const colMap = (c) => { let m = recs.get(c); if (!m) { m = new Map(); recs.set(c, m); } return m; };
  const assertCol = (c) => { if (!isCollection(c)) throw new StoreError('UNKNOWN_COLLECTION', `Colecție necunoscută: ${c}`); };
  const touch = (c) => { liveCache.delete(c); stateCache = null; };

  function live(c) {
    let arr = liveCache.get(c);
    if (!arr) {
      arr = [];
      for (const r of colMap(c).values()) if (!r.deletedAt) arr.push(r);
      Object.freeze(arr);
      liveCache.set(c, arr);
    }
    return arr;
  }

  function singletonValue(key) {
    const r = colMap('singletons').get(key);
    if (r && !r.deletedAt) { const { id, ...v } = r; return v; }
    return defaultSingleton(key);
  }

  function buildState() {
    if (stateCache && stateCache.rev === rev) return stateCache;
    const collections = {};
    for (const c of COLLECTIONS) collections[c] = live(c);
    const singletons = {};
    const keys = new Set([...SINGLETON_KEYS, ...colMap('singletons').keys()]);
    for (const k of keys) singletons[k] = singletonValue(k);
    stateCache = Object.freeze({ ...collections, ...singletons, rev, singletons, collections });
    return stateCache;
  }

  // ---------- inițializare ----------
  async function loadAll() {
    for (const c of [...COLLECTIONS, 'singletons']) {
      const rows = await db.getAll(c);
      const m = colMap(c);
      m.clear();
      for (const { key, value } of rows) {
        m.set(key, strip(value));
        revs.set(keyOf(c, key), value._rev || 0);
      }
      touch(c);
    }
    outboxMap.clear();
    for (const { key, value } of await db.getAll('outbox')) outboxMap.set(key, value);
    kv.clear();
    for (const { key, value } of await db.getAll('kv')) kv.set(key, value);
  }

  async function init() {
    if (inited) return;
    await loadAll();
    const seen = kv.get('schemaSeen');
    if (seen !== undefined && seen > APP_MAX_SCHEMA) {
      throw new StoreError('APP_TOO_OLD', `Datele locale au schema ${seen}, aplicația înțelege până la ${APP_MAX_SCHEMA}.`, { schemaVersion: seen });
    }
    if (seen !== undefined && seen < SCHEMA_VERSION) {
      const before = exportDoc();
      before.schemaVersion = seen;
      emitBus('store:premigration', { from: seen, to: SCHEMA_VERSION, filename: `flota-backup-pre-v${SCHEMA_VERSION}-${iso().slice(0, 10)}.json`, json: JSON.stringify(before) });
      const { doc } = migrate(before);
      await writeDoc(doc, { markClean: true, keepKv: true });
    }
    if (seen !== SCHEMA_VERSION) await kvSet('schemaSeen', SCHEMA_VERSION);
    if (channel) {
      listen(channel, (m) => {
        if (!m || m.tabId === tabId) return;
        if (m.type === 'store:changed') reload(m.collections, m.ids).catch(() => {});
      });
    }
    inited = true;
    rev++;
    stateCache = null;
  }

  // ---------- citire ----------
  const get = (c, id) => { assertCol(c); const r = colMap(c).get(id); return r && !r.deletedAt ? r : undefined; };
  const list = (c, pred) => { assertCol(c); const a = live(c); return pred ? a.filter(pred) : a; };
  const rawGet = (c, id) => colMap(c).get(id);
  const rawAll = (c) => [...colMap(c).values()];

  // ---------- gardul lunilor închise (5.9) ----------
  function closedThrough() {
    return singletonValue('company').closedThrough || null;
  }
  function recMonth(rec) {
    if (!rec) return null;
    if (rec.accrualMonth) return monthOf(rec.accrualMonth);
    if (rec.kind && rec.date) return monthOf(rec.date); // înregistrare de tip Entry
    return null;
  }
  function guardClosed(rec) {
    const ct = closedThrough();
    const m = recMonth(rec);
    if (ct && m && m <= ct) return { code: 'CLOSED_MONTH', month: m };
    return null;
  }
  function onlyMeta(prev, next) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys) if (!META_OK.has(k) && !stableEqual(prev[k], next[k])) return false;
    return true;
  }
  function closedCheck(col, prev, next, o) {
    if (o.allowClosed || col === 'singletons') return;
    const g = (next && !next.deletedAt ? guardClosed(next) : null) || (prev && !prev.deletedAt ? guardClosed(prev) : null);
    if (!g) return;
    if (prev && next && !next.deletedAt && onlyMeta(prev, next)) return;
    throw new StoreError('CLOSED_MONTH', `Luna ${g.month} este închisă.`, { month: g.month });
  }

  // ---------- pregătirea operațiilor ----------
  function stampRec(rec, prev, now, o) {
    const out = { ...rec };
    delete out.deletedAt;
    let at = o.raw && rec.updatedAt ? rec.updatedAt : now;
    if (!o.raw && prev && prev.updatedAt && at <= prev.updatedAt) at = new Date(Date.parse(prev.updatedAt) + 1).toISOString();
    out.updatedAt = at;
    out.updatedBy = o.raw && rec.updatedBy ? rec.updatedBy : deviceId;
    out.createdAt = out.createdAt || prev?.createdAt || at;
    out.createdBy = out.createdBy || prev?.createdBy || 'admin';
    return out;
  }
  function tombstone(prev, id, now) {
    const t = { id, deletedAt: now, updatedAt: now, updatedBy: deviceId };
    if (prev) {
      if (prev.createdAt) t.createdAt = prev.createdAt;
      for (const f of BUCKET_FIELDS) if (prev[f] !== undefined) t[f] = prev[f];
      if (prev.updatedAt && t.updatedAt <= prev.updatedAt) t.updatedAt = t.deletedAt = new Date(Date.parse(prev.updatedAt) + 1).toISOString();
    }
    return t;
  }

  /** Transformă operațiile cerute în operații concrete (rec final, prev, rev așteptat). Aruncă înainte de orice scriere. */
  function prepare(ops, o = {}) {
    const now = iso();
    const view = new Map();
    const expected = new Map();
    const prepared = [];
    const queue = [...ops];
    while (queue.length) {
      const op = queue.shift();
      let col, id, next;
      const opts = { ...o, ...(op.o || {}) };
      if (op.kind === 'singleton') { col = 'singletons'; id = op.key; }
      else if (op.kind === 'remove') { col = op.col; id = op.id; }
      else { col = op.col; id = op.rec && op.rec.id; }
      assertCol(col);
      if (typeof id !== 'string' || !id) throw new StoreError('BAD_RECORD', 'Înregistrare fără id.');
      const key = keyOf(col, id);
      const prev = view.has(key) ? view.get(key) : colMap(col).get(id);
      const expRev = expected.has(key) ? expected.get(key) + 1 : revs.get(key) || 0;
      if (op.kind === 'singleton') {
        const base = prev && !prev.deletedAt ? strip(prev) : { id, ...defaultSingleton(id) };
        next = stampRec({ ...base, ...op.patch, id }, prev, now, opts);
      } else if (op.kind === 'remove') {
        closedCheck(col, prev, null, opts);
        next = tombstone(prev, id, now);
        if (col === 'entries' && prev && !prev.deletedAt && prev.source === 'recurring' && prev.recurring && !opts.noOccurrence) {
          const occ = [...colMap('occurrences').values()].find((x) => x.entryId === id && !x.deletedAt);
          if (occ) queue.push({ kind: 'put', col: 'occurrences', rec: { ...occ, state: 'deleted', auto: false }, o: { allowClosed: true } });
          else queue.push({ kind: 'put', col: 'occurrences', rec: unknownOccurrence(prev), o: { allowClosed: true } });
        }
      } else {
        next = stampRec(op.rec, prev, now, opts);
        closedCheck(col, prev, next, opts);
      }
      view.set(key, next);
      expected.set(key, expRev);
      prepared.push({ col, id, key, prev, next, expRev });
    }
    return prepared;
  }

  function unknownOccurrence(entry) {
    // Fallback rar: fără ocurență în registru. Id determinist FNV-1a identic ca principiu cu core/ids.detId nu e garantat,
    // de aceea folosim un prefix propriu `occ_x` (domeniul reconciliază după templateId+period).
    const r = entry.recurring;
    const tk = entry.target?.truckId || entry.target?.trailerId || 'company';
    return { id: `occx_${r.templateId}_${r.period}_${tk}`, templateId: r.templateId, period: r.period, targetKey: tk, entryId: entry.id, state: 'deleted', versionFrom: r.versionFrom, auto: false };
  }

  // ---------- commit ----------
  async function commit(prepared, { source = 'local', label } = {}) {
    if (!prepared.length) return { undo: async () => {}, changed: [] };
    const cols = [...new Set(prepared.map((p) => p.col))];
    const at = iso();
    let results;
    try {
      results = await db.transact([...cols, 'outbox'], async (tx) => {
        const pend = new Map();
        const out = [];
        for (const p of prepared) {
          const stored = pend.has(p.key) ? pend.get(p.key) : await tx.get(p.col, p.id);
          const storedRev = stored ? stored._rev || 0 : 0;
          let final = p.next;
          if (stored && storedRev !== p.expRev) {
            const m = mergeRecord(p.next, strip(stored), p.prev, { collection: p.col, deviceId });
            if (m.conflict) throw new StoreError('CONFLICT', 'Modificat într-o altă fereastră.', { col: p.col, id: p.id, fields: m.conflict.fields, current: strip(stored) });
            final = m.rec;
          }
          const value = { ...final, _rev: storedRev + 1 };
          await tx.put(p.col, p.id, value);
          await tx.put('outbox', p.key, { col: p.col, id: p.id, at });
          pend.set(p.key, value);
          out.push({ p, final, rev: storedRev + 1 });
        }
        return out;
      });
    } catch (e) {
      if (e instanceof StoreError && e.code === 'CONFLICT') {
        await reload([e.col], [e.id]).catch(() => {});
        emitChanged([e.col], [e.id], 'tab');
      }
      throw e;
    }
    for (const r of results) {
      colMap(r.p.col).set(r.p.id, r.final);
      revs.set(r.p.key, r.rev);
      outboxMap.set(r.p.key, { col: r.p.col, id: r.p.id, at });
      touch(r.p.col);
    }
    const changedCols = [...new Set(results.map((r) => r.p.col))];
    const ids = results.map((r) => r.p.id);
    emitChanged(changedCols, ids, source, true);
    const inverse = prepared.slice().reverse().map((p) => (
      p.prev && !p.prev.deletedAt
        ? { kind: 'put', col: p.col, rec: p.prev, o: { allowClosed: true } }
        : { kind: 'remove', col: p.col, id: p.id, o: { allowClosed: true, noOccurrence: true } }
    ));
    let undone = false;
    return {
      label,
      changed: results.map((r) => ({ col: r.p.col, id: r.p.id })),
      undo: async () => {
        if (undone) return;
        undone = true;
        await commit(prepare(inverse, {}), { source: 'undo', label: label ? `undo:${label}` : 'undo' });
      },
    };
  }

  function emitChanged(collections, ids, source, broadcast = false) {
    rev++;
    stateCache = null;
    const payload = { collections, ids, source, rev };
    emitBus('store:changed', payload);
    for (const fn of [...subs]) { try { fn(buildState(), payload); } catch { /* un abonat defect nu oprește ceilalți */ } }
    if (broadcast && channel && source !== 'tab') {
      try { channel.postMessage({ type: 'store:changed', tabId, collections, ids }); } catch { /* canal închis */ }
    }
  }

  // ---------- API de scriere ----------
  const put = async (col, rec, o) => commit(prepare([{ kind: 'put', col, rec, o }], o), { source: o?.source || 'local' });
  const putMany = async (col, recs, o) => commit(prepare(recs.map((rec) => ({ kind: 'put', col, rec })), o), { source: o?.source || 'local' });
  const remove = async (col, id, o) => commit(prepare([{ kind: 'remove', col, id, o }], o), { source: o?.source || 'local' });
  const setSingleton = async (key, patch, o) => commit(prepare([{ kind: 'singleton', key, patch }], o), { source: o?.source || 'local' });

  async function batch(label, fn, o = {}) {
    const ops = [];
    const tx = {
      put: (col, rec, oo) => { ops.push({ kind: 'put', col, rec, o: oo }); },
      remove: (col, id, oo) => { ops.push({ kind: 'remove', col, id, o: oo }); },
      setSingleton: (key, patch) => { ops.push({ kind: 'singleton', key, patch }); },
    };
    await fn(tx);
    return commit(prepare(ops, o), { source: o.source || 'local', label });
  }

  // ---------- reîncărcare din IDB (după scrierea altei file) ----------
  async function reload(collections, ids) {
    const changedCols = [];
    const cols = collections && collections.length ? collections : [...COLLECTIONS, 'singletons'];
    for (const c of cols) {
      if (!isCollection(c)) continue;
      const m = colMap(c);
      if (ids && ids.length) {
        await db.transact([c], async (tx) => {
          for (const id of ids) {
            const v = await tx.get(c, id);
            if (v) { m.set(id, strip(v)); revs.set(keyOf(c, id), v._rev || 0); }
          }
        }, { mode: 'readonly' });
      } else {
        m.clear();
        for (const { key, value } of await db.getAll(c)) { m.set(key, strip(value)); revs.set(keyOf(c, key), value._rev || 0); }
      }
      touch(c);
      changedCols.push(c);
    }
    outboxMap.clear();
    for (const { key, value } of await db.getAll('outbox')) outboxMap.set(key, value);
    emitChanged(changedCols, ids || [], 'tab', false);
  }

  // ---------- primitive pentru sincronizare ----------
  async function readOutbox() {
    const rows = await db.getAll('outbox');
    return rows.map((r) => r.value);
  }

  /**
   * Aplică înregistrări venite de la distanță prin fuziune three-way (4.7). `items` = [{ col, rec }].
   * @returns {{ changed:Array<{col,id}>, conflicts:Array, closedMonth:Array }}
   */
  async function applyRemote(items, o = {}) {
    const changed = [], conflicts = [], closedMonth = [];
    const CH = 800;
    const ct = closedThrough();
    for (let i = 0; i < items.length; i += CH) {
      const part = items.slice(i, i + CH);
      const cols = [...new Set(part.map((x) => x.col))];
      const res = await db.transact([...cols, 'base', 'outbox'], async (tx) => {
        const out = [];
        const pend = new Map();
        for (const { col, rec: R } of part) {
          if (!R || !R.id) continue;
          const key = keyOf(col, R.id);
          const storedRaw = pend.has(key) ? pend.get(key) : await tx.get(col, R.id);
          const L = strip(storedRaw);
          const B = await tx.get('base', key);
          const m = mergeRecord(L, R, B, { collection: col, deviceId });
          const final = m.rec;
          if (m.conflict) conflicts.push({ collection: col, id: R.id, ...m.conflict, at: iso() });
          await tx.put('base', key, R);
          if (!stableEqual(final, L)) {
            const r2 = (storedRaw?._rev || 0) + 1;
            const val = { ...final, _rev: r2 };
            await tx.put(col, R.id, val);
            pend.set(key, val);
            out.push({ col, id: R.id, final, rev: r2 });
          }
          if (stableEqual(final, R)) await tx.delete('outbox', key);
          else await tx.put('outbox', key, { col, id: R.id, at: iso() });
        }
        return out;
      });
      for (const r of res) {
        colMap(r.col).set(r.id, r.final);
        revs.set(keyOf(r.col, r.id), r.rev);
        touch(r.col);
        changed.push({ col: r.col, id: r.id });
        if (r.col === 'entries' && ct && !r.final.deletedAt && monthOf(r.final.accrualMonth) && monthOf(r.final.accrualMonth) <= ct) closedMonth.push(r.id);
      }
    }
    // sincronizează memoria outbox cu IDB
    outboxMap.clear();
    for (const v of await readOutbox()) outboxMap.set(keyOf(v.col, v.id), v);
    if (conflicts.length) await logConflicts(conflicts);
    if (closedMonth.length) await kvSet('closedMonthSignals', [...new Set([...(kv.get('closedMonthSignals') || []), ...closedMonth])]);
    if (changed.length) {
      const cols = [...new Set(changed.map((c) => c.col))];
      emitChanged(cols, changed.map((c) => c.id), o.source || 'remote', true);
    }
    if (conflicts.length) emitBus('sync:conflict', { count: conflicts.length, conflicts: conflicts.slice(0, 20) });
    return { changed, conflicts, closedMonth };
  }

  /** După un push reușit: `base` = ce am scris; scoate din outbox doar dacă înregistrarea nu s-a schimbat între timp. */
  async function markSynced(col, id, baseRec) {
    const key = keyOf(col, id);
    await db.transact([col, 'base', 'outbox'], async (tx) => {
      await tx.put('base', key, baseRec);
      const cur = strip(await tx.get(col, id));
      if (cur && stableEqual(cur, baseRec)) await tx.delete('outbox', key);
    });
    const cur = colMap(col).get(id);
    if (cur && stableEqual(cur, baseRec)) outboxMap.delete(key);
  }

  async function getBase(col, id) { return db.get('base', keyOf(col, id)); }

  async function markAllDirty() {
    const at = iso();
    const keys = [];
    for (const c of [...COLLECTIONS, 'singletons']) for (const id of colMap(c).keys()) keys.push([c, id]);
    await db.transact(['outbox'], async (tx) => { for (const [c, id] of keys) await tx.put('outbox', keyOf(c, id), { col: c, id, at }); });
    for (const [c, id] of keys) outboxMap.set(keyOf(c, id), { col: c, id, at });
  }

  async function logConflicts(list) {
    const cur = kv.get('conflictLog') || [];
    await kvSet('conflictLog', [...cur, ...list].slice(-50));
  }

  // ---------- kv (stare strict locală) ----------
  const kvGet = (k) => kv.get(k);
  async function kvSet(k, v) {
    if (v === undefined) { kv.delete(k); await db.transact(['kv'], (tx) => tx.delete('kv', k)); return; }
    kv.set(k, v);
    await db.transact(['kv'], (tx) => tx.put('kv', k, v));
  }
  const kvAll = () => Object.fromEntries(kv);

  // ---------- document logic ----------
  function exportDoc() {
    const collections = {};
    for (const c of COLLECTIONS) collections[c] = [...colMap(c).values()].map((r) => clone(r));
    const singletons = {};
    for (const [k, r] of colMap('singletons')) { if (r.deletedAt) continue; const { id, ...v } = r; singletons[k] = clone(v); }
    for (const k of SINGLETON_KEYS) if (!singletons[k]) singletons[k] = defaultSingleton(k);
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        docId: kv.get('docId') || null,
        epoch: kv.get('epochSeen') || { id: null, no: 0 },
        appVersionMin: APP_VERSION_MIN,
        devices: { [deviceId]: { lastSyncedAt: kv.get('lastSyncedAt') || null, label: kv.get('deviceLabel') || '' } },
        ...(singletons.ui && singletons.ui.isDemo ? { demo: true } : {}),
      },
      singletons,
      collections,
    };
  }

  /** Scrie un DbDoc în IDB (golește colecțiile). markClean = înregistrările sunt deja pe Drive (base=doc, outbox gol). */
  async function writeDoc(doc, { markClean = false, keepKv = false } = {}) {
    const flat = [];
    const at = iso();
    for (const c of COLLECTIONS) for (const r of doc.collections?.[c] || []) flat.push([c, r]);
    for (const [k, v] of Object.entries(doc.singletons || {})) {
      // singletonii din seed/backup fără `updatedAt` se păstrează (ștampilați acum); doar cei impliciți (epoca 0) se omit
      if (v && v.updatedAt !== EPOCH0 && Object.keys(v).length) flat.push(['singletons', { id: k, ...v, updatedAt: v.updatedAt || at, updatedBy: v.updatedBy || deviceId }]);
    }
    const stores = [...COLLECTIONS, 'singletons', 'base', 'outbox'];
    await db.transact(stores, async (tx) => {
      for (const s of stores) await tx.clear(s);
      for (const [c, r] of flat) {
        await tx.put(c, r.id, { ...r, _rev: 1 });
        if (markClean) await tx.put('base', keyOf(c, r.id), r);
        else await tx.put('outbox', keyOf(c, r.id), { col: c, id: r.id, at });
      }
    });
    if (!keepKv) { /* kv rămâne: deviceId/fileIds se resetează explicit de apelant */ }
    for (const c of [...COLLECTIONS, 'singletons']) { colMap(c).clear(); touch(c); }
    revs.clear();
    outboxMap.clear();
    for (const [c, r] of flat) {
      colMap(c).set(r.id, r);
      revs.set(keyOf(c, r.id), 1);
      if (!markClean) outboxMap.set(keyOf(c, r.id), { col: c, id: r.id, at });
    }
  }

  /**
   * Înlocuiește tot conținutul (restaurare, resetare demo, adoptarea unei epoci de la distanță) – 4.8.
   * @param {object} doc DbDoc  @param {{ reason:string, newEpoch?:boolean, epoch?:{id,no}, markClean?:boolean, source?:string }} o
   */
  async function replaceDoc(doc, o = {}) {
    const { doc: migrated } = migrate(doc);
    const v = validateDoc(migrated);
    if (!v.ok) throw new StoreError('BAD_DOC', v.errors.join(' '));
    await writeDoc(migrated, { markClean: !!o.markClean });
    const prevEpoch = kv.get('epochSeen') || migrated.meta?.epoch || { id: null, no: 0 };
    let epoch = o.epoch || null;
    if (!epoch && o.newEpoch !== false) epoch = { id: randId('ep', 8), no: (prevEpoch.no || 0) + 1 };
    if (epoch) { await kvSet('epochSeen', epoch); await kvSet('epochPending', o.newEpoch !== false && !o.epoch); }
    if (migrated.meta?.docId && !kv.get('docId')) await kvSet('docId', migrated.meta.docId);
    if (o.newEpoch !== false && !o.epoch) await kvSet('fileVersions', {});
    emitChanged([...COLLECTIONS, 'singletons'], [], o.source || 'import', true);
    emitBus('store:replaced', { reason: o.reason || 'replace', epoch });
  }

  function hasUserData() {
    for (const c of COLLECTIONS) for (const r of colMap(c).values()) if (!r.deletedAt) return true;
    for (const r of colMap('singletons').values()) if (!r.deletedAt && r.updatedAt !== EPOCH0) return true;
    return false;
  }

  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  async function close() { try { if (channel && channel.close) channel.close(); } catch { /* deja închis */ } db.close(); }

  return {
    name: db.name, deviceId, tabId, appVersion,
    init, state: buildState, get, list, rawGet, rawAll,
    put, putMany, remove, batch, setSingleton, guardClosed,
    subscribe, exportDoc, replaceDoc, hasUserData,
    outbox: () => ({ ids: [...outboxMap.keys()], count: outboxMap.size }),
    readOutbox, markSynced, getBase, applyRemote, markAllDirty,
    kvGet, kvSet, kvAll, logConflicts, reload, close,
    conflictLog: () => kv.get('conflictLog') || [],
    closedMonthSignals: () => kv.get('closedMonthSignals') || [],
    db,
  };
}
