// Construirea și validarea intrărilor (cheltuieli / venituri), plan 3.3, 5.2, 5.3, 10.4.
// Pur: nu citește store-ul și nu face I/O. Cursul vine gata rezolvat în ctx.rate (RateResult din fx.js).
// Valorile sunt înghețate la introducere în moneda originală, în RON și în EUR (D11).

import { allocate, allocateFair } from '../core/money.js';
import { newId } from '../core/ids.js';
import { splitAmounts, vatCost, defaultRateFor, isVatNonRefundable, defaultVatFor, VAT_TREATMENTS, VAT_REGIMES } from './vat.js';
import { convertMinor, isPositiveRate } from './fx.js';
import { DEFAULT_COUNTRIES } from '../data/vat-defaults.js';

/** @typedef {import('./vat.js').VatSpec} VatSpec */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const isInt = Number.isSafeInteger;
const KINDS = ['expense', 'income'];
const DOCS = ['invoice', 'receipt', 'none'];
const MONEY_SOURCES = ['company', 'driverAdvance', 'ownerPersonal'];
const PAYMENTS = ['card', 'cash', 'bank', 'fuelcard', 'driverCash'];
const STATUSES = ['confirmed', 'pending', 'auto_pending', 'flagged'];
const SOURCES = ['manual', 'quick', 'copy', 'import', 'recurring'];

const monthOf = (d) => d.slice(0, 7);
const findCat = (categories, id) => (categories || []).find((c) => c.id === id) || null;
const findCountry = (countries, code) => (countries || []).find((c) => c.code === code) || DEFAULT_COUNTRIES.find((c) => c.code === code) || null;

/**
 * @typedef {Object} EntryInput
 * @property {'expense'|'income'} kind
 * @property {string} date  IsoDate
 * @property {string|null} [truckId]
 * @property {'truck'|'trailer'|'company'} targetType
 * @property {string} categoryId
 * @property {string} [supplier] @property {string} [docNo] @property {string} [note]
 * @property {'invoice'|'receipt'|'none'} documentation
 * @property {string} countryCode
 * @property {VatSpec} [vat]  lipsă ⇒ implicit din categorie + țară (defaultVatFor)
 * @property {string} currency
 * @property {'gross'|'net'|'vat'} entered
 * @property {number} minor
 * @property {'card'|'cash'|'bank'|'fuelcard'|'driverCash'|null} [payment]
 * @property {string} [status] @property {string|null} [groupId] @property {{from:string,to:string}|null} [spread]
 * @property {'manual'|'quick'|'copy'|'import'|'recurring'} source
 * @property {object|null} [recurring] @property {string|null} [courseId]
 * // câmpuri opționale peste plan (toate au valori implicite):
 * @property {string|null} [trailerId] @property {string|null} [docDate] @property {string} [accrualMonth] @property {string|null} [relatesTo]
 * @property {'freight'|'recovery'|'other'|null} [incomeType] @property {string|null} [counterpartyVatId] @property {string|null} [parentDocId]
 * @property {'company'|'driverAdvance'|'ownerPersonal'} [moneySource] @property {string|null} [justification] @property {string|null} [approvedAt]
 * @property {'cost'|'cashOnly'} [costClass] @property {'domestic'|'ic'|'import'|'outOfScope'} [vatRegime]
 * @property {{ml:number,odoM:number|null}|null} [fuel] @property {string|null} [correctionOf] @property {string|null} [importId]
 * @property {'docDate'|'date'|'unloadDate'|'loadDate'} [fxDateBasis]
 * @property {{gross:number,net:number,vat:number}} [amounts]  sume explicite (ocolește `entered`/`minor`), folosit la împărțiri
 */

// ───────────── nucleul financiar ─────────────

/** Convertește un set brut/net într-o altă monedă păstrând gross = net + vat. */
function convertSet(o, from, to, rate) {
  const gross = convertMinor(o.gross, from, to, rate);
  const net = convertMinor(o.net, from, to, rate);
  return { gross, net, vat: gross - net };
}

/**
 * Calculează blocurile financiare ale unei intrări. `forced` permite impunerea unor sume (net/vat) în orice bloc
 * (folosit la împărțirea pe camioane, ca Σ să rămână exactă la ban).
 */
