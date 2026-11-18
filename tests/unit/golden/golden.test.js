// Valori de aur INDEPENDENTE (Python decimal, tests/fixtures/golden/make_expected.py) ⇄ codul aplicației (DEV-PLAN 11.1).
// Dacă un test pică, nu „repara” expected.json cu rezultatul codului: verifică întâi regula în DEV-PLAN 5.x.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFixtureJson, readFixtureBytes } from '../../helpers/fixtures.js';
import { mulDiv, convert, allocate, allocateFair, parseAmount, rateDiv, fromDecimalString, toDecimalString, sum } from '../../../src/core/money.js';
import { fmtMoney, fmtKm, fmtPct } from '../../../src/core/format.js';
import { addMonths, clampDay, daysInMonth } from '../../../src/core/dates.js';
import { splitAmounts, vatCost } from '../../../src/domain/vat.js';
import { crossRate, parseBnrXml } from '../../../src/domain/fx.js';

const G = readFixtureJson('golden', 'expected.json');

test('mulDiv: jumătate în afara lui zero', () => {
  for (const c of G.mulDiv) assert.equal(mulDiv(c.a, c.b, c.c), c.expected, `mulDiv(${c.a},${c.b},${c.c})`);
});

test('splitAmounts: net/brut/TVA (1018 cazuri, inclusiv 1000 cu PRNG fix) și gross = net + vat', () => {
  for (const c of G.splitAmounts) {
    const r = splitAmounts({ entered: c.entered, minor: c.minor, rateBp: c.rateBp });
    assert.deepEqual({ gross: r.gross, net: r.net, vat: r.vat }, c.expected, `${c.entered} ${c.minor} @${c.rateBp}`);
    assert.equal(r.gross, r.net + r.vat);
  }
});

test('tabelul real: net 3542,77 ⇒ TVA 743,98 ⇒ brut 4286,75; derivat din brut 1876,60', () => {
  for (const c of G.photoVat21) {
    const r = splitAmounts({ entered: 'net', minor: c.net, rateBp: 2100 });
    assert.equal(r.vat, c.expectedVat); assert.equal(r.vat, c.vatInSheet); assert.equal(r.gross, c.grossInSheet);
  }
  for (const d of G.photoDerivedFromGross) {
    const r = splitAmounts({ entered: 'gross', minor: d.grossMinor, rateBp: 2100 });
    assert.deepEqual([r.net, r.vat], [d.netMinor, d.vatMinor]);
  }
});

test('vatCost: taxed / none / zero / nondeductible / reverse, bon, firmă neplătitoare', () => {
  for (const c of G.vatCases ?? G.vatCost) {
    const a = c.args;
    const r = vatCost({ gross: c.gross, net: c.net, vat: c.vat },
      { treatment: c.treatment, deductiblePct: a.ded ?? 100, rateBp: a.rate_bp ?? undefined },
      { company: { vatPayer: a.vat_payer !== false, countryCode: 'RO' }, countryCode: a.same_country === false ? 'DE' : 'RO', documentation: a.documentation ?? 'invoice', refundable: a.refundable !== false });
    assert.equal(r.cost, c.expected.cost, c.name + ' (cost)');
    assert.equal(r.recoverable, c.expected.recoverable, c.name + ' (recuperabil)');
    assert.equal(r.selfAssessedVat, c.expected.selfAssessedVat, c.name + ' (autolichidat)');
    assert.equal(r.selfNonRecoverable, c.expected.selfNonRecoverable, c.name + ' (autolichidat nerecuperabil)');
  }
});

test('conversie: EUR→RON, RON→EUR, HUF (0 zecimale) și încrucișate cu cursul pinned', () => {
  for (const c of G.convert) assert.equal(convert(c.minor, c.from, c.to, c.rate), c.expected, `${c.minor} ${c.from}→${c.to} @${c.rate}`);
});
test('HUF: 0 zecimale la afișare și la parsare', () => {
  assert.equal(fmtMoney(123456, 'HUF'), '123.456 HUF');
  assert.equal(parseAmount('123456', 'HUF').minor, 123456);
  assert.equal(parseAmount('12,5', 'HUF').ok, false);
  assert.equal(toDecimalString(123456, 'HUF'), '123456');
  assert.equal(fromDecimalString('123456', 'HUF'), 123456);
});

test('curs încrucișat din cotații „per EUR” și împărțire de cursuri (10 zecimale)', () => {
  for (const c of G.crossRate) assert.equal(crossRate(c.perEur, c.from, c.to), c.expected, `${c.from}→${c.to}`);
  for (const c of G.rateDiv) assert.equal(rateDiv(c.a, c.b), c.expected);
});

