import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCourseMapping } from '../mapping.js';
import { parseCourseRows, planCourseImport, currencySample } from '../courses-importer.js';
import { detectSheetInfo } from '../xlsx-reader.js';
import { HEADER } from './helpers.mjs';

// rânduri-test din poză (6.1); coloana A goală, K = rătăcit
const R = (b, c, d, e, f, g, h, i, j, k) => [null, b, c, d, e, f, g, h, i, j, k];
const photo = [
  [null, ...HEADER, null],
  R('07.08.2025', '09.08.2025', 'XX00DEM/XX30DEM', 'DORIAN', 'CAREI - SZEKESFEHERVAR', 2940.66, 617.54, 3558.20, null, null),
  R('12.08.2025', '13.08.2025', 'XX00DEM/XX30DEM', 'DORIAN', 'KISVARDA - ORADEA', '2105,13', 442.08, 2547.21, null, null),
  R('14.08.2025', '14.08.2025', 'XX00DEM/XX30DEM', 'DORIAN', 'SIMLEU SILVANIEI - CEHU+ZALAU', 1250, 262.5, 1512.5, null, null),
  R('15.08.2025', '15.08.2025', 'XX00DEM/XX30DEM', 'DORIAN', 'ORADEA - SANMIHAIU', 950, 199.5, 1149.5, 'lepakolni Kalman', null),
  R('20.08.2025', '21.08.2025', 'XX00DEM/XX30DEM', 'KALMAN', 'PECS - SIBIU', null, null, null, null, 3900),
  R('23.08.2025', '23.08.2025', 'XX00DEM/XX30DEM', 'KALMAN', 'SANMARTIN - TAUTII MAGHERAUS', 950, 199.5, 1149.5, 'lepakolni Dorian', null),
  R('28.08.2025', '30.08.2025', 'XX00DEM/XX30DEM', 'KALMAN', 'CAREI - CROATIA', 4081.54, 857.12, 4938.66, null, null),
  R('06.09.2025', '07.09.2025', 'XX00DEM/XX30DEM', 'KALMAN', 'TARGU MURES - HAJDUBOSZORMENY', null, null, 1557.94, null, null),
  R('12.09.2025', '12.09.2025', 'XX00DEM/XX30DEM', 'KALMAN', 'KISVARDA - SALONTA', null, null, 2107.9, null, null),
  R('12.09.2025', '13.09.2025', 'XX00DEM/XX30DEM', 'KALMAN', 'CLUJ NAPOCA - TURDA', 950, 199.5, 1149.5, 'lepakolni Kalman', null),
  R('16.09.2025', '17.09.2025', 'XX00DEM/XX30DEM', 'ANDOR', 'NAGYKALLO - LUGOJ', 950, 199.5, 1149.5, null, null),
  R('18.09.2025', '19.09.2025', 'XX00DEM/XX30DEM', 'ANDOR', 'ORADEA - SALONTA + SACUENI +VALEA LUI MIHAI', 1320, 277.2, 1597.2, null, null),
];
// antet adâncit sub 100 de rânduri goale
const deep = [...Array.from({ length: 130 }, () => [null, null, null]), ...photo];

test('detectCourseMapping: antete reale, ignoră K', () => {
  const { mapping, headerRow, confidence } = detectCourseMapping(photo);
  assert.equal(headerRow, 0);
  assert.deepEqual(mapping.cols, { loadDate: 1, unloadDate: 2, plates: 3, driver: 4, route: 5, net: 6, vat: 7, gross: 8, note: 9 });
  assert.deepEqual(mapping.strayCols, [10]);
  assert.ok(confidence > 0.8);
});

test('antetul se găsește sub rândul 100', () => {
  const d = detectCourseMapping(deep);
  assert.equal(d.headerRow, 130);
  const { drafts } = parseCourseRows(deep, d.mapping, { plate: 'XX00DEM', currency: 'RON' });
  assert.equal(drafts.length, 12);
});

test('fără antet: două coloane de date nu se ghicesc', () => {
  const body = photo.slice(1).map((r) => r.slice());
  const d = detectCourseMapping(body);
  assert.equal(d.mapping.method, 'content');
  assert.ok(d.mapping.needsUser);
  assert.ok(d.mapping.ambiguities.some((a) => a.fields.includes('loadDate') && a.columns.length === 2));
  assert.equal(d.mapping.cols.loadDate, undefined);
  assert.equal(d.mapping.cols.plates, 3);
  assert.equal(d.mapping.cols.route, 5);
  assert.deepEqual([d.mapping.cols.net, d.mapping.cols.vat, d.mapping.cols.gross], [6, 7, 8]);
});

function parse() {
  const { mapping } = detectCourseMapping(photo);
  return parseCourseRows(photo, mapping, { plate: 'XX00DEM', year: 2025, currency: 'RON', file: 't.xlsx', sheet: 'XX00DEM 2025' });
}