function computeFinancials(i, ctx, forced) {
  const { company, countries, categories, rate } = ctx;
  if (!rate || !rate.ronPerUnit) throw new TypeError('ctx.rate (RateResult) este obligatoriu.');
  const cat = findCat(categories, i.categoryId);
  const country = findCountry(countries, i.countryCode);
  const companyCountry = company.countryCode || 'RO';
  const refundable = !(i.countryCode !== companyCountry && isVatNonRefundable(country, cat));
  const documentation = i.documentation || 'invoice';
  const income = i.kind === 'income';

  // 1. specificația de TVA
  let vat = i.vat;
  let vatRegime = i.vatRegime;
  if (!vat) {
    const d = defaultVatFor(cat, i.countryCode, i.date, { company, countries, roVatRates: ctx.roVatRates });
    vat = d.vat;
    vatRegime = vatRegime || d.vatRegime;
  }
  vat = { treatment: vat.treatment, rateBp: vat.rateBp == null ? null : vat.rateBp, deductiblePct: vat.deductiblePct == null ? (vat.treatment === 'taxed' ? 100 : 0) : vat.deductiblePct };
  if (documentation === 'none') vat = { treatment: 'none', rateBp: null, deductiblePct: 0 };
  if ((vat.treatment === 'taxed' || vat.treatment === 'nondeductible') && vat.rateBp == null) {
    vat.rateBp = defaultRateFor(i.countryCode, i.date, countries, company, ctx.roVatRates).standardBp;
  }
  if (vat.treatment === 'reverse' && vat.rateBp == null) {
    vat.rateBp = defaultRateFor(companyCountry, i.date, countries, company, ctx.roVatRates).standardBp;
  }
  if (!vatRegime) {
    if (vat.treatment === 'none' && cat && cat.defaultVat && cat.defaultVat.vatRegime === 'outOfScope') vatRegime = 'outOfScope';
    else if (vat.treatment === 'reverse') vatRegime = (country && country.isEu === false) ? 'import' : 'ic';
    else if (documentation === 'none') vatRegime = 'outOfScope';
    else vatRegime = 'domestic';
  }

  // 2. sumele în moneda originală
  let orig;
  if (forced && forced.orig) orig = { net: forced.orig.net, vat: forced.orig.vat, gross: forced.orig.net + forced.orig.vat };
  else if (i.amounts) orig = { gross: i.amounts.gross, net: i.amounts.net, vat: i.amounts.vat };
  else if (vat.treatment === 'taxed' || vat.treatment === 'nondeductible') {
    orig = splitAmounts({ entered: i.entered, minor: i.minor, rateBp: vat.rateBp });
  } else {
    if (i.entered === 'vat') throw new RangeError('Pentru tratamentul „' + vat.treatment + '” nu se poate introduce doar TVA.');
    orig = { gross: i.minor, net: i.minor, vat: 0 }; // fără TVA / 0% / taxare inversă: brut = net
  }

  // 3. îngheț RON și EUR
  let ron, eur;
  if (i.currency === 'RON') ron = { ...orig };
  else if (forced && forced.ron) ron = { net: forced.ron.net, vat: forced.ron.vat, gross: forced.ron.net + forced.ron.vat };
  else ron = convertSet(orig, i.currency, 'RON', rate.ronPerUnit);
  if (i.currency === 'EUR') eur = { ...orig };
  else if (rate.eurPerUnit == null) eur = null;
  else if (forced && forced.eur) eur = { net: forced.eur.net, vat: forced.eur.vat, gross: forced.eur.net + forced.eur.vat };
  else eur = convertSet(orig, i.currency, 'EUR', rate.eurPerUnit);

  // 4. cost / TVA recuperabil (pentru venit nu există cost: ron.net este venitul)
  const vctx = { company, countryCode: i.countryCode, documentation, refundable };
  const zero = { cost: 0, recoverable: 0, recoverableKind: null, selfAssessedVat: 0 };
  const rc = income ? zero : vatCost(ron, vat, vctx);
  const ec = income || !eur ? zero : vatCost(eur, vat, vctx);
  const ronBlock = { ...ron, cost: rc.cost, recoverable: rc.recoverable, recoverableKind: rc.recoverableKind, selfAssessedVat: rc.selfAssessedVat };
  const eurBlock = eur ? { ...eur, cost: ec.cost, recoverable: ec.recoverable } : null;

  const fx = {
    ronPerUnit: i.currency === 'RON' ? '1' : rate.ronPerUnit,
    eurPerUnit: i.currency === 'EUR' ? '1' : (rate.eurPerUnit == null ? null : rate.eurPerUnit),
    rateDate: rate.rateDate,
    source: i.currency === 'RON' ? 'ron' : rate.source,
    manual: !!rate.manual,
    stale: !!rate.stale || (eur === null),
    dateBasis: i.fxDateBasis || (i.docDate ? 'docDate' : 'date'),
    eurSource: rate.eurSource || null,
  };
  const foreignVatStatus = rc.recoverableKind === 'foreign' && rc.recoverable > 0 ? 'toClaim' : null;
  return { vat, vatRegime, orig, ron: ronBlock, eur: eurBlock, fx, foreignVatStatus };
}

