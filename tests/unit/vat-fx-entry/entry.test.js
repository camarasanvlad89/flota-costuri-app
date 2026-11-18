import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry, validateEntry, changeAmounts, splitAcrossTrucks, noDocMonthlyTotal } from '../../../src/domain/entry.js';
import { createFxService } from '../../../src/domain/fx.js';
import { COMPANY, categories, countries, ctx, memStore, mulberry32, RATE_EUR, RATE_HUF, RATE_RON } from './helpers.js';

const base = (o = {}) => ({
  kind: 'expense', date: '2026-11-17', truckId: 'trk_1', targetType: 'truck', categoryId: 'cat_fuel',
  supplier: 'Shell', docNo: 'F123', documentation: 'invoice', countryCode: 'DE',
  currency: 'EUR', entered: 'gross', minor: 8750, payment: 'card', source: 'manual', ...o,
});
const val = (e, o) => validateEntry(e, { company: COMPANY, categories, ...o });
const codes = (errs) => errs.map((e) => e.code);

test('AC 8.3-1: 87,50 € cu TVA DE 19%, brut, curs 5,3442', () => {
  const e = buildEntry(base(), ctx(RATE_EUR, { id: 'ent_test1' }));
  assert.deepEqual(e.orig, { gross: 8750, net: 7353, vat: 1397 });
  assert.equal(e.ron.gross, 46762); // 467,62
  assert.equal(e.ron.net, 39296); // 392,96
  assert.equal(e.ron.vat, 7466); // 74,66
  assert.equal(e.ron.recoverable, 7466);
  assert.equal(e.ron.recoverableKind, 'foreign');
  assert.equal(e.ron.cost, 39296);
  assert.deepEqual(e.eur, { gross: 8750, net: 7353, vat: 1397, cost: 7353, recoverable: 1397 });
  assert.equal(e.foreignVatStatus, 'toClaim');
  assert.equal(e.vat.treatment, 'taxed');
  assert.equal(e.vat.rateBp, 1900);
  assert.equal(e.vatRegime, 'domestic');
  assert.equal(e.accrualMonth, '2026-11');
  assert.equal(e.status, 'confirmed');
  assert.equal(e.id, 'ent_test1');
  assert.deepEqual(e.fx, { ronPerUnit: '5.3442', eurPerUnit: '1', rateDate: '2026-11-17', source: 'bnr', manual: false, stale: false, dateBasis: 'date', eurSource: 'bnr' });
  assert.deepEqual(val(e), []);
});

test('AC 8.3-2: HUF 123.456 fără zecimale, RON la ban, EUR înghețat', () => {
  const e = buildEntry(base({ currency: 'HUF', countryCode: 'HU', minor: 123456, categoryId: 'cat_toll_hu' }), ctx(RATE_HUF));
  assert.equal(e.vat.rateBp, 2700);
  assert.equal(e.orig.gross, 123456);
  assert.equal(e.orig.net, 97209); // 123456/1,27 = 97209,45
  assert.equal(e.orig.vat, 26247);
  assert.equal(e.ron.gross, 181217); // 1.812,17 lei (golden Python)
  assert.equal(e.eur.gross, 33909);
  assert.equal(e.ron.gross, e.ron.net + e.ron.vat);
  assert.equal(e.eur.gross, e.eur.net + e.eur.vat);
  assert.deepEqual(val(e), []);
});

test('RON în țara firmei: valorile din tabelul real (net 3542,77 la 21%) și EUR înghețat', () => {
  const e = buildEntry(base({ kind: 'expense', currency: 'RON', countryCode: 'RO', entered: 'net', minor: 354277, categoryId: 'cat_service' }), ctx(RATE_RON));
  assert.deepEqual(e.orig, { gross: 428675, net: 354277, vat: 74398 });
  assert.deepEqual([e.ron.gross, e.ron.net, e.ron.vat], [428675, 354277, 74398]);
  assert.equal(e.ron.recoverable, 74398);
  assert.equal(e.ron.recoverableKind, 'ro');
  assert.equal(e.ron.cost, 354277);
  assert.equal(e.fx.source, 'ron');
  assert.equal(e.fx.ronPerUnit, '1');
  assert.equal(e.foreignVatStatus, null);
  assert.equal(e.eur.gross, 80213); // 4286,75 × 0,1871187456 = 802,13 (golden Python)
  assert.deepEqual(val(e), []);
});

