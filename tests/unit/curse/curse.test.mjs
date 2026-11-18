// Teste unitare „Curse, locuri, km, confruntare” (node --test). Datele GPS: copie a exportului real SafeFleet
// „Călătorii” XX 00 DEM, oct. 2026 (138 călătorii). Cursele sunt FICTIVE (doar pentru test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseRoute, normRoute, courseLocationNames, unresolvedPlaces, placeKey, countryCodeFromName, makePlace, buildPlaceIndex, findPlace } from '../../../src/domain/places.js';
import { matchPlace, parseGpsAddress, makeAlias, scoreBand } from '../../../src/domain/placeMatch.js';
import { courseId, priceFromColumns, coursesOverlap, resolveLoadedKm } from '../../../src/domain/courses.js';
import { odometerCheck, kmByCountry, longStops, groupManeuvers, mergeDailyKm, normTrips, buildTripIndex, anchorCourse } from '../../../src/domain/gpsKm.js';
import { computeEmptyKm } from '../../../src/domain/emptyKm.js';
import { reconcile, setFlagStatus } from '../../../src/domain/reconcile.js';
import { createRouting } from '../../../src/domain/routing.js';

const here = dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(readFileSync(join(here, 'real-trips-XX00DEM-oct2026.json'), 'utf8'));
const TRIPS = REAL.map((t) => ({ truckId: 'T1', ...t }));
const RANGE = { from: '2026-10-01', to: '2026-10-31' };

const mk = (id, load, unload, route, extra = {}) => ({
  id, truckId: 'T1', loadDate: load, unloadDate: unload, routeRaw: route, ...parseRoute(route), priceStatus: 'ok', ...extra,
});
const sumM = (arr) => arr.reduce((s, t) => s + t.distanceM, 0);

// ---------------------------------------------------------------- locuri și rute
test('parseRoute: cazurile din tabelul real', () => {
  assert.deepEqual(parseRoute('MEDIESU AURIT - VESZPREM'), { origin: 'MEDIESU AURIT', destinations: ['VESZPREM'], countryOnly: false, destCountry: null, extras: [], originCountry: null });
  const r = parseRoute('ARAD - GHERTA + TURT +NEGRESTI');
  assert.equal(r.origin, 'ARAD');
  assert.deepEqual(r.destinations, ['GHERTA', 'TURT', 'NEGRESTI']);
  assert.deepEqual(parseRoute('AGHIRES - NEGRESTI+ARDUD').destinations, ['NEGRESTI', 'ARDUD']);
  const c = parseRoute('MEDIESU AURIT - CROATIA');
  assert.equal(c.countryOnly, true);
  assert.equal(c.destCountry, 'HR');
  assert.deepEqual(c.destinations, []);
  assert.equal(parseRoute('KOSICE - CINCU').destinations[0], 'CINCU');
  assert.equal(parseRoute('').origin, '');
});

test('normRoute / courseId: stabile, fără diacritice, ordinal pentru rânduri identice', () => {
  assert.equal(normRoute('Vásárosnamény – Cluj-Napoca'), normRoute('VASAROSNAMENY - CLUJ NAPOCA'));
  const c = { plate: 'xx-00-dem', loadDate: '2025-08-20', unloadDate: '2025-08-22', route: 'MEDIESU AURIT - VESZPREM' };
  assert.equal(courseId(c), courseId({ ...c, plate: 'XX00DEM' }));
  assert.equal(courseId(c, 1), courseId(c));
  assert.notEqual(courseId(c, 2), courseId(c));
  assert.notEqual(courseId(c), courseId({ ...c, unloadDate: '2025-08-23' }));
});

test('coada „Locuri de rezolvat”: sortată după frecvență, fără țări și fără locuri cunoscute', () => {
  const courses = [mk('a', '2026-10-01', '2026-10-01', 'ARAD - GHERTA + TURT'), mk('b', '2026-10-02', '2026-10-02', 'ARAD - TURT'), mk('c', '2026-10-03', '2026-10-03', 'ORADEA - CROATIA')];
  const known = [makePlace({ display: 'Oradea', lat: 47, lon: 21, confirmed: true })];
  const q = unresolvedPlaces(courses, known);
  assert.deepEqual(q.map((x) => [x.name, x.count]), [['ARAD', 2], ['TURT', 2], ['GHERTA', 1]]);
  assert.equal(findPlace(buildPlaceIndex(known), 'ORADEA')?.display, 'Oradea');
  assert.deepEqual(courseLocationNames(courses[2]), ['ORADEA']);
});