// ───────────── API public ─────────────

/**
 * Construiește o intrare completă (sume înghețate în moneda originală, RON și EUR).
 * Dacă `eurPerUnit` lipsește din curs (RON fără niciun curs EUR cunoscut), `eur` este `null` și `fx.stale` = true.
 * @param {EntryInput} input
 * @param {{ company:object, countries:object[], categories:object[], rate:object, now:string, id?:string, roVatRates?:object[], deviceId?:string }} ctx
 */
export function buildEntry(input, ctx) {
  if (!input || !KINDS.includes(input.kind)) throw new TypeError("kind trebuie să fie 'expense' sau 'income'.");
  if (!ISO_DATE.test(input.date || '')) throw new TypeError('Data trebuie să fie YYYY-MM-DD.');
  if (!ctx || !ctx.company) throw new TypeError('ctx.company este obligatoriu.');
  return assemble(input, computeFinancials({ ...input, documentation: input.documentation || 'invoice' }, ctx), ctx);
}

/** Pune laolaltă câmpurile intrării din input + blocurile financiare calculate. */
function assemble(input, fin, ctx) {
  const documentation = input.documentation || 'invoice';
  const source = input.source || 'manual';
  const status = input.status || (source === 'recurring' ? 'auto_pending' : source === 'import' ? 'pending' : 'confirmed');
  const targetType = input.targetType || (input.truckId ? 'truck' : 'company');
  const entry = {
    id: ctx.id || newId('ent'),
    kind: input.kind,
    incomeType: input.kind === 'income' ? (input.incomeType || 'other') : null,
    date: input.date,
    docDate: input.docDate || null,
    accrualMonth: input.accrualMonth || monthOf(input.date),
    relatesTo: input.relatesTo || null,
    target: { type: targetType, truckId: targetType === 'truck' ? (input.truckId || null) : null, trailerId: targetType === 'trailer' ? (input.trailerId || null) : null },
    groupId: input.groupId || null,
    parentDocId: input.parentDocId || null,
    categoryId: input.categoryId,
    supplier: input.supplier || '',
    counterpartyVatId: input.counterpartyVatId || null,
    docNo: input.docNo || '',
    note: input.note || '',
    documentation,
    moneySource: input.moneySource || 'company',
    justification: input.justification || null,
    approvedAt: input.approvedAt || null,
    costClass: input.costClass || 'cost',
    countryCode: input.countryCode,
    vatRegime: fin.vatRegime,
    vat: fin.vat,
    foreignVatStatus: input.foreignVatStatus != null ? input.foreignVatStatus : fin.foreignVatStatus,
    correctionOf: input.correctionOf || null,
    fuel: input.fuel || null,
    currency: input.currency,
    orig: fin.orig,
    fx: fin.fx,
    ron: fin.ron,
    eur: fin.eur,
    payment: input.payment || null,
    status,
    recurring: input.recurring || null,
    source,
    importId: input.importId || null,
    courseId: input.courseId || null,
    spread: input.spread || null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    createdBy: 'admin',
  };
  if (ctx.deviceId) entry.updatedBy = ctx.deviceId;
  return entry;
}

