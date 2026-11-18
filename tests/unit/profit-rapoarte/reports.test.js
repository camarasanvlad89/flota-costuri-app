import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vatSummary, foreignVatReceivable, accountingJournal, journalTotals, noDocReport, noDocLine, categoryBreakdown, unpaidCourses, fxUsage,
  monthlySeries, reportMeta, emptyKmReport, benchmarksOf, BENCHMARK_DEFAULTS,
} from '../../../src/domain/reports.js';
import { fleetPnl } from '../../../src/domain/profit.js';
import { buildDemoDb } from '../../../src/domain/demo-seed.js';
import { truck, exp, inc, course, state, cats } from './helpers.js';

const OCT = { from: '2026-10-01', to: '2026-10-31' };

test('sumar TVA: deductibil RO, TVA străin de recuperat (cu original în valută), nedeductibil, autolichidat', () => {
  const hu = exp('hu', { country: 'HU', gross: 12700000, net: 10000000, vat: 2700000, foreignVatStatus: 'toClaim', recoverableKind: 'foreign', regime: 'domestic' });
  hu.currency = 'HUF'; hu.orig = { gross: 1270000, net: 1000000, vat: 270000 };      // HUF 0 zecimale
  hu.ron.recoverable = 14000;                                                   // 140,00 lei recuperabili
  hu.ron.vat = 14000; hu.ron.net = 51852; hu.ron.gross = 65852; hu.ron.cost = 51852;
  const nd = exp('nd', { net: 10000, vat: 2100, gross: 12100, recoverable: 0, cost: 12100, treatment: 'nondeductible', recoverableKind: null });
  const rev = exp('rev', { net: 10000, vat: 0, gross: 10000, cost: 10000, treatment: 'reverse', regime: 'ic', recoverableKind: null }); rev.ron.selfAssessedVat = 2100;
  const s = state({ trucks: [truck('t1')], entries: [exp('ro', { net: 10000, vat: 2100, gross: 12100 }), hu, nd, rev] });
  const v = vatSummary(s, OCT);
  assert.equal(v.deductibleRo, 2100);
  assert.equal(v.foreignRecoverable, 14000);
  assert.equal(v.nonDeductible, 2100);
  assert.equal(v.selfAssessed, 2100);
  assert.equal(v.foreign.length, 1);
  assert.deepEqual([v.foreign[0].countryCode, v.foreign[0].currency, v.foreign[0].vat, v.foreign[0].ron, v.foreign[0].deadline], ['HU', 'HUF', 270000, 14000, '2027-09-30']);
  assert.match(v.note, /Nu este decont de TVA/);
});

test('TVA străin: respins/rambursat nu mai apare ca de recuperat', () => {
  const a = exp('a', { country: 'DE', foreignVatStatus: 'rejected', recoverableKind: 'foreign' });
  const b = exp('b', { country: 'DE', foreignVatStatus: 'toClaim', recoverableKind: 'foreign' });
  const s = state({ trucks: [truck('t1')], entries: [a, b] });
  const r = foreignVatReceivable(s, OCT);
  assert.equal(r.length, 1); assert.equal(r[0].count, 1);
  assert.equal(vatSummary(s, OCT).foreignRejected, a.ron.recoverable);
});

test('jurnal contabil: totalurile RON = suma intrărilor din spate la ban; coloane cerute', () => {
  const entries = [exp('a', { net: 10001, vat: 2100, gross: 12101 }), exp('b', { net: 5, vat: 1, gross: 6 }), exp('c', { net: 777, vat: 0, gross: 777, treatment: 'none', documentation: 'none' })];
  const s = state({ trucks: [truck('t1')], categories: cats(), entries, courses: [course('k', 't1', '2026-10-03', '2026-10-04', 100000, { invoiceNo: 'F9', clientName: 'Client SRL' })] });
  const rows = accountingJournal(s, OCT);
  const t = journalTotals(rows);
  assert.equal(t['cheltuială'].ronGross, 12101 + 6 + 777);
  assert.equal(t['cheltuială'].ronNet, 10001 + 5 + 777);
  assert.equal(t['venit (cursă)'].ronNet, 100000);
  for (const k of ['docNo', 'date', 'supplier', 'supplierVatId', 'ronNet', 'ronVat', 'ronGross', 'currency', 'category', 'documentationLabel', 'accountCode']) assert.ok(k in rows[0], k);
  assert.equal(rows.find((r) => r.ref.id === 'k').docNo, 'F9');
  assert.equal(accountingJournal(s, OCT, { includeCourses: false }).length, 3);
});

