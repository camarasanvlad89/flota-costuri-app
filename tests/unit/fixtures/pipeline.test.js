// Fixture-urile FICTIV și cele reale parcurg tot lanțul: xlsx/csv ⇒ import ⇒ confruntare. Valorile așteptate vin din
// fișierele *.expected.json (scrise independent de cod), nu din rezultatul codului.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFixtureJson, fixtureFile, readFixtureBytes } from '../../helpers/fixtures.js';
import { loadXlsx } from '../../../scripts/lib/xlsx-node.mjs';
import { setXlsxLib, readWorkbook } from '../../../src/import/xlsx-reader.js';
import { detectCourseMapping, parseCourseRows, planCourseImport, readCsv, decodeText, parseGpsFiles, planGpsImport } from '../../../src/import/index.js';
import { reconcile, setFlagStatus } from '../../../src/domain/reconcile.js';
import { computeEmptyKm } from '../../../src/domain/emptyKm.js';
import { buildDemoDb } from '../../../src/domain/demo-seed.js';

before(() => setXlsxLib(loadXlsx()));
const COMPANY = { countryCode: 'RO' };

async function coursesFrom(file, sheetName, plate, year, headerHint) {
  const wb = await readWorkbook(fixtureFile(...file));
  const sh = wb.sheets.find((s) => s.name === sheetName);
  assert.ok(sh, 'foaia ' + sheetName);
  const det = detectCourseMapping(sh.rows);
  assert.equal(det.headerRow, headerHint, 'antetul se găsește după nume, nu în rândul 1');
  const parsed = parseCourseRows(sh.rows, det.mapping, { plate, year, currency: 'RON', company: COMPANY, file: file[file.length - 1], sheet: sheetName });
  return { wb, sh, det, ...parsed };
}

test('registru real (aug.–oct. 2025): 7 foi cu plăcuță/an din numele foii; Munka1 fără plăcuță', async () => {
  const wb = await readWorkbook(fixtureFile('courses', 'tabel-curse-registru-aug-oct-2025.xlsx'));
  assert.deepEqual(wb.sheets.map((s) => [s.name, s.plate, s.year]), [
    ['XX01DEM 2025', 'XX01DEM', 2025], ['XX02DEM 2025', 'XX02DEM', 2025], ['XX00DEM 2025', 'XX00DEM', 2025], ['Munka1', null, null],
    ['XX01DEM', 'XX01DEM', null], ['XX02DEM', 'XX02DEM', null], ['XX00DEM', 'XX00DEM', null]]);
});

test('rândurile 121–147 din poză: fiecare rând = valorile transcrise (net/TVA/total, opriri, predare, K)', async () => {
  const E = readFixtureJson('courses', 'tabel-curse-rd121-147.expected.json');
  const { drafts, det } = await coursesFrom(['courses', 'tabel-curse-registru-aug-oct-2025.xlsx'], 'XX00DEM 2025', 'XX00DEM', 2025, E.headerRow - 1);
  assert.deepEqual(det.mapping.cols.strayCols ?? det.mapping.strayCols, [10], 'coloana K fără antet = rătăcită');
  assert.equal(drafts.length, E.rows.length);
  for (const e of E.rows) {
    const d = drafts.find((x) => x.sheet.row === e.row);
    assert.ok(d, 'rând ' + e.row);
    const at = `rând ${e.row} (${e.route})`;
    assert.equal(d.loadDate, e.loadDate, at); assert.equal(d.unloadDate, e.unloadDate, at);
    assert.equal(d.plate, e.truck, at); assert.equal(d.trailerPlate, e.trailer, at); assert.equal(d.driverName, e.driver, at);
    assert.equal(d.origin, e.origin, at);
    assert.deepEqual(d.destinations, e.stops, at);
    assert.equal(d.priceStatus, e.priceStatus, at);
    if (e.priceStatus !== 'missing') { assert.equal(d.net, e.netMinor, at + ' net'); assert.equal(d.vat, e.vatMinor, at + ' TVA'); assert.equal(d.gross, e.grossMinor, at + ' brut'); }
    assert.equal(!!d.vatDerived, e.priceStatus === 'derived', at);
    if (e.priceStatus === 'missing') { assert.equal(d.status, 'review', at); assert.deepEqual(d.strayValues, [e.strayK], at); }
    if (e.handoverTo) { assert.equal(d.handoverTo, e.handoverTo, at); assert.ok(d.note.includes('lepakolni'), 'nota păstrată ca atare'); }
    if (e.destOnlyCountry) { assert.equal(d.destCountry, e.destCountry, at + ' țara destinației'); assert.deepEqual(d.destinations, [], at); assert.equal(d.destCountryOnly, true, at); }
  }
  const driverSet = new Set(drafts.map((d) => d.driverName));
  assert.deepEqual([...driverSet].sort(), ['ANDOR', 'DORIAN', 'KALMAN']);
});