/** Reconstruiește intrarea de plecare (EntryInput) dintr-o intrare existentă. */
function inputFromEntry(e) {
  return {
    kind: e.kind, incomeType: e.incomeType, date: e.date, docDate: e.docDate, accrualMonth: e.accrualMonth, relatesTo: e.relatesTo,
    truckId: e.target.truckId, trailerId: e.target.trailerId, targetType: e.target.type, groupId: e.groupId, parentDocId: e.parentDocId,
    categoryId: e.categoryId, supplier: e.supplier, counterpartyVatId: e.counterpartyVatId, docNo: e.docNo, note: e.note,
    documentation: e.documentation, moneySource: e.moneySource, justification: e.justification, approvedAt: e.approvedAt,
    costClass: e.costClass, countryCode: e.countryCode, vatRegime: e.vatRegime, vat: { ...e.vat },
    foreignVatStatus: e.foreignVatStatus, correctionOf: e.correctionOf, fuel: e.fuel, currency: e.currency,
    entered: 'gross', minor: e.orig.gross, payment: e.payment, status: e.status, recurring: e.recurring, source: e.source,
    importId: e.importId, courseId: e.courseId, spread: e.spread, fxDateBasis: e.fx && e.fx.dateBasis,
  };
}

/**
 * Recalculează o intrare după schimbarea sumei / TVA / cursului. Fără `patch.rate` se păstrează cursul înghețat al intrării
 * (istoria nu se rescrie pe tăcute). O intrare recurentă editată primește `recurring.edited = true`.
 * @param {object} e
 * @param {{ entered?:'gross'|'net'|'vat', minor?:number, vat?:Partial<VatSpec>, rate?:object }} patch
 * @param {object} ctx  { company, countries, categories, now, roVatRates? } (ctx.rate ignorat; cursul = patch.rate sau cel al intrării)
 */
export function changeAmounts(e, patch, ctx) {
  const input = inputFromEntry(e);
  if (patch.vat) input.vat = { ...input.vat, ...patch.vat };
  if (patch.entered && patch.minor == null) throw new TypeError('`entered` cere și `minor`.');
  if (patch.minor != null) { input.entered = patch.entered || 'gross'; input.minor = patch.minor; }
  else {
    // fără sumă nouă: sumele originale rămân neschimbate dacă nici cota, nici tratamentul nu se schimbă
    const pv = patch.vat || {};
    const sameRate = pv.rateBp === undefined || pv.rateBp === e.vat.rateBp;
    const sameTreatment = pv.treatment === undefined || pv.treatment === e.vat.treatment;
    if (sameRate && sameTreatment) input.amounts = { ...e.orig };
  }
  const rate = patch.rate || {
    ronPerUnit: e.fx.ronPerUnit, eurPerUnit: e.fx.eurPerUnit, rateDate: e.fx.rateDate, source: e.fx.source,
    manual: e.fx.manual, stale: e.fx.stale, eurSource: e.fx.eurSource || null,
  };
  // moneda RON păstrează sursa 'ron' în fx; rate.source ignorat pentru RON în computeFinancials
  const fin = computeFinancials(input, { ...ctx, rate });
  const next = {
    ...e, vat: fin.vat, vatRegime: fin.vatRegime, orig: fin.orig, ron: fin.ron, eur: fin.eur, fx: fin.fx,
    foreignVatStatus: e.foreignVatStatus && fin.ron.recoverable > 0 ? e.foreignVatStatus : fin.foreignVatStatus,
    updatedAt: ctx.now,
  };
  if (e.recurring) next.recurring = { ...e.recurring, edited: true };
  if (ctx.deviceId) next.updatedBy = ctx.deviceId;
  return next;
}

/**
 * Împarte o cheltuială pe mai multe camioane: intrări separate cu același `groupId`. Suma brut/net/TVA din fiecare bloc
 * (original, RON, EUR) = totalul la ban. Costul și TVA recuperabil se recalculează pe fiecare intrare (identitatea per intrare rămâne valabilă).
 * ctx.fairSeed ⇒ restul se împarte cu allocateFair (cel mai mare rest, determinist); altfel restul merge pe ultima parte.
 * ctx.ids ⇒ id-uri deterministe (altfel newId).
 * @param {EntryInput} input  sumele sunt totalul documentului
 * @param {string[]} truckIds
 * @param {number[]} weights
 * @param {object} ctx  ca la buildEntry (+ fairSeed?, ids?)
 * @returns {object[]}
 */