test('placeKey: diacritice românești și maghiare (ő ű ș ț ă î), cratime', () => {
  assert.equal(placeKey('Törökszentmiklós'), 'TOROKSZENTMIKLOS');
  assert.equal(placeKey('Hajdúdorog'), 'HAJDUDOROG');
  assert.equal(placeKey('Orașu Nou'), 'ORASU NOU');
  assert.equal(placeKey('Negrești-Oaș'), 'NEGRESTI OAS');
  assert.equal(placeKey('Görbeháza'), 'GORBEHAZA');
  assert.equal(placeKey('Szőlős űr'), 'SZOLOS UR');
  assert.equal(countryCodeFromName('Ungaria'), 'HU');
  assert.equal(countryCodeFromName('Croația'), 'HR');
});

test('parseGpsAddress: [stradă, localitate, cod, țară] și forma cu județ', () => {
  const a = parseGpsAddress('[Drum local, Orașu Nou, 447220, România]');
  assert.equal(a.locality, 'Orașu Nou');
  assert.equal(a.countryCode, 'RO');
  assert.equal(a.postcode, '447220');
  const b = parseGpsAddress('[Jász-Nagykun-Szolnok vármegye, 5081, Ungaria]');
  assert.equal(b.locality, 'Jász-Nagykun-Szolnok vármegye');
  assert.equal(b.countryCode, 'HU');
});

test('matchPlace: automat / de confirmat / nepotrivit / alias', () => {
  const addr = '[Drum local, Medieșu Aurit, 447185, România]';
  assert.equal(matchPlace('MEDIESU AURIT', addr).score, 1);
  assert.equal(matchPlace('MEDIESU AURIT', addr).band, 'auto');
  assert.equal(matchPlace('TOROKSZENTMIKLOS', '[Drum local, Törökszentmiklós, 5200, Ungaria]').band, 'auto');
  assert.equal(matchPlace('CLUJ NAPOCA', '[Drum local, Cluj-Napoca, 400000, România]').band, 'auto');
  const partial = matchPlace('MEDIESU', addr);
  assert.equal(partial.band, 'confirm');
  assert.ok(partial.score >= 0.6 && partial.score < 0.85);
  assert.equal(matchPlace('SATU MARE', '[DN1, Satu Nou, 1, România]').band === 'auto', false);
  assert.equal(matchPlace('ARAD', '[A, Satu Mare, 1, România]').band, 'none');
  assert.equal(matchPlace('HAJDUDOROG', '[Drum local, Hajdudorog, 4087, Ungaria]').band, 'auto');
  // alias confirmat: nume diferit => scor 1
  assert.equal(matchPlace('OSZTALY', '[Drum local, Hajdúdorog, 4087, Ungaria]').band, 'none');
  const al = makeAlias({ name: 'OSZTALY', locality: 'Hajdúdorog' });
  assert.equal(matchPlace('OSZTALY', '[Drum local, Hajdúdorog, 4087, Ungaria]', [al]).score, 1);
  assert.equal(scoreBand(0.85), 'auto');
  assert.equal(scoreBand(0.6), 'confirm');
  assert.equal(scoreBand(0.59), 'none');
});

