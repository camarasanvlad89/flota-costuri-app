import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAmounts, defaultRateFor, vatCost, defaultVatFor, isVatNonRefundable } from '../../../src/domain/vat.js';
import { DEFAULT_COUNTRIES, DEFAULT_RO_VAT_RATES, roRateOn } from '../../../src/data/vat-defaults.js';
import { DEFAULT_CATEGORIES } from '../../../src/data/categories-default.js';
import { COMPANY, countries, categories, mulberry32 } from './helpers.js';

test('splitAmounts: valorile reale din tabelul de curse (net 3542,77 la 21%)', () => {
  assert.deepEqual(splitAmounts({ entered: 'net', minor: 354277, rateBp: 2100 }), { gross: 428675, net: 354277, vat: 74398 });
  assert.deepEqual(splitAmounts({ entered: 'gross', minor: 428675, rateBp: 2100 }), { gross: 428675, net: 354277, vat: 74398 });
  // din TVA singur, net = TVA/cota (rotunjit): 743,98/0,21 = 3542,76 (nu poate reproduce întotdeauna cifra exactă)
  assert.deepEqual(splitAmounts({ entered: 'vat', minor: 74398, rateBp: 2100 }), { gross: 428674, net: 354276, vat: 74398 });
});

test('splitAmounts: DE 19%, brut 87,50 ⇒ net 73,53 / TVA 13,97', () => {
  assert.deepEqual(splitAmounts({ entered: 'gross', minor: 8750, rateBp: 1900 }), { gross: 8750, net: 7353, vat: 1397 });
});

test('splitAmounts: HUF 0 zecimale (50.000 brut la 27%)', () => {
  assert.deepEqual(splitAmounts({ entered: 'gross', minor: 50000, rateBp: 2700 }), { gross: 50000, net: 39370, vat: 10630 });
});

test('splitAmounts: cota 0 și erori', () => {
  assert.deepEqual(splitAmounts({ entered: 'gross', minor: 1000, rateBp: 0 }), { gross: 1000, net: 1000, vat: 0 });
  assert.throws(() => splitAmounts({ entered: 'vat', minor: 100, rateBp: 0 }), RangeError);
  assert.throws(() => splitAmounts({ entered: 'gross', minor: 10.5, rateBp: 2100 }), RangeError);
  assert.throws(() => splitAmounts({ entered: 'foo', minor: 1, rateBp: 2100 }), TypeError);
});

test('splitAmounts: gross = net + vat în 10.000 de cazuri (PRNG fix)', () => {
  const rnd = mulberry32(42);
  const rates = [0, 500, 900, 1100, 1900, 2100, 2500, 2700, 810];
  for (let n = 0; n < 10000; n++) {
    const minor = Math.floor(rnd() * 100000000);
    const rateBp = rates[Math.floor(rnd() * rates.length)];
    for (const entered of rateBp === 0 ? ['gross', 'net'] : ['gross', 'net', 'vat']) {
      const r = splitAmounts({ entered, minor, rateBp });
      assert.equal(r.gross, r.net + r.vat);
      assert.ok(r.vat >= 0 && r.net >= 0);
      assert.equal(r[entered], minor);
    }
  }
});

test('defaultRateFor: România pe perioade (19% → 21% la 01.08.2025)', () => {
  assert.equal(defaultRateFor('RO', '2025-07-31', countries, COMPANY).standardBp, 1900);
  assert.equal(defaultRateFor('RO', '2025-08-01', countries, COMPANY).standardBp, 2100);
  assert.deepEqual(defaultRateFor('RO', '2026-11-18', countries, COMPANY).reducedBp, [1100]);
  // colecția roVatRates editată de administrator are prioritate
  const custom = [{ from: '2020-01-01', standardBp: 1234, reducedBp: [] }];
  assert.equal(defaultRateFor('RO', '2026-01-01', countries, COMPANY, custom).standardBp, 1234);
});

