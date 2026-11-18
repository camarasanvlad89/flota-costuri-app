import test from 'node:test';
import assert from 'node:assert/strict';
import { courseEconomics, decisionReport, worthIt, priceAtKm, ratesFor } from '../../../src/domain/decision.js';
import { truck, exp, course, state, cats } from './helpers.js';

const KM = 1000;
function world(extraCourses = []) {
  // iul–sep: 3.000 km pe lună, combustibil 90.000 bani + chirie comună 60.000 bani pe lună ⇒ cost varKm 30 bani/km
  const gpsDays = [], entries = [];
  for (const m of ['07', '08', '09']) {
    for (let d = 1; d <= 30; d++) gpsDays.push({ truckId: 't1', date: `2026-${m}-${String(d).padStart(2, '0')}`, kmM: 100 * KM });
    entries.push(exp('f' + m, { date: `2026-${m}-10`, cat: 'cat_fuel', net: 90000, vat: 0, gross: 90000, cost: 90000 }));
    entries.push(exp('r' + m, { date: `2026-${m}-02`, company: true, cat: 'cat_rent', net: 60000, vat: 0, gross: 60000, cost: 60000 }));
  }
  const c = course('c1', 't1', '2026-10-05', '2026-10-06', 120000, { loadedKm: { meters: 300 * KM, source: 'column', confidence: 'high' }, origin: 'MEDIESU AURIT', destinations: ['VESZPREM'], clientName: 'Client A' });
  return state({ trucks: [truck('t1')], categories: cats(), gpsDays, entries, courses: [c, ...extraCourses] });
}

test('rate de cost din fereastra de 3 luni complete: variabil/km și fix/zi', () => {
  const s = world();
  const r = ratesFor(s, 't1', '2026-10-05');
  assert.equal(r.gpsM, 9000 * KM);
  assert.equal(r.varCost, 270000);
  assert.equal(r.varPerKmMilli, 30000);                 // 0,30 lei/km = 30 bani/km = 30.000 miimi
  assert.equal(r.fixedCost, 180000);
});

test('preț de echilibru × km = costul alocat (la ban)', () => {
  const s = world();
  const e = courseEconomics(s, s.collections.courses[0]);
  assert.equal(e.loadedM, 300 * KM);
  assert.equal(e.costVar, 9000);                        // 300 km × 30 bani
  assert.equal(e.costFixed, 3913);                      // 2 zile × (180.000 / 92 zile din iul–sep)
  assert.equal(e.cost, 12913);
  assert.equal(e.profit, 120000 - 12913);
  assert.ok(Math.abs(priceAtKm(e.breakEvenPerKmMilli, e.loadedM) - e.cost) <= 1);
  assert.equal(e.revenuePerKmMilli, 400000);
});

test('fără km încărcați ⇒ fereastra GPS marcată orientativ; fără GPS ⇒ cost necalculabil, nu 0', () => {
  const s = world([course('c2', 't1', '2026-09-10', '2026-09-11', 50000)]);
  const e2 = courseEconomics(s, s.collections.courses[1]);
  assert.equal(e2.kmSource, 'gps-window'); assert.equal(e2.confidence, 'low'); assert.equal(e2.approx, true);
  const s3 = state({ trucks: [truck('t1')], courses: [course('c3', 't1', '2026-10-05', '2026-10-06', 50000)] });
  const e3 = courseEconomics(s3, s3.collections.courses[0]);
  assert.equal(e3.cost, null); assert.equal(e3.loadedM, null);
});

test('raport: pe culoar și pe client; rândurile fără cost rămân listate dar nu intră în agregări', () => {
  const s = world([
    course('c4', 't1', '2026-10-20', '2026-10-20', 60000, { loadedKm: { meters: 100 * KM, source: 'column', confidence: 'high' }, origin: 'Mediesu Aurit', destinations: ['Veszprém'], clientName: 'client a' }),
    course('c5', 't1', '2026-10-25', '2026-10-25', 99999, { origin: 'X', destinations: ['Y'] }),
  ]);
  s.collections.gpsDays = s.collections.gpsDays.filter((d) => d.date < '2026-10-01');
  const r = decisionReport(s, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(r.courses.length, 3);
  assert.equal(r.lanes.length, 2);
  const lane = r.lanes.find((l) => l.key === 'MEDIESU AURIT → VESZPREM');
  assert.equal(lane.count, 2); assert.equal(lane.withKm, 2); assert.equal(lane.revenue, 180000);
  assert.equal(r.clients.length, 1, 'client fără nume exclus; „Client A” și „client a” se unesc');
  assert.equal(r.total.noKm, 1);
});

test('„Merită cursa?”: același cost/km ca raportul, verdict neutru, preț de echilibru', () => {
  const s = world();
  const ok = worthIt(s, { truckId: 't1', priceMinor: 120000, loadedKm: 300, days: 2, asOf: '2026-10-05' });
  assert.equal(ok.ok, true); assert.equal(ok.cost, 12913); assert.equal(ok.verdict, 'peste-cost');
  assert.ok(Math.abs(priceAtKm(ok.breakEvenPerKmMilli, 300 * KM) - ok.cost) <= 1);
  assert.equal(worthIt(s, { truckId: 't1', priceMinor: 10000, loadedKm: 300, days: 2, asOf: '2026-10-05' }).verdict, 'sub-cost');
  assert.equal(worthIt(s, { truckId: 't1', priceMinor: 13200, loadedKm: 300, days: 2, asOf: '2026-10-05' }).verdict, 'la-limita');
  const fleet = worthIt(s, { priceMinor: 120000, loadedKm: 300, days: 2, asOf: '2026-10-05' });
  assert.equal(fleet.basis, 'media flotei'); assert.equal(fleet.cost, 12913);
  assert.equal(worthIt(state({ trucks: [truck('t1')] }), { truckId: 't1', priceMinor: 1, loadedKm: 1, asOf: '2026-10-05' }).ok, false);
  assert.throws(() => worthIt(s, { truckId: 't1', priceMinor: 1, loadedKm: 0, asOf: '2026-10-05' }));
});