// ---------------------------------------------------------------- preț
const ron = (s) => Math.round(parseFloat(String(s).replace(',', '.')) * 100);
test('priceFromColumns: rândurile din poză', () => {
  const full = priceFromColumns({ net: ron('3542,77'), vat: ron('743,98'), gross: ron('4286,75'), date: '2025-08-20' });
  assert.deepEqual([full.net, full.vat, full.gross, full.priceStatus, full.vatBp], [354277, 74398, 428675, 'ok', 2100]);
  const r126 = priceFromColumns({ net: ron('2536,1'), vat: ron('532,58'), gross: ron('3068,68'), date: '2025-09-01' });
  assert.deepEqual([r126.net, r126.vat, r126.gross, r126.priceStatus], [253610, 53258, 306868, 'ok']);
  const only = priceFromColumns({ gross: ron('1876,60'), date: '2025-09-19' });
  assert.deepEqual([only.net, only.vat, only.vatDerived, only.priceStatus], [155091, 32569, true, 'derived']);
  const o2 = priceFromColumns({ gross: ron('2539,20'), date: '2025-09-25' });
  assert.deepEqual([o2.net, o2.vat], [209851, 44069]);
  const dom = priceFromColumns({ net: 110000, vat: 23100, gross: 133100, date: '2025-09-10' });
  assert.equal(dom.priceStatus, 'ok');
  assert.deepEqual(dom.warnings, []);
  const none = priceFromColumns({ date: '2025-09-10' });
  assert.equal(none.priceStatus, 'missing');
  assert.equal(none.net, null);
});

test('priceFromColumns: client străin (zero/reverse), H=0, cote necunoscute, doar net', () => {
  const z = priceFromColumns({ gross: 500000, date: '2026-01-10', vatTreatment: 'reverse' });
  assert.deepEqual([z.net, z.vat, z.vatDerived, z.priceStatus], [500000, 0, false, 'derived']);
  const h0 = priceFromColumns({ net: 100000, vat: 0, gross: 100000, date: '2026-01-10' });
  assert.equal(h0.vatTreatment, 'zero');
  assert.equal(h0.vatBp, 0);
  assert.equal(h0.warnings.length, 0);
  const odd = priceFromColumns({ net: 100000, vat: 13700, gross: 113700, date: '2026-01-10' });
  assert.ok(odd.warnings.some((w) => w.startsWith('RATE_UNKNOWN')));
  const gOnly = priceFromColumns({ net: 100000, date: '2026-01-10' });
  assert.deepEqual([gOnly.vat, gOnly.gross, gOnly.priceStatus], [21000, 121000, 'derived']);
  const old = priceFromColumns({ gross: 119000, date: '2025-07-31' }); // 19% înainte de 1.08.2025
  assert.deepEqual([old.net, old.vat, old.vatBp], [100000, 19000, 1900]);
  const mism = priceFromColumns({ net: 1000, vat: 210, gross: 1300, date: '2026-01-10' });
  assert.ok(mism.warnings.some((w) => w.startsWith('TOTAL_MISMATCH')));
});

test('coursesOverlap: lanțul în aceeași zi nu e suprapunere', () => {
  const a = { loadDate: '2025-09-25', unloadDate: '2025-09-25' }, b = { loadDate: '2025-09-25', unloadDate: '2025-09-26' };
  assert.equal(coursesOverlap(a, b), false);
  assert.equal(coursesOverlap({ loadDate: '2025-09-20', unloadDate: '2025-09-22' }, { loadDate: '2025-09-22', unloadDate: '2025-09-23' }), false);
  assert.equal(coursesOverlap({ loadDate: '2025-09-20', unloadDate: '2025-09-22' }, { loadDate: '2025-09-21', unloadDate: '2025-09-23' }), true);
});

// ---------------------------------------------------------------- GPS
test('fișierul real: 8.376,3 km, odometru în toleranță, 43 manevre, km pe țară', () => {
  assert.equal(TRIPS.length, 138);
  assert.equal(sumM(TRIPS), 8376284);
  const o = odometerCheck({ sumM: 8376300, odoStartM: 358257900, odoStopM: 366635300 });
  assert.equal(o.odoDeltaM, 8377400);
  assert.equal(o.withinTolerance, true);
  assert.equal(odometerCheck({ sumM: 8000000, odoStartM: 0, odoStopM: 8377400 }).withinTolerance, false);
  assert.equal(odometerCheck({ sumM: 1 }).withinTolerance, null);
  const g = groupManeuvers(TRIPS);
  assert.equal(g.reduce((s, x) => s + x.count, 0), 138);
  assert.equal(g.reduce((s, x) => s + x.distM, 0), 8376284);
  assert.equal(TRIPS.filter((t) => t.distanceM < 2000).length, 43);
  const k = kmByCountry(TRIPS);
  assert.equal(k.totalM, 8376284);
  assert.ok(Math.abs(k.byCountry.RO / 1000 - 6326) < 3, `RO=${k.byCountry.RO}`);
  assert.ok(Math.abs(k.byCountry.HU / 1000 - 2050) < 3, `HU=${k.byCountry.HU}`);
});

