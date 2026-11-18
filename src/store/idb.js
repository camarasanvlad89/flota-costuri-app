// IndexedDB: un singur cod de stocare locală (4.1). Două implementări ale aceleiași interfețe `IdbHandle`:
//  - openDb(name)        IndexedDB real (durabilitate „strict”, tranzacții cu abort la eroare)
//  - createMemoryDb()    în memorie (teste, fallback când IDB lipsește: bandă roșie în UI, `volatile:true`)
//
// IdbHandle = {
//   name, kind:'idb'|'memory', volatile:boolean,
//   get(store,key), getAll(store) -> [{key,value}],
//   transact(stores:string[], fn:(tx)=>Promise<T>, {mode?:'readwrite'|'readonly'}) -> Promise<T>,
//     tx = { get(store,key), put(store,key,value), delete(store,key), getAll(store), clear(store) }
//     fn trebuie să aștepte doar operații ale lui `tx` (altfel IDB închide tranzacția); aruncare ⇒ abort, nimic scris,
//   close(), destroy() }
import { STORE_NAMES } from './schema.js';
import { StoreError } from './util.js';

const DELETED = Symbol('deleted');

export function createMemoryDb(name = 'flota:memory', { volatile = true } = {}) {
  /** @type {Map<string, Map<string, any>>} */
  const data = new Map();
  let chain = Promise.resolve();
  let closed = false;
  const st = (s) => { if (!data.has(s)) data.set(s, new Map()); return data.get(s); };
  const cl = (v) => (v === undefined ? undefined : structuredClone(v));

  async function runTx(names, fn) {
    const overlay = new Map(); // store -> Map(key -> value|DELETED)
    const cleared = new Set();
    const ov = (s) => { if (!overlay.has(s)) overlay.set(s, new Map()); return overlay.get(s); };
    const check = (s) => { if (!names.includes(s)) throw new StoreError('IDB_STORE_NOT_IN_TX', `Store ${s} nu e în tranzacție.`); };
    const tx = {
      async get(s, k) {
        check(s);
        const o = ov(s);
        if (o.has(k)) { const v = o.get(k); return v === DELETED ? undefined : cl(v); }
        if (cleared.has(s)) return undefined;
        return cl(st(s).get(k));
      },
      async put(s, k, v) { check(s); ov(s).set(k, cl(v)); },
      async delete(s, k) { check(s); ov(s).set(k, DELETED); },
      async clear(s) { check(s); cleared.add(s); overlay.set(s, new Map()); },
      async getAll(s) {
        check(s);
        const m = new Map(cleared.has(s) ? [] : st(s));
        for (const [k, v] of ov(s)) { if (v === DELETED) m.delete(k); else m.set(k, v); }
        return [...m].map(([key, value]) => ({ key, value: cl(value) }));
      },
    };
    const res = await fn(tx);
    // commit atomic
    for (const s of cleared) st(s).clear();
    for (const [s, o] of overlay) { const m = st(s); for (const [k, v] of o) { if (v === DELETED) m.delete(k); else m.set(k, v); } }
    return res;
  }

  const handle = {
    name, kind: 'memory', volatile,
    transact(names, fn) {
      if (closed) return Promise.reject(new StoreError('IDB_CLOSED', 'Baza este închisă.'));
      const p = chain.then(() => runTx(names, fn));
      chain = p.then(() => {}, () => {});
      return p;
    },
    get: (s, k) => handle.transact([s], (tx) => tx.get(s, k)),
    getAll: (s) => handle.transact([s], (tx) => tx.getAll(s)),
    close() { closed = true; },
    reopen() { closed = false; },
    async destroy() { data.clear(); },
    _data: data,
  };
  return handle;
}

function openOnce(factory, name, version, stores) {
  return new Promise((resolve, reject) => {
    const req = version ? factory.open(name, version) : factory.open(name);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new StoreError('IDB_OPEN_FAILED', 'Nu s-a putut deschide IndexedDB.'));
    req.onblocked = () => {};
  });
}

