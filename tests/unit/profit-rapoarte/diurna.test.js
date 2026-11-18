import test from 'node:test';
import assert from 'node:assert/strict';
import { diurnaReport, travelSheet, travelSheetHtml, diurnaConfig, DIURNA_DEFAULTS, DIURNA_NOTE } from '../../../src/domain/diurna.js';
import { truck, course, state } from './helpers.js';

const pos = (loc, country) => `[Strada, ${loc}, 1000, ${country}]`;
const RO = (l = 'Orașu Nou') => pos(l, 'România');
const HU = (l = 'Hajdúdorog') => pos(l, 'Ungaria');
const trip = (start, stop, a, b, km = 100000) => ({ truckId: 't1', start, stop, startPos: a, stopPos: b, distanceM: km });
const RANGE = { from: '2026-10-01', to: '2026-10-31' };
const drivers = [{ id: 'drv_d', name: 'DORIAN', aliases: [] }];
const cDen = (id, a, b, over = {}) => course(id, 't1', a, b, 100000, { driverId: 'drv_d', driverRaw: 'DORIAN', ...over });

test('cursă RO→HU→RO (plecare 05.10, întoarcere 06.10): 2 zile în străinătate, țara HU', () => {
  const s = state({
    trucks: [truck('t1')], drivers, courses: [cDen('c', '2026-10-05', '2026-10-06')],
    gpsTrips: [trip('2026-10-05T06:00:00', '2026-10-05T09:00:00', RO(), HU()), trip('2026-10-06T07:00:00', '2026-10-06T10:00:00', HU(), RO())],
  });
  const r = diurnaReport(s, RANGE);
  assert.deepEqual(r.rows.map((x) => [x.date, x.country, x.source]), [['2026-10-05', 'HU', 'gps'], ['2026-10-06', 'HU', 'gps']]);
  assert.equal(r.totals.days, 2);
  assert.equal(r.byDriver[0].driverName, 'DORIAN');
  assert.equal(r.byDriver[0].days, 2);
  assert.equal(r.totals.amountEur, 2 * DIURNA_DEFAULTS.defaultRateEur);
});

test('o zi cu plecare și întoarcere în aceeași zi = 1 zi; noapte în străinătate continuă zilele', () => {
  const same = state({ trucks: [truck('t1')], gpsTrips: [trip('2026-10-05T06:00:00', '2026-10-05T09:00:00', RO(), HU()), trip('2026-10-05T12:00:00', '2026-10-05T15:00:00', HU(), RO())] });
  assert.equal(diurnaReport(same, RANGE).totals.days, 1);
  const stay = state({ trucks: [truck('t1')], gpsTrips: [trip('2026-10-05T06:00:00', '2026-10-05T09:00:00', RO(), HU()), trip('2026-10-08T07:00:00', '2026-10-08T10:00:00', HU(), RO())] });
  assert.equal(diurnaReport(stay, RANGE).totals.days, 4, '05, 06, 07 (în HU) și 08 (întoarcere)');
});

test('regula „noapte în străinătate”: ziua de întoarcere nu se numără', () => {
  const s = state({ trucks: [truck('t1')], gpsTrips: [trip('2026-10-05T06:00:00', '2026-10-05T09:00:00', RO(), HU()), trip('2026-10-06T07:00:00', '2026-10-06T10:00:00', HU(), RO())], singletons: { diurna: { countMode: 'nightAbroad' } } });
  assert.deepEqual(diurnaReport(s, RANGE).rows.map((x) => x.date), ['2026-10-05']);
});