test('opriri lungi: baza Orașu Nou marcată ca „acasă”', () => {
  const ls = longStops(TRIPS, { hours: 40, homeBase: 'Orașu Nou' });
  assert.ok(ls.length >= 1);
  assert.ok(ls.some((s) => s.isHome && /Ora/.test(s.locality)));
  assert.ok(ls.every((s) => s.hours >= 40));
  const seini = longStops(TRIPS, { hours: 40 }).find((s) => /Seini/.test(s.locality || ''));
  assert.ok(seini, 'Seini apare ca oprire lungă');
});

test('import duplicat: aceeași călătorie de două ori nu dublează km', () => {
  const twice = [...TRIPS, ...TRIPS.map((t) => ({ ...t }))];
  assert.equal(normTrips(twice).length, 138);
  const m = mergeDailyKm([], twice);
  let total = 0;
  for (const v of m.values()) total += v.m;
  assert.equal(total, 8376284);
});

test('călătorie peste miezul nopții intră în ziua de start; foaia zilnică doar ca rezervă', () => {
  const t = [{ truckId: 'T1', start: '2026-10-01T23:30:00', stop: '2026-10-02T01:30:00', startPos: '[x, Arad, 1, România]', stopPos: '[y, Oradea, 2, România]', distanceM: 100000 }];
  const m = mergeDailyKm([{ truckId: 'T1', date: '2026-10-01', kmM: 5000 }, { truckId: 'T1', date: '2026-10-03', kmM: 7000 }], t);
  assert.equal(m.get('2026-10-01').m, 100000);
  assert.equal(m.get('2026-10-01').source, 'trips');
  assert.equal(m.get('2026-10-02'), undefined);
  assert.equal(m.get('2026-10-03').source, 'daily');
});

test('ancorare: km încărcați = Σ călătorii între opriri; încărcare=alias confirmat', () => {
  const idx = buildTripIndex(TRIPS);
  const c = mk('A', '2026-10-01', '2026-10-02', 'ALSOZSOLCA - HALMEU');
  const a = anchorCourse(c, idx);
  assert.equal(a.ok, true);
  assert.equal(a.confidence, 'high');
  const expected = TRIPS.slice(3, 8).reduce((s, t) => s + t.distanceM, 0); // de la sosirea în Alsózsolca (k=3) până la Halmeu (k=8)
  assert.equal(a.meters, expected);
  const lk = resolveLoadedKm(c, { gpsTrips: TRIPS, gpsDays: [] });
  assert.equal(lk.source, 'gps-trips');
  assert.equal(lk.meters, expected);
  // coloana km are prioritate
  assert.equal(resolveLoadedKm({ ...c, loadedKm: { meters: 300000, source: 'column', confidence: 'high', at: null } }, { gpsTrips: TRIPS }).meters, 300000);
  // loc necunoscut + fără estimare => fereastra GPS (low)
  const w = resolveLoadedKm(mk('W', '2026-10-01', '2026-10-01', 'FOO - BAR'), { gpsTrips: TRIPS, gpsDays: [] });
  assert.equal(w.source, 'gps-window');
  assert.equal(w.confidence, 'low');
  // estimarea de rută are prioritate față de fereastră
  const est = { meters: 123000, source: 'route', confidence: 'medium', at: null };
  assert.equal(resolveLoadedKm(mk('W', '2026-10-01', '2026-10-01', 'FOO - BAR'), { gpsTrips: TRIPS, estimate: est }).meters, 123000);
});

