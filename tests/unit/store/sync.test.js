import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../../../src/store/idb.js';
import { createSync, fileNameFor, MANIFEST_NAME, bucketOf } from '../../../src/store/sync.js';
import { createFakeCloud } from '../../../src/store/drivers/fake-drive.js';
import { createFakeHub } from '../../../src/store/crosstab.js';
import { mkStore, fakeClock } from './helpers.js';

const entry = (id, o = {}) => ({ id, kind: 'expense', date: '2026-10-05', accrualMonth: '2026-10', amount: 100, status: 'pending', ...o });
const okAuth = { getAccessToken: () => 'tok', onChange: () => () => {} };

async function device(cloud, deviceId, { clock, auth = okAuth } = {}) {
  const m = await mkStore({ db: createMemoryDb('d-' + deviceId), deviceId, tabId: 't-' + deviceId, clock });
  const driver = cloud.driver({ label: deviceId });
  const sync = createSync({ store: m.store, driver, auth, bus: m.bus, clock: m.clock, poll: false });
  return { ...m, driver, sync };
}

test('prima rulare: manifest genesis + fișiere proprii; alt dispozitiv primește datele', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  await A.store.put('trucks', { id: 't1', plate: 'XX00DEM' });
  await A.store.put('entries', entry('e1'));
  await A.sync.flush();
  const names = [...cloud.files.values()].map((f) => f.meta.name).sort();
  assert.deepEqual(names, [MANIFEST_NAME, fileNameFor('devA', 'hot'), 'flota-backup-2026-11-18.json.gz'].sort()); // + backup zilnic
  assert.equal(A.store.outbox().count, 0);
  assert.equal(A.sync.status().state, 'idle');

  const B = await device(cloud, 'devB', { clock });
  await B.sync.pullNow();
  assert.equal(B.store.get('entries', 'e1').amount, 100);
  assert.equal(B.store.get('trucks', 't1').plate, 'XX00DEM');
  assert.equal(B.store.kvGet('epochSeen').no, 1);
  assert.equal(B.sync.canGenerate().ok, true);
});

test('două dispozitive cu scrieri intercalate: câmpuri diferite se păstrează, același câmp = 1 conflict', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  const B = await device(cloud, 'devB', { clock });
  await A.store.put('entries', entry('e1'));
  await A.sync.flush();
  await B.sync.pullNow();
  clock.advance(1000);
  await A.store.put('entries', { ...A.store.get('entries', 'e1'), amount: 555 });
  clock.advance(1000);
  await B.store.put('entries', { ...B.store.get('entries', 'e1'), status: 'confirmed' });
  await A.sync.flush(); // A scrie
  await B.sync.flush(); // B pull (fuziune) + push
  await A.sync.flush();
  for (const d of [A, B]) {
    const e = d.store.get('entries', 'e1');
    assert.equal(e.amount, 555, d.store.deviceId);
    assert.equal(e.status, 'confirmed', d.store.deviceId);
  }
  assert.equal(B.store.conflictLog().length, 0);
  // același câmp
  clock.advance(1000);
  await A.store.put('entries', { ...A.store.get('entries', 'e1'), amount: 1 });
  clock.advance(1000);
  await B.store.put('entries', { ...B.store.get('entries', 'e1'), amount: 2 });
  await A.sync.flush();
  await B.sync.flush();
  await A.sync.flush();
  assert.equal(A.store.get('entries', 'e1').amount, 2);
  assert.equal(B.store.get('entries', 'e1').amount, 2);
  assert.equal(B.store.conflictLog().length, 1);
  assert.equal(A.store.outbox().count, 0);
  assert.equal(B.store.outbox().count, 0);
});

test('ștergere propagată; dispozitiv vechi nu învie ștersul', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  const B = await device(cloud, 'devB', { clock });
  await A.store.put('entries', entry('e1'));
  await A.sync.flush();
  await B.sync.pullNow();
  clock.advance(100 * 86400000); // 100 de zile
  await A.store.remove('entries', 'e1');
  await A.sync.flush();
  await B.sync.flush(); // B nu a atins nimic: ia piatra de mormânt
  assert.equal(B.store.get('entries', 'e1'), undefined);
  await A.sync.flush();
  assert.equal(A.store.get('entries', 'e1'), undefined);
  assert.ok(A.store.rawGet('entries', 'e1').deletedAt);
});

