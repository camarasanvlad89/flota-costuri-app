import test from 'node:test';
import assert from 'node:assert/strict';
import {
  depreciationForMonth, depreciationRonForMonth, depreciationSchedule, depreciationByTruck, bookValueAtMonthEnd,
  depreciationSpan, validateFinancing, financingSummary, depreciationForRange,
} from '../../../src/domain/financing.js';

const fin = (over = {}) => ({
  id: 'f1', truckId: 't1', type: 'financial', valueMinor: 12000000, currency: 'RON', startDate: '2026-03-15',
  residualMinor: 2000000, usefulLifeMonths: 60, ...over,
});

test('liniar: (valoare − reziduală) / luni, din luna de start', () => {
  const f = fin();
  assert.equal(depreciationForMonth(f, '2026-02'), 0);
  assert.equal(depreciationForMonth(f, '2026-03'), 166666); // 10.000.000 / 60 = 166.666,67 => 166.666 + restul pe ultima lună
  assert.equal(depreciationForMonth(f, '2026-04'), 166666);
});

test('suma lunilor = valoarea amortizabilă exactă (restul pe ultima lună)', () => {
  const f = fin();
  const sched = depreciationSchedule(f);
  assert.equal(sched.length, 60);
  assert.equal(sched.reduce((a, r) => a + r.depreciation, 0), 10000000);
  assert.equal(sched[59].depreciation, 166666 + 40); // rest 10000000 % 60 = 40
  assert.equal(sched[59].bookValueEnd, 2000000);
  assert.equal(depreciationForMonth(f, sched[59].month), 166706);
  assert.equal(depreciationForMonth(f, '2031-03'), 0); // după 60 de luni
});

test('leasing operațional: fără amortizare', () => {
  const f = fin({ type: 'operational' });
  assert.equal(depreciationForMonth(f, '2026-06'), 0);
  assert.deepEqual(depreciationSchedule(f), []);
  assert.equal(depreciationSpan(f), null);
});

test('credit și cumpărare (cash) se amortizează; reziduală 0', () => {
  for (const type of ['credit', 'cash']) {
    const f = fin({ type, residualMinor: 0, valueMinor: 1200000, usefulLifeMonths: 12 });
    assert.equal(depreciationForRange(f, '2026-03', '2027-02'), 1200000);
    assert.equal(depreciationForMonth(f, '2026-03'), 100000);
  }
});

test('valută: conversie la cursul înghețat; fără curs => null', () => {
  const f = fin({ currency: 'EUR', valueMinor: 6000000, residualMinor: 0, usefulLifeMonths: 60, fx: { ronPerUnit: '5.3442' } });
  assert.equal(depreciationForMonth(f, '2026-04'), 100000);
  assert.equal(depreciationRonForMonth(f, '2026-04'), 534420);
  assert.equal(depreciationRonForMonth({ ...f, fx: null }, '2026-04'), null);
  const r = depreciationByTruck([f, fin({ id: 'f2', truckId: 't2', valueMinor: 600000, residualMinor: 0, usefulLifeMonths: 6, startDate: '2026-04-01' })], '2026-04');
  assert.deepEqual(r.byTruck, { t1: 534420, t2: 100000 });
  assert.equal(r.total, 634420);
});

test('valoare contabilă de sfârșit de lună', () => {
  const f = fin({ residualMinor: 0, valueMinor: 1200000, usefulLifeMonths: 12, startDate: '2026-01-01' });
  assert.equal(bookValueAtMonthEnd(f, '2025-12'), 1200000);
  assert.equal(bookValueAtMonthEnd(f, '2026-01'), 1100000);
  assert.equal(bookValueAtMonthEnd(f, '2026-12'), 0);
});

test('validateFinancing + înregistrări șterse + intrare invalidă', () => {
  assert.deepEqual(validateFinancing(fin()), []);
  assert.ok(validateFinancing(fin({ residualMinor: 99999999 })).some((e) => e.code === 'RESIDUAL_GT_VALUE'));
  assert.ok(validateFinancing(fin({ usefulLifeMonths: 0 })).some((e) => e.field === 'usefulLifeMonths'));
  assert.equal(depreciationForMonth(fin({ deletedAt: 'x' }), '2026-05'), 0);
  assert.equal(depreciationForMonth(fin(), 'bad'), 0);
});

test('financingSummary: principal în afara profitului, dobânda cost', () => {
  const entries = [
    { source: 'recurring', recurring: { templateId: 'tp' }, costClass: 'cashOnly', ron: { gross: 80000, cost: 80000 } },
    { source: 'recurring', recurring: { templateId: 'tp' }, costClass: 'cost', ron: { gross: 15000, cost: 15000 } },
    { source: 'recurring', recurring: { templateId: 'other' }, costClass: 'cost', ron: { gross: 1, cost: 1 } },
  ];
  const s = financingSummary(fin(), [{ id: 'tp', financingId: 'f1' }], entries);
  assert.deepEqual(s, { principalPaidRon: 80000, interestAndFeesRon: 15000, entries: 2 });
});