test('lanțul în aceeași zi (141 ⇒ 142; 126 ⇒ 127) nu e suprapunere; cursa 127 este într-o singură zi', async () => {
  const { drafts } = await coursesFrom(['courses', 'tabel-curse-registru-aug-oct-2025.xlsx'], 'XX00DEM 2025', 'XX00DEM', 2025, 119);
  const r = (n) => drafts.find((d) => d.sheet.row === n);
  assert.equal(r(141).unloadDate, r(142).loadDate);
  const rec = reconcile({ courses: drafts.map((d) => ({ ...d, truckId: 'T' })), gpsDays: [], gpsTrips: [], now: '2026-11-18T00:00:00Z' });
  assert.equal(rec.flags.filter((f) => f.code === 'COURSE_OVERLAP').length, 0, 'nicio suprapunere în rândurile din poză');
});

test('CSV (UTF-8 cu BOM, ; și virgulă zecimală) și CSV Windows-1250 dau aceleași curse ca xlsx; reimport = 0 noi', async () => {
  const x = await coursesFrom(['courses', 'tabel-curse-registru-aug-oct-2025.xlsx'], 'XX00DEM 2025', 'XX00DEM', 2025, 119);
  for (const name of ['tabel-curse-XX00DEM-2025-rd121-147.csv', 'tabel-curse-XX00DEM-2025-rd121-147.cp1250.csv']) {
    const buf = readFixtureBytes('courses', name);
    const text = decodeText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const csv = readCsv(text);
    assert.equal(csv.delimiter, ';', name);
    const det = detectCourseMapping(csv.rows);
    const p = parseCourseRows(csv.rows, det.mapping, { plate: 'XX00DEM', year: 2025, currency: 'RON', company: COMPANY, file: name, sheet: 'csv' });
    assert.equal(p.drafts.length, x.drafts.length, name);
    for (let i = 0; i < x.drafts.length; i++) {
      for (const k of ['loadDate', 'unloadDate', 'routeRaw', 'net', 'vat', 'gross', 'priceStatus', 'driverName', 'id']) assert.deepEqual(p.drafts[i][k], x.drafts[i][k], `${name} rând ${i} ${k}`);
    }
  }
  const first = planCourseImport(x.drafts, []);
  assert.equal(first.add.length, 27);
  const existing = x.drafts.map((d) => ({ ...d, id: d.id }));
  const again = planCourseImport(x.drafts, existing);
  assert.equal(again.add.length, 0, 'reimport idempotent: 0 adăugate');
  assert.equal(again.update.length, 0); assert.equal(again.unchanged.length, 27); assert.equal(again.orphaned.length, 0);
});

test('tabel FICTIV oct. 2026: antet în rândul 3, sume exacte, rând doar cu Total (derivat), fără preț + K, număr stocat ca text', async () => {
  const E = readFixtureJson('fictiv', 'FICTIV-curse-XX00DEM-oct2026.expected.json');
  const { drafts } = await coursesFrom(['fictiv', 'FICTIV-curse-XX00DEM-oct2026.xlsx'], 'XX00DEM 2026', 'XX00DEM', 2026, E.headerRow - 1);
  assert.equal(drafts.length, E.rows.length);
  for (const e of E.rows) {
    const d = drafts.find((x) => x.sheet.row === e.row); assert.ok(d, 'rând ' + e.row);
    const at = `cursa ${e.n} ${e.route}`;
    assert.equal(d.loadDate, e.loadDate, at); assert.equal(d.unloadDate, e.unloadDate, at); assert.equal(d.priceStatus, e.priceStatus, at);
    if (e.netMinor !== null) { assert.equal(d.net, e.netMinor, at); assert.equal(d.vat, e.vatMinor, at); assert.equal(d.gross, e.grossMinor, at); }
    if (e.strayK) assert.deepEqual(d.strayValues, [e.strayK], at);
  }
  assert.ok(drafts.find((d) => d.sheet.row === E.rows[9].row).net > 0, 'net stocat ca text „2534,70” citit corect');
  assert.ok(E.rows.find((r) => r.n === 8).note === undefined);
  const hu = drafts.find((d) => d.routeRaw === 'MIERCUREA CIUC - UNGURAS');
  assert.ok(hu.note.includes('ő'), 'caracterele ungurești din note se păstrează');
});

