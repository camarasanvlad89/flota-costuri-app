import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthlyRevenue, closingChecklist, closeMonth, reopenMonth, verifyClosure, guardClosedRecord, redirectToOpenMonth,
  isMonthClosed, fleetDaysBasis, computeMonthTotals, closedTotals, revenueByMonth,
} from '../../../src/domain/closing.js';
import { createMemStore, mkTruck } from '../recurring/_memstore.js';

const NOW = '2026-11-18T08:00:00.000Z';
const course = (id, truckId, loadDate, unloadDate, net, over = {}) => ({
  id, truckId, loadDate, unloadDate, priceStatus: 'ok', invoiceNo: 'F1', ron: { net, vat: 0, gross: net }, ...over,
});
const entry = (id, over = {}) => ({
  id, kind: 'expense', date: '2026-09-10', accrualMonth: '2026-09', target: { type: 'truck', truckId: 't1' },
  status: 'confirmed', costClass: 'cost', documentation: 'invoice', ron: { gross: 10000, net: 10000, vat: 0, cost: 10000 },
  fx: { source: 'ron', stale: false }, ...over,
});
const seed = (extra = {}) => ({
  company: { revenueRecognition: 'prorata', overheadAllocation: 'daysInFleet', profitIncludesDepreciation: true, noDocCeilingMinor: 20000, ...(extra.company || {}) },
  collections: { trucks: [mkTruck('t1'), mkTruck('t2')], ...(extra.collections || {}) },
});

test('monthlyRevenue prorata: 28.10–02.11, 6.000,01 => oct 4.000,00 / nov 2.000,01', () => {
  const c = course('c1', 't1', '2026-10-28', '2026-11-02', 600001);
  assert.equal(monthlyRevenue(c, 'prorata', '2026-10'), 400000);
  assert.equal(monthlyRevenue(c, 'prorata', '2026-11'), 200001);
  assert.equal(monthlyRevenue(c, 'unload', '2026-11'), 600001);
  assert.equal(monthlyRevenue(c, 'unload', '2026-10'), 0);
  assert.equal(monthlyRevenue(c, 'load', '2026-10'), 600001);
  const sum = revenueByMonth(c, 'prorata').reduce((a, x) => a + x.minor, 0);
  assert.equal(sum, 600001);
  assert.equal(monthlyRevenue({ ...c, ron: null }, 'prorata', '2026-10'), 0);
});

test('checklist: pending, fără document peste plafon, luna neîncheiată, ordine', () => {
  const store = createMemStore(seed({ collections: { entries: [
    entry('e1', { status: 'pending' }),
    entry('e2', { status: 'auto_pending' }),
    entry('e3', { documentation: 'none', ron: { gross: 50000, net: 50000, vat: 0, cost: 50000 } }),
    entry('e4', { documentation: 'none', justification: 'avarie', ron: { gross: 50000, net: 50000, vat: 0, cost: 50000 } }),
  ], courses: [course('c1', 't1', '2026-09-01', '2026-09-02', 100000, { priceStatus: 'missing', ron: { net: 0 } })] } }));
  const cl = closingChecklist(store.state(), '2026-09', { today: '2026-11-18' });
  const codes = cl.map((x) => x.code);
  assert.ok(codes.includes('PENDING_ENTRIES'));
  assert.ok(codes.includes('AUTO_PENDING_ENTRIES'));
  assert.ok(codes.includes('COURSE_PRICE_MISSING'));
  const nodoc = cl.find((x) => x.code === 'NODOC_NO_JUSTIFICATION');
  assert.equal(nodoc.severity, 'error');
  assert.deepEqual(nodoc.refs.map((r) => r.id), ['e3']);
  assert.ok(closingChecklist(store.state(), '2026-11', { today: '2026-11-18' }).some((x) => x.code === 'MONTH_NOT_ENDED'));
});