// ---------------------------------------------------------------- km pe gol
const COURSES = [
  mk('A', '2026-10-01', '2026-10-02', 'ALSOZSOLCA - HALMEU'),
  mk('B', '2026-10-02', '2026-10-05', 'SATU MARE - TOROKSZENTMIKLOS'), // peste weekend (3-4 oct fără GPS)
  mk('C', '2026-10-06', '2026-10-06', 'SATU MARE - MEDIESU AURIT'),
  mk('D', '2026-10-07', '2026-10-08', 'MIERCUREA CIUC - VESZPREM'),  // Veszprém nu e vizitat niciodată
  mk('E', '2026-10-09', '2026-10-09', 'ARAD - SATU MARE'),            // vineri: camion inactiv
  mk('F1', '2026-10-12', '2026-10-14', 'DOROLT - SATU MARE'),
  mk('F2', '2026-10-13', '2026-10-14', 'SATU MARE - ARAD'),           // suprapus cu F1
  mk('G', '2026-10-08', '2026-10-08', 'UNGURAS - SEINI', { priceStatus: 'missing' }),
  mk('H', '2026-12-01', '2026-12-02', 'ARAD - ORADEA'),               // în afara intervalului GPS
];
const sumRows = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0);

for (const gran of ['day', 'week', 'month']) {
  test(`km pe gol (${gran}): încărcați + goi = GPS pe fiecare rând`, () => {
    const r = computeEmptyKm({ truckIds: ['T1'], range: RANGE, granularity: gran, courses: COURSES, gpsDays: [], gpsTrips: TRIPS, costs: { T1: 150 } });
    assert.ok(r.rows.length > 0);
    for (const row of r.rows) {
      assert.equal(row.loadedM + row.emptyM, row.gpsM, `${row.bucket}`);
      assert.ok(row.loadedM >= 0 && row.emptyM >= 0, `${row.bucket} negativ`);
    }
    assert.equal(sumRows(r.rows, 'gpsM'), 8376284);
    assert.equal(r.byTruck.T1.gpsM, 8376284);
    assert.equal(r.byTruck.T1.loadedM + r.byTruck.T1.emptyM, 8376284);
    assert.equal(r.totals.gpsM, 8376284);
    assert.ok(r.byTruck.T1.emptyCostRon > 0);
  });
}

test('km pe gol: cursa A ancorată = km reali între opriri, golul A->B în `gaps`', () => {
  const r = computeEmptyKm({ truckIds: ['T1'], range: RANGE, granularity: 'month', courses: COURSES, gpsDays: [], gpsTrips: TRIPS });
  const aKm = TRIPS.slice(3, 8).reduce((s, t) => s + t.distanceM, 0);
  const gapAB = r.gaps.find((g) => g.afterCourseId === 'A' && g.beforeCourseId === 'B');
  assert.ok(gapAB);
  assert.equal(gapAB.mode, 'trips');
  assert.equal(gapAB.emptyM, TRIPS[8].distanceM); // Halmeu -> Satu Mare
  assert.ok(r.byTruck.T1.loadedM >= aKm);
  assert.ok(r.byTruck.T1.anchoredCourses >= 3);
});

test('km pe gol: luna se împarte exact la limita de lună (cursă 30.09 -> 02.10)', () => {
  const crossing = [mk('X', '2026-09-30', '2026-10-02', 'ALSOZSOLCA - HALMEU')];
  const sep = computeEmptyKm({ truckIds: ['T1'], range: { from: '2026-09-01', to: '2026-10-31' }, granularity: 'month', courses: crossing, gpsDays: [], gpsTrips: TRIPS });
  for (const row of sep.rows) assert.equal(row.loadedM + row.emptyM, row.gpsM);
  assert.equal(sumRows(sep.rows, 'gpsM'), 8376284);
});