test('RON fără curs EUR cunoscut: eur null, fx.stale, intrarea rămâne validă', () => {
  const rate = { ronPerUnit: '1', eurPerUnit: null, rateDate: '2026-11-18', source: 'ron', manual: false, stale: true, eurSource: null };
  const e = buildEntry(base({ currency: 'RON', countryCode: 'RO', minor: 10000 }), ctx(rate));
  assert.equal(e.eur, null);
  assert.equal(e.fx.stale, true);
  assert.equal(e.ron.gross, 10000);
  assert.deepEqual(val(e), []);
});

test('rovinietă RO: fără TVA, în afara sferei; cost = brut', () => {
  const e = buildEntry(base({ currency: 'RON', countryCode: 'RO', categoryId: 'cat_toll_ro', minor: 12000 }), ctx(RATE_RON));
  assert.equal(e.vat.treatment, 'none');
  assert.equal(e.vatRegime, 'outOfScope');
  assert.deepEqual([e.ron.vat, e.ron.recoverable, e.ron.cost], [0, 0, 12000]);
  assert.deepEqual(val(e), []);
});

test('0% (scutit), nedeductibil, fără TVA, ca tratamente explicite', () => {
  const zero = buildEntry(base({ vat: { treatment: 'zero', rateBp: 0, deductiblePct: 0 }, countryCode: 'DE' }), ctx(RATE_EUR));
  assert.deepEqual([zero.orig.vat, zero.ron.cost, zero.ron.recoverable], [0, 46762, 0]);
  assert.equal(zero.foreignVatStatus, null);
  assert.deepEqual(val(zero), []);
  const nd = buildEntry(base({ vat: { treatment: 'nondeductible', rateBp: 1900, deductiblePct: 0 } }), ctx(RATE_EUR));
  assert.equal(nd.orig.vat, 1397);
  assert.equal(nd.ron.cost, 46762);
  assert.equal(nd.ron.recoverable, 0);
  assert.deepEqual(val(nd), []);
  const none = buildEntry(base({ vat: { treatment: 'none', rateBp: null, deductiblePct: 0 } }), ctx(RATE_EUR));
  assert.equal(none.orig.net, 8750);
  assert.deepEqual(val(none), []);
});

test('TVA parțial deductibil (50%): costul poartă jumătate din TVA', () => {
  const e = buildEntry(base({ currency: 'RON', countryCode: 'RO', minor: 12100, vat: { treatment: 'taxed', rateBp: 2100, deductiblePct: 50 } }), ctx(RATE_RON));
  assert.deepEqual([e.ron.net, e.ron.vat, e.ron.recoverable, e.ron.cost], [10000, 2100, 1050, 11050]);
  assert.deepEqual(val(e), []);
});

test('taxare inversă: serviciu din DE fără TVA, firmă RO ⇒ TVA autolichidat separat, regim „ic”', () => {
  const e = buildEntry(base({ vat: { treatment: 'reverse', rateBp: null, deductiblePct: 100 }, categoryId: 'cat_service', minor: 100000 }), ctx(RATE_EUR));
  assert.equal(e.vat.rateBp, 2100);
  assert.equal(e.vatRegime, 'ic');
  assert.equal(e.orig.vat, 0);
  assert.equal(e.ron.gross, 534420);
  assert.equal(e.ron.selfAssessedVat, 112228); // 5.344,20 × 21% = 1.122,28
  assert.equal(e.ron.cost, 534420);
  assert.equal(e.ron.recoverable, 0);
  assert.deepEqual(val(e), []);
  const bad = { ...e, orig: { ...e.orig, vat: 10, gross: e.orig.gross + 10 } };
  assert.ok(codes(val(bad)).includes('REVERSE_VAT'));
});