export function splitAcrossTrucks(input, truckIds, weights, ctx) {
  if (!Array.isArray(truckIds) || truckIds.length === 0) throw new RangeError('Alege cel puțin un camion.');
  if (!Array.isArray(weights) || weights.length !== truckIds.length) throw new RangeError('Numărul de ponderi trebuie să fie egal cu numărul de camioane.');
  if (!weights.every((w) => isInt(w) && w >= 0) || weights.every((w) => w === 0)) throw new RangeError('Ponderile trebuie să fie întregi pozitive.');
  const total = computeFinancials({ ...input, documentation: input.documentation || 'invoice' }, ctx);
  const alloc = (amount, tag) => (ctx.fairSeed ? allocateFair(amount, weights, ctx.fairSeed + ':' + tag) : allocate(amount, weights));
  const parts = {
    oNet: alloc(total.orig.net, 'o.net'), oVat: alloc(total.orig.vat, 'o.vat'),
    rNet: alloc(total.ron.net, 'r.net'), rVat: alloc(total.ron.vat, 'r.vat'),
    eNet: total.eur ? alloc(total.eur.net, 'e.net') : null, eVat: total.eur ? alloc(total.eur.vat, 'e.vat') : null,
  };
  const groupId = input.groupId || newId('grp');
  return truckIds.map((truckId, k) => {
    const forced = {
      orig: { net: parts.oNet[k], vat: parts.oVat[k] },
      ron: { net: parts.rNet[k], vat: parts.rVat[k] },
      eur: parts.eNet ? { net: parts.eNet[k], vat: parts.eVat[k] } : null,
    };
    const sub = { ...input, truckId, targetType: 'truck', groupId, vat: total.vat, vatRegime: total.vatRegime, amounts: undefined, documentation: input.documentation || 'invoice' };
    const fin = computeFinancials(sub, ctx, forced);
    return assemble(sub, fin, { ...ctx, id: ctx.ids ? ctx.ids[k] : undefined });
  });
}

/**
 * Suma „fără document” (RON minor, brut) a unui camion într-o lună de înregistrare, fără intrarea cu id-ul `excludeId`.
 * Pentru plafonul lunar per camion (5.4).
 */
export function noDocMonthlyTotal(entries, truckId, month, excludeId) {
  let t = 0;
  for (const e of entries || []) {
    if (e.deletedAt || e.id === excludeId || e.kind !== 'expense' || e.documentation !== 'none') continue;
    if (e.target && e.target.truckId === truckId && e.accrualMonth === month) t += e.ron.gross;
  }
  return t;
}

const err = (field, code, message) => ({ field, code, message });

/**
 * Validează invariantele unei intrări. Întoarce lista erorilor (goală = validă), cu mesaje în română.
 * ctx: { company, categories, countries?, closedThrough?, noDocMonthTotalMinor? }
 *   noDocMonthTotalMinor = suma „fără document” a altor intrări ale aceluiași camion în aceeași lună (RON minor), vezi noDocMonthlyTotal.
 * @returns {Array<{field:string, code:string, message:string}>}
 */