test('closeMonth: erori blochează, avertismentele cer confirmare, apoi scrie Closure + closedThrough', async () => {
  const entries = [entry('e1'), entry('e2', { status: 'pending' })];
  const store = createMemStore(seed({ collections: { entries, courses: [course('c1', 't1', '2026-09-03', '2026-09-04', 200000)] } }));
  const r1 = closeMonth(store, '2026-09', { now: NOW, today: '2026-11-18' });
  assert.equal(r1.ok, false); assert.equal(r1.reason, 'needs-ack');
  const r2 = closeMonth(store, '2026-09', { now: NOW, today: '2026-11-18', ackWarnings: true });
  assert.equal(r2.ok, true);
  await r2.done;
  assert.equal(store.state().singletons.company.closedThrough, '2026-09');
  const c = store.raw('closures', '2026-09');
  assert.equal(c.recognition, 'prorata');
  assert.equal(c.totals.fleet.revenue, 200000);
  assert.equal(c.totals.fleet.cost, 20000);
  assert.equal(c.totals.fleet.profit, 180000);
  assert.deepEqual(c.allocationBasis, { t1: 30, t2: 30 });
  assert.equal(store.all('audit').length, 1);
  // acum luna e închisă
  assert.equal(closeMonth(store, '2026-09', { now: NOW, ackWarnings: true }).reason, 'errors');
  assert.equal(closeMonth(store, '2026-11', { now: NOW, ackWarnings: true }).reason, 'errors'); // sare octombrie
  assert.deepEqual(closedTotals(store.state(), '2026-09'), c.totals);
});

test('garduri: scriere în lună închisă respinsă; redirecționare „aferent lunii X”', () => {
  const company = { closedThrough: '2026-09' };
  assert.equal(isMonthClosed(company, '2026-09'), true);
  assert.equal(isMonthClosed(company, '2026-10'), false);
  assert.deepEqual(guardClosedRecord(company, { accrualMonth: '2026-08' }), { code: 'CLOSED_MONTH', month: '2026-08' });
  assert.equal(guardClosedRecord(company, { date: '2026-10-02' }), null);
  const r = redirectToOpenMonth({ id: 'x', date: '2026-08-30', accrualMonth: '2026-08' }, company);
  assert.equal(r.accrualMonth, '2026-10'); assert.equal(r.relatesTo, '2026-08');
  const same = { id: 'y', accrualMonth: '2026-10' };
  assert.equal(redirectToOpenMonth(same, company), same);
});

test('redeschidere jurnalizată: motiv obligatoriu, closedThrough scade, istoric păstrat', async () => {
  const store = createMemStore(seed({ collections: { entries: [entry('e1')] } }));
  await closeMonth(store, '2026-08', { now: NOW, ackWarnings: true }).done;
  await closeMonth(store, '2026-09', { now: NOW, ackWarnings: true }).done;
  assert.equal(store.state().singletons.company.closedThrough, '2026-09');
  assert.equal(reopenMonth(store, '2026-08', ' ').ok, false);
  const r = reopenMonth(store, '2026-09', 'factură lipsă', { now: NOW });
  assert.equal(r.ok, true);
  await r.done;
  assert.equal(store.state().singletons.company.closedThrough, '2026-08');
  assert.equal(store.raw('closures', '2026-09').status, 'reopened');
  assert.equal(store.raw('closures', '2026-09').reopened[0].reason, 'factură lipsă');
  assert.equal(closedTotals(store.state(), '2026-09'), null);
  assert.ok(store.all('audit').some((a) => a.type === 'month-reopen' && a.reason === 'factură lipsă'));
  // re-închidere păstrează istoricul de redeschideri
  await closeMonth(store, '2026-09', { now: NOW, ackWarnings: true }).done;
  assert.equal(store.raw('closures', '2026-09').reopened.length, 1);
  assert.equal(store.raw('closures', '2026-09').status, 'closed');
  // redeschiderea unei luni mai vechi redeschide și lunile următoare
  await reopenMonth(store, '2026-08', 'corecție', { now: NOW }).done;
  assert.equal(store.state().singletons.company.closedThrough, null);
  assert.equal(store.raw('closures', '2026-09').status, 'reopened');
});