test('„fără document”: linia permanentă, depășiri de plafon, lipsă justificare', () => {
  const entries = [
    exp('big', { net: 30000, vat: 0, gross: 30000, cost: 30000, documentation: 'none', treatment: 'none' }),                              // 300 lei > plafon 200
    exp('ok', { net: 5000, vat: 0, gross: 5000, cost: 5000, documentation: 'none', treatment: 'none', justification: 'x' }),
    exp('norm', { net: 65000, vat: 0, gross: 65000, cost: 65000 }),
  ];
  const s = state({ trucks: [truck('t1')], entries });
  const r = noDocReport(s, OCT);
  assert.equal(r.total, 35000);
  assert.equal(r.rows.find((x) => x.entryId === 'big').missingJustification, true);
  assert.equal(r.rows.find((x) => x.entryId === 'ok').overCeiling, false);
  assert.equal(r.monthly[0].overCeiling, false);
  const line = noDocLine(s, OCT);
  assert.equal(line.amount, 35000); assert.equal(line.costTotal, 100000); assert.equal(line.pct, 0.35);
});

test('pe categorii: reconciliază cu costul flotei (fără amortizare)', () => {
  const s = state({
    trucks: [truck('t1'), truck('t2')], categories: cats(),
    entries: [exp('a', { net: 1000, vat: 0, gross: 1000, cost: 1000 }), exp('b', { net: 2000, vat: 0, gross: 2000, cost: 2000, cat: 'cat_service', truckId: 't2' }),
      exp('c', { company: true, cat: 'cat_rent', net: 301, vat: 0, gross: 301, cost: 301 }), inc('r', { incomeType: 'recovery', cat: 'cat_rec_fuel', net: 100 })],
  });
  const b = categoryBreakdown(s, OCT);
  assert.equal(b.reduce((x, y) => x + y.cost, 0), fleetPnl(s, OCT).total.costTotal);
  assert.equal(b.find((x) => x.categoryId === 'cat_fuel').cost, 900);
});

test('neîncasat și cursuri folosite', () => {
  const s = state({
    trucks: [truck('t1')],
    courses: [course('a', 't1', '2026-09-01', '2026-09-02', 100000, { dueDate: '2026-10-01', invoiceNo: 'F1' }), course('b', 't1', '2026-09-01', '2026-09-02', 100000, { dueDate: '2026-10-01', paidDate: '2026-10-05' }),
      course('c', 't1', '2026-10-01', '2026-10-02', 100000, { dueDate: '2026-12-01' })],
    entries: [exp('m', { fxSource: 'manual', stale: true }), exp('e', { fxSource: 'ecb-v1' })],
  });
  const u = unpaidCourses(s, '2026-11-18');
  assert.deepEqual(u.map((x) => x.courseId), ['a']);
  const f = fxUsage(s, OCT);
  assert.equal(f.rows.length, 2); assert.equal(f.stale, 1); assert.equal(f.notBnr, 2);
  assert.equal(reportMeta(s, OCT).nonBnrCount, 2);
});

test('serie lunară: emptyPct null fără GPS; reperele implicite și editabile', () => {
  const s = state({ trucks: [truck('t1')], courses: [course('a', 't1', '2026-09-05', '2026-09-05', 100000)] });
  const m = monthlySeries(s, { from: '2026-09-01', to: '2026-10-31' });
  assert.deepEqual(m.map((x) => x.month), ['2026-09', '2026-10']);
  assert.equal(m[0].revenue, 100000); assert.equal(m[0].emptyPct, null);
  assert.deepEqual(benchmarksOf(s), BENCHMARK_DEFAULTS);
  assert.equal(benchmarksOf(state({ singletons: { benchmarks: { avgEmptyPct: 25 } } })).avgEmptyPct, 25);
  assert.equal(BENCHMARK_DEFAULTS.label, 'orientativ, sursă comercială');
});

test('km pe gol pe setul demo: încărcați + goi = GPS pe fiecare rând; KPI = sume; camion fără GPS ⇒ null', () => {
  const s = buildDemoDb(1);
  const r = emptyKmReport(s, OCT, { granularity: 'week' });
  for (const row of r.rows) if (row.gpsM != null) assert.equal(row.loadedM + row.emptyM, row.gpsM);
  const cj = r.trucks.find((t) => t.plate === 'XX00DEM');
  assert.equal(cj.gpsM, 8376284);
  assert.equal(cj.loadedM + cj.emptyM, cj.gpsM);
  assert.equal(r.kpis.gpsM, r.trucks.reduce((a, t) => a + (t.gpsM || 0), 0));
  assert.equal(r.kpis.loadedM + r.kpis.emptyM, r.kpis.gpsM);
  assert.ok(r.kpis.pctEmpty > 0 && r.kpis.pctEmpty < 1);
  assert.equal(r.trend.length, 12);
  assert.equal(r.benchmarks.label, 'orientativ, sursă comercială');
  // fără GPS
  const s2 = state({ trucks: [truck('t1')], courses: [course('a', 't1', '2026-10-05', '2026-10-05', 100000)] });
  const r2 = emptyKmReport(s2, OCT, {});
  assert.equal(r2.kpis.pctEmpty, null); assert.equal(r2.trucks[0].emptyM, null); assert.equal(r2.kpis.emptyCostRon, null);
});