test('list eșuat nu creează fișiere; offline => state offline; fără token => authNeeded cu outbox păstrat', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  await A.store.put('entries', entry('e1'));
  A.driver.state.listFail = true;
  await A.sync.flush();
  assert.equal(cloud.files.size, 0);
  assert.equal(A.sync.status().state, 'error');
  A.driver.state.listFail = false;
  A.driver.setOffline(true);
  await A.sync.flush();
  assert.equal(A.sync.status().state, 'offline');
  assert.equal(cloud.files.size, 0);
  A.driver.setOffline(false);
  A.driver.failNext('auth', 401);
  await A.sync.flush();
  assert.equal(A.sync.status().state, 'authNeeded');
  assert.equal(A.store.outbox().count, 1, 'coada nu se pierde');
  await A.sync.flush();
  assert.equal(A.sync.status().state, 'idle');
  assert.equal(A.store.outbox().count, 0);
  const noTok = await device(cloud, 'devC', { clock, auth: { getAccessToken: () => null, onChange: () => () => {} } });
  await noTok.sync.flush();
  assert.equal(noTok.sync.status().state, 'authNeeded');
});

test('canGenerate: refuzat înainte de pull; ceas greșit refuzat', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  assert.deepEqual(A.sync.canGenerate(), { ok: false, reason: 'not-pulled' });
  A.driver.state.clockSkewMs = 3 * 86400000; // Drive vede alt timp decât dispozitivul
  await A.store.put('entries', entry('e1'));
  await A.sync.flush();
  assert.equal(A.sync.canGenerate().ok, false);
  assert.equal(A.sync.canGenerate().reason, 'clock');
});

test('fișiere duplicate ale propriului dispozitiv: se fuzionează și extra se șterge', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  await A.store.put('entries', entry('e1'));
  await A.sync.flush();
  const primary = [...cloud.files.values()].find((f) => f.meta.name === fileNameFor('devA', 'hot'));
  const body = JSON.parse(primary.text);
  cloud.injectDuplicate(fileNameFor('devA', 'hot'), { ...body, records: { entries: [entry('e2', { updatedAt: '2026-10-06T00:00:00.000Z', updatedBy: 'devA', createdAt: '2026-10-06T00:00:00.000Z' })] } }, 5000);
  await A.store.put('entries', entry('e3'));
  await A.sync.flush();
  assert.ok(A.store.get('entries', 'e2'), 'conținutul duplicatului a fost fuzionat');
  const hot = [...cloud.files.values()].filter((f) => f.meta.name === fileNameFor('devA', 'hot'));
  assert.equal(hot.length, 1);
  const stored = JSON.parse(hot[0].text);
  assert.ok(stored.records.entries.find((r) => r.id === 'e2'));
});

test('epocă nouă: restaurarea rămâne restaurată pe celălalt dispozitiv; „murdarul” se salvează în backup', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  const B = await device(cloud, 'devB', { clock });
  await A.store.put('entries', entry('old'));
  await A.sync.flush();
  await B.sync.pullNow();
  await B.store.put('entries', entry('dirtyB')); // nesincronizat pe B
  // A restaurează un backup fără 'old'
  const doc = A.store.exportDoc();
  doc.collections.entries = [];
  doc.collections.trucks = [{ id: 'tr', plate: 'XX00DEM', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'x' }];
  await A.store.replaceDoc(doc, { reason: 'restore', newEpoch: true });
  assert.equal(A.store.kvGet('epochSeen').no, 2);
  await A.sync.flush();
  const backups = [];
  B.bus.on('sync:epoch', (p) => backups.push(p.backup));
  await B.sync.flush();
  assert.equal(B.store.get('entries', 'old'), undefined);
  assert.equal(B.store.get('entries', 'dirtyB'), undefined, 'starea de la distanță înlocuiește local');
  assert.ok(B.store.get('trucks', 'tr'));
  assert.equal(B.store.kvGet('epochSeen').no, 2);
  assert.equal(backups.length, 1);
  assert.ok(JSON.parse(backups[0].json).collections.entries.some((e) => e.id === 'dirtyB'));
  // un fișier vechi din epoca 1 reapărut nu mai e luat în seamă
  await B.sync.flush();
  assert.equal(B.store.get('entries', 'old'), undefined);
});