test('defaultRateFor: alte țări și țară necunoscută', () => {
  assert.equal(defaultRateFor('HU', '2026-01-01', countries, COMPANY).standardBp, 2700);
  assert.equal(defaultRateFor('DE', '2026-01-01', countries, COMPANY).standardBp, 1900);
  assert.deepEqual(defaultRateFor('XX', '2026-01-01', countries, COMPANY), { standardBp: 0, reducedBp: [], unknown: true });
  // tabel gol ⇒ valorile implicite din data/
  assert.equal(defaultRateFor('FR', '2026-01-01', [], COMPANY).standardBp, 2000);
});

test('tabelul implicit conține țările cerute, cote ca întregi bp, fără verificare simulată', () => {
  for (const code of ['RO', 'HU', 'DE', 'AT', 'IT', 'FR', 'ES', 'NL', 'BE', 'PL', 'BG', 'CZ', 'SK', 'HR', 'SI', 'GR', 'PT', 'CH']) {
    const c = DEFAULT_COUNTRIES.find((x) => x.code === code);
    assert.ok(c, code);
    assert.ok(Number.isInteger(c.standardBp) && c.standardBp > 0);
    assert.ok(c.reducedBp.every(Number.isInteger));
    assert.equal(c.verifiedAt, null);
    assert.equal(c.id, code);
  }
  assert.equal(roRateOn(DEFAULT_RO_VAT_RATES, '2000-01-01'), null);
});

test('categoriile implicite: id-uri unice, offsets valide, fără documente fiscale înghesuite', () => {
  const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
  assert.equal(ids.size, DEFAULT_CATEGORIES.length);
  for (const c of DEFAULT_CATEGORIES) {
    if (c.offsetsCategoryId) assert.ok(ids.has(c.offsetsCategoryId), c.id);
    if (c.kind === 'recovery') assert.ok(c.offsetsCategoryId);
  }
});

const net = (n, v) => ({ gross: n + v, net: n, vat: v });

test('vatCost: taxed 100% deductibil în țara firmei ⇒ cost = net, TVA recuperabil RO', () => {
  const r = vatCost(net(10000, 2100), { treatment: 'taxed', rateBp: 2100, deductiblePct: 100 }, { company: COMPANY, countryCode: 'RO' });
  assert.deepEqual([r.cost, r.recoverable, r.recoverableKind], [10000, 2100, 'ro']);
});

test('vatCost: taxed 50% (carburant mixt) ⇒ jumătate din TVA în cost, cu rotunjire', () => {
  const r = vatCost(net(10001, 2100), { treatment: 'taxed', rateBp: 2100, deductiblePct: 50 }, { company: COMPANY });
  // nedeductibil = round(2100*50/100)=1050; cost = 10001+1050
  assert.equal(r.recoverable, 1050);
  assert.equal(r.cost, 10001 + 1050);
  const odd = vatCost(net(1000, 21), { treatment: 'taxed', rateBp: 2100, deductiblePct: 50 }, { company: COMPANY });
  assert.equal(odd.nonRecoverableVat, 11); // 10,5 ⇒ 11 (jumătate în sus)
  assert.equal(odd.recoverable, 10);
});

test('vatCost: TVA străin ⇒ recuperabil „foreign”; nerambursabil ⇒ cost brut', () => {
  const a = vatCost(net(7353, 1397), { treatment: 'taxed', rateBp: 1900, deductiblePct: 100 }, { company: COMPANY, countryCode: 'DE' });
  assert.deepEqual([a.cost, a.recoverable, a.recoverableKind], [7353, 1397, 'foreign']);
  const b = vatCost(net(7353, 1397), { treatment: 'taxed', rateBp: 1900, deductiblePct: 100 }, { company: COMPANY, countryCode: 'CH', refundable: false });
  assert.deepEqual([b.cost, b.recoverable, b.recoverableKind], [8750, 0, null]);
});