export function validateEntry(e, ctx) {
  const errs = [];
  const company = (ctx && ctx.company) || {};
  const categories = (ctx && ctx.categories) || [];
  if (!e || !KINDS.includes(e.kind)) { errs.push(err('kind', 'KIND', 'Tipul intrării este invalid.')); return errs; }
  if (!ISO_DATE.test(e.date || '')) errs.push(err('date', 'DATE', 'Data este invalidă (format AAAA-LL-ZZ).'));
  if (e.docDate != null && !ISO_DATE.test(e.docDate)) errs.push(err('docDate', 'DATE', 'Data documentului este invalidă.'));
  if (!MONTH.test(e.accrualMonth || '')) errs.push(err('accrualMonth', 'MONTH', 'Luna de înregistrare este invalidă.'));
  if (e.relatesTo != null && !MONTH.test(e.relatesTo)) errs.push(err('relatesTo', 'MONTH', 'Luna „aferent” este invalidă.'));
  if (!DOCS.includes(e.documentation)) errs.push(err('documentation', 'DOC', 'Tipul documentului este invalid.'));
  if (e.status && !STATUSES.includes(e.status)) errs.push(err('status', 'STATUS', 'Stare necunoscută.'));
  if (e.source && !SOURCES.includes(e.source)) errs.push(err('source', 'SOURCE', 'Sursă necunoscută.'));
  if (e.payment != null && !PAYMENTS.includes(e.payment)) errs.push(err('payment', 'PAYMENT', 'Modalitate de plată necunoscută.'));
  if (!/^[A-Z]{3}$/.test(e.currency || '')) errs.push(err('currency', 'CURRENCY', 'Moneda este invalidă.'));
  if (!e.countryCode) errs.push(err('countryCode', 'COUNTRY', 'Alege țara.'));

  // țintă
  const t = e.target || {};
  if (t.type === 'truck' && !t.truckId) errs.push(err('target', 'TARGET', 'Alege camionul.'));
  else if (t.type === 'trailer' && !t.trailerId) errs.push(err('target', 'TARGET', 'Alege remorca.'));
  else if (!['truck', 'trailer', 'company'].includes(t.type)) errs.push(err('target', 'TARGET', 'Țintă invalidă.'));

  // categorie
  const cat = categories.find((c) => c.id === e.categoryId);
  if (!e.categoryId) errs.push(err('categoryId', 'CATEGORY', 'Alege categoria.'));
  else if (categories.length && !cat) errs.push(err('categoryId', 'CATEGORY', 'Categoria nu există.'));
  if (cat) {
    if (e.kind === 'expense' && cat.kind !== 'expense') errs.push(err('categoryId', 'CATEGORY_KIND', 'Categoria nu este de cheltuială.'));
    if (e.kind === 'income' && cat.kind === 'expense') errs.push(err('categoryId', 'CATEGORY_KIND', 'Categoria nu este de venit.'));
    if (cat.personnel && e.documentation === 'none') errs.push(err('documentation', 'PERSONNEL_NO_DOC', 'Cheltuielile de personal nu pot fi „fără document”.'));
  }

  // TVA
  const v = e.vat || {};
  if (!VAT_TREATMENTS.includes(v.treatment)) errs.push(err('vat.treatment', 'VAT_TREATMENT', 'Tratament TVA invalid.'));
  if (!VAT_REGIMES.includes(e.vatRegime)) errs.push(err('vatRegime', 'VAT_REGIME', 'Regim TVA invalid.'));
  if (!isInt(v.deductiblePct) || v.deductiblePct < 0 || v.deductiblePct > 100) errs.push(err('vat.deductiblePct', 'DEDUCTIBLE', 'Deductibilitatea trebuie să fie între 0 și 100%.'));
  if ((v.treatment === 'taxed' || v.treatment === 'nondeductible' || v.treatment === 'reverse') && !(isInt(v.rateBp) && v.rateBp >= 0 && v.rateBp <= 100000)) {
    errs.push(err('vat.rateBp', 'VAT_RATE', 'Lipsește cota TVA.'));
  }
  if (e.kind === 'income' && v.treatment === 'nondeductible') errs.push(err('vat.treatment', 'INCOME_NONDEDUCTIBLE', 'Un venit nu poate avea TVA nedeductibil.'));
  if (e.documentation === 'none' && v.treatment !== 'none') errs.push(err('vat.treatment', 'NODOC_VAT', 'Fără document, TVA trebuie să fie „fără TVA”.'));
  if (v.treatment === 'reverse' && e.orig && e.orig.vat !== 0) errs.push(err('orig.vat', 'REVERSE_VAT', 'La taxarea inversă factura nu conține TVA.'));
  if ((v.treatment === 'none' || v.treatment === 'zero') && e.orig && e.orig.vat !== 0) errs.push(err('orig.vat', 'NO_VAT_AMOUNT', 'Fără TVA / 0%: suma TVA trebuie să fie 0.'));

  // sume
  const allowNeg = !!e.correctionOf;
  const blocks = [['orig', e.orig], ['ron', e.ron], ['eur', e.eur]];
  for (const [name, b] of blocks) {
    if (!b) { if (name !== 'eur') errs.push(err(name, 'AMOUNTS', 'Lipsesc sumele (' + name + ').')); continue; }
    if (![b.gross, b.net, b.vat].every(isInt)) { errs.push(err(name, 'AMOUNTS', 'Sumele trebuie să fie întregi (unitate minoră).')); continue; }
    if (b.gross !== b.net + b.vat) errs.push(err(name + '.gross', 'GROSS_NET_VAT', 'Brut trebuie să fie egal cu net + TVA.'));
    if (!allowNeg && (b.gross < 0 || b.net < 0 || b.vat < 0)) errs.push(err(name + '.gross', 'NEGATIVE', 'Suma nu poate fi negativă (folosește o intrare de corecție).'));
  }
  if (e.ron && isInt(e.ron.recoverable)) {
    if (e.ron.recoverable < 0 || e.ron.recoverable > Math.max(e.ron.vat, 0)) errs.push(err('ron.recoverable', 'RECOVERABLE', 'TVA recuperabil depășește TVA.'));
    if (e.documentation !== 'invoice' && e.ron.recoverable !== 0) errs.push(err('ron.recoverable', 'RECOVERABLE_NO_INVOICE', 'Doar factura dă TVA recuperabil.'));
    if (e.documentation === 'none' && e.ron.recoverable !== 0) errs.push(err('ron.recoverable', 'NODOC_VAT', 'Fără document nu există TVA recuperabil.'));
    if (e.kind === 'expense' && e.ron.cost != null && [e.ron.gross, e.ron.net, e.ron.vat].every(isInt) && VAT_TREATMENTS.includes(v.treatment)) {
      let selfNon = 0;
      if (v.treatment === 'reverse' && isInt(v.rateBp)) {
        const r = vatCost({ gross: e.ron.gross, net: e.ron.net, vat: e.ron.vat }, v, { company, countryCode: e.countryCode, documentation: e.documentation });
        selfNon = r.selfNonRecoverable;
        if (r.selfAssessedVat !== e.ron.selfAssessedVat) errs.push(err('ron.selfAssessedVat', 'SELF_VAT', 'TVA autolichidat nu corespunde cotei.'));
      }
      const expected = e.ron.net + (e.ron.vat - e.ron.recoverable) + selfNon;
      if (e.ron.cost !== expected) errs.push(err('ron.cost', 'COST_FORMULA', 'Costul nu respectă formula net + (TVA − recuperabil).'));
    }
  }

  // curs
  if (e.fx) {
    if (e.currency !== 'RON' && !(e.fx.ronPerUnit && isPositiveRate(e.fx.ronPerUnit))) errs.push(err('fx', 'FX_MISSING', 'Lipsește cursul valutar.'));
    if (e.currency !== 'RON' && e.fx.manual !== true && e.fx.manual !== false) errs.push(err('fx.manual', 'FX_FLAG', 'Marcajul de curs manual lipsește.'));
  } else errs.push(err('fx', 'FX_MISSING', 'Lipsește cursul valutar.'));

  // fără document: sursa banilor, justificare peste plafon
  if (e.kind === 'expense' && e.documentation === 'none') {
    if (!MONEY_SOURCES.includes(e.moneySource)) errs.push(err('moneySource', 'MONEY_SOURCE', 'Alege sursa banilor pentru cheltuiala fără document.'));
    const gross = e.ron ? e.ron.gross : 0;
    const perTx = company.noDocCeilingMinor;
    const perMonth = company.noDocCeilingMonthlyPerTruckMinor;
    const overTx = isInt(perTx) && perTx > 0 && gross > perTx;
    const monthTotal = (ctx && isInt(ctx.noDocMonthTotalMinor) ? ctx.noDocMonthTotalMinor : 0) + gross;
    const overMonth = isInt(perMonth) && perMonth > 0 && t.type === 'truck' && monthTotal > perMonth;
    if ((overTx || overMonth) && !(e.justification && String(e.justification).trim())) {
      errs.push(err('justification', 'JUSTIFICATION', overTx
        ? 'Suma fără document depășește plafonul per tranzacție: scrie o justificare.'
        : 'Totalul fără document al camionului depășește plafonul lunar: scrie o justificare.'));
    }
    if ((overTx || overMonth) && e.justification && !e.approvedAt) {
      // aprobarea (approvedAt) se completează la confirmare; nu blochează salvarea ca ciornă
    }
  }

  // luna închisă
  const closedThrough = (ctx && ctx.closedThrough !== undefined ? ctx.closedThrough : company.closedThrough) || null;
  if (closedThrough && MONTH.test(e.accrualMonth || '') && e.accrualMonth <= closedThrough) {
    errs.push(err('accrualMonth', 'CLOSED_MONTH', 'Luna ' + e.accrualMonth + ' este închisă. Înregistrează în luna curentă, „aferent lunii ' + e.accrualMonth + '”, sau redeschide luna.'));
  }
  return errs;
}
