import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../../../src/store/idb.js';
import { createStore } from '../../../src/store/store.js';
import { createFakeHub } from '../../../src/store/crosstab.js';
import { exportBackup, parseBackup, planRestore, confirmWordOk } from '../../../src/store/backup.js';
import { migrate } from '../../../src/store/migrations.js';
import { emptyDoc } from '../../../src/store/schema.js';
import { mkStore, fakeClock } from './helpers.js';
import { createBus } from './bus.js';

const entry = (id, o = {}) => ({ id, kind: 'expense', date: '2026-10-05', accrualMonth: '2026-10', amount: 100, ...o });

test('put așteaptă IDB: "fila omorâtă" după put păstrează modificarea și outbox', async () => {
  const { store, db } = await mkStore();
  await store.put('entries', entry('e1'));
  // fila „moare”: pornim un store nou pe aceeași bază
  const again = await mkStore({ db, tabId: 'tab2' });
  assert.equal(again.store.get('entries', 'e1').amount, 100);
  assert.deepEqual(again.store.outbox().ids, ['entries/e1']);
});

test('put/get/list/remove logic + stampare + undo', async () => {
  const { store, clock } = await mkStore();
  const r = await store.put('entries', entry('e1'));
  assert.equal(store.get('entries', 'e1').updatedBy, 'devA');
  assert.ok(store.get('entries', 'e1').createdAt);
  clock.advance(1000);
  await store.put('entries', entry('e1', { amount: 200 }));
  assert.equal(store.list('entries').length, 1);
  const rm = await store.remove('entries', 'e1');
  assert.equal(store.get('entries', 'e1'), undefined);
  assert.equal(store.list('entries').length, 0);
  assert.ok(store.rawGet('entries', 'e1').deletedAt, 'piatra de mormânt rămâne');
  await rm.undo();
  assert.equal(store.get('entries', 'e1').amount, 200);
  await r.undo();
  assert.equal(store.get('entries', 'e1'), undefined); // acum e șters logic (nu exista înainte)
  assert.ok(store.rawGet('entries', 'e1').deletedAt);
});

test('updatedAt crește monoton chiar la același milisecund', async () => {
  const { store } = await mkStore();
  await store.put('entries', entry('e1'));
  const a = store.get('entries', 'e1').updatedAt;
  await store.put('entries', entry('e1', { amount: 2 }));
  assert.ok(store.get('entries', 'e1').updatedAt > a);
});

test('batch: o singură tranzacție, un singur store:changed; undo restaurează totul', async () => {
  const { store, bus } = await mkStore();
  const evs = [];
  bus.on('store:changed', (e) => evs.push(e));
  const h = await store.batch('import', (tx) => { tx.put('entries', entry('a')); tx.put('entries', entry('b')); tx.put('trucks', { id: 't1', plate: 'XX00DEM' }); });
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0].collections.sort(), ['entries', 'trucks']);
  assert.equal(store.list('entries').length, 2);
  await h.undo();
  assert.equal(store.list('entries').length, 0);
  assert.equal(store.list('trucks').length, 0);
});

test('state(): referință nouă la fiecare rev, scurtături și valori implicite', async () => {
  const { store } = await mkStore();
  const s1 = store.state();
  assert.equal(s1.company.homeBase, 'Orașu Nou');
  assert.equal(s1, store.state());
  await store.put('trucks', { id: 't1', plate: 'XX00DEM' });
  const s2 = store.state();
  assert.notEqual(s1, s2);
  assert.equal(s2.trucks.length, 1);
  assert.equal(s2.collections.trucks, s2.trucks);
  assert.equal(s1.collections.entries, s2.collections.entries); // colecția neatinsă își păstrează referința
  await store.setSingleton('company', { name: 'Trans SRL' });
  assert.equal(store.state().company.name, 'Trans SRL');
  assert.equal(store.state().company.vatPayer, true);
});

test('luna închisă: respinge scrierea, permite meta, allowClosed, ștergerea', async () => {
  const { store } = await mkStore();
  await store.put('entries', entry('e1', { note: 'a' }));
  await store.setSingleton('company', { closedThrough: '2026-10' });
  assert.deepEqual(store.guardClosed(entry('x')), { code: 'CLOSED_MONTH', month: '2026-10' });
  await assert.rejects(store.put('entries', entry('e2')), (e) => e.code === 'CLOSED_MONTH' && e.month === '2026-10');
  await assert.rejects(store.put('entries', entry('e1', { amount: 5 })), { code: 'CLOSED_MONTH' });
  await assert.rejects(store.remove('entries', 'e1'), { code: 'CLOSED_MONTH' });
  await store.put('entries', entry('e1', { note: 'b', justification: 'ok' })); // metadate
  assert.equal(store.get('entries', 'e1').note, 'b');
  await store.put('entries', entry('e3', { accrualMonth: '2026-11', date: '2026-11-02' })); // luna deschisă
  await store.put('entries', entry('e4'), { allowClosed: true });
  assert.ok(store.get('entries', 'e4'));
  // batch atomic: o respingere nu scrie nimic
  await assert.rejects(store.batch('x', (tx) => { tx.put('entries', entry('e5', { accrualMonth: '2026-11', date: '2026-11-03' })); tx.put('entries', entry('e6')); }));
  assert.equal(store.get('entries', 'e5'), undefined);
});