test('GPS real: ambele exporturi + varianta XX01DEM într-o singură importare multiplă; reimport = 0 adăugate', async () => {
  const X = readFixtureJson('gps', 'expected-XX00DEM-oct2026.json');
  const files = [fixtureFile('gps', 'safefleet-calatorii-XX00DEM-oct2026.xlsx'), fixtureFile('gps', 'safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx'),
    fixtureFile('gps', 'FICTIV-foaie-activitate-zilnica-XX01DEM-aug2026.xlsx')];
  const r = await parseGpsFiles(files);
  assert.deepEqual([...r.dataset.plates].sort(), ['XX00DEM', 'XX01DEM']);
  const cj = r.dataset.days.filter((d) => d.plate === 'XX00DEM');
  assert.equal(cj.length, X.daily.days);
  assert.equal(cj.reduce((s, d) => s + d.kmM, 0), X.trips.totalM);
  assert.equal(r.dataset.trips.length, X.trips.count);
  assert.equal(r.dataset.trips.filter((t) => t.kmM < 2000).length, X.trips.under2kmCount);
  assert.equal(cj.filter((d) => d.idle).length, X.daily.idleDays);
  assert.deepEqual(cj.filter((d) => d.idle).map((d) => d.date), X.daily.idleDayList);
  for (const [d, m] of Object.entries(X.kmByDayM)) assert.equal(cj.find((x) => x.date === d).kmM, m, 'km pe ziua ' + d);
  const chk = r.dataset.checks.find((c) => c.plate === 'XX00DEM');
  assert.equal(chk.odoDeltaM, X.odometer.deltaM);
  assert.ok(chk.tripsVsOdoPct <= X.odometer.tolerancePct / 100, 'diferența față de odometru în toleranța de 0,5%');
  const sm = r.dataset.days.filter((d) => d.plate === 'XX01DEM');
  assert.equal(sm.length, 31); assert.equal(sm[0].date, '2026-08-01', 'perioada nu se presupune: august 2026');
  assert.equal(r.issues.filter((i) => i.severity === 'warn' && /odometru/i.test(i.message || '')).length, 0, 'XX01DEM are odometru consecvent');

  const trucks = [{ id: 'trk_cj', plate: 'XX00DEM' }, { id: 'trk_sm', plate: 'XX 01 DEM' }];
  const plan1 = planGpsImport(r.dataset, [], trucks);
  assert.equal(plan1.add.length, 62); assert.deepEqual(plan1.unmatchedPlates, []);
  const stored = plan1.add.map((d) => ({ ...d }));
  const plan2 = planGpsImport(r.dataset, stored, trucks, plan1.trips.add);
  assert.equal(plan2.add.length, 0); assert.equal(plan2.replace.length, 0);
  assert.equal(plan2.trips.add.length, 0);
});

test('GPS: odometru greșit (>1%) ⇒ avertizare; călătorie peste miezul nopții păstrează ziua de start; manevră < 2 km', async () => {
  const bad = await parseGpsFiles([fixtureFile('gps', 'FICTIV-foaie-activitate-zilnica-XX00DEM-odometru-gresit.xlsx')]);
  const f = bad.files[0];
  assert.equal(f.odometerCheck.withinTolerance, false);
  assert.ok(bad.issues.some((i) => /odometru/i.test(i.message) || /odo/i.test(i.code)), 'avertizare odometru');
  const X = readFixtureJson('gps', 'FICTIV-calatorii-peste-miezul-noptii.expected.json');
  const mid = await parseGpsFiles([fixtureFile('gps', 'FICTIV-calatorii-peste-miezul-noptii.xlsx')]);
  const t = mid.dataset.trips;
  assert.equal(t.length, X.tripsCount);
  assert.equal(t.reduce((s, x) => s + x.kmM, 0), X.totalM);
  assert.equal(t[0].date, X.startDayOfTrip1); assert.ok(t[0].stop.startsWith(X.stopDayOfTrip1));
  assert.equal(t.filter((x) => x.kmM < 2000).length, X.under2km);
});