test('țara zilei = țara străină cu cei mai mulți km; cotă pe țară; plafon scutit; zile de capăt', () => {
  const s = state({
    trucks: [truck('t1')],
    gpsTrips: [trip('2026-10-05T05:00:00', '2026-10-05T07:00:00', RO(), HU(), 50000), trip('2026-10-05T08:00:00', '2026-10-05T12:00:00', HU(), pos('Wien', 'Austria'), 300000), trip('2026-10-06T07:00:00', '2026-10-06T10:00:00', pos('Wien', 'Austria'), RO(), 200000)],
    singletons: { diurna: { ratesEur: { AT: 6000 }, edgeDayPct: 50, taxFreeBaseEur: 3500, taxFreeMultiplier: 1.5, verified: true } },
  });
  const r = diurnaReport(s, RANGE);
  assert.equal(r.rows[0].country, 'AT');
  assert.equal(r.rows[0].edge, true);
  assert.equal(r.rows[0].rateEur, 3000);                 // 60,00 × 50%
  const full = state({ trucks: [truck('t1')], gpsTrips: s.collections.gpsTrips, singletons: { diurna: { ratesEur: { AT: 6000 }, taxFreeBaseEur: 3500, taxFreeMultiplier: 1.5 } } });
  const f = diurnaReport(full, RANGE).rows[0];
  assert.equal(f.rateEur, 6000); assert.equal(f.taxFreeEur, 5250); assert.equal(f.taxableEur, 750);
  assert.ok(!r.warnings.some((w) => /valori de pornire/.test(w)), 'verificat ⇒ fără avertizare de valori de pornire');
  assert.ok(diurnaReport(full, RANGE).warnings.some((w) => w.includes(DIURNA_NOTE)));
});

test('fără GPS: estimare din curse cu țara destinației, marcată „curse”, plus avertizare', () => {
  const s = state({ trucks: [truck('t1')], drivers, courses: [cDen('c', '2026-10-05', '2026-10-07', { destCountry: 'HU' }), cDen('d', '2026-10-09', '2026-10-09', { destCountry: 'RO', originCountry: 'RO' })] });
  const r = diurnaReport(s, RANGE);
  assert.equal(r.rows.length, 3);
  assert.ok(r.rows.every((x) => x.source === 'curse' && x.country === 'HU'));
  assert.ok(r.warnings.some((w) => /estimate din curse/.test(w)));
});

test('RON opțional din cursul dat; configurația implicită se poate suprascrie', () => {
  const s = state({ trucks: [truck('t1')], gpsTrips: [trip('2026-10-05T06:00:00', '2026-10-05T09:00:00', RO(), HU())] });
  const r = diurnaReport(s, RANGE, { ronPerEur: '5.3442' });
  assert.equal(r.totals.amountRon, 18705);               // 35,00 EUR × 5,3442 = 187,05 lei
  assert.equal(diurnaConfig(state({ singletons: { diurna: { defaultRateEur: 5000 } } })).defaultRateEur, 5000);
});

test('foaie de deplasare: deplasări consecutive, total, HTML escapat și tipăribil', () => {
  const dr = [{ id: 'drv_x', name: '<script>alert(1)</script> & Co', aliases: [] }];
  const s = state({
    trucks: [truck('t1')], drivers: dr, courses: [course('c', 't1', '2026-10-05', '2026-10-09', 1000, { driverId: 'drv_x', driverRaw: 'X' })],
    gpsTrips: [trip('2026-10-05T06:00:00', '2026-10-05T09:00:00', RO(), HU()), trip('2026-10-06T07:00:00', '2026-10-06T10:00:00', HU(), RO()), trip('2026-10-08T06:00:00', '2026-10-08T09:00:00', RO(), HU()), trip('2026-10-09T06:00:00', '2026-10-09T09:00:00', HU(), RO())],
  });
  const rep = diurnaReport(s, RANGE);
  const sheet = travelSheet(rep, 'drv_x');
  assert.equal(sheet.trips.length, 2);
  assert.deepEqual(sheet.trips.map((t) => [t.from, t.to, t.days]), [['2026-10-05', '2026-10-06', 2], ['2026-10-08', '2026-10-09', 2]]);
  assert.equal(sheet.totals.days, 4);
  const html = travelSheetHtml(sheet, { company: 'Firma <demo>' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('@media print') && html.includes('window.print()'));
  assert.ok(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Firma &lt;demo&gt;'));
  assert.ok(html.includes('de verificat cu contabilul'));
});
