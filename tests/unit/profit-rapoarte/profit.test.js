import test from 'node:test';
import assert from 'node:assert/strict';
import { truckPnl, fleetPnl, fleetRanking, courseRevenueInRange, ledgerLines, closingCompute } from '../../../src/domain/profit.js';
import { truck, exp, inc, course, state, cats } from './helpers.js';

const OCT = { from: '2026-10-01', to: '2026-10-31' };
const NOV = { from: '2026-11-01', to: '2026-11-30' };

test('prorata pe limită de lună: 28.10–02.11, 6.000,01 lei ⇒ octombrie 4.000,00, noiembrie 2.000,01', () => {
  const s = state({ trucks: [truck('t1')], courses: [course('c1', 't1', '2026-10-28', '2026-11-02', 600001)] });
  assert.equal(truckPnl(s, 't1', OCT, {}).revenue, 400000);
  assert.equal(truckPnl(s, 't1', NOV, {}).revenue, 200001);
  assert.equal(truckPnl(s, 't1', { from: '2026-10-01', to: '2026-11-30' }, {}).revenue, 600001);
});

test('modurile unload / load: toată cursa într-o lună', () => {
  const s = state({ trucks: [truck('t1')], courses: [course('c1', 't1', '2026-10-28', '2026-11-02', 600001)] });
  assert.equal(truckPnl(s, 't1', OCT, { recognition: 'load' }).revenue, 600001);
  assert.equal(truckPnl(s, 't1', NOV, { recognition: 'load' }).revenue, 0);
  assert.equal(truckPnl(s, 't1', NOV, { recognition: 'unload' }).revenue, 600001);
});

test('modul din companie se aplică când nu e cerut; luna închisă folosește recognition din Closure', () => {
  const base = { trucks: [truck('t1')], courses: [course('c1', 't1', '2026-10-28', '2026-11-02', 600001)] };
  const s1 = state({ ...base, company: { revenueRecognition: 'unload' } });
  assert.equal(truckPnl(s1, 't1', NOV, {}).revenue, 600001);
  const s2 = state({ ...base, company: { revenueRecognition: 'unload' }, closures: [{ id: '2026-11', month: '2026-11', recognition: 'prorata' }] });
  assert.equal(truckPnl(s2, 't1', NOV, {}).revenue, 200001, 'luna închisă rămâne cu modul din Closure');
});

test('cost direct, accrualMonth, fără document, cashOnly, recuperări, detalii consolidate', () => {
  const s = state({
    trucks: [truck('t1')], categories: cats(),
    courses: [course('c1', 't1', '2026-10-05', '2026-10-05', 1000000)],
    entries: [
      exp('e1', { net: 100000, vat: 21000, gross: 121000, cost: 100000 }),                                   // 1.000 lei cost net, TVA recuperabil
      exp('e2', { net: 5000, vat: 0, gross: 5000, cost: 5000, documentation: 'none', treatment: 'none' }),     // fără document
      exp('e3', { net: 80000, vat: 0, gross: 80000, cost: 80000, costClass: 'cashOnly', cat: 'cat_rent' }),    // principal: în afara profitului
      inc('r1', { incomeType: 'recovery', cat: 'cat_rec_fuel', net: 10000 }),                                   // recuperare combustibil: scade costul
      inc('o1', { incomeType: 'other', net: 20000 }),                                                          // alt venit: crește venitul
      exp('d1', { net: 99999, vat: 0, gross: 99999, cost: 99999, parentDocId: 'e1' }),                           // detaliu: NU se adună
      exp('late', { date: '2026-10-30', accrualMonth: '2026-11', net: 7000, vat: 0, gross: 7000, cost: 7000 }), // în noiembrie
    ],
  });
  const p = truckPnl(s, 't1', OCT, {});
  assert.equal(p.revenue, 1020000);
  assert.equal(p.cost, 100000 + 5000 - 10000);
  assert.equal(p.cashOnly, 80000);
  assert.equal(p.noDocCost, 5000);
  assert.equal(p.profitOp, 1020000 - 95000);
  assert.equal(p.profitDoc, 1020000 - (95000 - 5000));
  assert.equal(truckPnl(s, 't1', NOV, {}).cost, 7000);
  const cat = Object.fromEntries(p.byCategory.map((c) => [c.categoryId, c]));
  assert.equal(cat.cat_fuel.cost, 100000 + 5000 - 10000, 'recuperarea scade categoria combustibil');
});