test('remove pe intrare recurentă trece prin registrul de ocurențe', async () => {
  const { store } = await mkStore();
  await store.put('occurrences', { id: 'occ1', templateId: 'tp', period: '2026-10', targetKey: 't1', entryId: 'e1', state: 'generated', auto: true });
  await store.put('entries', entry('e1', { source: 'recurring', recurring: { templateId: 'tp', period: '2026-10', versionFrom: '2026-01' } }));
  const h = await store.remove('entries', 'e1');
  const occ = store.get('occurrences', 'occ1');
  assert.equal(occ.state, 'deleted');
  assert.equal(occ.auto, false);
  await h.undo();
  assert.equal(store.get('occurrences', 'occ1').state, 'generated');
  assert.ok(store.get('entries', 'e1'));
});

test('două file pe aceeași înregistrare: verificare rev + fuziune three-way', async () => {
  const hub = createFakeHub();
  const db = createMemoryDb('shared');
  const clock = fakeClock();
  const a = await mkStore({ db, tabId: 'A', clock, channel: hub.channel('flota:shared') });
  const b = await mkStore({ db, tabId: 'B', clock, channel: hub.channel('flota:shared') });
  await a.store.put('entries', entry('e1', { status: 'pending' }));
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(b.store.get('entries', 'e1'), 'fila B recitește din IDB după mesaj');
  // ambele editează câmpuri diferite pornind de la aceeași stare
  clock.advance(1000);
  const ra = { ...a.store.get('entries', 'e1'), amount: 111 };
  const rb = { ...b.store.get('entries', 'e1'), status: 'confirmed' };
  await a.store.put('entries', ra);
  await b.store.put('entries', rb); // rev vechi în fila B => fuziune
  const final = b.store.get('entries', 'e1');
  assert.equal(final.amount, 111);
  assert.equal(final.status, 'confirmed');
  // același câmp => CONFLICT, editorul rămâne deschis
  clock.advance(1000);
  await a.store.put('entries', { ...a.store.get('entries', 'e1'), amount: 1 });
  await assert.rejects(b.store.put('entries', { ...b.store.get('entries', 'e1'), amount: 2 }), { code: 'CONFLICT' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(b.store.get('entries', 'e1').amount, 1, 'după conflict fila B vede starea curentă');
});

test('backup round-trip + replaceDoc cu epocă nouă', async () => {
  const { store } = await mkStore();
  await store.put('trucks', { id: 't1', plate: 'XX00DEM' });
  await store.put('entries', entry('e1'));
  await store.remove('entries', 'e1');
  await store.setSingleton('company', { name: 'ACME' });
  const { filename, json } = exportBackup(store, { now: new Date(2026, 10, 18, 9, 5) });
  assert.equal(filename, 'flota-backup-2026-11-18-0905.json');
  const p = parseBackup(json);
  assert.ok(p.ok);
  assert.equal(p.doc.singletons.company.name, 'ACME');
  assert.equal(p.doc.collections.entries[0].deletedAt !== undefined, true, 'pietrele de mormânt intră în backup');
  assert.equal(parseBackup('nu e json').ok, false);
  assert.equal(parseBackup(JSON.stringify({ a: 1 })).ok, false);

  const other = await mkStore({ db: createMemoryDb('o'), deviceId: 'devB' });
  await other.store.put('trucks', { id: 'zz', plate: 'X' });
  const plan = planRestore(other.store, p.doc);
  assert.equal(plan.mode, 'newEpoch');
  assert.equal(plan.counts.incoming.trucks, 1);
  assert.equal(plan.counts.current.trucks, 1);
  await other.store.replaceDoc(p.doc, { reason: 'restore', newEpoch: true });
  assert.equal(other.store.get('trucks', 'zz'), undefined);
  assert.equal(other.store.get('trucks', 't1').plate, 'XX00DEM');
  assert.equal(other.store.kvGet('epochSeen').no, 1);
  assert.equal(other.store.kvGet('epochPending'), true);
  assert.equal(other.store.outbox().count > 0, true);
  const again = await mkStore({ db: other.db, tabId: 'x' });
  assert.equal(again.store.get('trucks', 't1').plate, 'XX00DEM');
  assert.equal(confirmWordOk('restaureaza'), true);
  assert.equal(confirmWordOk('da'), false);
});

test('migrare: schemă prea nouă => APP_TOO_OLD; document invalid => BAD_DOC', () => {
  const d = emptyDoc();
  assert.equal(migrate(d).migrated, false);
  assert.throws(() => migrate({ ...d, schemaVersion: 99 }), { code: 'APP_TOO_OLD' });
  assert.throws(() => migrate({ nu: 'doc' }), { code: 'BAD_DOC' });
  const r = parseBackup(JSON.stringify({ format: 'flota-backup', doc: { ...d, schemaVersion: 99 } }));
  assert.equal(r.ok, false);
});

test('colecție necunoscută', async () => {
  const { store } = await mkStore();
  await assert.rejects(store.put('nope', { id: 'x' }), { code: 'UNKNOWN_COLLECTION' });
});
