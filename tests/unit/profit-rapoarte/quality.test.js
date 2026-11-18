import test from 'node:test';
import assert from 'node:assert/strict';
import { dataQuality, uitStatus, uitIssues, qualitySummary } from '../../../src/domain/quality.js';
import { snapshotHashFor } from '../../../src/domain/closing.js';
import { buildDemoDb } from '../../../src/domain/demo-seed.js';
import { truck, exp, course, state, cats } from './helpers.js';

const OCT = { from: '2026-10-01', to: '2026-10-31' };
const codes = (q) => q.map((i) => i.code);
const days = (truckId, from, to, kmM) => { const o = []; for (let d = from; d <= to; d++) o.push({ truckId, date: `2026-10-${String(d).padStart(2, '0')}`, kmM }); return o; };

test('demo: fiecare defect deliberat dă steagul așteptat, cursele potrivite nu dau steaguri', () => {
  const s = buildDemoDb(1);
  const q = dataQuality(s, OCT, { today: '2026-11-18' }).filter((i) => !i.truckId || i.truckId === 'trk_xx00dem');
  const get = (c) => q.filter((i) => i.code === c);
  assert.equal(get('COURSE_OVERLAP').length, 1);
  assert.equal(get('COURSE_OVERLAP')[0].refs.length, 2);
  assert.equal(get('COURSE_NO_PRICE').length, 1);
  assert.equal(get('COURSE_NO_GPS').length, 1, 'doar cursa pe zi inactivă');
  assert.match(get('COURSE_NO_GPS')[0].message, /SEINI - ARAD/);
  assert.deepEqual(get('GPS_DAYS_NO_COURSE').map((i) => i.date), ['2026-10-17']);
  const wide = dataQuality(s, { from: '2026-09-26', to: '2026-11-05' }).filter((i) => i.truckId === 'trk_xx00dem' && i.code === 'COURSES_OUTSIDE_GPS');
  assert.equal(wide[0].count, 2, '28–29.09 și 03.11 sunt în afara intervalului GPS');
  assert.equal(get('LOADED_GT_GPS').length, 0);
  assert.equal(get('GPS_PLATE_UNMATCHED').length, 0);
});

test('km încărcați > km GPS din fereastră (+3%), estimare vs GPS, zile GPS lipsă, camion fără GPS', () => {
  const s = state({
    trucks: [truck('t1'), truck('t2')],
    gpsDays: [...days('t1', 1, 4, 100000), ...days('t1', 6, 8, 100000)],
    courses: [
      course('big', 't1', '2026-10-02', '2026-10-02', 1000, { loadedKm: { meters: 150000, source: 'column', confidence: 'high' } }),
      course('est', 't1', '2026-10-03', '2026-10-03', 1000, { loadedKm: { meters: 60000, source: 'route', confidence: 'medium' } }),
      course('gap', 't1', '2026-10-04', '2026-10-06', 1000),
      course('nogps', 't2', '2026-10-02', '2026-10-02', 1000),
    ],
  });
  const q = dataQuality(s, OCT);
  assert.ok(codes(q).includes('LOADED_GT_GPS'));
  assert.ok(codes(q).includes('ESTIMATE_VS_GPS'));
  assert.equal(q.find((i) => i.code === 'GPS_DAYS_MISSING').count, 1);        // 05.10 lipsește
  assert.ok(codes(q).includes('TRUCK_NO_GPS'));
  const sm = qualitySummary(q);
  assert.equal(sm.error + sm.warn + sm.info, q.length);
});

test('plăcuță GPS fără potrivire, consum de combustibil față de normă, curs ne-BNR', () => {
  const s = state({
    trucks: [truck('t1', { normFuelL100: 30 })], categories: cats(),
    gpsDays: [...days('t1', 1, 30, 100000), { truckId: null, plate: 'B123XYZ', date: '2026-10-02', kmM: 5 }],
    entries: [exp('f', { fuel: { ml: 1500000, odoM: null }, fxSource: 'ecb-v1' })],                   // 1.500 L / 3.000 km = 50 L/100km (norma 30)
  });
  const q = dataQuality(s, OCT);
  assert.ok(codes(q).includes('GPS_PLATE_UNMATCHED'));
  const f = q.find((i) => i.code === 'FUEL_CONSUMPTION');
  assert.equal(f.severity, 'warn'); assert.match(f.message, /50,0 L\/100 km/);
  assert.ok(codes(q).includes('FX_NOT_BNR'));
  // în normă ⇒ fără semnal
  const s2 = state({ trucks: [truck('t1', { normFuelL100: 30 })], gpsDays: days('t1', 1, 30, 100000), entries: [exp('f', { fuel: { ml: 900000, odoM: null } })] });
  assert.ok(!codes(dataQuality(s2, OCT)).includes('FUEL_CONSUMPTION'));
});

test('luna închisă s-a schimbat: semnal de eroare', () => {
  const base = state({ trucks: [truck('t1')], entries: [exp('a', { net: 1000, vat: 0, gross: 1000, cost: 1000 })] });
  const basis = { t1: 31 };
  const hash = snapshotHashFor(base, '2026-10', { recognition: 'prorata', basis });
  const closure = { id: '2026-10', month: '2026-10', status: 'closed', recognition: 'prorata', allocationBasis: basis, snapshotHash: hash };
  const ok = state({ trucks: [truck('t1')], entries: base.collections.entries, closures: [closure] });
  assert.ok(!codes(dataQuality(ok, OCT)).includes('CLOSED_MONTH_CHANGED'));
  const changed = state({ trucks: [truck('t1')], entries: [...base.collections.entries, exp('b', { net: 5, vat: 0, gross: 5, cost: 5 })], closures: [closure] });
  assert.ok(codes(dataQuality(changed, OCT)).includes('CLOSED_MONTH_CHANGED'));
});

test('e-Transport (doar evidență): lipsă UIT, valabilitate 5 zile, memento', () => {
  const c = (over) => course('c', 't1', '2026-11-16', '2026-11-18', 1000, over);
  assert.equal(uitStatus(c({}), '2026-11-18').state, 'missing');
  const ok = uitStatus(c({ uit: { code: 'UIT1', issuedAt: '2026-11-16T08:00:00' } }), '2026-11-18');
  assert.deepEqual([ok.state, ok.validUntil, ok.daysLeft], ['ok', '2026-11-21', 3]);
  assert.equal(uitStatus(c({ uit: { code: 'U' }, unloadDate: '2026-11-25' }), '2026-11-18').state, 'expired');
  assert.equal(uitStatus(c({ uit: { code: 'U', issuedAt: '2026-11-13' }, unloadDate: '2026-11-18' }), '2026-11-17').state, 'expiring');
  const s = state({ trucks: [truck('t1')], courses: [c({}), course('old', 't1', '2026-01-01', '2026-01-02', 1000)] });
  const u = uitIssues(s, '2026-11-18');
  assert.equal(u.length, 1); assert.equal(u[0].code, 'UIT_MISSING'); assert.equal(u[0].severity, 'info');
});
