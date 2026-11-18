import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFxService, crossRate, convertMinor, parseBnrXml, lastBusinessDay, shiftDate, FxError,
  rateToScaled, scaledToRate, rateDivide, rateMul, toDecimalStr,
} from '../../../src/domain/fx.js';
import { memStore, PINNED } from './helpers.js';

const BNR_XML = `<?xml version="1.0" encoding="utf-8"?>
<DataSet xmlns="http://www.bnr.ro/xsd">
<Header><Publisher>National Bank of Romania</Publisher><Type>Rates</Type></Header>
<Body><Subject>Reference rates</Subject><OrigCurrency>RON</OrigCurrency>
<Cube date="2026-11-12"><Rate currency="EUR">5.3400</Rate><Rate currency="HUF" multiplier="100">1.4600</Rate><Rate currency="USD">4.6000</Rate></Cube>
<Cube date="2026-11-13"><Rate currency="EUR">5.3442</Rate><Rate currency="HUF" multiplier="100">1.4679</Rate><Rate currency="USD">4.6100</Rate></Cube>
<Cube date="2026-11-17"><Rate currency="EUR">5.3500</Rate><Rate currency="HUF" multiplier="100">1.4700</Rate></Cube>
</Body></DataSet>`;

const clock = { now: () => Date.UTC(2026, 10, 18, 10, 0, 0) };
const online = () => true;
const offline = () => false;
const noFetch = async () => { throw new Error('fetch nu trebuia apelat'); };

function ecbV1Fetch(table, calls) {
  // table: { 'YYYY-MM-DD': {RON, HUF...} }; întoarce ultima zi <= data cerută, ca Frankfurter
  return async (url) => {
    calls.push(url);
    const m = /\/v1\/(\d{4}-\d{2}-\d{2})\?symbols=(.*)$/.exec(url);
    const day = Object.keys(table).sort().filter((d) => d <= m[1]).pop();
    if (!day) return { ok: false, status: 404, json: async () => ({}) };
    const rates = {};
    for (const s of m[2].split(',')) if (table[day][s] != null) rates[s] = table[day][s];
    return { ok: true, status: 200, json: async () => ({ amount: 1, base: 'EUR', date: day, rates }) };
  };
}

test('aritmetică de curs: scalare, împărțire, înmulțire, rotunjire la 10 zecimale', () => {
  assert.equal(scaledToRate(rateToScaled('5.3442')), '5.3442');
  assert.equal(toDecimalStr(1e-7), '0.0000001');
  assert.equal(toDecimalStr('5,3442'), '5.3442');
  assert.equal(rateDivide('5.3442', '364.08'), '0.0146786421');
  assert.equal(rateDivide('1', '5.3442'), '0.1871187456');
  assert.equal(rateMul('0.0146786421', '364.08'), '5.3442000158');
  assert.equal(rateMul('2', '0.5'), '1');
  assert.equal(rateToScaled('1.00000000005'), rateToScaled('1.0000000001')); // cifra 11 = 5 ⇒ rotunjire în sus
  assert.throws(() => toDecimalStr('abc'), FxError);
});

test('crossRate din cotații per EUR: HUF→RON ≈ 0,01468 (golden Python Decimal)', () => {
  assert.equal(crossRate({ RON: PINNED.RON, HUF: PINNED.HUF }, 'HUF', 'RON'), '0.0146786421');
  assert.equal(crossRate({ RON: PINNED.RON }, 'EUR', 'RON'), '5.3442');
  assert.equal(crossRate({ RON: PINNED.RON }, 'RON', 'EUR'), '0.1871187456');
  assert.equal(crossRate({ RON: PINNED.RON, HUF: PINNED.HUF }, 'RON', 'HUF'), '68.126192882');
  assert.equal(crossRate({}, 'EUR', 'EUR'), '1');
  assert.throws(() => crossRate({ RON: '5' }, 'HUF', 'RON'), (e) => e.code === 'NO_RATE');
});

