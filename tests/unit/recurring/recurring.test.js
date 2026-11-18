import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planOccurrences, runCatchUp, skipPeriod, deleteRecurringEntry, changeAmountFrom, endTemplate, confirmAllPending,
  summaryForMonth, copyPreviousMonth, regenerateUnconfirmed, occurrenceId, targetKeysFor,
} from '../../../src/domain/recurring.js';
import { createMemStore, createFakeFx, mkTruck, mkTemplate, versionEvent, NONE_VAT } from './_memstore.js';

const NOW = '2026-11-18T08:00:00.000Z';
const TODAY = '2026-11-18';
const seedWith = (tpls, evs, extra = {}) => ({
  company: { countryCode: 'RO', vatPayer: true, ...(extra.company || {}) },
  collections: {
    trucks: extra.trucks || [mkTruck('t1')], templates: tpls, templateEvents: evs,
    categories: [{ id: 'cat_leasing', name: 'Leasing', kind: 'expense' }], countries: [], ...(extra.collections || {}),
  },
});
const run = (store, over = {}) => runCatchUp({ store, fx: createFakeFx(), today: TODAY, now: NOW, ...over });
const liveEntries = (store) => store.all('entries').filter((e) => !e.deletedAt);

test('planOccurrences: ziua 31 se clampează (28/29/30) și anul bisect', () => {
  const tpl = mkTemplate({ dayOfMonth: 31, startDate: '2028-01-01', backfillFrom: '2028-01' });
  const evs = [versionEvent(tpl.id, '2028-01', {})];
  const plan = planOccurrences(tpl, '2028-05-31', evs);
  assert.deepEqual(plan.map((p) => p.date), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']);
  const plan25 = planOccurrences({ ...tpl, startDate: '2027-01-01', backfillFrom: '2027-01' }, '2027-03-31', [versionEvent(tpl.id, '2027-01', {})]);
  assert.equal(plan25[1].date, '2027-02-28');
});

test('planOccurrences: apariții cu data > azi nu se generează; trimestrial / anual', () => {
  const q = mkTemplate({ frequency: 'quarterly', startDate: '2026-01-10', dayOfMonth: 10, backfillFrom: '2026-01' });
  const ev = [versionEvent(q.id, '2026-01', {})];
  assert.deepEqual(planOccurrences(q, '2026-10-09', ev).map((p) => p.period), ['2026-01', '2026-04', '2026-07']);
  assert.deepEqual(planOccurrences(q, '2026-10-10', ev).map((p) => p.period), ['2026-01', '2026-04', '2026-07', '2026-10']);
  const y = mkTemplate({ frequency: 'yearly', startDate: '2024-03-01', dayOfMonth: 1, backfillFrom: '2024-03' });
  assert.deepEqual(planOccurrences(y, '2026-11-18', [versionEvent(y.id, '2024-03', {})]).map((p) => p.period), ['2024-03', '2025-03', '2026-03']);
});

test('catch-up: 4 luni lipsă => 4 intrări; a doua rulare => 0', async () => {
  const tpl = mkTemplate({ startDate: '2026-07-01', backfillFrom: '2026-07' });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-07', {})]));
  const r1 = await run(store);
  const n = planOccurrences(tpl, TODAY, [versionEvent(tpl.id, '2026-07', {})]).length;
  assert.equal(n, 5); // iul, aug, sep, oct, nov (nov-05 <= 18)
  assert.equal(r1.created.length, 5);
  assert.deepEqual(r1.errors, []);
  const e = r1.created[0];
  assert.equal(e.status, 'auto_pending');
  assert.equal(e.source, 'recurring');
  assert.equal(e.recurring.templateId, tpl.id);
  assert.equal(e.id, occurrenceId(tpl, '2026-07', 't1'));
  const r2 = await run(store);
  assert.equal(r2.created.length, 0);
  assert.equal(r2.existing, 5);
  assert.equal(liveEntries(store).length, 5);
});

test('idempotență pe două dispozitive: aceleași id-uri, o singură intrare după uniune', async () => {
  const tpl = mkTemplate({ startDate: '2026-09-01', backfillFrom: '2026-09' });
  const seed = seedWith([tpl], [versionEvent(tpl.id, '2026-09', {})]);
  const a = createMemStore(seed), b = createMemStore(seed);
  await run(a, { deviceId: 'devA' }); await run(b, { deviceId: 'devB' });
  const ids = (s) => s.all('entries').map((e) => e.id).sort();
  assert.deepEqual(ids(a), ids(b));
  assert.equal(new Set([...ids(a), ...ids(b)]).size, ids(a).length);
  assert.deepEqual(a.all('occurrences').map((o) => o.id).sort(), b.all('occurrences').map((o) => o.id).sort());
});

test('schimbare de sumă la mijlocul anului nu rescrie istoria', async () => {
  const tpl = mkTemplate({ startDate: '2026-01-01', backfillFrom: '2026-01' });
  const evs = [versionEvent(tpl.id, '2026-01', { minor: 100000 })];
  const store = createMemStore(seedWith([tpl], evs));
  // primele 6 luni generate cu suma veche
  await run(store, { today: '2026-06-30' });
  assert.equal(liveEntries(store).length, 6);
  const m = changeAmountFrom(store, tpl.id, '2026-07', evs[0].payload && { ...evs[0].payload, minor: 120000 }, { now: NOW });
  await m.done;
  await run(store);
  const byPeriod = Object.fromEntries(liveEntries(store).map((e) => [e.recurring.period, e.orig.gross]));
  for (const p of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) assert.equal(byPeriod[p], 100000, p);
  for (const p of ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']) assert.equal(byPeriod[p], 120000, p);
});

test('changeAmountFrom: intrările neconfirmate deja generate pot fi regenerate; cele confirmate nu', async () => {
  const tpl = mkTemplate({ startDate: '2026-09-01', backfillFrom: '2026-09' });
  const evs = [versionEvent(tpl.id, '2026-09', { minor: 100000 })];
  const store = createMemStore(seedWith([tpl], evs));
  await run(store);
  // confirmă septembrie
  const sept = store.all('entries').find((e) => e.recurring.period === '2026-09');
  await store.put('entries', { ...sept, status: 'confirmed' });
  const m = changeAmountFrom(store, tpl.id, '2026-09', { ...evs[0].payload, minor: 90000 }, { now: NOW });
  await m.done;
  assert.equal(m.affected.length, 2); // oct + nov; sept confirmat exclus
  assert.ok(!m.affected.includes(sept.id));
  const res = await regenerateUnconfirmed({ store, fx: createFakeFx(), today: TODAY, now: NOW }, tpl.id, '2026-09');
  assert.equal(res.errors.length, 0);
  const now = Object.fromEntries(liveEntries(store).map((e) => [e.recurring.period, e.orig.gross]));
  assert.equal(now['2026-09'], 100000);
  assert.equal(now['2026-10'], 90000);
  assert.equal(now['2026-11'], 90000);
});

test('șablon încheiat nu generează după final; apariții anterioare rămân', async () => {
  const tpl = mkTemplate({ startDate: '2026-01-01', backfillFrom: '2026-01', dayOfMonth: 15 });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-01', {})]));
  await run(store, { today: '2026-06-30' });
  await endTemplate(store, tpl.id, '2026-06-30', { now: NOW }).done;
  const r = await run(store);
  assert.equal(r.created.length, 0);
  assert.equal(liveEntries(store).length, 6);
  // reactivare
  await endTemplate(store, tpl.id, null, { now: '2026-11-18T09:00:00.000Z' }).done;
  const r2 = await run(store);
  assert.ok(r2.created.length >= 4); // iul..nov
});

test('skipPeriod: șterge intrarea existentă și nu o recreează; ștergerea din ledger nu regenerează', async () => {
  const tpl = mkTemplate({ startDate: '2026-01-01', backfillFrom: '2026-01' });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-01', {})]));
  await run(store, { today: '2026-04-30' });
  const sk = skipPeriod(store, tpl.id, '2026-03', { now: NOW });
  await sk.done;
  assert.equal(liveEntries(store).filter((e) => e.recurring.period === '2026-03').length, 0);
  const del = store.all('entries').find((e) => e.recurring.period === '2026-02');
  const d = deleteRecurringEntry(store, del.id, { now: NOW });
  await d.done;
  const r = await run(store);
  assert.equal(r.created.filter((e) => ['2026-02', '2026-03'].includes(e.recurring.period)).length, 0);
  assert.equal(store.raw('occurrences', store.all('occurrences').find((o) => o.period === '2026-02').id).state, 'deleted');
  assert.equal(store.all('occurrences').find((o) => o.period === '2026-03').state, 'skipped');
  // undo readuce intrarea ștearsă
  await d.undo();
  assert.ok(store.get('entries', del.id));
});

test('skipPeriod înainte de generare: ocurența e marcată skipped, fără intrare', async () => {
  const tpl = mkTemplate({ startDate: '2026-09-01', backfillFrom: '2026-09' });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-09', {})]));
  await skipPeriod(store, tpl.id, '2026-10', { now: NOW }).done;
  const r = await run(store);
  assert.equal(r.created.length, 2); // sep, nov
  assert.equal(r.created.some((e) => e.recurring.period === '2026-10'), false);
});

test('flotă împărțită egal: 7 camioane, 1.000,00 lei => 142,86 x5 + 142,85 x2; camion inactiv exclus', async () => {
  const trucks = Array.from({ length: 7 }, (_, i) => mkTruck(`t${i + 1}`));
  trucks.push(mkTruck('tx', { activeTo: '2025-12-31' }));
  const tpl = mkTemplate({ target: { type: 'fleet', truckIds: [] }, startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-11', { minor: 100000 })], { trucks }));
  const r = await run(store);
  assert.equal(r.created.length, 7);
  const parts = r.created.map((e) => e.orig.gross).sort((a, b) => b - a);
  assert.deepEqual(parts, [14286, 14286, 14286, 14286, 14286, 14285, 14285]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100000);
  assert.equal(r.created.every((e) => e.target.type === 'truck'), true);
  assert.equal(new Set(r.created.map((e) => e.groupId)).size, 1);
  assert.deepEqual(targetKeysFor(tpl), ['fleet']);
  // idempotent
  assert.equal((await run(store)).created.length, 0);
});

test('mai multe camioane cu sume per camion; totalul facturii trebuie să bată la ban', async () => {
  const trucks = [mkTruck('t1'), mkTruck('t2')];
  const tpl = mkTemplate({ target: { type: 'trucks', truckIds: ['t1', 't2'] }, startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1, totalMinor: 30000 });
  const ok = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-11', { minor: 0, perTruck: { t1: 10000, t2: 20000 } })], { trucks }));
  const r = await run(ok);
  assert.deepEqual(r.created.map((e) => e.orig.gross).sort((a, b) => a - b), [10000, 20000]);
  const bad = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-11', { minor: 0, perTruck: { t1: 10000, t2: 19999 } })], { trucks }));
  const rb = await run(bad);
  assert.equal(rb.created.length, 0);
  assert.equal(rb.errors.length, 2);
});

test('trimestrial/anual: spread automat; spreadMonths=12 explicit', async () => {
  const q = mkTemplate({ id: 'tpl_q', frequency: 'quarterly', startDate: '2026-01-10', dayOfMonth: 10, backfillFrom: '2026-01' });
  const y = mkTemplate({ id: 'tpl_y', name: 'CASCO', frequency: 'yearly', startDate: '2026-03-01', dayOfMonth: 1, backfillFrom: '2026-03', spreadMonths: 12 });
  const store = createMemStore(seedWith([q, y], [versionEvent('tpl_q', '2026-01', {}), versionEvent('tpl_y', '2026-03', { minor: 600000 })]));
  const r = await run(store);
  const cas = r.created.find((e) => e.recurring.templateId === 'tpl_y');
  assert.deepEqual(cas.spread, { from: '2026-03', to: '2027-02' });
  assert.equal(cas.orig.gross, 600000); // intrarea rămâne întreagă
  const qs = r.created.filter((e) => e.recurring.templateId === 'tpl_q');
  assert.equal(qs.length, 4);
  assert.deepEqual(qs[0].spread, { from: '2026-01', to: '2026-03' });
});

test('valută: fiecare apariție are propriul curs la data ei; HUF fără zecimale', async () => {
  const tpl = mkTemplate({ startDate: '2026-09-01', backfillFrom: '2026-09', dayOfMonth: 1 });
  const rates = { EUR: (d) => ({ '2026-09-01': '5.0000', '2026-10-01': '5.1000', '2026-11-01': '5.2000' }[d]) };
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-09', { currency: 'EUR', minor: 10000 })]));
  const r = await run(store, { fx: createFakeFx(rates) });
  const ron = Object.fromEntries(r.created.map((e) => [e.recurring.period, e.ron.gross]));
  assert.deepEqual(ron, { '2026-09': 50000, '2026-10': 51000, '2026-11': 52000 });
  const huf = mkTemplate({ id: 'tpl_h', startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const s2 = createMemStore(seedWith([huf], [versionEvent('tpl_h', '2026-11', { currency: 'HUF', minor: 150000 })]));
  const r2 = await run(s2);
  assert.equal(r2.created[0].orig.gross, 150000);
  assert.equal(r2.created[0].ron.gross, 220200); // 150000 HUF x 0,01468 = 2.202,00 lei
});

test('curs lipsă: eroare raportată, nimic scris pentru acea perioadă', async () => {
  const tpl = mkTemplate({ startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-11', { currency: 'PLN', minor: 1000 })]));
  const r = await run(store);
  assert.equal(r.created.length, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(store.all('occurrences').length, 0);
});

test('maxim 6 perioade pe șablon pe rulare; peste, cere confirmare', async () => {
  const tpl = mkTemplate({ startDate: '2025-01-01', backfillFrom: '2025-01' });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2025-01', {})]));
  const r = await run(store);
  assert.equal(r.created.length, 0);
  assert.equal(r.pendingConfirmation.length, 1);
  assert.equal(r.pendingConfirmation[0].missing, 23);
  const r2 = await run(store, { confirmOver: [tpl.id] });
  assert.equal(r2.created.length, 23);
});

test('ceas greșit (2030) refuzat; ceas dat înapoi față de datele existente refuzat', async () => {
  const tpl = mkTemplate({ startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-11', {})]));
  const bad = await run(store, { today: '2030-01-01', now: '2030-01-01T00:00:00.000Z', referenceDate: '2026-11-18' });
  assert.equal(bad.blocked, 'clock');
  assert.equal(store.all('entries').length, 0);
  await run(store); // generează normal (updatedAt = 2026-11-18)
  const back = await run(store, { today: '2026-01-01', now: '2026-01-01T00:00:00.000Z' });
  assert.equal(back.blocked, 'clock');
});

test('dispozitiv vechi de > 90 de zile sau fără pull în mod Google nu generează', async () => {
  const tpl = mkTemplate({ startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-11', {})]));
  assert.equal((await run(store, { requirePull: true, pulledOk: false })).blocked, 'no-pull');
  assert.equal((await run(store, { deviceLastSyncedAt: '2026-06-01T00:00:00Z' })).blocked, 'stale-device');
  const ok = await run(store, { deviceLastSyncedAt: '2026-06-01T00:00:00Z', pulledOk: true });
  assert.equal(ok.blocked, null);
  assert.equal(ok.created.length, 1);
});

test('lună închisă: apariția devine propunere în luna deschisă, aferent lunii X', async () => {
  const tpl = mkTemplate({ startDate: '2026-09-01', backfillFrom: '2026-09', dayOfMonth: 5 });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-09', {})], { company: { closedThrough: '2026-09' } }));
  const r = await run(store);
  assert.equal(r.redirected, 1);
  const sept = r.created.find((e) => e.recurring.period === '2026-09');
  assert.equal(sept.accrualMonth, '2026-10');
  assert.equal(sept.relatesTo, '2026-09');
  assert.equal(sept.status, 'auto_pending');
  const oct = r.created.find((e) => e.recurring.period === '2026-10');
  assert.equal(oct.accrualMonth, '2026-10');
});

test('offline: intrările sunt provisional; după pull reușit se regenerează dacă nu sunt editate', async () => {
  const tpl = mkTemplate({ startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const evs = [versionEvent(tpl.id, '2026-11', { currency: 'EUR', minor: 10000 })];
  const store = createMemStore(seedWith([tpl], evs));
  const r = await run(store, { offline: true, fx: createFakeFx({ EUR: '5.0000' }) });
  assert.equal(r.created[0].recurring.provisional, true);
  assert.equal(r.created[0].ron.gross, 50000);
  const r2 = await run(store, { pulledOk: true, requirePull: true, fx: createFakeFx({ EUR: '5.3442' }) });
  assert.equal(r2.refreshed, 1);
  const e = liveEntries(store)[0];
  assert.equal(e.recurring.provisional, false);
  assert.equal(e.ron.gross, 53442);
  assert.equal(liveEntries(store).length, 1);
});

test('finanțare: componente separate, principal cashOnly, dobânda cost; leasing operațional = rata întreagă', async () => {
  const comps = [{ kind: 'principal', minor: 80000 }, { kind: 'interest', minor: 15000 }, { kind: 'fees', minor: 5000 }];
  const tpl = mkTemplate({ financingId: 'fin1', startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const evs = [versionEvent(tpl.id, '2026-11', { minor: 100000, components: comps })];
  const fin = (type) => ({ id: 'fin1', truckId: 't1', type });
  const s1 = createMemStore(seedWith([tpl], evs, { collections: { financing: [fin('financial')] } }));
  const r = await run(s1);
  assert.equal(r.created.length, 3);
  const by = Object.fromEntries(r.created.map((e) => [e.note, e]));
  assert.equal(r.created.filter((e) => e.costClass === 'cashOnly').length, 1);
  assert.equal(r.created.find((e) => e.costClass === 'cashOnly').orig.gross, 80000);
  assert.equal(r.created.reduce((a, e) => a + e.orig.gross, 0), 100000);
  assert.equal(Object.keys(by).length, 3);
  const s2 = createMemStore(seedWith([tpl], evs, { collections: { financing: [fin('operational')] } }));
  const r2 = await run(s2);
  assert.equal(r2.created.length, 1);
  assert.equal(r2.created[0].costClass, 'cost');
  assert.equal(r2.created[0].orig.gross, 100000);
});

test('confirmAllPending + summaryForMonth', async () => {
  const t1 = mkTemplate({ startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 1 });
  const t2 = mkTemplate({ id: 'tpl_b', name: 'GPS', startDate: '2026-11-01', backfillFrom: '2026-11', dayOfMonth: 2 });
  const store = createMemStore(seedWith([t1, t2], [versionEvent(t1.id, '2026-11', { minor: 100000 }), versionEvent('tpl_b', '2026-11', { minor: 5000 })]));
  await run(store);
  let s = summaryForMonth(store.state(), '2026-11');
  assert.equal(s.pendingCount, 2);
  assert.equal(s.totalRon, 105000);
  assert.deepEqual(s.byTemplate.map((x) => x.name), ['GPS', 'Leasing']);
  const c = confirmAllPending(store, undefined, { now: NOW });
  await c.done;
  assert.equal(c.count, 2);
  s = summaryForMonth(store.state(), '2026-11');
  assert.equal(s.pendingCount, 0);
  await c.undo();
  assert.equal(summaryForMonth(store.state(), '2026-11').pendingCount, 2);
});

test('copyPreviousMonth: ciorne pending din luna trecută, fără recurente, cu ziua clampată', () => {
  const mk = (id, over) => ({
    id, kind: 'expense', date: '2026-10-31', accrualMonth: '2026-10', categoryId: 'cat_fuel', supplier: 'OMV',
    target: { type: 'truck', truckId: 't1' }, documentation: 'invoice', countryCode: 'RO', vat: NONE_VAT, currency: 'RON',
    orig: { gross: 25000, net: 25000, vat: 0 }, payment: 'card', source: 'manual', ...over,
  });
  const state = { collections: { entries: [mk('a', {}), mk('b', { source: 'recurring', recurring: { templateId: 'x' } }), mk('c', { categoryId: 'cat_toll' })] } };
  const all = copyPreviousMonth(state, '2026-11');
  assert.equal(all.length, 2);
  assert.equal(all[0].date, '2026-11-30');
  assert.equal(all[0].status, 'pending');
  assert.equal(all[0].source, 'copy');
  assert.equal(all[0].minor, 25000);
  assert.equal(copyPreviousMonth(state, '2026-11', { categories: ['cat_toll'] }).length, 1);
});

test('activare șablon inactiv: generează doar de la luna activării', () => {
  const tpl = mkTemplate({ startDate: '2026-01-01', backfillFrom: '2026-01', activatedMonth: '2026-10' });
  const plan = planOccurrences(tpl, TODAY, [versionEvent(tpl.id, '2026-01', {})]);
  assert.deepEqual(plan.map((p) => p.period), ['2026-10', '2026-11']);
  assert.deepEqual(planOccurrences({ ...tpl, active: false }, TODAY, [versionEvent(tpl.id, '2026-01', {})]), []);
});

test('batch unic și eveniment recurring:generated', async () => {
  const tpl = mkTemplate({ startDate: '2026-09-01', backfillFrom: '2026-09' });
  const store = createMemStore(seedWith([tpl], [versionEvent(tpl.id, '2026-09', {})]));
  const emitted = [];
  await run(store, { bus: { emit: (n, p) => emitted.push([n, p]) } });
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0].o.source, 'generator');
  assert.deepEqual(emitted, [['recurring:generated', { created: 3, month: '2026-11' }]]);
});

test('magazin real: ștergerea unei apariții recurente chiar o scoate din listă și perioada rămâne „deleted” (nu se regenerează); skip la fel; undo o readuce', async () => {
  const { mkStore } = await import('../store/helpers.js');
  const tpl = mkTemplate({ startDate: '2026-01-01', backfillFrom: '2026-01' });
  const { store } = await mkStore();
  await store.put('templates', tpl);
  await store.put('trucks', mkTruck('t1'));
  await store.put('templateEvents', versionEvent(tpl.id, '2026-01', {}));
  const first = await runCatchUp({ store, fx: createFakeFx(), today: '2026-04-30', now: NOW });
  assert.equal(first.created.length, 4);
  const victim = store.list('entries').find((e) => e.recurring.period === '2026-02');
  const d = deleteRecurringEntry(store, victim.id, { now: NOW });
  await d.done;
  assert.ok(!store.get('entries', victim.id), 'intrarea dispare din listă');
  assert.equal(store.list('entries').length, 3);
  const again = await runCatchUp({ store, fx: createFakeFx(), today: '2026-04-30', now: NOW });
  assert.equal(again.created.length, 0, 'nu se regenerează');
  await skipPeriod(store, tpl.id, '2026-03', { now: NOW }).done;
  assert.equal(store.list('entries').filter((e) => e.recurring.period === '2026-03').length, 0);
  assert.ok(store.list('templateEvents').some((e) => e.type === 'skip' && e.period === '2026-03'));
  await d.undo();
  assert.ok(store.get('entries', victim.id), 'undo readuce intrarea');
});