test('BNR (FICTIV): multiplicator HUF=100 și cursul pinned EUR 5.3442', () => {
  const r = parseBnrXml(readFixtureBytes('fx', 'bnr-FICTIV.xml').toString('utf8'));
  assert.equal(r.date, '2026-10-14');
  assert.equal(r.rates.EUR, '5.3442');
  assert.equal(Number(r.rates.HUF).toFixed(4), '0.0147'); // money-ok: doar verificare vizuală a ordinului de mărime
  assert.equal(r.cubes.length, 2);
});

test('reconciliere EUR: valorile înghețate se adună în EUR; RON se adună în RON', () => {
  const rec = G.eurReconciliation;
  assert.equal(sum(rec.entries.map((e) => e.ronMinor)), rec.totalRon);
  assert.equal(sum(rec.entries.map((e) => convert(e.ronMinor, 'RON', 'EUR', G.rates['RON->EUR']))), rec.sumEurFrozen);
  assert.equal(sum(rec.entries.map((e) => e.eurMinor)), rec.sumEurFrozen);
});

test('allocate: suma exactă, restul pe ultima parte; prorata 6.000,01 ⇒ 4.000,00 / 2.000,01', () => {
  for (const c of G.allocate) { const r = allocate(c.total, c.weights); assert.deepEqual(r, c.expected, JSON.stringify(c)); assert.equal(sum(r), c.total); }
  const p = G.prorata;
  assert.deepEqual(allocate(p.total, Object.values(p.monthDays)), p.expected);
});

test('allocateFair: proprietăți (suma exactă, ±1 față de partea exactă, determinist, fără părtinire de poziție)', () => {
  const cases = [[10000, [1, 1, 1]], [100001, [3, 3, 3, 3]], [7, [1, 1, 1, 1, 1]], [1000003, [2, 5, 11]]];
  for (const [total, w] of cases) {
    const a = allocateFair(total, w, 'seed-1'); const b = allocateFair(total, w, 'seed-1');
    assert.deepEqual(a, b); assert.equal(sum(a), total);
    const S = w.reduce((x, y) => x + y, 0);
    a.forEach((v, i) => { const exact = (total * w[i]) / S; assert.ok(Math.abs(v - exact) < 1, `${v} vs ${exact}`); });
  }
  // Niciun camion nu absoarbe sistematic restul (5.1/5.5): 10001 împărțit în 3 părți egale lasă 2 bani de repartizat.
  // Pe 3000 de semințe diferite, fiecare poziție trebuie să primească ~2/3 din ele (≈2000), nu 100% / 50%.
  const hits = [0, 0, 0];
  for (let i = 0; i < 3000; i++) allocateFair(10001, [1, 1, 1], `ovh:${i}:${(i * 2654435761 >>> 0).toString(36)}`).forEach((v, j) => { if (v === 3334) hits[j]++; });
  for (const h of hits) assert.ok(h > 1800 && h < 2200, `distribuție părtinitoare a restului pe poziții: ${hits} (așteptat ≈2000 fiecare)`);
});

test('formatator ro-RO: monedă, negative cu minus U+2212, grupare de 4 cifre, -0 ⇒ 0', () => {
  for (const c of G.fmtMoney) assert.equal(fmtMoney(c.minor, c.currency, c.code ? { code: true } : undefined), c.expected, JSON.stringify(c));
  assert.equal(fmtMoney(-0, 'RON'), '0,00 lei');
  assert.equal(fmtMoney(123400, 'RON'), '1.234,00 lei');
});
test('formatator: km și procente', () => {
  for (const c of G.fmtKm) assert.equal(fmtKm(c.meters, c.decimals), c.expected, JSON.stringify(c));
  for (const c of G.fmtPct) assert.equal(fmtPct(Number(c.ratio), c.decimals), c.expected, JSON.stringify(c));
});

test('parseAmount: formate acceptate și cazuri ambigue (1.234, 12.500) cu confirmare', () => {
  for (const c of G.parseAmount) {
    const r = parseAmount(c.text, c.cur);
    assert.equal(r.ok, c.ok, c.text);
    if (!c.ok) continue;
    if (c.ambiguous) {
      assert.equal(r.ambiguous, true, c.text + ' trebuie marcat ambiguu');
      const alts = [r.minor, ...(r.alternatives || [])];
      for (const v of c.interpretations) assert.ok(alts.includes(v), `${c.text}: lipsește interpretarea ${v} din ${alts}`);
    } else assert.equal(r.minor, c.minor, c.text);
  }
});

test('date: addMonths clampează la sfârșit de lună (an bisect, ziua 31)', () => {
  for (const c of G.addMonths) assert.equal(addMonths(c.from, c.months), c.expected, `${c.from} +${c.months}`);
  for (const [y, list] of Object.entries(G.day31)) list.forEach((d, i) => assert.equal(clampDay(Number(y), i + 1, 31), d));
  for (const c of G.daysInMonth) assert.equal(daysInMonth(c.year, c.month), c.expected);
});