test('RON și EUR: venit − cost = profit pe camion în ambele monede', () => {
  const s = state({
    trucks: [truck('t1')], categories: cats(),
    courses: [course('c1', 't1', '2026-10-05', '2026-10-06', 1000000)],
    entries: [exp('e1', { net: 100000, vat: 21000, gross: 121000 }), exp('e2', { net: 50000, vat: 0, gross: 50000, cost: 50000 })],
  });
  for (const cur of ['RON', 'EUR']) {
    const p = truckPnl(s, 't1', OCT, { currency: cur });
    assert.equal(p.revenue - p.costTotal, p.profitOp);
  }
  assert.equal(truckPnl(s, 't1', OCT, { currency: 'EUR' }).revenue, 200000);
});

test('costuri comune: repartizate pe zile în flotă; Σ camioane + nerepartizate = flotă (AC2)', () => {
  const s = state({
    trucks: [truck('t1'), truck('t2', { activeFrom: '2026-10-16' })], categories: cats(),
    courses: [course('c1', 't1', '2026-10-05', '2026-10-05', 500000), course('c2', 't2', '2026-10-20', '2026-10-20', 300000)],
    entries: [exp('rent', { company: true, cat: 'cat_rent', net: 470001, vat: 0, gross: 470001, cost: 470001 }), exp('own', { net: 1000, vat: 0, gross: 1000, cost: 1000 })],
  });
  const f = fleetPnl(s, OCT, {});
  assert.equal(f.trucks.t1.overhead + f.trucks.t2.overhead, 470001);
  assert.ok(Math.abs(f.trucks.t1.overhead - 470001 * 31 / 47) < 1.5);
  const sumProfit = f.trucks.t1.profitOp + f.trucks.t2.profitOp;
  assert.equal(f.total.profitOp, sumProfit - f.unallocatedOverhead);
  assert.equal(f.total.revenue, 800000);
  assert.equal(f.total.costTotal, 470001 + 1000);
});

test('costuri comune fără niciun camion activ rămân nerepartizate (în total, nu pierdute)', () => {
  const s = state({ trucks: [], entries: [exp('rent', { company: true, net: 1000, vat: 0, gross: 1000, cost: 1000 })] });
  const f = fleetPnl(s, OCT, {});
  assert.equal(f.unallocatedOverhead, 1000);
  assert.equal(f.total.profitOp, -1000);
});

test('remorcă atribuită ⇒ cost al camionului; fără atribuire ⇒ cost comun', () => {
  const s = state({
    trucks: [truck('t1')], trailerAssignments: [{ id: 'a1', trailerId: 'tr1', truckId: 't1', from: '2026-01-01', to: null }],
    entries: [exp('x', { trailerId: 'tr1', net: 3000, vat: 0, gross: 3000, cost: 3000 }), exp('y', { trailerId: 'trX', net: 700, vat: 0, gross: 700, cost: 700 })],
  });
  const f = fleetPnl(s, OCT, {});
  assert.equal(f.trucks.t1.cost, 3000);
  assert.equal(f.trucks.t1.overhead, 700);
});