test('firmă neplătitoare: TVA devine cost', () => {
  const e = buildEntry(base({ currency: 'RON', countryCode: 'RO', minor: 12100, vat: { treatment: 'taxed', rateBp: 2100, deductiblePct: 100 } }),
    { ...ctx(RATE_RON), company: { ...COMPANY, vatPayer: false } });
  assert.deepEqual([e.ron.recoverable, e.ron.cost], [0, 12100]);
});

test('bon fiscal: nu dă TVA recuperabil; validare respinge recoverable>0 fără factură', () => {
  const e = buildEntry(base({ documentation: 'receipt', currency: 'RON', countryCode: 'RO', minor: 12100 }), ctx(RATE_RON));
  assert.equal(e.ron.recoverable, 0);
  assert.equal(e.ron.cost, 12100);
  assert.deepEqual(val(e), []);
  const bad = { ...e, ron: { ...e.ron, recoverable: 2100, cost: 10000 } };
  assert.ok(codes(val(bad)).includes('RECOVERABLE_NO_INVOICE'));
});

test('CH (non-UE): TVA nerambursabil ⇒ cost brut, fără „toClaim”', () => {
  const e = buildEntry(base({ countryCode: 'CH', currency: 'EUR', vat: { treatment: 'taxed', rateBp: 810, deductiblePct: 100 } }), ctx(RATE_EUR));
  assert.equal(e.ron.recoverable, 0);
  assert.equal(e.ron.cost, e.ron.gross);
  assert.equal(e.foreignVatStatus, null);
  assert.deepEqual(val(e), []);
});

test('fără document: forțează „fără TVA”, cere sursa banilor, respinge personalul, justificare peste plafon', () => {
  const e = buildEntry(base({ documentation: 'none', currency: 'RON', countryCode: 'RO', minor: 15000, categoryId: 'cat_parking' }), ctx(RATE_RON));
  assert.equal(e.vat.treatment, 'none');
  assert.equal(e.ron.recoverable, 0);
  assert.equal(e.moneySource, 'company');
  assert.deepEqual(val(e), []);
  // peste plafonul per tranzacție (200 lei) ⇒ justificare
  const big = buildEntry(base({ documentation: 'none', currency: 'RON', countryCode: 'RO', minor: 30000, categoryId: 'cat_parking' }), ctx(RATE_RON));
  assert.ok(codes(val(big)).includes('JUSTIFICATION'));
  const ok = { ...big, justification: 'Parcare în port, fără bon', approvedAt: '2026-11-18T10:00:00Z' };
  assert.deepEqual(val(ok), []);
  // plafon lunar per camion (1.000 lei): alte intrări deja 950 lei + 150
  assert.ok(codes(val(e, { noDocMonthTotalMinor: 95000 })).includes('JUSTIFICATION'));
  assert.deepEqual(val(e, { noDocMonthTotalMinor: 50000 }), []);
  // personal
  const pers = buildEntry(base({ documentation: 'none', currency: 'RON', countryCode: 'RO', minor: 1000, categoryId: 'cat_salary' }), ctx(RATE_RON));
  assert.ok(codes(val(pers)).includes('PERSONNEL_NO_DOC'));
  // sursa banilor invalidă
  assert.ok(codes(val({ ...e, moneySource: 'xx' })).includes('MONEY_SOURCE'));
});

test('noDocMonthlyTotal însumează doar fără document, același camion și lună, fără intrarea exclusă', () => {
  const mk = (id, truck, month, g, doc = 'none') => ({ id, kind: 'expense', documentation: doc, accrualMonth: month, target: { truckId: truck }, ron: { gross: g } });
  const list = [mk('a', 't1', '2026-11', 100), mk('b', 't1', '2026-11', 200), mk('c', 't2', '2026-11', 400), mk('d', 't1', '2026-10', 800), mk('e', 't1', '2026-11', 1600, 'invoice'), { ...mk('f', 't1', '2026-11', 3200), deletedAt: 'x' }];
  assert.equal(noDocMonthlyTotal(list, 't1', '2026-11'), 300);
  assert.equal(noDocMonthlyTotal(list, 't1', '2026-11', 'a'), 200);
});