test('convertMinor: HUF 0 zecimale, EUR→RON, încrucișate, rotunjire jumătate în sus', () => {
  assert.equal(convertMinor(123456, 'HUF', 'RON', '0.0146786421'), 181217); // 1.812,17 lei
  assert.equal(convertMinor(123456, 'HUF', 'EUR', '0.0027466491'), 33909); // 339,09 EUR
  assert.equal(convertMinor(8750, 'EUR', 'RON', '5.3442'), 46762); // 467,6175 ⇒ 467,62
  assert.equal(convertMinor(7353, 'EUR', 'RON', '5.3442'), 39296); // 392,96
  assert.equal(convertMinor(46762, 'RON', 'HUF', '68.126192882'), 31857); // 467,62 lei = 31.857,17 ⇒ 31.857 HUF
  assert.equal(convertMinor(100, 'EUR', 'HUF', '364.08'), 364); // 1,00 EUR = 364,08 HUF; HUF nu are subdiviziuni
  assert.equal(convertMinor(150, 'EUR', 'HUF', '364.5'), 547); // 546,75 ⇒ 547
  assert.equal(convertMinor(-8750, 'EUR', 'RON', '5.3442'), -46762);
  assert.equal(convertMinor(0, 'EUR', 'RON', '5.3442'), 0);
});