test('spread: intrarea anuală se reportează în cote lunare, restul pe ultima lună', () => {
  const s = state({ trucks: [truck('t1')], entries: [exp('rca', { date: '2026-03-15', net: 1000001, vat: 0, gross: 1000001, cost: 1000001, spread: { from: '2026-03', to: '2027-02' } })] });
  let total = 0;
  for (const m of ['2026-03', '2026-04', '2026-10', '2027-02']) total += truckPnl(s, 't1', { from: m + '-01', to: m + '-28' }, {}).cost;
  assert.equal(truckPnl(s, 't1', { from: '2026-03-01', to: '2027-02-28' }, {}).cost, 1000001);
  assert.equal(truckPnl(s, 't1', { from: '2026-04-01', to: '2026-04-30' }, {}).cost, 83333);
  assert.equal(truckPnl(s, 't1', { from: '2027-02-01', to: '2027-02-28' }, {}).cost, 83333 + 5);
  assert.ok(total > 0);
});

test('provizoriu: intrările auto_pending intră cu marcaj; opțiunea de excludere le scoate', () => {
  const entries = [exp('a', { net: 1000, vat: 0, gross: 1000, cost: 1000, status: 'auto_pending' }), exp('b', { net: 500, vat: 0, gross: 500, cost: 500 })];
  const s = state({ trucks: [truck('t1')], entries });
  const p = truckPnl(s, 't1', OCT, {});
  assert.equal(p.cost, 1500); assert.equal(p.provisionalCount, 1);
  const s2 = state({ trucks: [truck('t1')], entries, company: { excludeAutoPendingFromProfit: true } });
  assert.equal(truckPnl(s2, 't1', OCT, {}).cost, 500);
});

test('amortizare: leasing financiar ⇒ amortizare separată; operațional ⇒ fără; comutator', () => {
  const fin = [{ id: 'f1', truckId: 't1', type: 'financial', valueMinor: 12100000, residualMinor: 100000, currency: 'RON', startDate: '2026-01-01', endDate: '2030-01-01', usefulLifeMonths: 120 },
    { id: 'f2', truckId: 't2', type: 'operational', valueMinor: 9000000, residualMinor: 0, currency: 'RON', startDate: '2026-01-01', usefulLifeMonths: 60 }];
  const s = state({ trucks: [truck('t1'), truck('t2')], financing: fin, courses: [course('c', 't1', '2026-10-05', '2026-10-05', 2000000)] });
  const p1 = truckPnl(s, 't1', OCT, {});
  assert.equal(p1.depreciation, 100000);           // (121.000 − 1.000) / 120 luni = 1.000 lei
  assert.equal(p1.profitOp, 2000000 - 100000);
  assert.equal(truckPnl(s, 't2', OCT, {}).depreciation, 0);
  assert.equal(truckPnl(s, 't1', OCT, { includeDepreciation: false }).profitOp, 2000000);
  assert.equal(truckPnl(s, 't1', { from: '2026-10-01', to: '2026-10-15' }, {}).depreciation, 48387, 'lună parțială: proporțional');
});

test('km: fără GPS ⇒ gpsM null și perKm null (nu 0)', () => {
  const s = state({ trucks: [truck('t1')], courses: [course('c', 't1', '2026-10-05', '2026-10-05', 100000)] });
  const p = truckPnl(s, 't1', OCT, {});
  assert.equal(p.km.gpsM, null); assert.equal(p.km.emptyM, null);
  assert.equal(p.perKm.revenue, null); assert.equal(p.perKm.profit, null);
});

test('km: încărcați + goi = GPS; profit/km din km GPS, fereastră de 3 luni pentru varKm', () => {
  const days = [];
  for (let d = 1; d <= 31; d++) days.push({ truckId: 't1', date: `2026-10-${String(d).padStart(2, '0')}`, kmM: 100000 });
  const s = state({
    trucks: [truck('t1')], categories: cats(), gpsDays: days,
    courses: [course('c', 't1', '2026-10-05', '2026-10-09', 1000000)],
    entries: [exp('f', { net: 200000, vat: 0, gross: 200000, cost: 200000, cat: 'cat_fuel' }), exp('f0', { date: '2026-08-10', net: 100000, vat: 0, gross: 100000, cost: 100000, cat: 'cat_fuel' })],
  });
  const p = truckPnl(s, 't1', OCT, {});
  assert.equal(p.km.gpsM, 3100000);
  assert.equal(p.km.loadedM + p.km.emptyM, p.km.gpsM);
  assert.equal(p.perKm.revenue, 323);               // 10.000 lei / 3.100 km = 3,23 lei/km
  // fereastra mobilă se restrânge la acoperirea GPS (doar octombrie): 2.000 lei varKm / 3.100 km = 0,65 lei/km
  // (înainte: 3.000 lei din aug–oct / km din octombrie = 0,97, cost și km pe acoperiri diferite)
  assert.equal(p.perKm.cost, 65);
  assert.equal(p.perKm.revenue - p.perKm.cost, p.perKm.profit);
  assert.equal(p.perKm.estimated, false);
});