test('km pe gol: nivel de zi (doar foaia zilnică): încărcați=min(L, G) repartizat pe zile, mixte marcate', () => {
  const days = [
    { truckId: 'T2', date: '2026-10-01', kmM: 100000 }, { truckId: 'T2', date: '2026-10-02', kmM: 300000 },
    { truckId: 'T2', date: '2026-10-03', kmM: 100000 }, { truckId: 'T2', date: '2026-10-04', kmM: 0 }, { truckId: 'T2', date: '2026-10-05', kmM: 50000 },
  ];
  const c = { id: 'K', truckId: 'T2', loadDate: '2026-10-01', unloadDate: '2026-10-03', routeRaw: 'A - B', origin: 'A', destinations: ['B'], loadedKm: { meters: 350000, source: 'column', confidence: 'high', at: null } };
  const r = computeEmptyKm({ truckIds: ['T2'], range: { from: '2026-10-01', to: '2026-10-05' }, granularity: 'day', courses: [c], gpsDays: days, gpsTrips: [] });
  const by = Object.fromEntries(r.rows.map((x) => [x.bucket, x]));
  assert.equal(sumRows(r.rows, 'loadedM'), 350000); // L < G (500000)
  assert.equal(by['2026-10-01'].loadedM, 70000);
  assert.equal(by['2026-10-02'].loadedM, 210000);
  assert.equal(by['2026-10-03'].loadedM, 70000);
  assert.equal(by['2026-10-04'].emptyM, 0);
  assert.equal(by['2026-10-05'].emptyM, 50000);
  assert.equal(by['2026-10-04'].idleDays, 1);
  assert.ok(by['2026-10-01'].flags.includes('MIXED_DAYS'));
  for (const row of r.rows) assert.equal(row.loadedM + row.emptyM, row.gpsM);
  // km încărcați > km GPS => semnal și plafonare
  const big = { ...c, loadedKm: { meters: 900000, source: 'column', confidence: 'high', at: null } };
  const r2 = computeEmptyKm({ truckIds: ['T2'], range: { from: '2026-10-01', to: '2026-10-05' }, granularity: 'month', courses: [big], gpsDays: days, gpsTrips: [] });
  assert.ok(r2.issues.some((i) => i.code === 'LOADED_KM_GT_GPS'));
  assert.equal(r2.rows[0].loadedM, 500000);
  assert.equal(r2.rows[0].emptyM, 50000);
});

test('km pe gol: camion fără GPS => necunoscut (null), nu 0', () => {
  const r = computeEmptyKm({ truckIds: ['T9'], range: RANGE, granularity: 'month', courses: [mk('Z', '2026-10-01', '2026-10-02', 'A - B', { truckId: 'T9' })], gpsDays: [], gpsTrips: [] });
  assert.equal(r.rows[0].gpsM, null);
  assert.equal(r.rows[0].emptyM, null);
  assert.equal(r.rows[0].pctEmpty, null);
  assert.equal(r.byTruck.T9.emptyM, null);
  assert.deepEqual(r.trucksWithoutGps, ['T9']);
  assert.ok(r.issues.some((i) => i.code === 'NO_GPS_TRUCK'));
  assert.equal(r.totals.gpsM, 0);
});

test('km pe gol: zile fără GPS în interval parțial sunt marcate PARTIAL_GPS', () => {
  const r = computeEmptyKm({ truckIds: ['T1'], range: { from: '2026-09-01', to: '2026-10-31' }, granularity: 'month', courses: [], gpsDays: [], gpsTrips: TRIPS });
  const sep = r.rows.find((x) => x.bucket === '2026-09');
  assert.equal(sep, undefined); // nimic în septembrie (în afara acoperirii)
  assert.ok(r.rows.find((x) => x.bucket === '2026-10').flags.includes('PARTIAL_GPS'));
  assert.equal(r.rows.find((x) => x.bucket === '2026-10').emptyM, 8376284); // fără curse => totul gol
});

// ---------------------------------------------------------------- confruntare
test('confruntare: fiecare defect deliberat dă exact steagul așteptat', () => {
  const r = reconcile({ courses: COURSES, gpsDays: [], gpsTrips: TRIPS, now: '2026-11-18T10:00:00Z' });
  const byCode = (code) => r.flags.filter((f) => f.code === code);
  const refs = (f) => f.refs.map((x) => x.id).sort().join(',');

  assert.deepEqual(byCode('IDLE_ON_COURSE').map(refs), ['E']);
  assert.deepEqual(byCode('COURSE_OVERLAP').map(refs), ['F1,F2']);
  assert.deepEqual(byCode('PLACE_NOT_VISITED').map(refs), ['D']);
  assert.equal(byCode('PLACE_NOT_VISITED')[0].detail.which, 'unload');
  assert.deepEqual(byCode('COURSE_NO_PRICE').map(refs), ['G']);
  assert.deepEqual(byCode('NO_GPS_RANGE').map(refs), ['H']);
  assert.ok(byCode('UNCOVERED_ACTIVE_PERIOD').length >= 1);

  // cursele potrivite nu produc steaguri (în afara celor intenționate)
  const flagged = new Set(r.flags.flatMap((f) => f.refs.map((x) => x.id)));
  for (const ok of ['A', 'B', 'C']) assert.equal(flagged.has(ok), false, `cursa ${ok} nu trebuie să aibă steaguri`);
  assert.equal(r.flags.find((f) => f.code === 'IDLE_ON_COURSE').severity, 'high');
  assert.equal(r.flags.find((f) => f.code === 'NO_GPS_RANGE').severity, 'info');
});