test('lastBusinessDay și shiftDate', () => {
  assert.equal(lastBusinessDay('2026-11-14'), '2026-11-13'); // sâmbătă
  assert.equal(lastBusinessDay('2026-11-15'), '2026-11-13'); // duminică
  assert.equal(lastBusinessDay('2026-11-16'), '2026-11-16');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

test('parseBnrXml: Multiplier (HUF=100), mai multe zile, ultima zi ca implicit', () => {
  const p = parseBnrXml(BNR_XML);
  assert.equal(p.date, '2026-11-17');
  assert.equal(p.cubes.length, 3);
  assert.equal(p.cubes[1].rates.HUF, '0.014679');
  assert.equal(p.cubes[1].rates.EUR, '5.3442');
  assert.equal(p.rates.USD, undefined);
  assert.throws(() => parseBnrXml('<html></html>'), (e) => e.code === 'BAD_XML');
  assert.throws(() => parseBnrXml(''), (e) => e.code === 'BAD_XML');
});

test('BNR: curs pe zi lucrătoare, weekend ⇒ vineri, sursa „bnr”, nu stale', async () => {
  const fx = createFxService({ store: memStore(), fetchImpl: noFetch, clock, isOnline: offline });
  const imp = await fx.importBnrXml(BNR_XML);
  assert.deepEqual([imp.days, imp.from, imp.to], [3, '2026-11-12', '2026-11-17']);
  const r = await fx.getRate('HUF', '2026-11-13');
  assert.equal(r.source, 'bnr');
  assert.equal(r.ronPerUnit, '0.014679');
  assert.equal(r.eurPerUnit, rateDivide('0.014679', '5.3442'));
  assert.equal(r.stale, false);
  assert.equal(r.manual, false);
  const w = await fx.getRate('EUR', '2026-11-14'); // sâmbătă
  assert.equal(w.rateDate, '2026-11-13');
  assert.equal(w.ronPerUnit, '5.3442');
  assert.equal(w.eurPerUnit, '1');
  const ron = await fx.getRate('RON', '2026-11-13');
  assert.equal(ron.source, 'ron');
  assert.equal(ron.ronPerUnit, '1');
  assert.equal(ron.eurPerUnit, '0.1871187456');
});

test('BNR: zi lipsă între două zile publicate (sărbătoare) rămâne „bnr”, nu stale', async () => {
  const fx = createFxService({ store: memStore(), fetchImpl: noFetch, clock, isOnline: offline });
  await fx.importBnrXml(BNR_XML);
  const r = await fx.getRate('EUR', '2026-11-16'); // luni, BNR nu are 16.11 dar are 17.11
  assert.equal(r.rateDate, '2026-11-13');
  assert.equal(r.source, 'bnr');
  assert.equal(r.stale, false);
});

test('curs lipsă offline: ultimul curs cunoscut, marcat stale / last-known; fără niciun curs ⇒ NO_RATE', async () => {
  const fx = createFxService({ store: memStore(), fetchImpl: noFetch, clock, isOnline: offline });
  await assert.rejects(fx.getRate('HUF', '2026-11-18'), (e) => e instanceof FxError && e.code === 'NO_RATE');
  await fx.importBnrXml(BNR_XML);
  const r = await fx.getRate('HUF', '2026-11-18'); // BNR nu a publicat încă 18.11, offline
  assert.equal(r.source, 'last-known');
  assert.equal(r.stale, true);
  assert.equal(r.rateDate, '2026-11-17');
  assert.equal(r.ronPerUnit, '0.0147');
  const old = await fx.getRate('HUF', '2026-01-05'); // mai vechi decât orice curs: cel mai apropiat, tot stale
  assert.equal(old.stale, true);
  assert.equal(old.rateDate, '2026-11-12');
  await assert.rejects(fx.getRate('PLN', '2026-11-17'), (e) => e.code === 'NO_RATE');
});

test('RON fără niciun curs EUR: se salvează, eurPerUnit null și stale (excepția RON)', async () => {
  const fx = createFxService({ store: memStore(), fetchImpl: noFetch, clock, isOnline: offline });
  const r = await fx.getRate('RON', '2026-11-18');
  assert.deepEqual([r.ronPerUnit, r.eurPerUnit, r.stale, r.source], ['1', null, true, 'ron']);
});

test('Frankfurter v1: o singură cerere, salvat în cache, „ecb-v1”, a doua cerere nu mai merge pe rețea', async () => {
  const calls = [];
  const store = memStore();
  const fx = createFxService({ store, fetchImpl: ecbV1Fetch({ '2026-11-13': { RON: 5.3494, HUF: 365.6 } }, calls), clock, isOnline: online });
  const r = await fx.getRate('HUF', '2026-11-13');
  assert.equal(r.source, 'ecb-v1');
  assert.equal(r.ronPerUnit, crossRate({ RON: '5.3494', HUF: '365.6' }, 'HUF', 'RON'));
  assert.equal(r.eurPerUnit, rateDivide('1', '365.6'));
  assert.equal(r.stale, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v1\/2026-11-13\?symbols=RON,HUF$/);
  const again = await fx.getRate('HUF', '2026-11-13');
  assert.equal(again.ronPerUnit, r.ronPerUnit);
  assert.equal(calls.length, 1);
  assert.equal(store.size(), 2);
});

test('Frankfurter: weekend ⇒ ziua de vineri (răspunsul poartă data reală); sărbătoare (fără zi lucrătoare în BCE) nu repetă cererea', async () => {
  const calls = [];
  const fx = createFxService({ store: memStore(), fetchImpl: ecbV1Fetch({ '2026-11-12': { RON: 5.34 }, '2026-11-13': { RON: 5.3494 } }, calls), clock, isOnline: online });
  const r = await fx.getRate('EUR', '2026-11-14');
  assert.equal(r.rateDate, '2026-11-13');
  // luni 16.11: BCE nu are încă dată (răspunsul e 13.11) ⇒ folosim 13.11, iar apelul repetat nu mai cere
  const h = await fx.getRate('EUR', '2026-11-16');
  assert.equal(h.rateDate, '2026-11-13');
  const n = calls.length;
  await fx.getRate('EUR', '2026-11-16');
  assert.equal(calls.length, n);
});

test('BNR are prioritate față de BCE; BCE doar pentru ce lipsește din BNR (ex. PLN)', async () => {
  const calls = [];
  const fx = createFxService({ store: memStore(), fetchImpl: ecbV1Fetch({ '2026-11-13': { RON: 5.3494, PLN: 4.25 } }, calls), clock, isOnline: online });
  await fx.importBnrXml(BNR_XML);
  const eur = await fx.getRate('EUR', '2026-11-13');
  assert.equal(eur.source, 'bnr');
  assert.equal(calls.length, 0);
  const pln = await fx.getRate('PLN', '2026-11-13');
  assert.equal(pln.source, 'ecb-v1');
  assert.equal(calls.length, 1);
});

test('Frankfurter căzut ⇒ ultimul curs cunoscut, fără a arunca; dezactivat ⇒ nu se cheamă deloc', async () => {
  const failing = async () => { throw new Error('rețea'); };
  const fx = createFxService({ store: memStore(), fetchImpl: failing, clock, isOnline: online });
  await fx.importBnrXml(BNR_XML);
  const r = await fx.getRate('EUR', '2026-11-18');
  assert.equal(r.source, 'last-known');
  assert.equal(r.stale, true);
  const calls = [];
  const off = createFxService({ store: memStore(), fetchImpl: ecbV1Fetch({ '2026-11-13': { RON: 5.3 } }, calls), clock, isOnline: online, enabled: false });
  await assert.rejects(off.getRate('EUR', '2026-11-13'), (e) => e.code === 'NO_RATE');
  assert.equal(calls.length, 0);
});

test('Frankfurter v2: tablou {date, quote, rate}', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ([{ date: '2026-11-13', base: 'EUR', quote: 'HUF', rate: 365.58 }, { date: '2026-11-13', base: 'EUR', quote: 'RON', rate: 5.3527 }]) };
  };
  const fx = createFxService({ store: memStore(), fetchImpl, clock, isOnline: online, frankfurterVersion: 'v2' });
  const r = await fx.getRate('HUF', '2026-11-13');
  assert.equal(r.source, 'ecb-v2');
  assert.match(calls[0], /\/v2\/rates\?base=EUR&quotes=RON,HUF&date=2026-11-13$/);
  assert.equal(r.ronPerUnit, crossRate({ RON: '5.3527', HUF: '365.58' }, 'HUF', 'RON'));
});

