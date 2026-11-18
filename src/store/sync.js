// Sincronizare cu stocarea la distanță (Drive) – 4.6, 4.7, 4.8.
//
// Aranjament: fiecare dispozitiv scrie DOAR fișierele lui (`flota-<deviceId>-hot.json.gz`, `flota-<deviceId>-<AAAA>.json.gz`);
// toate fișierele tuturor dispozitivelor se fuzionează la citire (three-way cu `base`). Nu există scriere concurentă pe același
// fișier, deci nu e nevoie de compare-and-swap. `flota-epoch.json` = manifest mic cu epoca (restaurare/resetare).
//
// Reguli de siguranță: nu se creează niciodată un fișier după un `list` eșuat sau offline (orice scriere e precedată, în
// aceeași rulare, de un `list` reușit); doar liderul (lacăt exclusiv) sincronizează; fără token ⇒ `authNeeded`, fără pierderea cozii.
import { COLLECTIONS, SCHEMA_VERSION, APP_MAX_SCHEMA, APP_VERSION_MIN, emptyDoc, isCollection, countsOf } from './schema.js';
import { acquireLeadership, listen } from './crosstab.js';
import { DriverError } from './drivers/driver-error.js';
import { StoreError, randId, isoFromClock, stableStringify, todayIso } from './util.js';
import { mergeRecord } from './merge.js';

export const MANIFEST_NAME = 'flota-epoch.json';
const FILE_RE = /^flota-([A-Za-z0-9_]+)-(hot|\d{4})\.json\.gz$/;
const BACKUP_RE = /^flota-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/;
const YEAR_COLS = new Set(['entries', 'courses', 'gpsDays', 'gpsTrips']);
const YEAR_FIELDS = ['accrualMonth', 'date', 'loadDate', 'day', 'start', 'startAt'];
const DAY_MS = 86400000;

export const fileNameFor = (deviceId, bucket) => `flota-${deviceId}-${bucket}.json.gz`;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
const sigOf = (m) => `${m.version}|${m.md5Checksum || ''}`;

/** Anul unei înregistrări pentru împărțirea pe fișiere (3.5). */
export function yearOf(rec) {
  for (const f of YEAR_FIELDS) if (typeof rec[f] === 'string' && /^\d{4}/.test(rec[f])) return rec[f].slice(0, 4);
  return null;
}
/** Fișierul în care intră o înregistrare: 'hot' sau 'AAAA' (an cu toate lunile închise). */
export function bucketOf(col, rec, closedThrough) {
  if (!YEAR_COLS.has(col) || !closedThrough) return 'hot';
  const y = yearOf(rec);
  if (y && closedThrough >= `${y}-12`) return y;
  return 'hot';
}

function pickPrimary(metas) {
  return [...metas].sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || '') || a.id.localeCompare(b.id));
}

function epochRank(a, b) {
  // >0 dacă a mai nou decât b
  if ((a.no || 0) !== (b.no || 0)) return (a.no || 0) - (b.no || 0);
  if (a.id === b.id || (a.genesis && b.genesis)) return 0; // aceeași epocă sau frați genesis
  return a.id > b.id ? 1 : -1;
}