test('confruntare: perioadele fără factură grupează zilele consecutive active', () => {
  const r = reconcile({ courses: [COURSES[0]], gpsDays: [], gpsTrips: TRIPS });
  const p = r.uncoveredPeriods;
  assert.ok(p.length >= 2);
  const first = p[0];
  assert.equal(first.from, '2026-10-05'); // 3-4 oct nu sunt active; 1-2 acoperite de A
  assert.equal(first.to, '2026-10-08');
  assert.equal(first.days, 4);
  assert.equal(first.kmM, TRIPS.filter((t) => t.start >= '2026-10-05' && t.start < '2026-10-09').reduce((s, t) => s + t.distanceM, 0));
  // suma km pe lună: în ferestre + în afara lor = total
  const m = r.monthly.find((x) => x.month === '2026-10');
  assert.equal(m.kmInInvoicedWindowsM + m.kmOutsideM, m.kmTotalM);
  assert.equal(m.kmTotalM, 8376284);
});

test('confruntare: starea și nota steagului supraviețuiesc reanalizei; steag rezolvat devine „stale”', () => {
  const first = reconcile({ courses: COURSES, gpsDays: [], gpsTrips: TRIPS });
  const idle = first.flags.find((f) => f.code === 'IDLE_ON_COURSE');
  const explained = setFlagStatus(idle, { status: 'explicat', note: 'cursă mutată pe 08.10' }, '2026-11-18T10:00:00Z');
  const second = reconcile({ courses: COURSES, gpsDays: [], gpsTrips: TRIPS, existingFlags: [explained] });
  const again = second.flags.find((f) => f.id === idle.id);
  assert.equal(again.status, 'explicat');
  assert.equal(again.note, 'cursă mutată pe 08.10');
  assert.throws(() => setFlagStatus(idle, { status: 'x' }));
  // corectăm data cursei E (vineri -> 08.10): steagul dispare din rezultat și apare în `staleFlagIds`
  const fixed = COURSES.map((c) => (c.id === 'E' ? { ...c, loadDate: '2026-10-08', unloadDate: '2026-10-08' } : c));
  const third = reconcile({ courses: fixed, gpsDays: [], gpsTrips: TRIPS, existingFlags: [explained] });
  assert.equal(third.flags.some((f) => f.id === idle.id), false);
  assert.ok(third.staleFlagIds.includes(idle.id));
});

test('confruntare: km GPS implauzibil de puțini față de ruta declarată', () => {
  const c = mk('L', '2026-10-06', '2026-10-06', 'SATU MARE - MEDIESU AURIT', { loadedKm: { meters: 2000000, source: 'column', confidence: 'high', at: null } });
  const r = reconcile({ courses: [c], gpsDays: [], gpsTrips: TRIPS });
  assert.ok(r.flags.some((f) => f.code === 'LOW_KM_VS_ROUTE'));
});

test('confruntare: doar foaia zilnică (fără călătorii) => fără PLACE_NOT_VISITED, IDLE funcționează', () => {
  const days = [];
  for (let d = 1; d <= 10; d++) days.push({ truckId: 'T1', date: `2026-10-${String(d).padStart(2, '0')}`, kmM: d === 5 ? 0 : 200000 });
  const r = reconcile({ courses: [mk('P', '2026-10-05', '2026-10-05', 'ARAD - ORADEA'), mk('Q', '2026-10-06', '2026-10-06', 'ARAD - ORADEA')], gpsDays: days, gpsTrips: [] });
  assert.deepEqual(r.flags.filter((f) => f.code === 'IDLE_ON_COURSE').map((f) => f.refs[0].id), ['P']);
  assert.equal(r.flags.some((f) => f.code === 'PLACE_NOT_VISITED'), false);
});