test('clasament: cel mai slab primul; rânduri cu încredere scăzută fără valori pe km', () => {
  const s = state({
    trucks: [truck('t1'), truck('t2')],
    courses: [course('a', 't1', '2026-10-05', '2026-10-05', 500000, { loadedKm: { meters: 1, source: 'gps-window', confidence: 'low' } }), course('b', 't2', '2026-10-06', '2026-10-06', 100000)],
    entries: [exp('e', { truckId: 't2', net: 300000, vat: 0, gross: 300000, cost: 300000 })],
  });
  const r = fleetRanking(s, OCT, {});
  assert.deepEqual(r.rows.map((x) => x.truckId), ['t2', 't1']);
  assert.equal(r.rows[1].lowConfidence, true);
});

test('ledgerLines memoizat pe starea imuabilă', () => {
  const s = state({ trucks: [truck('t1')], entries: [exp('a')] });
  assert.equal(ledgerLines(s), ledgerLines(s));
});

test('courseRevenueInRange: cursă fără preț ⇒ 0', () => {
  const s = state({ trucks: [truck('t1')] });
  assert.equal(courseRevenueInRange(s, course('c', 't1', '2026-10-05', '2026-10-06', 0, { priceStatus: 'missing' }), OCT, 'RON'), 0);
});

test('closingCompute: totalurile înghețate coincid cu fleetPnl', () => {
  const s = state({
    trucks: [truck('t1'), truck('t2')], categories: cats(),
    courses: [course('c1', 't1', '2026-10-05', '2026-10-05', 500000)],
    entries: [exp('e1', { net: 10000, vat: 0, gross: 10000, cost: 10000 }), exp('rent', { company: true, cat: 'cat_rent', net: 20001, vat: 0, gross: 20001, cost: 20001 })],
  });
  const c = closingCompute(s, '2026-10', {});
  const f = fleetPnl(s, OCT, {});
  assert.equal(c.totals.fleet.revenue, f.total.revenue);
  assert.equal(c.totals.fleet.profit, f.total.profitOp);
  assert.equal(c.totals.byTruck.t1.profit, f.trucks.t1.profitOp);
  assert.ok(c.snapshotHash === undefined && Array.isArray(c.lines));
});

test('alt venit fără camion (comun) intră în totalul flotei, ca venit nerepartizat', () => {
  const o = inc('o', { net: 7000 }); o.target = { type: 'company', truckId: null, trailerId: null };
  const s = state({ trucks: [truck('t1')], entries: [o] });
  const f = fleetPnl(s, OCT, {});
  assert.equal(f.unallocatedRevenue, 7000);
  assert.equal(f.total.revenue, 7000);
  assert.equal(f.total.profitOp, 7000);
});

test('EUR lipsă pe o intrare RON: avertizare în loc de cost 0 tăcut', () => {
  const s = state({
    trucks: [truck('t1')], categories: cats(),
    entries: [{ ...exp('x', { net: 1000000, vat: 0, gross: 1000000, cost: 1000000, cat: 'cat_fuel' }), eur: null }],
  });
  const ron = fleetPnl(s, OCT, { currency: 'RON' });
  const eur = fleetPnl(s, OCT, { currency: 'EUR' });
  assert.equal(ron.warnings.missingConversionEntries.length, 0);
  assert.deepEqual(eur.warnings.missingConversionEntries, ['x']);
});