export function createSync(deps) {
  const { store, driver, auth, bus, locks, channel } = deps;
  const clock = deps.clock || { now: () => Date.now() };
  const timers = deps.timers || { setTimeout: globalThis.setTimeout?.bind(globalThis), clearTimeout: globalThis.clearTimeout?.bind(globalThis), setInterval: globalThis.setInterval?.bind(globalThis), clearInterval: globalThis.clearInterval?.bind(globalThis) };
  const env = deps.env || {}; // { on(name, fn)->off, visible():boolean } pentru focus/online/visibilitychange
  const debounceMs = deps.debounceMs ?? 3000;
  const pollMs = deps.pollMs ?? 60000;
  const poll = deps.poll !== false;
  const isOnline = typeof deps.online === 'function' ? deps.online : deps.online && deps.online.isOnline ? () => deps.online.isOnline() : () => true;
  const deviceId = store.deviceId;
  const iso = () => isoFromClock(clock);
  const emit = (n, p) => { if (bus) bus.emit(n, p); };
  const isNone = driver.kind === 'none';

  let status = { state: isNone ? 'local' : 'idle', dirty: 0, lastSyncedAt: null, message: undefined };
  let pulled = false;
  let clockSkewMs = 0;
  let clockChecked = false;
  let pendingChoice = null;
  let leadership = null;
  let started = false;
  let chain = Promise.resolve();
  let debounceT = null;
  let pollT = null;
  let retryT = null;
  let failures = 0;
  const offs = [];

  function setStatus(patch) {
    const dirty = store.outbox().count;
    const next = { ...status, ...patch, dirty };
    if (!('message' in patch)) next.message = undefined;
    const changed = next.state !== status.state || next.dirty !== status.dirty || next.lastSyncedAt !== status.lastSyncedAt || next.message !== status.message;
    status = next;
    if (changed) emit('sync:status', { ...status });
  }
  const getStatus = () => ({ ...status, dirty: store.outbox().count, pulled, clockSkewMs, leader: isLeader(), pendingChoice: pendingChoice ? { local: pendingChoice.local, remote: pendingChoice.remote } : null });
  const isLeader = () => (leadership ? leadership.isLeader() : false);

  function run(fn) {
    const p = chain.then(fn, fn);
    chain = p.then(() => {}, () => {});
    return p;
  }

  function mapError(e) {
    if (e instanceof DriverError) {
      switch (e.code) {
        case 'auth': return { state: 'authNeeded', message: 'Reconectează-te la Google.' };
        case 'insufficientPermissions': return { state: 'authNeeded', message: 'Permisiunea pentru Drive nu a fost acordată.' };
        case 'offline': return { state: 'offline', message: undefined };
        case 'quota': return { state: 'error', message: 'Spațiul din Google Drive este plin.' };
        case 'rate': return { state: 'error', message: 'Prea multe cereri către Google; se reîncearcă.' };
        default: return { state: 'error', message: e.message };
      }
    }
    if (e instanceof StoreError && e.code === 'APP_TOO_OLD') return { state: 'conflict', message: 'Datele de pe Drive sunt mai noi decât aplicația. Actualizează aplicația.' };
    return { state: 'error', message: e && e.message ? e.message : String(e) };
  }

  /** Execută `fn` cu verificări (online, token) și traducerea erorilor în stări. */
  async function guarded(fn, { saving = false } = {}) {
    if (isNone) return { skipped: 'local' };
    if (pendingChoice) return { skipped: 'choice' };
    if (!isOnline()) { setStatus({ state: 'offline' }); return { skipped: 'offline' }; }
    if (auth && !auth.getAccessToken()) { setStatus({ state: 'authNeeded', message: 'Reconectează-te la Google.' }); return { skipped: 'auth' }; }
    try {
      if (saving) setStatus({ state: 'saving' });
      const r = await fn();
      return { ok: true, value: r };
    } catch (e) {
      setStatus(mapError(e));
      return { error: e };
    }
  }

  // ---------- citire ----------
  function groupByName(files) {
    const m = new Map();
    for (const f of files) { if (!m.has(f.name)) m.set(f.name, []); m.get(f.name).push(f); }
    for (const [k, v] of m) m.set(k, pickPrimary(v));
    return m;
  }

  async function readManifest(metas) {
    const primary = [...metas].sort((a, b) => a.id.localeCompare(b.id))[0]; // id lexicografic minim
    const cache = store.kvGet('manifestCache');
    if (cache && cache.id === primary.id && cache.sig === sigOf(primary)) return { meta: primary, obj: cache.obj, all: metas };
    const obj = await driver.read(primary.id);
    await store.kvSet('manifestCache', { id: primary.id, sig: sigOf(primary), obj });
    return { meta: primary, obj, all: metas };
  }

  async function writeManifest(files, epoch, docId) {
    const obj = { docId, epoch, schemaVersion: SCHEMA_VERSION, appVersionMin: APP_VERSION_MIN };
    const metas = files.filter((f) => f.name === MANIFEST_NAME).sort((a, b) => a.id.localeCompare(b.id));
    let meta;
    if (metas.length) meta = await driver.update(metas[0].id, obj);
    else meta = await driver.create(MANIFEST_NAME, obj);
    await store.kvSet('manifestCache', { id: meta.id, sig: sigOf(meta), obj });
    noteClock(meta);
    return meta;
  }

  function noteClock(meta) {
    if (!meta || !meta.modifiedTime) return;
    const skew = Date.parse(meta.modifiedTime) - clock.now();
    if (Number.isFinite(skew)) {
      clockChecked = true;
      if (Math.abs(skew) > DAY_MS) { clockSkewMs = skew; emit('sync:clock', { skewMs: skew }); } else clockSkewMs = 0;
    }
  }

  /** Descarcă fișierele de date (doar cele ale căror versiuni diferă, sau toate cu `all`) și întoarce articolele. */
  async function readDataFiles(files, { all = false, epoch = null } = {}) {
    const fv = { ...(store.kvGet('fileVersions') || {}) };
    const items = [];
    const seen = {};
    const ownExtras = [];
    const byName = groupByName(files.filter((f) => FILE_RE.test(f.name)));
    for (const [name, metas] of byName) {
      const dev = FILE_RE.exec(name)[1];
      if (dev === deviceId && metas.length > 1) ownExtras.push(...metas.slice(1));
      for (const meta of metas) {
        const s = sigOf(meta);
        seen[meta.id] = s;
        if (!all && fv[meta.id] === s) continue;
        let body;
        try { body = await driver.read(meta.id); } catch (e) { if (e instanceof DriverError && e.code === 'notFound') continue; throw e; }
        if (!body || !body.records) continue;
        if ((body.schemaVersion || 1) > APP_MAX_SCHEMA) throw new StoreError('APP_TOO_OLD', 'Fișier cu schemă mai nouă.', { schemaVersion: body.schemaVersion });
        if (epoch && body.epoch && (body.epoch.no || 0) < (epoch.no || 0)) continue;
        for (const [col, arr] of Object.entries(body.records)) {
          if (!isCollection(col) || !Array.isArray(arr)) continue;
          for (const rec of arr) items.push({ col, rec });
        }
      }
    }
    return { items, seen, ownExtras };
  }

  function docFromItems(items) {
    const doc = emptyDoc();
    const maps = {};
    for (const { col, rec } of items) {
      const m = maps[col] || (maps[col] = new Map());
      const cur = m.get(rec.id);
      m.set(rec.id, cur ? mergeRecord(cur, rec, undefined, { collection: col }).rec : rec);
    }
    for (const [col, m] of Object.entries(maps)) {
      if (col === 'singletons') { for (const [id, r] of m) { const { id: _i, ...v } = r; doc.singletons[id] = v; } } else doc.collections[col] = [...m.values()];
    }
    return doc;
  }

  const hasData = (files) => files.some((f) => FILE_RE.test(f.name));

  async function pullInner() {
    const files = await driver.list();
    const byName = groupByName(files);
    const mfs = byName.get(MANIFEST_NAME);
    let localEpoch = store.kvGet('epochSeen') || null;
    let pendingManifest = false;

    if (!mfs) {
      // Prima rulare pe un cont fără manifest (list a reușit): epocă genesis.
      const epoch = localEpoch || { id: randId('ep', 8), no: 1, genesis: true };
      const docId = store.kvGet('docId') || randId('doc', 10);
      if (!localEpoch && store.hasUserData()) await store.markAllDirty();
      await writeManifest(files, epoch, docId);
      await store.kvSet('epochSeen', epoch);
      await store.kvSet('docId', docId);
      await store.kvSet('epochPending', false);
      localEpoch = epoch;
    } else {
      const { obj: manifest } = await readManifest(mfs);
      const re = manifest.epoch;
      if ((manifest.schemaVersion || 1) > APP_MAX_SCHEMA) throw new StoreError('APP_TOO_OLD', 'Manifest cu schemă mai nouă.');
      if (!localEpoch) {
        if (store.hasUserData() && hasData(files)) {
          // 4.8: ecran de alegere cu numărătoarea ambelor părți
          const { items } = await readDataFiles(files, { all: true, epoch: re });
          const remoteDoc = docFromItems(items);
          pendingChoice = { local: countsOf(store.exportDoc()), remote: countsOf(remoteDoc), remoteDoc, manifest, files };
          setStatus({ state: 'conflict', message: 'Există date și local, și pe Drive. Alege ce folosești.' });
          emit('sync:firstConnect', { local: pendingChoice.local, remote: pendingChoice.remote });
          return { files, stopped: true };
        }
        await store.kvSet('epochSeen', re);
        await store.kvSet('docId', manifest.docId);
        if (store.hasUserData()) await store.markAllDirty();
      } else {
        const cmp = epochRank(re, localEpoch);
        if (cmp > 0) {
          // epocă nouă de la distanță: salvăm local „murdarul”, apoi luăm starea de la distanță în bloc
          const pre = { filename: `flota-backup-pre-epoca-${todayIso(clock)}.json`, json: JSON.stringify(store.exportDoc()) };
          const { items, seen } = await readDataFiles(files, { all: true, epoch: re });
          await store.replaceDoc(docFromItems(items), { reason: 'remote-epoch', newEpoch: false, epoch: re, markClean: true, source: 'remote' });
          await store.kvSet('fileVersions', seen);
          await store.kvSet('docId', manifest.docId);
          await store.kvSet('epochPending', false);
          localEpoch = re;
          emit('sync:epoch', { epoch: re, backup: pre });
        } else if (cmp < 0 || store.kvGet('epochPending')) {
          pendingManifest = true; // local restaurat: manifestul se scrie înaintea datelor (în push)
        } else if (re.id !== localEpoch.id) {
          await store.kvSet('epochSeen', re); // frați genesis: adoptăm manifestul câștigător
          localEpoch = re;
        }
      }
    }

    const epoch = store.kvGet('epochSeen') || localEpoch;
    const { items, seen, ownExtras } = await readDataFiles(files, { epoch });
    if (items.length) await store.applyRemote(items, { source: 'remote' });
    const fv = { ...(store.kvGet('fileVersions') || {}), ...seen };
    await store.kvSet('fileVersions', fv);
    await store.kvSet('lastSyncedAt', iso());
    pulled = true;
    return { files, ownExtras, pendingManifest };
  }

  // ---------- scriere ----------
  function buildBuckets(closedThrough, outboxKeys) {
    /** @type {Map<string, {records:Record<string,any[]>, items:Array<{col,id,rec}>}>} */
    const buckets = new Map();
    for (const col of [...COLLECTIONS, 'singletons']) {
      for (const rec of store.rawAll(col)) {
        const key = `${col}/${rec.id}`;
        if (rec.updatedBy !== deviceId && !outboxKeys.has(key)) continue;
        const b = bucketOf(col, rec, closedThrough);
        let bk = buckets.get(b);
        if (!bk) { bk = { records: {}, items: [] }; buckets.set(b, bk); }
        (bk.records[col] || (bk.records[col] = [])).push(rec);
        bk.items.push({ col, id: rec.id, rec });
      }
    }
    for (const bk of buckets.values()) for (const arr of Object.values(bk.records)) arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return buckets;
  }

  async function pushInner(listing) {
    const { files, ownExtras = [], pendingManifest } = listing;
    const epoch = store.kvGet('epochSeen');
    const docId = store.kvGet('docId');
    if (pendingManifest || store.kvGet('epochPending')) {
      await writeManifest(files, epoch, docId);
      await store.kvSet('epochPending', false);
    }
    const outboxKeys = new Set((await store.readOutbox()).map((o) => `${o.col}/${o.id}`));
    const company = store.state().company;
    const buckets = buildBuckets(company.closedThrough || null, outboxKeys);
    const pushedSig = { ...(store.kvGet('pushedSig') || {}) };
    for (const name of Object.keys(pushedSig)) { const m = FILE_RE.exec(name); if (m && m[1] === deviceId && !buckets.has(m[2])) buckets.set(m[2], { records: {}, items: [] }); }
    const names = [...buckets.keys()].sort((a, b) => (a === 'hot') - (b === 'hot') || a.localeCompare(b)); // ani închiși înaintea lui hot
    const byName = groupByName(files);
    const fv = { ...(store.kvGet('fileVersions') || {}) };
    const synced = [];
    let wrote = false;
    for (const b of names) {
      const bk = buckets.get(b);
      const fname = fileNameFor(deviceId, b);
      const sig = fnv(stableStringify(bk.records));
      const existing = byName.get(fname)?.[0];
      const force = b === 'hot' && !clockChecked;
      if (existing && pushedSig[fname] === sig && !force) { for (const it of bk.items) synced.push(it); continue; }
      const body = {
        format: 'flota-device-file', schemaVersion: SCHEMA_VERSION, docId, epoch, deviceId, bucket: b,
        appVersion: store.appVersion, writtenAt: iso(), lastSyncedAt: iso(), records: bk.records,
      };
      let meta;
      if (existing) {
        try { meta = await driver.update(existing.id, body); } catch (e) {
          if (e instanceof DriverError && e.code === 'notFound') meta = await driver.create(fname, body); else throw e;
        }
      } else meta = await driver.create(fname, body);
      fv[meta.id] = sigOf(meta);
      pushedSig[fname] = sig;
      noteClock(meta);
      wrote = true;
      for (const it of bk.items) synced.push(it);
      await store.kvSet('fileVersions', fv);
      await store.kvSet('pushedSig', pushedSig);
    }
    for (const it of synced) if (outboxKeys.has(`${it.col}/${it.id}`)) await store.markSynced(it.col, it.id, it.rec);
    for (const extra of ownExtras) { try { await driver.remove(extra.id); } catch { /* se reîncearcă la următoarea rulare */ } }
    await store.kvSet('lastSyncedAt', iso());
    if (isLeader() || !leadership) await dailyBackup(files);
    return { wrote };
  }

  async function dailyBackup(files) {
    const today = todayIso(clock);
    if (store.kvGet('lastDriveBackup') === today) return;
    try {
      const name = `flota-backup-${today}.json.gz`;
      if (!files.some((f) => f.name === name)) await driver.create(name, store.exportDoc());
      const all = files.filter((f) => BACKUP_RE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      const excess = all.length + 1 - 14;
      for (let i = 0; i < excess; i++) { try { await driver.remove(all[i].id); } catch { /* ignorat */ } }
      await store.kvSet('lastDriveBackup', today);
    } catch { /* backup-ul zilnic nu blochează sincronizarea */ }
  }

  // ---------- reîncercare cu backoff (coada eșuată/offline se retrimite singură) ----------
  const BACKOFF_MS = [5000, 15000, 45000, 120000, 300000];
  function clearRetry() { if (retryT && timers.clearTimeout) timers.clearTimeout(retryT); retryT = null; }
  function scheduleRetry() {
    clearRetry();
    if (!started || isNone || pendingChoice || !timers.setTimeout) return;
    if (store.outbox().count === 0) return;
    if (status.state !== 'error' && status.state !== 'offline') return; // authNeeded se rezolvă la gest (auth.onChange); conflict cere alegere
    const ms = BACKOFF_MS[Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1];
    retryT = timers.setTimeout(() => { retryT = null; if (started && isLeader()) flush(); }, ms);
    if (retryT && retryT.unref) retryT.unref();
  }
  /** Un eveniment de mediu (online/focus/poll): coada nesincronizată se retrimite (flush), altfel doar se citește. */
  function tick() {
    if (!isLeader()) return;
    if (store.outbox().count > 0 || status.state === 'error' || status.state === 'offline') { failures = 0; return flush(); }
    return pullNow();
  }

  // ---------- API public ----------
  async function pullNow() {
    if (started && leadership && !leadership.isLeader()) { try { channel && channel.postMessage({ type: 'sync:request', tabId: store.tabId, what: 'pull' }); } catch { /* ignorat */ } return { skipped: 'follower' }; }
    if (store.outbox().count > 0) return flush(); // un pull simplu nu are voie să acopere o eroare cu „idle” cât timp există modificări nesincronizate
    return run(async () => {
      const r = await guarded(async () => { const l = await pullInner(); return l; });
      if (r.ok && !r.value.stopped) {
        if (store.outbox().count > 0) { setStatus({ lastSyncedAt: store.kvGet('lastSyncedAt') || null }); scheduleFlush(); } else setStatus({ state: 'idle', lastSyncedAt: store.kvGet('lastSyncedAt') || null });
      }
      return r;
    });
  }

  async function flush() {
    if (started && leadership && !leadership.isLeader()) { try { channel && channel.postMessage({ type: 'sync:request', tabId: store.tabId, what: 'flush' }); } catch { /* ignorat */ } return { skipped: 'follower' }; }
    return run(async () => {
      const r = await guarded(async () => {
        setStatus({ state: 'saving' });
        const listing = await pullInner();
        if (listing.stopped) return listing;
        if (clockSkewMs && Math.abs(clockSkewMs) > DAY_MS) { /* încă scriem datele proprii; doar generarea de recurente e refuzată */ }
        await pushInner(listing);
        return listing;
      }, { saving: true });
      if (r.ok && !r.value.stopped) { failures = 0; clearRetry(); setStatus({ state: 'idle', lastSyncedAt: store.kvGet('lastSyncedAt') || null }); }
      else if (r.error || r.skipped === 'offline') { failures++; scheduleRetry(); }
      return r;
    });
  }

  function scheduleFlush() {
    if (!started || isNone || pendingChoice) return;
    if (debounceT && timers.clearTimeout) timers.clearTimeout(debounceT);
    setStatus({}); // actualizează dirty
    if (timers.setTimeout) debounceT = timers.setTimeout(() => { debounceT = null; flush(); }, debounceMs);
  }

  /** 4.8: după alegerea utilizatorului la prima conectare cu date și local, și pe Drive. */
  async function resolveFirstConnect(choice) {
    if (!pendingChoice) return { ok: false };
    const pc = pendingChoice;
    return run(async () => {
      try {
        if (choice === 'cancel') { pendingChoice = null; stop(); setStatus({ state: 'local', message: 'Sincronizarea cu Drive a fost anulată.' }); return { ok: true }; }
        const pre = { filename: `flota-backup-pre-epoca-${todayIso(clock)}.json`, json: JSON.stringify(store.exportDoc()) };
        if (choice === 'useDrive') {
          await store.replaceDoc(pc.remoteDoc, { reason: 'use-drive', newEpoch: false, epoch: pc.manifest.epoch, markClean: true, source: 'remote' });
          await store.kvSet('docId', pc.manifest.docId);
          await store.kvSet('fileVersions', {});
          emit('sync:epoch', { epoch: pc.manifest.epoch, backup: pre });
        } else if (choice === 'replaceDrive') {
          await store.kvSet('epochSeen', pc.manifest.epoch);
          await store.kvSet('docId', pc.manifest.docId);
          await store.replaceDoc(store.exportDoc(), { reason: 'replace-drive', newEpoch: true });
        } else return { ok: false };
        pendingChoice = null;
        setStatus({ state: 'idle' });
      } catch (e) { setStatus(mapError(e)); return { ok: false, error: e }; }
      return { ok: true };
    }).then(async (r) => { if (r.ok && choice !== 'cancel') await flush(); return r; });
  }

  function start() {
    if (started) return;
    started = true;
    if (isNone) { setStatus({ state: 'local' }); return; }
    leadership = acquireLeadership(`flota-sync:${store.name}`, { locks, onLead: () => { pullNow().then(() => flush()); } });
    if (channel) offs.push(listen(channel, (m) => { if (m && m.type === 'sync:request' && m.tabId !== store.tabId && isLeader()) (m.what === 'pull' ? pullNow() : flush()); }));
    if (bus) offs.push(bus.on('store:changed', (e) => { if (e && e.source !== 'remote' && isLeader()) scheduleFlush(); }));
    if (auth && auth.onChange) offs.push(auth.onChange(() => { if (isLeader() && auth.getAccessToken() && (status.state === 'authNeeded' || !pulled)) flush(); }));
    if (env.on) for (const ev of ['focus', 'online']) offs.push(env.on(ev, () => { tick(); }));
    if (poll && timers.setInterval) pollT = timers.setInterval(() => { if (isLeader() && (!env.visible || env.visible())) tick(); }, pollMs);
    setStatus({});
  }

  function stop() {
    started = false;
    for (const off of offs.splice(0)) { try { off(); } catch { /* ignorat */ } }
    if (debounceT && timers.clearTimeout) timers.clearTimeout(debounceT);
    clearRetry();
    if (pollT && timers.clearInterval) timers.clearInterval(pollT);
    debounceT = pollT = null;
    if (leadership) leadership.release();
    leadership = null;
  }

  /** Regula 4.7 pct. 6: generarea recurentelor doar după un pull reușit în sesiune (mod Google), cu ceas valid. */
  function canGenerate() {
    if (isNone) return { ok: true, provisional: false };
    if (Math.abs(clockSkewMs) > DAY_MS) return { ok: false, reason: 'clock' };
    if (!pulled) {
      if (status.state === 'offline' || !isOnline()) return { ok: true, provisional: true }; // offline: intrările se marchează provizoriu (4.7 pct. 6)
      return { ok: false, reason: 'not-pulled' };
    }
    return { ok: true, provisional: false };
  }

  return { start, stop, flush, pullNow, status: getStatus, isLeader, canGenerate, resolveFirstConnect, isNone: () => isNone };
}
