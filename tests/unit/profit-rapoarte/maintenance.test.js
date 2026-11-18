import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceStatus, maintenanceAlerts, completeService, serviceHistory, maintenanceCategoryIds, latestOdometerM, kmSince } from '../../../src/domain/maintenance.js';
import { truck, exp, state, cats } from './helpers.js';

const TODAY = '2026-11-18';
const KM = 1000;
const gps = (arr) => arr.map(([date, kmM, odoStopM]) => ({ truckId: 't1', date, kmM, odoStopM: odoStopM ?? null }));

test('alerta la pragul de km (odometru) înaintea datei', () => {
  const s = state({ trucks: [truck('t1')], gpsDays: gps([['2026-11-17', 500 * KM, 389000 * KM]]) });
  const it = { id: 'i', subjectType: 'truck', subjectId: 't1', name: 'Revizie', nextKmM: 390500 * KM, nextDate: '2027-06-01' };
  const st = serviceStatus(s, it, TODAY);
  assert.equal(st.state, 'soon'); assert.equal(st.trigger, 'km'); assert.equal(st.remainingKmM, 1500 * KM); assert.equal(st.kmSource, 'odometer');
  const over = serviceStatus(s, { ...it, nextKmM: 388000 * KM }, TODAY);
  assert.equal(over.state, 'overdue'); assert.equal(over.trigger, 'km');
});

test('alerta la dată înaintea kilometrilor', () => {
  const s = state({ trucks: [truck('t1')], gpsDays: gps([['2026-11-17', 500 * KM, 100000 * KM]]) });
  const it = { id: 'i', subjectType: 'truck', subjectId: 't1', name: 'Revizie', nextKmM: 150000 * KM, nextDate: '2026-12-01' };
  const st = serviceStatus(s, it, TODAY);
  assert.deepEqual([st.state, st.trigger, st.remainingDays], ['soon', 'date', 13]);
  assert.equal(serviceStatus(s, { ...it, nextDate: '2026-11-10' }, TODAY).state, 'overdue');
  assert.equal(serviceStatus(s, { ...it, nextDate: '2027-03-01' }, TODAY).state, 'ok');
});

test('km din GPS de la ultima revizie când nu există odometru; ambele declanșate ⇒ trigger „both”', () => {
  const s = state({ trucks: [truck('t1')], gpsDays: gps([['2026-09-01', 30000 * KM], ['2026-10-01', 31000 * KM], ['2026-11-01', 1000 * KM]]) });
  assert.equal(kmSince(s, 't1', '2026-09-01', TODAY), 32000 * KM, 'zilele de după ultima revizie');
  const it = { id: 'i', subjectType: 'truck', subjectId: 't1', name: 'Ulei', intervalKmM: 60000 * KM, lastDate: '2026-09-01', intervalMonths: 2 };
  const st = serviceStatus(s, it, TODAY);
  assert.equal(st.kmSource, 'gps-since'); assert.equal(st.remainingKmM, 28000 * KM); assert.equal(st.kmState, 'ok');
  assert.equal(st.dueDate, '2026-11-01'); assert.equal(st.dateState, 'overdue'); assert.equal(st.trigger, 'date');
  const both = serviceStatus(s, { ...it, intervalKmM: 30000 * KM }, TODAY);
  assert.equal(both.trigger, 'both');
});

test('remorcă: doar pe dată (fără GPS)', () => {
  const s = state({ trucks: [truck('t1')] });
  const st = serviceStatus(s, { id: 'i', subjectType: 'trailer', subjectId: 'tr1', name: 'Frâne', nextDate: '2026-12-10' }, TODAY);
  assert.deepEqual([st.state, st.kmState], ['soon', null]);
});

test('lista de alerte: expirate primele; completeService reportează scadențele', () => {
  const s = state({
    trucks: [truck('t1')],
    serviceItems: [
      { id: 'a', subjectType: 'truck', subjectId: 't1', name: 'A', nextDate: '2026-12-01' }, { id: 'b', subjectType: 'truck', subjectId: 't1', name: 'B', nextDate: '2026-11-01' },
      { id: 'c', subjectType: 'truck', subjectId: 't1', name: 'C', nextDate: '2027-12-01' }, { id: 'd', subjectType: 'truck', subjectId: 't1', name: 'D', nextDate: '2026-11-01', active: false },
    ],
  });
  const al = maintenanceAlerts(s, TODAY);
  assert.deepEqual(al.map((x) => x.id), ['b', 'a']);
  assert.equal(al[0].subjectName, 'T1');
  const done = completeService({ id: 'i', subjectType: 'truck', subjectId: 't1', name: 'U', intervalKmM: 60000 * KM, intervalMonths: 6, lastKmM: 330000 * KM, nextKmM: 390000 * KM }, { date: '2026-11-18', kmM: 391000 * KM }, 'now');
  assert.deepEqual([done.lastDate, done.lastKmM, done.nextKmM, done.nextDate], ['2026-11-18', 391000 * KM, 451000 * KM, '2027-05-18']);
});

test('odometrul cel mai recent; istoricul de service din cheltuieli', () => {
  const s = state({
    trucks: [truck('t1')], categories: cats(), gpsDays: gps([['2026-11-01', 100, 5000], ['2026-11-10', 100, 6000], ['2026-11-20', 100, 7000]]),
    entries: [exp('s1', { cat: 'cat_service', date: '2026-10-01' }), exp('s2', { cat: 'cat_service', date: '2026-11-05' }), exp('f', { cat: 'cat_fuel' }), exp('s3', { cat: 'cat_service', truckId: 't2' })],
  });
  assert.deepEqual(latestOdometerM(s, 't1', TODAY), { odoM: 6000, date: '2026-11-10' });
  assert.ok(maintenanceCategoryIds(s).has('cat_service') && !maintenanceCategoryIds(s).has('cat_fuel'));
  assert.deepEqual(serviceHistory(s, 't1').map((h) => h.entryId), ['s2', 's1']);
  assert.equal(serviceHistory(s, null).length, 3);
});