// ───────────── confruntare + km pe gol pe tabelul FICTIV ─────────────
async function fictivWorld() {
  const E = readFixtureJson('fictiv', 'FICTIV-curse-XX00DEM-oct2026.expected.json');
  const { drafts } = await coursesFrom(['fictiv', 'FICTIV-curse-XX00DEM-oct2026.xlsx'], 'XX00DEM 2026', 'XX00DEM', 2026, 2);
  const byN = new Map(E.rows.map((e) => [e.n, drafts.find((d) => d.sheet.row === e.row)]));
  const courses = drafts.map((d) => ({ ...d, truckId: 'trk_cj' }));
  const g = await parseGpsFiles([fixtureFile('gps', 'safefleet-calatorii-XX00DEM-oct2026.xlsx'), fixtureFile('gps', 'safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx')]);
  const gpsTrips = g.dataset.trips.map((t) => ({ truckId: 'trk_cj', start: t.start, stop: t.stop, startPos: t.from.raw, stopPos: t.to.raw, distanceM: t.kmM }));
  const gpsDays = g.dataset.days.map((d) => ({ truckId: 'trk_cj', date: d.date, kmM: d.kmM }));
  const aliasesFx = readFixtureJson('fictiv', 'aliases-FICTIV.json');
  return { E, drafts, byN, courses, gpsTrips, gpsDays, aliasesFx };
}

test('confruntare pe FICTIV: fiecare defect deliberat dă exact steagul așteptat; cursele curate nu au steaguri', async () => {
  const W = await fictivWorld();
  const F = readFixtureJson('fictiv', 'FICTIV-expected-flags.json');
  const aliases = W.aliasesFx;
  const r = reconcile({ courses: W.courses, gpsDays: W.gpsDays, gpsTrips: W.gpsTrips, aliases, now: '2026-11-18T10:00:00Z' });
  const idOf = (n) => W.byN.get(n).id;
  const refsOf = (f) => f.refs.map((x) => x.id);
  const allowed = new Set(F.allowedExtra.flatMap((a) => (a.also || []).map((c) => c + '@' + (a.course ?? a.courses.join('+')))));
  for (const q of F.required) {
    const ids = q.courses ? q.courses.map(idOf) : q.course ? [idOf(q.course)] : [];
    const hit = r.flags.filter((f) => f.code === q.code && (q.period ? (f.detail?.from ?? f.date) === q.period.from || JSON.stringify(f).includes(q.period.from) : ids.every((i) => refsOf(f).includes(i))));
    assert.ok(hit.length >= 1, `lipsește ${q.code} pentru ${JSON.stringify(q.courses || q.course || q.period)}: ${q.why}`);
  }
  const requiredCodesByCourse = new Map();
  for (const q of F.required) for (const n of q.courses || (q.course ? [q.course] : [])) { const s = requiredCodesByCourse.get(n) || new Set(); s.add(q.code); requiredCodesByCourse.set(n, s); }
  for (const n of F.cleanCourses) {
    const flags = r.flags.filter((f) => refsOf(f).includes(idOf(n)));
    assert.deepEqual(flags.map((f) => f.code), [], `cursa curată ${n} (${W.byN.get(n).routeRaw}) are steaguri: ${flags.map((f) => f.code)}`);
  }
  for (const n of F.defectiveCourses) {
    const got = new Set(r.flags.filter((f) => refsOf(f).includes(idOf(n))).map((f) => f.code));
    const want = requiredCodesByCourse.get(n) || new Set();
    for (const c of got) assert.ok(want.has(c) || allowed.has(c + '@' + n) || [...allowed].some((a) => a.startsWith(c + '@') && a.includes(String(n))), `cursa ${n}: steag neașteptat ${c}`);
  }
  const unc = r.uncoveredPeriods.map((p) => [p.from, p.to]);
  assert.deepEqual(unc, [['2026-10-17', '2026-10-17'], ['2026-10-23', '2026-10-23']]);
  const X = readFixtureJson('gps', 'expected-XX00DEM-oct2026.json');
  assert.equal(r.uncoveredPeriods[0].kmM, X.kmByDayM['2026-10-17']);
  assert.equal(r.uncoveredPeriods[1].kmM, X.kmByDayM['2026-10-23']);
});