/** Deschide (sau creează) baza IndexedDB cu toate object store-urile. @throws StoreError('NO_IDB') dacă lipsește. */
export async function openDb(name, { indexedDB = globalThis.indexedDB, stores = STORE_NAMES } = {}) {
  if (!indexedDB) throw new StoreError('NO_IDB', 'IndexedDB nu este disponibil.');
  let db;
  try {
    db = await openOnce(indexedDB, name, undefined, stores);
    const missing = stores.filter((s) => !db.objectStoreNames.contains(s));
    if (missing.length) { const v = db.version + 1; db.close(); db = await openOnce(indexedDB, name, v, stores); }
  } catch (e) {
    throw e instanceof StoreError ? e : new StoreError('NO_IDB', String(e && e.message || e));
  }
  db.onversionchange = () => db.close();
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const handle = {
    name, kind: 'idb', volatile: false,
    transact(names, fn, { mode = 'readwrite' } = {}) {
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(names, mode, { durability: 'strict' }); } catch (e) {
          try { tx = db.transaction(names, mode); } catch (e2) { reject(e2); return; }
        }
        let result, failed = null, settled = false;
        const fail = (e) => { if (!settled) { settled = true; reject(e); } };
        tx.oncomplete = () => { if (!settled) { settled = true; if (failed) reject(failed); else resolve(result); } };
        tx.onerror = () => fail(failed || tx.error);
        tx.onabort = () => fail(failed || tx.error || new StoreError('IDB_ABORT', 'Tranzacție anulată.'));
        const w = {
          get: (s, k) => req(tx.objectStore(s).get(k)),
          put: (s, k, v) => req(tx.objectStore(s).put(v, k)).then(() => {}),
          delete: (s, k) => req(tx.objectStore(s).delete(k)).then(() => {}),
          clear: (s) => req(tx.objectStore(s).clear()).then(() => {}),
          getAll: (s) => new Promise((res, rej) => {
            const out = [];
            const c = tx.objectStore(s).openCursor();
            c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); } else res(out); };
            c.onerror = () => rej(c.error);
          }),
        };
        Promise.resolve().then(() => fn(w)).then((r) => { result = r; }, (e) => { failed = e; try { tx.abort(); } catch { /* deja terminat */ } });
      });
    },
    get: (s, k) => handle.transact([s], (tx) => tx.get(s, k), { mode: 'readonly' }),
    getAll: (s) => handle.transact([s], (tx) => tx.getAll(s), { mode: 'readonly' }),
    close() { db.close(); },
    destroy() { db.close(); return new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); }); },
  };
  return handle;
}

/** Deschide IDB; dacă nu merge (mod privat strict) cade pe memorie cu `volatile:true` (UI: „Datele se pierd la închidere”). */
export async function openDbOrMemory(name, env = {}) {
  try { return await openDb(name, env); } catch (e) {
    const h = createMemoryDb(name, { volatile: true });
    h.openError = e;
    return h;
  }
}

/** Numele bazei per cont (4.1). */
export function dbNameFor(sub) {
  return sub ? `flota:${sub}` : 'flota:local';
}

/** `deviceId` o dată per profil de browser, într-o bază separată `flota:device` (fără cratime: apare în numele fișierelor Drive). */
export async function getOrCreateDeviceId(handle) {
  const existing = await handle.get('kv', 'deviceId');
  if (existing) return existing;
  const id = 'dev' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  // dacă două file creează simultan, rămâne primul scris
  return handle.transact(['kv'], async (tx) => {
    const again = await tx.get('kv', 'deviceId');
    if (again) return again;
    await tx.put('kv', 'deviceId', id);
    return id;
  });
}

export async function openDeviceDb(env = {}) {
  try { return await openDb('flota:device', { ...env, stores: ['kv'] }); } catch { return createMemoryDb('flota:device'); }
}