test('venit: fără cost; nedeductibil respins; tip implicit „other”', () => {
  const e = buildEntry({ kind: 'income', date: '2026-11-10', targetType: 'truck', truckId: 't1', categoryId: 'cat_inc_other', documentation: 'invoice', countryCode: 'RO', currency: 'RON', entered: 'net', minor: 100000, source: 'manual' }, ctx(RATE_RON));
  assert.equal(e.incomeType, 'other');
  assert.deepEqual([e.ron.net, e.ron.vat, e.ron.cost, e.ron.recoverable], [100000, 21000, 0, 0]);
  assert.deepEqual(val(e), []);
  assert.ok(codes(val({ ...e, vat: { ...e.vat, treatment: 'nondeductible' } })).includes('INCOME_NONDEDUCTIBLE'));
  assert.ok(codes(val({ ...e, categoryId: 'cat_fuel' })).includes('CATEGORY_KIND'));
});

test('validateEntry: gross ≠ net + vat, negativ, țintă, categorie, curs, dată', () => {
  const e = buildEntry(base(), ctx(RATE_EUR));
  assert.ok(codes(val({ ...e, orig: { ...e.orig, gross: e.orig.gross + 1 } })).includes('GROSS_NET_VAT'));
  assert.ok(codes(val({ ...e, ron: { ...e.ron, gross: e.ron.gross + 1 } })).includes('GROSS_NET_VAT'));
  assert.ok(codes(val({ ...e, orig: { gross: -100, net: -100, vat: 0 } })).includes('NEGATIVE'));
  assert.deepEqual(codes(val({ ...e, correctionOf: 'ent_x', orig: { gross: -100, net: -100, vat: 0 }, ron: { ...e.ron, gross: -500, net: -500, vat: 0, recoverable: 0, cost: -500 }, eur: { gross: -100, net: -100, vat: 0, cost: -100, recoverable: 0 } })), []);
  assert.ok(codes(val({ ...e, target: { type: 'truck', truckId: null, trailerId: null } })).includes('TARGET'));
  assert.ok(codes(val({ ...e, categoryId: 'nu_exista' })).includes('CATEGORY'));
  assert.ok(codes(val({ ...e, fx: { ...e.fx, ronPerUnit: null } })).includes('FX_MISSING'));
  assert.ok(codes(val({ ...e, date: '2026-13' })).includes('DATE'));
  assert.ok(codes(val({ ...e, ron: { ...e.ron, cost: e.ron.cost + 1 } })).includes('COST_FORMULA'));
  assert.ok(codes(val({ ...e, documentation: 'none' })).includes('NODOC_VAT'));
  assert.ok(val({ ...e, vat: { treatment: 'taxed', rateBp: null, deductiblePct: 100 } }).some((x) => x.field === 'vat.rateBp'));
  for (const err of val({ ...e, date: 'x' })) assert.ok(err.field && err.code && err.message);
});

test('luna închisă: accrualMonth <= closedThrough ⇒ CLOSED_MONTH; „aferent lunii” în luna curentă trece', () => {
  const closed = { company: { ...COMPANY, closedThrough: '2026-10' }, categories };
  const old = buildEntry(base({ date: '2026-10-05' }), ctx(RATE_EUR));
  assert.ok(codes(validateEntry(old, closed)).includes('CLOSED_MONTH'));
  const redirected = buildEntry(base({ date: '2026-10-05', accrualMonth: '2026-11', relatesTo: '2026-10' }), ctx(RATE_EUR));
  assert.deepEqual(validateEntry(redirected, closed), []);
});