// ---------------------------------------------------------------- rutare (fetch simulat)
function fakeStore() {
  const cols = { places: new Map(), routeCache: new Map() };
  return {
    cols,
    get: (c, id) => cols[c].get(id) ?? null,
    list: (c) => [...cols[c].values()],
    put: async (c, rec) => { cols[c].set(rec.id, rec); return { undo() {} }; },
  };
}
function fakeFetch(log) {
  const geo = { ARAD: [46.18, 21.31, 'ro'], ORADEA: [47.05, 21.92, 'ro'], TURT: [47.9, 23.0, 'ro'] };
  return async (url) => {
    log.push(String(url));
    const u = new URL(url);
    if (u.hostname.includes('nominatim')) {
      const q = u.searchParams.get('q').toUpperCase();
      if (q === 'AMBIGUU') return { ok: true, json: async () => [{ lat: '1', lon: '1', importance: 0.5, name: 'A', address: { country_code: 'ro' } }, { lat: '2', lon: '2', importance: 0.45, name: 'B', address: { country_code: 'ro' } }] };
      const g = geo[q];
      return { ok: true, json: async () => (g ? [{ lat: String(g[0]), lon: String(g[1]), importance: 0.6, name: q, address: { country_code: g[2] } }] : []) };
    }
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 123456.4, duration: 5000 }] }) };
  };
}

test('routing: geocodare + OSRM cu cache, ambiguu => candidați, țară => fără estimare', async () => {
  const log = [];
  const store = fakeStore();
  let t = 0;
  const waits = [];
  const routing = createRouting({ store, fetchImpl: fakeFetch(log), clock: { now: () => t }, sleep: async (ms) => { waits.push(ms); t += ms; } });
  const c = { id: 'r1', routeRaw: 'ARAD - ORADEA' };
  const lk = await routing.estimateCourse(c);
  assert.equal(lk.meters, 123456);
  assert.equal(lk.source, 'route');
  assert.equal(lk.confidence, 'medium');
  assert.equal(store.list('places').length, 2);
  assert.equal(store.list('routeCache').length, 1);
  assert.ok(waits.some((w) => w > 0), 'respectă limita de cereri');
  const before = log.length;
  const again = await routing.estimateCourse(c);
  assert.equal(again.meters, 123456);
  assert.equal(log.length, before, 'a doua oară totul vine din cache');
  const amb = await routing.estimateCourse({ id: 'r2', routeRaw: 'ARAD - AMBIGUU' });
  assert.equal(amb.meters, null);
  assert.equal(amb.detail.reason, 'UNRESOLVED_PLACES');
  assert.deepEqual(amb.detail.unresolved, ['AMBIGUU']);
  const country = await routing.estimateCourse({ id: 'r3', routeRaw: 'MEDIESU AURIT - CROATIA' });
  assert.equal(country.meters, null);
  assert.equal(country.detail.reason, 'COUNTRY_ONLY');
  const manual = await routing.estimateCourse({ id: 'r4', routeRaw: 'ARAD - ORADEA', loadedKm: { meters: 5, source: 'manual' } });
  assert.equal(manual.meters, 5);
  // coada
  routing.queue.add([c, { id: 'r5', routeRaw: 'ARAD - TURT' }]);
  assert.equal(routing.queue.pending, 2);
  const prog = [];
  await routing.queue.run((d, n) => prog.push([d, n]));
  assert.deepEqual(prog, [[1, 2], [2, 2]]);
  assert.equal(routing.queue.results.get('r5').meters, 123456);
  assert.equal(routing.queue.pending, 0);
});

test('routing: rețea căzută => rezultat cu motiv NETWORK, nu excepție', async () => {
  const routing = createRouting({ store: fakeStore(), fetchImpl: async () => { throw new Error('offline'); }, sleep: async () => {} });
  const r = await routing.estimateCourse({ id: 'x', routeRaw: 'ARAD - ORADEA' });
  assert.equal(r.meters, null);
  assert.equal(r.detail.reason, 'NETWORK');
});