test('confruntare: starea și nota unui steag supraviețuiesc reanalizei (id determinist)', async () => {
  const W = await fictivWorld();
  const first = reconcile({ courses: W.courses, gpsDays: W.gpsDays, gpsTrips: W.gpsTrips, now: '2026-11-18T10:00:00Z' });
  const idle = first.flags.find((f) => f.code === 'IDLE_ON_COURSE');
  const explained = setFlagStatus(idle, { status: 'explicat', note: 'camionul a stat la depozit; factura e pentru altă zi' }, '2026-11-18T11:00:00Z');
  const second = reconcile({ courses: W.courses, gpsDays: W.gpsDays, gpsTrips: W.gpsTrips, existingFlags: [explained], now: '2026-11-18T12:00:00Z' });
  const again = second.flags.find((f) => f.id === idle.id);
  assert.equal(again.status, 'explicat'); assert.match(again.note, /depozit/);
});

test('km pe gol pe FICTIV: încărcați + goi = GPS pe fiecare rând (lună, săptămână, zi) și totalul = 8.376,284 km', async () => {
  const W = await fictivWorld();
  const X = readFixtureJson('gps', 'expected-XX00DEM-oct2026.json');
  for (const granularity of ['month', 'week', 'day']) {
    const r = computeEmptyKm({ truckIds: ['trk_cj'], range: { from: '2026-10-01', to: '2026-10-31' }, granularity, courses: W.courses, gpsDays: W.gpsDays, gpsTrips: W.gpsTrips });
    assert.ok(r.rows.length > 0, granularity);
    for (const row of r.rows) assert.equal(row.loadedM + row.emptyM, row.gpsM, `${granularity} ${row.bucket}`);
    assert.equal(r.rows.reduce((s, x) => s + x.gpsM, 0), X.trips.totalM, granularity);
  }
});

test('seed-ul demo folosește aceleași date ca fixture-urile: GPS real și rândurile din poză', () => {
  const db = buildDemoDb(1); const C = db.collections;
  const X = readFixtureJson('gps', 'expected-XX00DEM-oct2026.json');
  assert.equal(C.gpsTrips.length, X.trips.count);
  assert.equal(C.gpsTrips.reduce((s, t) => s + t.distanceM, 0), X.trips.totalM);
  const P = readFixtureJson('courses', 'tabel-curse-rd121-147.expected.json');
  const rows = C.courses.filter((c) => c.sheet?.name === 'XX00DEM 2025');
  assert.equal(rows.length, P.rows.length);
  for (const e of P.rows) {
    const c = rows.find((r) => r.sheet.row === e.row); assert.ok(c, 'rând ' + e.row);
    assert.equal(c.loadDate, e.loadDate); assert.equal(c.unloadDate, e.unloadDate);
    if (e.netMinor != null) { assert.equal(c.net, e.netMinor, 'net rând ' + e.row); assert.equal(c.gross, e.grossMinor, 'brut rând ' + e.row); }
  }
  assert.equal(db.meta.demoBadge, 'date demo');
});

test('curse în aceeași zi: ordinea din registru (rândul foii) se păstrează la sortare, nu ordinea hash-ului id-ului', async () => {
  const { sortCourses } = await import('../../../src/domain/gpsKm.js');
  const W = await fictivWorld();
  // aceleași date de încărcare/descărcare, lanț logic în ordinea rândurilor: 12⇒13 (14.10), 18⇒19 (20.10), 22⇒23 (26.10)
  for (const [a, b] of [[12, 13], [18, 19], [22, 23]]) {
    const sorted = sortCourses(W.courses.filter((c) => [W.byN.get(a).id, W.byN.get(b).id].includes(c.id))).map((c) => c.sheet.row);
    assert.deepEqual(sorted, [W.byN.get(a).sheet.row, W.byN.get(b).sheet.row], `cursele ${a} și ${b} au ordinea inversată`);
  }
});

test('opriri lungi la același loc (weekend la depou/Seini): încărcarea de la data plecării e găsită chiar dacă sosirea a fost cu >1 zi înainte', async () => {
  const { buildTripIndex, anchorCourse } = await import('../../../src/domain/gpsKm.js');
  const W = await fictivWorld();
  const idx = buildTripIndex(W.gpsTrips);
  const a = anchorCourse(W.byN.get(9), idx, { aliases: W.aliasesFx });   // SEINI - ALSOZSOLCA, 12.10; camionul a sosit la Seini pe 08.10 și a plecat pe 12.10
  assert.equal(a.ok, true, `ancorare eșuată: ${a.reason}`);
});