test('curs păstrat înghețat: schimbarea sumei fără curs nou păstrează fx; recalculează RON/EUR', () => {
  const e = buildEntry(base(), ctx(RATE_EUR, { id: 'ent_1' }));
  const c = changeAmounts(e, { entered: 'gross', minor: 10000 }, ctx(null, { now: '2026-11-19T00:00:00Z' }));
  assert.deepEqual(c.fx, e.fx);
  assert.equal(c.orig.gross, 10000);
  assert.equal(c.ron.gross, 53442);
  assert.equal(c.id, 'ent_1');
  assert.equal(c.updatedAt, '2026-11-19T00:00:00Z');
  assert.equal(c.createdAt, e.createdAt);
  assert.deepEqual(val(c), []);
  // fără sumă nouă: sumele rămân identice (inclusiv când net a fost introdus)
  const n = buildEntry(base({ entered: 'net', minor: 10001 }), ctx(RATE_EUR));
  const same = changeAmounts(n, { vat: { deductiblePct: 100 } }, ctx(null));
  assert.deepEqual(same.orig, n.orig);
  // curs nou explicit ⇒ RON se recalculează, istoricul celorlalte intrări nu e atins
  const rate2 = { ...RATE_EUR, ronPerUnit: '5.4000', source: 'manual', manual: true };
  const r = changeAmounts(e, { rate: rate2 }, ctx(null));
  assert.equal(r.fx.manual, true);
  assert.equal(r.ron.gross, 47250);
  assert.equal(e.ron.gross, 46762);
});

test('changeAmounts: cota nouă ⇒ resplit din brut; intrare recurentă ⇒ edited:true; tratament nou fără sume ⇒ erori sunt prinse de validare', () => {
  const e = buildEntry(base({ source: 'recurring', recurring: { templateId: 'tpl_1', period: '2026-11', edited: false, versionFrom: '2026-01', provisional: false }, currency: 'RON', countryCode: 'RO', minor: 12100 }), ctx(RATE_RON));
  assert.equal(e.status, 'auto_pending');
  const c = changeAmounts(e, { vat: { rateBp: 1100 } }, ctx(null));
  assert.deepEqual([c.orig.gross, c.orig.net, c.orig.vat], [12100, 10901, 1199]);
  assert.equal(c.recurring.edited, true);
  assert.equal(e.recurring.edited, false);
  assert.throws(() => changeAmounts(e, { entered: 'gross' }, ctx(null)), TypeError);
});

test('splitAcrossTrucks: același groupId, Σ brut/net/TVA = totalul la ban (original, RON, EUR)', () => {
  const input = base({ currency: 'HUF', countryCode: 'HU', minor: 100001, categoryId: 'cat_toll_hu' });
  const ids = ['ent_a', 'ent_b', 'ent_c'];
  const out = splitAcrossTrucks(input, ['t1', 't2', 't3'], [1, 1, 1], ctx(RATE_HUF, { ids }));
  const total = buildEntry(input, ctx(RATE_HUF));
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((x) => x.id), ids);
  assert.equal(new Set(out.map((x) => x.groupId)).size, 1);
  assert.ok(out[0].groupId);
  assert.deepEqual(out.map((x) => x.target.truckId), ['t1', 't2', 't3']);
  for (const blk of ['orig', 'ron', 'eur']) {
    for (const f of ['gross', 'net', 'vat']) {
      assert.equal(out.reduce((s, x) => s + x[blk][f], 0), total[blk][f], blk + '.' + f);
    }
  }
  for (const x of out) assert.deepEqual(val(x), []);
});

test('splitAcrossTrucks: ponderi inegale și allocateFair cu sămânță determinist', () => {
  const input = base({ currency: 'RON', countryCode: 'RO', minor: 100000, categoryId: 'cat_rent' });
  const a = splitAcrossTrucks(input, ['t1', 't2'], [3, 1], ctx(RATE_RON, { fairSeed: 'rent-2026-11' }));
  const b = splitAcrossTrucks(input, ['t1', 't2'], [3, 1], ctx(RATE_RON, { fairSeed: 'rent-2026-11' }));
  assert.deepEqual(a.map((x) => x.ron.gross), b.map((x) => x.ron.gross));
  assert.equal(a[0].ron.gross + a[1].ron.gross, 100000);
  assert.ok(a[0].ron.gross > a[1].ron.gross * 2.9);
  assert.throws(() => splitAcrossTrucks(input, ['t1'], [1, 2], ctx(RATE_RON)), RangeError);
  assert.throws(() => splitAcrossTrucks(input, [], [], ctx(RATE_RON)), RangeError);
  assert.throws(() => splitAcrossTrucks(input, ['t1'], [0], ctx(RATE_RON)), RangeError);
});