test('verifyClosure: detectează modificarea datelor financiare, nu a notelor', async () => {
  const store = createMemStore(seed({ collections: { entries: [entry('e1')] } }));
  await closeMonth(store, '2026-09', { now: NOW, ackWarnings: true }).done;
  assert.equal(verifyClosure(store.state(), '2026-09').ok, true);
  await store.put('entries', { ...store.raw('entries', 'e1'), note: 'altă notă', justification: 'x' });
  assert.equal(verifyClosure(store.state(), '2026-09').ok, true);
  await store.put('entries', { ...store.raw('entries', 'e1'), ron: { gross: 10100, net: 10100, vat: 0, cost: 10100 } });
  const v = verifyClosure(store.state(), '2026-09');
  assert.equal(v.ok, false); assert.equal(v.closed, true);
  assert.equal(verifyClosure(store.state(), '2026-08').closed, false);
});

test('activeTo ulterior nu schimbă luna închisă (baza înghețată în Closure)', async () => {
  const store = createMemStore(seed({ collections: { entries: [entry('c1', { target: { type: 'company' }, ron: { gross: 100000, net: 100000, vat: 0, cost: 100000 } })] } }));
  await closeMonth(store, '2026-09', { now: NOW, ackWarnings: true }).done;
  const frozen = store.raw('closures', '2026-09');
  assert.deepEqual(frozen.allocationBasis, { t1: 30, t2: 30 });
  // camionul t2 e vândut retroactiv pe 10 septembrie
  const t2 = store.raw('trucks', 't2');
  await store.put('trucks', { ...t2, activeTo: '2026-09-10' });
  assert.equal(verifyClosure(store.state(), '2026-09').ok, true); // hash cu baza din Closure
  assert.equal(fleetDaysBasis(store.state().collections.trucks, '2026-09').t2, 10);
  assert.deepEqual(frozen.totals.byTruck.t1.overhead, 50000);
});

test('totaluri: cost comun repartizat fără pierdere de bani; recuperare scade costul; spread; cashOnly în afara profitului', () => {
  const entries = [
    entry('a', { target: { type: 'company' }, ron: { gross: 100001, net: 100001, vat: 0, cost: 100001 } }),
    entry('b', { kind: 'income', incomeType: 'recovery', ron: { gross: 1000, net: 1000, vat: 0, cost: 0 } }),
    entry('c', { costClass: 'cashOnly', ron: { gross: 80000, net: 80000, vat: 0, cost: 80000 } }),
    entry('d', { accrualMonth: '2026-08', spread: { from: '2026-08', to: '2026-10' }, ron: { gross: 30001, net: 30001, vat: 0, cost: 30001 } }),
    entry('p', { parentDocId: 'a', ron: { gross: 5, net: 5, vat: 0, cost: 5 } }),
  ];
  const store = createMemStore(seed({ collections: { entries } }));
  const r = computeMonthTotals(store.state(), '2026-09');
  const t = r.totals;
  assert.equal(t.byTruck.t1.overhead + t.byTruck.t2.overhead, 100001);
  assert.equal(t.byTruck.t1.cashOnly, 80000);
  // t1: cost propriu = -1000 (recuperare) + 10000 (a? nu) -> c nu e cost; d: 30001/3 în septembrie (lună 2 din 3 => 10000)
  assert.equal(t.byTruck.t1.cost, -1000 + 10000);
  assert.equal(t.fleet.cost, t.byTruck.t1.cost + t.byTruck.t1.overhead + t.byTruck.t2.overhead);
  assert.equal(t.fleet.profit, t.fleet.revenue - t.fleet.cost);
});

test('depreciere în totaluri doar dacă profitIncludesDepreciation', () => {
  const fin = { id: 'f', truckId: 't1', type: 'financial', valueMinor: 1200000, residualMinor: 0, usefulLifeMonths: 12, startDate: '2026-01-01', currency: 'RON' };
  const on = createMemStore(seed({ collections: { financing: [fin] } }));
  assert.equal(computeMonthTotals(on.state(), '2026-09').totals.byTruck.t1.depreciation, 100000);
  const off = createMemStore(seed({ company: { profitIncludesDepreciation: false }, collections: { financing: [fin] } }));
  assert.equal(computeMonthTotals(off.state(), '2026-09').totals.byTruck.t1.depreciation, 0);
});
