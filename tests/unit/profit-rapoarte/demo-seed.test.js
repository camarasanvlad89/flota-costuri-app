import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoDb, isDemoDb, DEMO_BADGE } from '../../../src/domain/demo-seed.js';
import { validateEntry } from '../../../src/domain/entry.js';
import { fleetPnl } from '../../../src/domain/profit.js';
import { expiryAlerts } from '../../../src/domain/expiry.js';
import { maintenanceAlerts } from '../../../src/domain/maintenance.js';
import { diurnaReport } from '../../../src/domain/diurna.js';

const db = buildDemoDb(1);
const C = db.collections;
const OCT = { from: '2026-10-01', to: '2026-10-31' };

test('determinist pentru aceeași sămânță; altă sămânță schimbă datele generate; marcat „date demo”', () => {
  assert.deepEqual(buildDemoDb(1), db);
  assert.notDeepEqual(buildDemoDb(2).collections.entries.map((e) => e.ron.gross), C.entries.map((e) => e.ron.gross));
  assert.equal(isDemoDb(db), true);
  assert.equal(isDemoDb({ meta: {} }), false);
  assert.equal(db.meta.demoBadge, DEMO_BADGE);
  assert.equal(db.schemaVersion, 1);
});

test('GPS: exportul real XX 00 DEM — 138 de călătorii și 8.376,3 km, egal cu suma foii zilnice', () => {
  const trips = C.gpsTrips;
  assert.equal(trips.length, 138);
  assert.equal(trips.reduce((s, t) => s + t.distanceM, 0), 8376284);
  const cj = C.gpsDays.filter((d) => d.truckId === 'trk_xx00dem');
  assert.equal(cj.length, 31);
  assert.equal(cj.reduce((s, d) => s + d.kmM, 0), 8376284);
  assert.equal(cj[0].odoStartM, 358257900); assert.equal(cj[30].odoStopM, 366635300);
  assert.match(trips[0].startPos, /^\[Drum local, Orașu Nou, 447220, România\]$/);
});

test('rândurile 121–147 din poză: sume exacte, derivate, fără preț, K, note ungurești păstrate', () => {
  const rows = C.courses.filter((c) => c.sheet.name === 'XX00DEM 2025').sort((a, b) => a.sheet.row - b.sheet.row);
  assert.equal(rows.length, 27);
  const r121 = rows[0];
  assert.deepEqual([r121.loadDate, r121.unloadDate, r121.net, r121.vat, r121.gross, r121.priceStatus], ['2025-08-07', '2025-08-09', 294066, 61754, 355820, 'ok']);
  const r138 = rows.find((r) => r.sheet.row === 138);                          // doar Total 1557,94 ⇒ net derivat 1287,55
  assert.deepEqual([r138.priceStatus, r138.vatDerived, r138.net, r138.vat, r138.gross], ['derived', true, 128755, 27039, 155794]);
  assert.equal(rows.find((r) => r.sheet.row === 141).net, 174207);
  const r132 = rows.find((r) => r.sheet.row === 132);
  assert.deepEqual([r132.priceStatus, r132.status, r132.strayValues], ['missing', 'review', [3900]]);
  assert.equal(rows.find((r) => r.sheet.row === 128).note, 'lepakolni Kalman');
  assert.equal(rows.find((r) => r.sheet.row === 128).handoverTo, 'Kalman');
  assert.equal(rows.find((r) => r.sheet.row === 136).routeRaw, 'CAREI - CROATIA');
  assert.equal(rows.find((r) => r.sheet.row === 136).destCountry, 'HR');
  assert.equal(rows.find((r) => r.sheet.row === 129).driverRaw, 'KALMAN');
  assert.deepEqual(rows.find((r) => r.sheet.row === 146).destinations, ['SALONTA', 'SACUENI', 'VALEA LUI MIHAI']);
  for (const r of rows) if (r.priceStatus === 'ok') assert.ok(Math.abs(r.net + r.vat - r.gross) <= 1, 'G + H = I la rândul ' + r.sheet.row);
});

test('fixtura FICTIV oct. 2026 are defectele deliberate', () => {
  const oct = C.courses.filter((c) => c.sheet.name === 'XX00DEM 2026' && c.sheet.row < 40);
  assert.equal(oct.length, 20);
  assert.ok(oct.some((c) => c.routeRaw === 'SEINI - ARAD' && c.loadDate === '2026-10-09'));
  assert.ok(oct.some((c) => c.priceStatus === 'missing' && c.strayValues[0] === 3900));
  assert.ok(oct.some((c) => c.priceStatus === 'derived' && c.gross === 155794));
  assert.ok(oct.some((c) => c.routeRaw === 'BAIA MARE - SZOMBATHELY'));
  assert.ok(oct.some((c) => c.loadDate > '2026-10-31') && oct.some((c) => c.unloadDate < '2026-10-01'));
});

test('ids unice pe colecție; intrările trec validateEntry; invariante gross = net + vat', () => {
  for (const [name, list] of Object.entries(C)) {
    const ids = list.map((r) => r.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, 'id-uri duplicate în ' + name);
  }
  const ctx = { company: db.singletons.company, categories: C.categories, countries: C.countries };
  for (const e of C.entries) {
    assert.deepEqual(validateEntry(e, ctx).filter((x) => x.severity !== 'warn' && x.severity !== 'info'), [], e.id);
    assert.equal(e.ron.gross, e.ron.net + e.ron.vat);
  }
});

test('profitul pe setul demo reconciliază: Σ camioane − nerepartizat = flotă; revenire în EUR', () => {
  const f = fleetPnl(db, OCT, {});
  const sum = Object.values(f.trucks).reduce((a, p) => a + p.profitOp, 0);
  assert.equal(f.total.profitOp, sum - f.unallocatedOverhead + f.unallocatedRevenue);
  assert.ok(f.total.revenue > 0 && f.total.costTotal > 0);
  const e = fleetPnl(db, OCT, { currency: 'EUR' });
  assert.ok(e.total.revenue > 0);
  for (const p of Object.values(e.trucks)) assert.equal(p.revenue - p.costTotal, p.profitOp);
  assert.equal(f.trucks.trk_xx00dem.km.gpsM, 8376284);
});

test('alerte demo: scadențe (depășit, 7, 14, 17, 29 zile), mentenanță, diurnă din călătoriile reale', () => {
  const a = expiryAlerts(db, '2026-11-18');
  assert.ok(a.some((x) => x.level === 'overdue') && a.some((x) => x.level === 'd7') && a.some((x) => x.level === 'd30'));
  const m = maintenanceAlerts(db, '2026-11-18');
  assert.ok(m.length >= 2);
  assert.ok(m.some((x) => x.id === 'svc_cj26_frane' && x.trigger === 'km'));
  const d = diurnaReport(db, OCT);
  const cj = d.rows.filter((r) => r.truckId === 'trk_xx00dem' && r.source === 'gps');
  assert.ok(cj.length >= 10 && cj.length <= 31);
  assert.ok(cj.every((r) => r.country === 'HU'));
});