test('rânduri din poză: valori exacte', () => {
  const { drafts, issues } = parse();
  const by = (route) => drafts.find((d) => d.routeRaw === route);
  let d = by('CAREI - SZEKESFEHERVAR');
  assert.deepEqual([d.net, d.vat, d.gross, d.priceStatus, d.status], [294066, 61754, 355820, 'ok', 'ok']);
  assert.equal(d.plate, 'XX00DEM'); assert.equal(d.trailerPlate, 'XX30DEM');
  d = by('KISVARDA - ORADEA');
  assert.deepEqual([d.net, d.vat, d.gross], [210513, 44208, 254721]);
  d = by('SIMLEU SILVANIEI - CEHU+ZALAU');
  assert.deepEqual(d.destinations, ['CEHU', 'ZALAU']);
  assert.equal(by('ORADEA - SANMIHAIU').handoverTo, 'Kalman');
  assert.equal(by('ORADEA - SANMIHAIU').note, 'lepakolni Kalman');
  assert.equal(by('SANMARTIN - TAUTII MAGHERAUS').handoverTo, 'Dorian');
  d = by('PECS - SIBIU');
  assert.equal(d.priceStatus, 'missing'); assert.equal(d.status, 'review'); assert.deepEqual(d.strayValues, [3900]);
  assert.ok(issues.some((x) => x.code === 'no_price' && /posibil preț/.test(x.message)));
  d = by('CAREI - CROATIA');
  assert.equal(d.destCountry, 'HR'); assert.deepEqual(d.destinations, []); assert.ok(d.destCountryOnly);
  assert.equal(d.net, 408154);
  d = by('TARGU MURES - HAJDUBOSZORMENY');
  assert.deepEqual([d.net, d.vat, d.gross, d.vatDerived, d.priceStatus, d.vatBp], [128755, 27039, 155794, true, 'derived', 2100]);
  d = by('KISVARDA - SALONTA');
  assert.deepEqual([d.net, d.vat], [174207, 36583]);
  d = by('NAGYKALLO - LUGOJ'); assert.equal(d.driverRaw, 'ANDOR');
  d = by('ORADEA - SALONTA + SACUENI +VALEA LUI MIHAI');
  assert.deepEqual(d.destinations, ['SALONTA', 'SACUENI', 'VALEA LUI MIHAI']);
  assert.deepEqual([d.net, d.vat, d.gross], [132000, 27720, 159720]);
  // lanț în aceeași zi: nu e suprapunere
  assert.ok(!issues.some((x) => x.code === 'course_overlap'));
  assert.equal(by('CLUJ NAPOCA - TURDA').vatBp, 2100);
});

test('Total-doar pe tratament zero/reverse: net = brut', () => {
  const { mapping } = detectCourseMapping(photo);
  const { drafts } = parseCourseRows(photo, mapping, { plate: 'XX00DEM', currency: 'EUR', vatTreatment: 'zero' });
  const d = drafts.find((x) => x.routeRaw === 'TARGU MURES - HAJDUBOSZORMENY');
  assert.deepEqual([d.net, d.vat, d.gross, d.vatDerived, d.priceStatus], [155794, 0, 155794, false, 'ok']);
});

test('plan idempotent + câmpuri manuale + orfane', () => {
  const { drafts } = parse();
  let plan = planCourseImport(drafts, []);
  assert.equal(plan.add.length, 12);
  const existing = drafts.map((d) => ({ ...d, loadedKm: undefined }));
  plan = planCourseImport(drafts, existing);
  assert.equal(plan.add.length, 0); assert.equal(plan.update.length, 0); assert.equal(plan.unchanged.length, 12);
  const ex2 = existing.map((e, i) => (i === 0 ? { ...e, note: 'editat', manualFields: ['note'], net: 1 } : e));
  plan = planCourseImport(drafts, ex2);
  assert.equal(plan.update.length, 1);
  assert.deepEqual(plan.update[0].changes, ['net']);
  const orphan = { ...existing[0], id: 'crs_x', sheet: { name: 'XX00DEM 2025' } };
  assert.equal(planCourseImport(drafts, [...existing, orphan]).orphaned.length, 1);
});

test('rânduri identice primesc ordinal diferit', () => {
  const { mapping } = detectCourseMapping(photo);
  const rows = [...photo, photo[11]];
  const { drafts } = parseCourseRows(rows, mapping, { plate: 'XX00DEM' });
  assert.equal(new Set(drafts.map((d) => d.id)).size, drafts.length);
});

test('suprapunere reală > 1 zi este avertizată', () => {
  const { mapping } = detectCourseMapping(photo);
  const rows = [photo[0], R('01.10.2025', '05.10.2025', 'XX00DEM', 'A', 'X - Y', 100, 21, 121), R('03.10.2025', '06.10.2025', 'XX00DEM', 'A', 'Z - W', 100, 21, 121)];
  const { issues } = parseCourseRows(rows, mapping, { plate: 'XX00DEM' });
  assert.ok(issues.some((x) => x.code === 'course_overlap'));
});

test('HUF: fără zecimale', () => {
  const { mapping } = detectCourseMapping(photo);
  const rows = [photo[0], R('01.10.2025', '02.10.2025', 'XX00DEM', 'A', 'X - Y', 250000, 0, 250000)];
  const { drafts } = parseCourseRows(rows, mapping, { plate: 'XX00DEM', currency: 'HUF', vatTreatment: 'zero' });
  assert.deepEqual([drafts[0].net, drafts[0].vat, drafts[0].vatBp], [250000, 0, 0]);
});

test('pasul de valută: eșantion + totaluri', () => {
  const { drafts } = parse();
  const s = currencySample(drafts, 'RON');
  assert.equal(s.sample.length, 5);
  assert.match(s.sample[0].text, /^2\.940,66\u00a0lei \+ TVA 617,54\u00a0lei = 3\.558,20\u00a0lei/);
  assert.equal(s.totals.missing, 1);
});

test('nume foi', () => {
  for (const [n, p, y] of [['XX01DEM 2025', 'XX01DEM', 2025], ['XX00DEM', 'XX00DEM', null], ['XX02DEM 2025', 'XX02DEM', 2025], ['xx-00-dem 2024', 'XX00DEM', 2024], ['Munka1', null, null]]) {
    const r = detectSheetInfo(n);
    assert.equal(r.plate, p, n); assert.equal(r.year, y, n);
  }
});