test('reconciliere: Σ ron.cost pe intrări = Σ ron.net + Σ(TVA − recuperabil), 2.000 de intrări aleatoare, toate valide', () => {
  const rnd = mulberry32(7);
  const cats = ['cat_fuel', 'cat_service', 'cat_toll_hu', 'cat_parking', 'cat_rca'];
  const cur = [['EUR', RATE_EUR, 'DE'], ['HUF', RATE_HUF, 'HU'], ['RON', RATE_RON, 'RO']];
  let sumCost = 0, sumParts = 0;
  for (let n = 0; n < 2000; n++) {
    const [currency, rate, countryCode] = cur[Math.floor(rnd() * cur.length)];
    const e = buildEntry(base({ currency, countryCode, minor: 100 + Math.floor(rnd() * 5000000), categoryId: cats[Math.floor(rnd() * cats.length)], entered: ['gross', 'net'][Math.floor(rnd() * 2)] }), ctx(rate));
    assert.deepEqual(val(e), [], JSON.stringify(e));
    sumCost += e.ron.cost; sumParts += e.ron.net + (e.ron.vat - e.ron.recoverable);
    assert.equal(e.ron.gross, e.ron.net + e.ron.vat);
    assert.equal(e.eur.gross, e.eur.net + e.eur.vat);
  }
  assert.equal(sumCost, sumParts);
});

test('integrare fx + entry: BNR XML ⇒ intrare în HUF; offline fără curs aruncă NO_RATE', async () => {
  const store = memStore();
  const fx = createFxService({ store, fetchImpl: async () => { throw new Error('x'); }, clock: { now: () => Date.UTC(2026, 10, 18) }, isOnline: () => false });
  await assert.rejects(fx.getRate('HUF', '2026-11-13'), (e) => e.code === 'NO_RATE');
  await fx.importBnrXml('<DataSet><Body><Cube date="2026-11-13"><Rate currency="EUR">5.3442</Rate><Rate currency="HUF" multiplier="100">1.4679</Rate></Cube></Body></DataSet>');
  const rate = await fx.getRate('HUF', '2026-11-13');
  const e = buildEntry(base({ currency: 'HUF', countryCode: 'HU', minor: 200000, date: '2026-11-13' }), ctx(rate));
  assert.equal(e.fx.source, 'bnr');
  assert.equal(e.ron.gross, 293580); // 200.000 × 0,014679 = 2.935,80 lei
  assert.deepEqual(val(e), []);
});

test('buildEntry: valori implicite de stare și validări de intrare', () => {
  assert.equal(buildEntry(base({ source: 'import' }), ctx(RATE_EUR)).status, 'pending');
  assert.equal(buildEntry(base({ status: 'flagged' }), ctx(RATE_EUR)).status, 'flagged');
  assert.equal(buildEntry(base({ targetType: 'company', truckId: null }), ctx(RATE_EUR)).target.truckId, null);
  assert.throws(() => buildEntry({ ...base(), kind: 'x' }, ctx(RATE_EUR)), TypeError);
  assert.throws(() => buildEntry({ ...base(), date: '17.11.2026' }, ctx(RATE_EUR)), TypeError);
  assert.throws(() => buildEntry(base(), { ...ctx(RATE_EUR), rate: null }), TypeError);
  assert.throws(() => buildEntry(base({ vat: { treatment: 'none', rateBp: null, deductiblePct: 0 }, entered: 'vat' }), ctx(RATE_EUR)), RangeError);
});