test('prefetch pe interval: o cerere, apoi getRate nu mai cheamă rețeaua', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ amount: 1, base: 'EUR', start_date: '2026-11-02', end_date: '2026-11-04', rates: { '2026-11-02': { RON: 5.3405, HUF: 364.5 }, '2026-11-03': { RON: 5.3428, HUF: 364.4 }, '2026-11-04': { RON: 5.344, HUF: 363.03 } } }) };
  };
  const fx = createFxService({ store: memStore(), fetchImpl, clock, isOnline: online });
  await fx.prefetch(['HUF'], '2026-11-02', '2026-11-04');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v1\/2026-11-02\.\.2026-11-04\?symbols=RON,HUF$/);
  const r = await fx.getRate('HUF', '2026-11-03');
  assert.equal(r.rateDate, '2026-11-03');
  assert.equal(calls.length, 1);
});

test('curs manual: manual:true, nu stale, eurPerUnit din cursul EUR cunoscut sau din parametru', async () => {
  const fx = createFxService({ store: memStore(), fetchImpl: noFetch, clock, isOnline: offline });
  const noEur = fx.fromManual('HUF', '2026-11-13', '0,0147');
  assert.deepEqual([noEur.manual, noEur.stale, noEur.source, noEur.ronPerUnit, noEur.eurPerUnit], [true, false, 'manual', '0.0147', null]);
  const withEur = fx.fromManual('HUF', '2026-11-13', '0.0147', 'manual', '5.34');
  assert.equal(withEur.eurPerUnit, rateDivide('0.0147', '5.34'));
  await fx.importBnrXml(BNR_XML);
  const cached = fx.fromManual('HUF', '2026-11-13', '0.0147', 'bnr-manual');
  assert.equal(cached.source, 'bnr-manual');
  assert.equal(cached.eurPerUnit, rateDivide('0.0147', '5.3442'));
  assert.equal(fx.fromManual('EUR', '2026-11-13', '5.30').eurPerUnit, '1');
  assert.equal(fx.fromManual('RON', '2026-11-13', '1').source, 'ron');
  assert.throws(() => fx.fromManual('EUR', '2026-11-13', '0'), FxError);
  assert.throws(() => fx.fromManual('EUR', '2026-11-13', '-1'), FxError);
});

test('curs manual salvat în cache are prioritate pe ziua exactă', async () => {
  const fx = createFxService({ store: memStore(), fetchImpl: noFetch, clock, isOnline: offline });
  await fx.importBnrXml(BNR_XML);
  await fx.saveManualRate('HUF', '2026-11-13', '0.015');
  const r = await fx.getRate('HUF', '2026-11-13');
  assert.equal(r.manual, true);
  assert.equal(r.ronPerUnit, '0.015');
  assert.equal(r.eurPerUnit, rateDivide('0.015', '5.3442'));
});