test('prima conectare cu date și local, și pe Drive: alegere explicită (Folosește Drive)', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  await A.store.put('entries', entry('drive1'));
  await A.sync.flush();
  const L = await device(cloud, 'devL', { clock });
  await L.store.put('entries', entry('local1'));
  const asked = [];
  L.bus.on('sync:firstConnect', (p) => asked.push(p));
  await L.sync.flush();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].local.entries, 1);
  assert.equal(asked[0].remote.entries, 1);
  assert.equal(L.sync.status().state, 'conflict');
  assert.equal(L.store.get('entries', 'drive1'), undefined, 'niciun merge automat');
  await L.sync.resolveFirstConnect('useDrive');
  assert.ok(L.store.get('entries', 'drive1'));
  assert.equal(L.store.get('entries', 'local1'), undefined);
});

test('prima conectare: „Înlocuiește Drive” creează epocă nouă', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  await A.store.put('entries', entry('drive1'));
  await A.sync.flush();
  const L = await device(cloud, 'devL', { clock });
  await L.store.put('entries', entry('local1'));
  await L.sync.flush();
  await L.sync.resolveFirstConnect('replaceDrive');
  assert.equal(L.store.kvGet('epochSeen').no, 2);
  await A.sync.flush();
  assert.equal(A.store.get('entries', 'drive1'), undefined);
  assert.ok(A.store.get('entries', 'local1'));
});

test('bucketOf: anii cu toate lunile închise merg în fișierul anului', () => {
  assert.equal(bucketOf('entries', { accrualMonth: '2025-05' }, '2025-12'), '2025');
  assert.equal(bucketOf('entries', { accrualMonth: '2025-05' }, '2025-11'), 'hot');
  assert.equal(bucketOf('trucks', { accrualMonth: '2025-05' }, '2026-12'), 'hot');
  assert.equal(bucketOf('gpsTrips', { start: '2025-03-04T10:00:00' }, '2026-01'), '2025');
});

test('an închis: înregistrările se scriu în fișierul anului, nu în hot', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await device(cloud, 'devA', { clock });
  await A.store.put('entries', entry('old', { date: '2025-03-01', accrualMonth: '2025-03' }));
  await A.store.put('entries', entry('new'));
  await A.store.setSingleton('company', { closedThrough: '2025-12' });
  await A.sync.flush();
  const names = [...cloud.files.values()].map((f) => f.meta.name);
  assert.ok(names.includes(fileNameFor('devA', '2025')));
  const y = JSON.parse([...cloud.files.values()].find((f) => f.meta.name === fileNameFor('devA', '2025')).text);
  assert.deepEqual(y.records.entries.map((e) => e.id), ['old']);
  const B = await device(cloud, 'devB', { clock });
  await B.sync.pullNow();
  assert.ok(B.store.get('entries', 'old') && B.store.get('entries', 'new'));
});

test('mod local (driver none): status local, nicio cerere', async () => {
  const { createNoneDriver } = await import('../../../src/store/drivers/none.js');
  const m = await mkStore();
  const sync = createSync({ store: m.store, driver: createNoneDriver(), auth: null, bus: m.bus, clock: m.clock });
  sync.start();
  await sync.flush();
  assert.equal(sync.status().state, 'local');
  assert.equal(sync.canGenerate().ok, true);
});

test('lider: doar o filă sincronizează; fila secundară cere liderului', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const hub = createFakeHub();
  const db = createMemoryDb('shared-sync');
  // hub.locks() trebuie partajat: refolosim aceeași instanță
  const locks = hub.locks();
  const mk2 = async (tabId) => {
    const chan = hub.channel('flota:shared-sync');
    const m = await mkStore({ db, deviceId: 'devA', tabId, clock, channel: chan });
    const sync = createSync({ store: m.store, driver: cloud.driver(), auth: okAuth, bus: m.bus, clock, locks, channel: chan, poll: false, debounceMs: 1 });
    return { ...m, sync };
  };
  const t1 = await mk2('T1');
  const t2 = await mk2('T2');
  t1.sync.start(); t2.sync.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t1.sync.isLeader(), true);
  assert.equal(t2.sync.isLeader(), false);
  await t2.store.put('entries', entry('fromT2'));
  await new Promise((r) => setTimeout(r, 80));
  const names = [...cloud.files.values()].map((f) => f.meta.name);
  assert.ok(names.includes(fileNameFor('devA', 'hot')), 'liderul a împins modificarea făcută în cealaltă filă');
  assert.equal(t1.store.get('entries', 'fromT2')?.amount, 100);
  t1.sync.stop(); t2.sync.stop();
});

