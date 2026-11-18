// Rulare: node --test src/core/core.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from './index.js';

test('hash / ids', () => {
  assert.equal(C.fnv1a64Hex(''), 'cbf29ce484222325');
  assert.equal(C.fnv1a64Hex('a'), 'af63dc4c8601ec8c');
  assert.equal(C.detId('rec', 'tpl1', '2026-03'), C.detId('rec_', 'tpl1', '2026-03'));
  assert.notEqual(C.detId('rec', 'a', 'b'), C.detId('rec', 'ab'));
  assert.match(C.detId('rec', 1), /^rec_[0-9a-f]{16}$/);
  assert.match(C.newId('ent'), /^ent_[0-9a-z]{10}$/);
  assert.notEqual(C.newId('ent'), C.newId('ent'));
});

test('dates', () => {
  assert.equal(C.parseDate('20.08.2025'), '2025-08-20');
  assert.equal(C.parseDate('2025-08-20'), '2025-08-20');
  assert.equal(C.parseDate('1/2/25'), '2025-02-01');
  assert.equal(C.parseDate('2025. 08. 20.'), '2025-08-20');
  assert.equal(C.parseDate('31.02.2025'), null);
  assert.equal(C.parseDate(45658), '2025-01-01');
  assert.equal(C.parseDate(45920), '2025-09-20');
  assert.equal(C.parseDate(46300.75), C.addDays(C.parseDate(46300), 0));
  assert.equal(C.parseDate('45920', 'excel'), '2025-09-20');
  assert.equal(C.parseDate(new Date(2025, 7, 20)), '2025-08-20');
  assert.equal(C.fmtDate('2025-08-20'), '20.08.2025');
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(C.addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(C.addMonths('2026-12-15', 2), '2027-02-15');
  assert.equal(C.clampDay(2026, 4, 31), '2026-04-30');
  assert.equal(C.daysInMonth(2024, 2), 29);
  assert.equal(C.daysInMonth(2100, 2), 28);
  assert.equal(C.addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(C.diffDays('2026-02-28', '2026-03-01'), 1);
  assert.deepEqual(C.eachDay('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(C.eachMonth('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(C.monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(C.overlapDays({ from: '2026-01-01', to: '2026-01-10' }, { from: '2026-01-10', to: '2026-01-12' }), 1);
  assert.equal(C.overlapDays({ from: '2026-01-01', to: '2026-01-05' }, { from: '2026-01-06', to: '2026-01-12' }), 0);
  assert.equal(C.todayLocal({ now: () => new Date(2026, 10, 18, 12).getTime() }), '2026-11-18');
  assert.ok(C.isIsoDate('2024-02-29') && !C.isIsoDate('2025-02-29') && !C.isIsoDate('2025-2-9'));
});

test('format (valori de aur)', () => {
  const N = ' ', M = '−';
  assert.equal(C.fmtMoney(354277, 'RON'), `3.542,77${N}lei`);
  assert.equal(C.fmtMoney(8750, 'EUR'), `87,50${N}€`);
  assert.equal(C.fmtMoney(123456, 'HUF'), `123.456${N}HUF`);
  assert.equal(C.fmtMoney(125000, 'PLN'), `1.250,00${N}PLN`);
  assert.equal(C.fmtMoney(0, 'RON'), `0,00${N}lei`);
  assert.equal(C.fmtMoney(-5, 'RON'), `${M}0,05${N}lei`);
  assert.equal(C.fmtMoney(99999999, 'RON'), `999.999,99${N}lei`);
  assert.equal(C.fmtMoney(123400, 'RON'), `1.234,00${N}lei`);
  assert.equal(C.fmtMoney(1234, 'HUF'), `1.234${N}HUF`);
  assert.equal(C.fmtMoney(100, 'RON', { sign: true }), `+1,00${N}lei`);
  assert.equal(C.fmtMoney(100, 'RON', { code: true }), `1,00${N}RON`);
  assert.equal(C.fmtNumber(-0.001, 2), '0,00');
  assert.equal(C.fmtNumber(-1234.5, 2), `${M}1.234,50`);
  assert.equal(C.fmtNumber(1234567), '1.234.567');
  assert.equal(C.fmtPct(0.125), '12,5%');
  assert.equal(C.fmtPct(-0.00001), '0,0%');
  assert.equal(C.fmtKm(8376300), `8.376,3${N}km`);
  assert.equal(C.fmtKm(950, 1), `1,0${N}km`);
  assert.equal(C.fmtKm(50, 0), `0${N}km`);
  assert.equal(C.fmtRate('5.3442'), '5,3442');
  assert.equal(C.fmtRate('0.0146800000'), '0,01468');
});

test('parseAmount', () => {
  const p = (t, c = 'RON') => C.parseAmount(t, c);
  assert.deepEqual(p('1234,56'), { ok: true, minor: 123456 });
  assert.deepEqual(p('1234.56'), { ok: true, minor: 123456 });
  assert.deepEqual(p('1 234,56'), { ok: true, minor: 123456 });
  assert.deepEqual(p('1.234,56'), { ok: true, minor: 123456 });
  assert.deepEqual(p('1,234.56'), { ok: true, minor: 123456 });
  assert.deepEqual(p('1.234.567'), { ok: true, minor: 123456700 });
  assert.deepEqual(p('3542,77 lei'), { ok: true, minor: 354277 });
  assert.deepEqual(p('−5,5'), { ok: true, minor: -550 });
  assert.deepEqual(p('12'), { ok: true, minor: 1200 });
  assert.deepEqual(p(',5'), { ok: true, minor: 50 });
  const a = p('1.234');
  assert.equal(a.ok && a.ambiguous, true);
  assert.equal(a.minor, 123400);
  assert.equal(a.readAs, '1234.00');
  assert.deepEqual(a.alternatives, [123]);
  assert.equal(p('12.500').ambiguous, true);
  assert.equal(p('0,125').ambiguous, undefined);
  assert.equal(p('12,5').ambiguous, undefined);
  assert.equal(p('1.2345').ok, false);
  assert.equal(p('abc').ok, false);
  assert.equal(p('').ok, false);
  assert.equal(p('1.2.3').ok, false);
  // HUF
  assert.deepEqual(p('12.500', 'HUF'), { ok: true, minor: 12500 });
  assert.deepEqual(p('123456', 'HUF'), { ok: true, minor: 123456 });
  assert.equal(p('12,5', 'HUF').ok, false);
  assert.equal(p('12,50', 'HUF').ok, false);
});

test('decimal strings / mulDiv / sum', () => {
  assert.equal(C.toDecimalString(354277, 'RON'), '3542.77');
  assert.equal(C.toDecimalString(-5, 'RON'), '-0.05');
  assert.equal(C.toDecimalString(123456, 'HUF'), '123456');
  assert.equal(C.fromDecimalString('3542.77', 'RON'), 354277);
  assert.equal(C.fromDecimalString('0.005', 'RON'), 1);
  assert.equal(C.fromDecimalString('-0.005', 'RON'), -1);
  assert.equal(C.fromDecimalString('12.5', 'HUF'), 13);
  assert.equal(C.mulDiv(354277, 21, 100), 74398); // 743,98 (TVA 21% din 3542,77)
  assert.equal(C.mulDiv(-1, 1, 2), -1);
  assert.equal(C.mulDiv(1, 1, 2), 1);
  assert.equal(C.mulDiv(Number.MAX_SAFE_INTEGER, 3, 3), Number.MAX_SAFE_INTEGER);
  assert.throws(() => C.mulDiv(Number.MAX_SAFE_INTEGER, 2, 1));
  assert.throws(() => C.mulDiv(1, 1, 0));
  assert.throws(() => C.mulDiv(1.5, 1, 1));
  assert.equal(C.sum([0.1 * 10, 1].map((x) => Math.round(x * 100))), 200);
  assert.equal(C.sum([]), 0);
});

test('convert / rate', () => {
  assert.equal(C.convert(10000, 'EUR', 'RON', '5.3442'), 53442);
  // 100000 HUF * 0.01468 = 1468,00 RON => 146800 bani
  assert.equal(C.convert(100000, 'HUF', 'RON', '0.01468'), 146800);
  // RON -> HUF: 1468 RON * 68.1199 = 100 000 HUF (rotunjit la întreg)
  assert.equal(C.convert(146800, 'RON', 'HUF', '68.1198910082'), 100000);
  assert.equal(C.convert(5, 'RON', 'RON', '9'), 5);
  assert.equal(C.convert(-10000, 'EUR', 'RON', '5.3442'), -53442);
  assert.equal(C.cmpRate('5.3442', '5.34420'), 0);
  assert.equal(C.cmpRate('5.3429', '5.3442'), -1);
  assert.equal(C.cmpRate('10', '9.99'), 1);
  // curs încrucișat: RON/EUR 5,3442 și HUF/EUR 364,08
  assert.equal(C.rateDiv('5.3442', '364.08'), '0.0146786421');
  assert.equal(C.rateDiv('1', '364.08'), '0.0027466491');
  assert.equal(C.rateMul('2', '0.5'), '1');
  assert.equal(C.normRate('5.3442000000'), '5.3442');
});

test('allocate / allocateFair', () => {
  assert.deepEqual(C.allocate(100, [1, 1, 1]), [33, 33, 34]);
  assert.deepEqual(C.allocate(-100, [1, 1, 1]), [-33, -33, -34]);
  assert.deepEqual(C.allocate(10, [1, 0]), [10, 0]);
  assert.deepEqual(C.allocate(10, [0, 1, 0]), [0, 10, 0]);
  assert.deepEqual(C.allocate(1000, [0.5, 1.5]), [250, 750]);
  assert.throws(() => C.allocate(10, [0, 0]));
  // AC7: 1.000,00 lei pe 7 camioane
  const f = C.allocateFair(100000, [1, 1, 1, 1, 1, 1, 1], 'ovh|2026-03');
  assert.equal(C.sum(f), 100000);
  assert.equal(f.filter((x) => x === 14286).length, 5);
  assert.equal(f.filter((x) => x === 14285).length, 2);
  assert.deepEqual(f, C.allocateFair(100000, [1, 1, 1, 1, 1, 1, 1], 'ovh|2026-03'));
  // rest cel mai mare
  assert.deepEqual(C.allocateFair(10, [1, 2, 7], 's'), [1, 2, 7]);
  assert.deepEqual(C.allocateFair(5, [3, 3, 4], 's').reduce((a, b) => a + b), 5);
  assert.deepEqual(C.allocateFair(1, [1, 1, 0], 's').slice(2), [0]);
  // fără părtinire: pe 12 luni nicio poziție nu primește tot restul
  const wins = [0, 0, 0];
  for (let m = 1; m <= 120; m++) {
    const r = C.allocateFair(100, [1, 1, 1], `ovh|${m}`); // 34/33/33
    r.forEach((x, i) => { if (x === 34) wins[i]++; });
  }
  assert.ok(wins.every((w) => w >= 20), `părtinire: ${wins}`);
  // sumă exactă pe date aleatoare (PRNG fix)
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 2000; k++) {
    const n = 1 + Math.floor(rnd() * 9);
    const w = Array.from({ length: n }, () => Math.floor(rnd() * 100) + 1);
    const t = Math.floor(rnd() * 2e7) - 1e7;
    assert.equal(C.sum(C.allocateFair(t, w, 'k' + k)), t);
    assert.equal(C.sum(C.allocate(t, w)), t);
  }
});

test('plates', () => {
  assert.equal(C.normalizePlate('XX-00-DEM'), 'XX00DEM');
  assert.equal(C.normalizePlate('XX 00 DEM'), 'XX00DEM');
  assert.equal(C.normalizePlate('xx00dem'), 'XX00DEM');
  assert.equal(C.normalizePlate('B 123 ABC'), C.normalizePlate('B123ABC'));
  assert.equal(C.displayPlate('XX00DEM'), 'XX 00 DEM');
  assert.equal(C.displayPlate('B123ABC'), 'B 123 ABC');
  assert.equal(C.displayPlate('XYZ'), 'XYZ');
  assert.deepEqual(C.parsePlates('XX00DEM/XX30DEM'), { truck: 'XX00DEM', trailer: 'XX30DEM' });
  assert.deepEqual(C.parsePlates('XX01DEM'), { truck: 'XX01DEM', trailer: null });
  assert.deepEqual(C.parsePlates(' XX 01 DEM / SM 12 TRL '), { truck: 'XX01DEM', trailer: 'SM12TRL' });
  assert.deepEqual(C.parsePlates(''), { truck: '', trailer: null });
});

test('text', () => {
  assert.equal(C.foldKey('Hajdúdorog'), 'HAJDUDOROG');
  assert.equal(C.foldKey('Törökszentmiklós'), 'TOROKSZENTMIKLOS');
  assert.equal(C.foldKey('Orașu Nou'), 'ORASU NOU');
  assert.equal(C.foldKey('Győr, Sőrés űrlap'), 'GYOR SORES URLAP');
  assert.equal(C.foldKey('ARAD - GHERTA + TURT'), 'ARAD GHERTA TURT');
  assert.equal(C.foldKey('  Čakovec   Zagreb '), 'CAKOVEC ZAGREB');
  assert.equal(C.similarity('Nyiregyhaza', 'NYÍREGYHÁZA'), 1);
  assert.ok(C.similarity('MEDIESU AURIT', 'Mediesu Aurit') === 1);
  assert.ok(C.similarity('Halmeu', 'Halmeu ') === 1);
  assert.ok(C.similarity('Veszprem', 'Veszprém') === 1);
  assert.ok(C.similarity('Satu Mare', 'Satu-Mare') === 1);
  assert.ok(C.similarity('Halmeu', 'Torokszentmiklos') < 0.6);
  assert.ok(C.similarity('Torokszentmiklos', 'Torokszentmiklós') === 1);
  assert.ok(C.similarity('Nyiregyhaza', 'Nyiregyhza') > 0.9);
  assert.equal(C.similarity('', 'x'), 0);
});

test('events', () => {
  const bus = C.createBus();
  const got = [];
  const off = bus.on('x', (p) => got.push(p));
  bus.on('x', () => { throw new Error('ascultător stricat'); });
  const origErr = console.error; console.error = () => {};
  bus.emit('x', 1);
  console.error = origErr;
  off();
  bus.emit('x', 2);
  bus.emit('nimeni');
  assert.deepEqual(got, [1]);
});

test('registerCurrency: exponentul se aplică la afișare și parsare (KRW fără zecimale)', async () => {
  const m = await import('./money.js');
  const f = await import('./format.js');
  m.registerCurrency('KRW', 0);
  assert.equal(m.currencyExp('KRW'), 0);
  assert.equal(m.toDecimalString(123456, 'KRW'), '123456');
  assert.ok(!f.fmtMoney(123456, 'KRW').includes(','), f.fmtMoney(123456, 'KRW'));
  const { currencyExpLocal } = await import('../export/csv-export.js');
  assert.equal(currencyExpLocal('KRW'), 0);
  assert.equal(currencyExpLocal('ISK'), 0);
});

// regresie QA: sume peste întregii siguri nu aruncă, ci întorc eroare
test('parseAmount: sumă prea mare => {ok:false}', () => {
  const r = C.parseAmount('9007199254740993', 'RON');
  assert.equal(r.ok, false); assert.equal(r.error, 'Suma prea mare');
  assert.equal(C.parseAmount('99999999999999999', 'RON').ok, false);
});
