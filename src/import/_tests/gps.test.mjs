import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HAS_XLSX, REF, XLSX } from './helpers.mjs';
import { readWorkbook } from '../xlsx-reader.js';
import { detectGpsMapping, parseGpsRows, planGpsImport, buildGpsDataset, parseGpsFiles, groupManeuvers, parseAddress } from '../gps-importer.js';
import { normalizePlate } from '../../core/plates.js';
import { kmToMeters } from '../cells.js';

const opts = { skip: !HAS_XLSX && 'SheetJS lipsește (vendor/xlsx.full.min.js sau FLOTA_XLSX_LIB)' };
const load = async (name) => {
  const buf = readFileSync(path.join(REF, name));
  const file = { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  return file;
};
const DAILY = 'safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx';
const TRIPS = 'safefleet-calatorii-XX00DEM-oct2026.xlsx';
const trucks = [{ id: 'trk_1', plate: 'XX00DEM' }];

test('kmToMeters', () => {
  assert.equal(kmToMeters('471,624'), 471624);
  assert.equal(kmToMeters(471.624), 471624);
  assert.equal(kmToMeters('~358257.9 km'), 358257900);
  assert.equal(kmToMeters('52,4 km/h'), 52400);
  assert.equal(kmToMeters('(necunoscut)'), null);
});

test('parseAddress', () => {
  const a = parseAddress('[DN19, Orașu Nou, 447220, România]');
  assert.deepEqual([a.street, a.locality, a.postcode, a.country, a.countryCode], ['DN19', 'Orașu Nou', '447220', 'România', 'RO']);
  assert.equal(parseAddress('[Drum local, Hajdúdorog, 4087, Ungaria]').countryCode, 'HU');
});

test('foaie zilnică reală: 8.376,3 km, 31 zile, odometru', opts, async () => {
  const wb = await readWorkbook(await load(DAILY));
  const rows = wb.sheets[0].rows;
  const det = detectGpsMapping(rows);
  assert.equal(det.kind, 'daily'); assert.equal(det.plate, 'XX00DEM');
  const p = parseGpsRows(rows, det.mapping, { file: DAILY });
  assert.equal(p.days.length, 31);
  assert.equal(p.summary.sumM, 8376284);
  assert.equal(p.days[0].date, '2026-10-01'); assert.equal(p.days[0].kmM, 471624);
  assert.equal(p.days[2].idle, true); assert.equal(p.days[2].startAt, null);
  assert.equal(p.odometerCheck.odoDeltaM, 8377400); assert.equal(p.odometerCheck.diffM, 1116);
  assert.equal(p.odometerCheck.withinTolerance, true);
  assert.equal(p.summary.idleDays, 9);
});

test('călătorii reale: 138 rânduri, 8.376,3 km, 43 manevre, țări', opts, async () => {
  const wb = await readWorkbook(await load(TRIPS));
  const rows = wb.sheets[0].rows;
  const det = detectGpsMapping(rows);
  assert.equal(det.kind, 'trips'); assert.equal(det.plate, 'XX00DEM');
  const p = parseGpsRows(rows, det.mapping, {});
  assert.equal(p.trips.length, 138);
  assert.equal(p.summary.sumM, 8376284);
  assert.equal(p.summary.maneuvers, 43);
  assert.equal(Math.round(p.summary.byCountry.RO / 1000), 6326); assert.equal(Math.round(p.summary.byCountry.HU / 1000), 2050);
  assert.equal(p.trips[0].from.locality, 'Orașu Nou'); assert.equal(p.trips[0].to.locality, 'Hajdúdorog');
  assert.equal(p.trips[0].avgKmh, 52.4);
  assert.match(p.trips[0].start, /^2026-10-01T05:45:54$/);
  assert.ok(groupManeuvers(p.trips).length < p.trips.length);
});

test('multi-fișier + idempotență + zilnic vs călătorii', opts, async () => {
  const files = [await load(DAILY), await load(TRIPS)];
  const r = await parseGpsFiles(files);
  assert.equal(r.files.length, 2);
  assert.deepEqual(r.dataset.plates, ['XX00DEM']);
  const chk = r.dataset.checks[0];
  assert.equal(chk.tripsKmM, 8376284); assert.equal(chk.tripsVsDailyOk, true);
  assert.equal(chk.tripsVsOdoOk, true); // 1,1 km din 8377,4
  const total = r.dataset.days.reduce((s, d) => s + d.kmM, 0);
  assert.equal(total, 8376284);
  assert.equal(r.dataset.days.length, 31);
  const plan1 = planGpsImport(r.dataset, [], trucks, []);
  assert.equal(plan1.add.length, 31); assert.equal(plan1.trips.add.length, 138); assert.equal(plan1.unmatchedPlates.length, 0);
  const days = plan1.add, trips = plan1.trips.add;
  const plan2 = planGpsImport(r.dataset, days, trucks, trips);
  assert.equal(plan2.add.length, 0); assert.equal(plan2.replace.length, 0); assert.equal(plan2.unchanged.length, 31);
  assert.equal(plan2.trips.add.length, 0); assert.equal(plan2.trips.unchanged.length, 138);
  // un fișier singur reimportat dă același rezultat
  const plan3 = planGpsImport(await parseGpsFiles([files[1]]).then((x) => x.dataset), [], trucks, []);
  assert.ok(plan3.add.length >= 30);
  // modificare => replace
  const mod = days.map((d, i) => (i === 0 ? { ...d, kmM: 1 } : d));
  assert.equal(planGpsImport(r.dataset, mod, trucks, trips).replace.length, 1);
  // plăcuță fără potrivire
  assert.deepEqual(planGpsImport(r.dataset, [], [{ id: 'x', plate: 'B123ABC' }]).unmatchedPlates, ['XX00DEM']);
});

test('doar călătorii: zilele se derivă din ziua de start; 31.10 lipsește fără foaie zilnică', opts, async () => {
  const r = await parseGpsFiles([await load(TRIPS)]);
  assert.ok(r.dataset.days.every((d) => d.source === 'trips'));
  assert.equal(r.dataset.days.reduce((s, d) => s + d.kmM, 0), 8376284);
});

test('călătorie peste miezul nopții intră în ziua de start', () => {
  const hdr = ['Nr.', 'Start', 'Stop', 'Poziţie Start', 'Poziţie Stop', 'Distanță'];
  const rows = [hdr, ['1', 46296.9, 46297.1, '[A, Arad, 310000, România]', '[B, Satu Mare, 440000, România]', 100.5], [], ['Număr De Înmatriculare', 'XX-00-DEM']];
  const det = detectGpsMapping(rows);
  const p = parseGpsRows(rows, det.mapping, {});
  assert.equal(p.trips[0].date, '2026-10-01'); assert.equal(p.trips[0].kmM, 100500); assert.equal(p.plate, 'XX00DEM');
  const ds = buildGpsDataset([p]);
  assert.equal(ds.days.length, 1);
});

test('normalizare plăcuță', () => {
  for (const s of ['B 123 ABC', 'B123ABC', 'b-123-abc']) assert.equal(normalizePlate(s), 'B123ABC');
});

test('fără date GPS pentru un camion: nu apare în plan', () => {
  const plan = planGpsImport({ plates: [], days: [], trips: [], checks: [], issues: [] }, [], trucks);
  assert.equal(plan.add.length, 0);
});