// ---------- regresie QA: coada eșuată/offline se retrimite (online/poll/backoff); pull-ul nu acoperă eroarea cu „idle” ----------
function fakeTimers() {
  const q = []; let id = 0; const ints = [];
  return {
    setTimeout: (fn, ms) => { const h = { id: ++id, fn, ms }; q.push(h); return h; },
    clearTimeout: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    setInterval: (fn, ms) => { const h = { id: ++id, fn, ms }; ints.push(h); return h; },
    clearInterval: (h) => { const i = ints.indexOf(h); if (i >= 0) ints.splice(i, 1); },
    pending: () => q.map((h) => h.ms),
    fireTimeout: async () => { const h = q.shift(); if (h) await h.fn(); },
    fireInterval: async () => { for (const h of [...ints]) await h.fn(); },
  };
}
function fakeEnv() {
  const hs = {};
  return { on: (n, fn) => { (hs[n] = hs[n] || []).push(fn); return () => {}; }, visible: () => true, fire: async (n) => { for (const f of hs[n] || []) await f(); } };
}
async function liveDevice(cloud, id, clock) {
  const m = await mkStore({ db: createMemoryDb('d-' + id), deviceId: id, tabId: 't-' + id, clock });
  const driver = cloud.driver({ label: id });
  const timers = fakeTimers(); const env = fakeEnv();
  const sync = createSync({ store: m.store, driver, auth: okAuth, bus: m.bus, clock: m.clock, timers, env, debounceMs: 10, pollMs: 60000 });
  return { ...m, driver, sync, timers, env };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('regresie: eveniment online retrimite coada eșuată (env conectat)', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await liveDevice(cloud, 'devA', clock);
  A.sync.start(); await settle();
  await A.store.put('entries', entry('e1'));
  A.driver.setOffline(true);
  await A.sync.flush();
  assert.equal(A.sync.status().state, 'offline');
  assert.equal(A.store.outbox().count, 1);
  A.driver.setOffline(false);
  await A.env.fire('online'); await settle();
  assert.equal(A.sync.status().state, 'idle');
  assert.equal(A.store.outbox().count, 0);
  A.sync.stop();
});

test('regresie: poll-ul cu coadă nesincronizată face flush, nu doar pull; eroarea nu devine „idle” cu dirty>0', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await liveDevice(cloud, 'devA', clock);
  A.sync.start(); await settle();
  await A.store.put('entries', entry('e1'));
  A.driver.state.listFail = true;
  await A.sync.flush();
  assert.equal(A.sync.status().state, 'error');
  // pullNow direct (ca din poll vechi) nu are voie să lase „idle” cu dirty=1
  await A.sync.pullNow();
  assert.notEqual(A.sync.status().state, 'idle');
  assert.equal(A.store.outbox().count, 1);
  A.driver.state.listFail = false;
  await A.timers.fireInterval(); await settle();
  assert.equal(A.sync.status().state, 'idle');
  assert.equal(A.store.outbox().count, 0);
  A.sync.stop();
});

test('regresie: backoff exponențial programează reîncercarea și coada se golește la revenirea rețelei', async () => {
  const clock = fakeClock();
  const cloud = createFakeCloud({ clock });
  const A = await liveDevice(cloud, 'devA', clock);
  A.sync.start(); await settle();
  await A.store.put('entries', entry('e1'));
  await A.timers.fireTimeout(); // debounce-ul scrierii inițiale (dacă există)
  await settle();
  await A.store.put('entries', entry('e2'));
  A.driver.state.listFail = true;
  await A.sync.flush();
  assert.deepEqual(A.timers.pending().slice(-1), [5000]);
  await A.timers.fireTimeout(); await settle(); // reîncercarea eșuează din nou => 15 s
  assert.deepEqual(A.timers.pending().slice(-1), [15000]);
  A.driver.state.listFail = false;
  await A.timers.fireTimeout(); await settle();
  assert.equal(A.sync.status().state, 'idle');
  assert.equal(A.store.outbox().count, 0);
  assert.equal(A.timers.pending().length, 0, 'fără reîncercări rămase după succes');
  A.sync.stop();
});