test('vatCost: fără TVA, 0%, nedeductibil ⇒ cost = brut, nimic recuperabil', () => {
  for (const [treatment, v] of [['none', 0], ['zero', 0], ['nondeductible', 2100]]) {
    const r = vatCost(net(10000, v), { treatment, rateBp: v ? 2100 : null, deductiblePct: 100 }, { company: COMPANY });
    assert.equal(r.cost, 10000 + v);
    assert.equal(r.recoverable, 0);
    assert.equal(r.recoverableKind, null);
  }
});

test('vatCost: firmă neplătitoare ⇒ taxed devine nedeductibil; bonul nu dă TVA recuperabil', () => {
  const np = vatCost(net(10000, 2100), { treatment: 'taxed', rateBp: 2100, deductiblePct: 100 }, { company: { ...COMPANY, vatPayer: false } });
  assert.deepEqual([np.cost, np.recoverable], [12100, 0]);
  const rc = vatCost(net(10000, 2100), { treatment: 'taxed', rateBp: 2100, deductiblePct: 100 }, { company: COMPANY, documentation: 'receipt' });
  assert.deepEqual([rc.cost, rc.recoverable], [12100, 0]);
});

test('vatCost: taxare inversă ⇒ TVA autolichidat separat, costul curat = net (100% deductibil)', () => {
  const r = vatCost({ gross: 100000, net: 100000, vat: 0 }, { treatment: 'reverse', rateBp: 2100, deductiblePct: 100 }, { company: COMPANY, countryCode: 'DE' });
  assert.equal(r.selfAssessedVat, 21000);
  assert.equal(r.cost, 100000);
  assert.equal(r.recoverable, 0);
  const half = vatCost({ gross: 100000, net: 100000, vat: 0 }, { treatment: 'reverse', rateBp: 2100, deductiblePct: 50 }, { company: COMPANY, countryCode: 'DE' });
  assert.equal(half.cost, 100000 + 10500);
});

test('vatCost: argumente invalide', () => {
  assert.throws(() => vatCost(net(1, 0), { treatment: 'x' }, { company: COMPANY }), TypeError);
  assert.throws(() => vatCost(net(1, 0), { treatment: 'taxed', deductiblePct: 120 }, { company: COMPANY }), RangeError);
  assert.throws(() => vatCost({ gross: 1.5, net: 1, vat: 0 }, { treatment: 'none' }, { company: COMPANY }), RangeError);
});

test('defaultVatFor: combustibil în DE ⇒ cu TVA 19%; în CH ⇒ nedeductibil; rovinietă ⇒ fără TVA în afara sferei', () => {
  const ctx = { company: COMPANY, countries };
  const fuel = categories.find((c) => c.id === 'cat_fuel');
  const de = defaultVatFor(fuel, 'DE', '2026-11-01', ctx);
  assert.deepEqual(de.vat, { treatment: 'taxed', rateBp: 1900, deductiblePct: 100 });
  assert.equal(de.refundable, true);
  const ch = defaultVatFor(fuel, 'CH', '2026-11-01', ctx);
  assert.equal(ch.vat.treatment, 'nondeductible');
  assert.equal(ch.refundable, false);
  const rov = defaultVatFor(categories.find((c) => c.id === 'cat_toll_ro'), 'RO', '2026-11-01', ctx);
  assert.equal(rov.vat.treatment, 'none');
  assert.equal(rov.vatRegime, 'outOfScope');
  const np = defaultVatFor(fuel, 'RO', '2026-11-01', { company: { ...COMPANY, vatPayer: false }, countries });
  assert.equal(np.vat.treatment, 'nondeductible');
});

test('isVatNonRefundable', () => {
  assert.equal(isVatNonRefundable({ nonRefundableGroups: ['*'] }, { group: 'fuel' }), true);
  assert.equal(isVatNonRefundable({ nonRefundableGroups: ['fuel'] }, { group: 'fuel' }), true);
  assert.equal(isVatNonRefundable({ nonRefundableGroups: ['fuel'] }, { group: 'tolls' }), false);
  assert.equal(isVatNonRefundable(null, { group: 'fuel', defaultVat: { refundable: false } }), true);
});
