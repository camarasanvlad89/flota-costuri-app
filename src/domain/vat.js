// TVA pe țară și pe regim (plan 5.2). Calcule pure, în întregi (unitatea minoră), fără float.
// Importă doar core/* și data/*.

import { mulDiv } from '../core/money.js';
import { DEFAULT_COUNTRIES, DEFAULT_RO_VAT_RATES, roRateOn } from '../data/vat-defaults.js';

/** @typedef {'taxed'|'none'|'zero'|'nondeductible'|'reverse'} VatTreatment */
/** @typedef {{ treatment:VatTreatment, rateBp:number|null, deductiblePct:number }} VatSpec */

export const VAT_TREATMENTS = Object.freeze(['taxed', 'none', 'zero', 'nondeductible', 'reverse']);
export const VAT_REGIMES = Object.freeze(['domestic', 'ic', 'import', 'outOfScope']);

const isInt = (n) => Number.isSafeInteger(n);

/**
 * Împarte o sumă introdusă în brut / net / TVA.
 * entered='gross': net = brut·10000/(10000+cota); entered='net': TVA = net·cota/10000;
 * entered='vat': net = TVA·10000/cota (cota 0 ⇒ eroare). Rotunjire jumătate în sus, în afara lui zero.
 * Exemplu verificat: net 3542,77 la 2100 bp ⇒ TVA 743,98, brut 4286,75.
 * @param {{ entered:'gross'|'net'|'vat', minor:number, rateBp:number }} i
 * @returns {{ gross:number, net:number, vat:number }}
 */
export function splitAmounts(i) {
  const { entered, minor, rateBp } = i || {};
  if (!isInt(minor)) throw new RangeError('Suma trebuie să fie un întreg (unitate minoră).');
  if (!isInt(rateBp) || rateBp < 0 || rateBp > 100000) throw new RangeError('Cota TVA trebuie să fie un întreg între 0 și 100000 puncte de bază.');
  if (entered === 'gross') {
    const net = mulDiv(minor, 10000, 10000 + rateBp);
    return { gross: minor, net, vat: minor - net };
  }
  if (entered === 'net') {
    const vat = mulDiv(minor, rateBp, 10000);
    return { gross: minor + vat, net: minor, vat };
  }
  if (entered === 'vat') {
    if (rateBp === 0) throw new RangeError('Din TVA nu se poate calcula suma cu cota 0%.');
    const net = mulDiv(minor, 10000, rateBp);
    return { gross: net + minor, net, vat: minor };
  }
  throw new TypeError("`entered` trebuie să fie 'gross', 'net' sau 'vat'.");
}

/**
 * Cota implicită a unei țări la o dată. Pentru România (țara firmei sau codul 'RO') se folosește
 * istoricul pe perioade (`roVatRates`, altfel valorile implicite din data/), restul țărilor au cotă simplă.
 * Țară necunoscută ⇒ { standardBp:0, reducedBp:[], unknown:true } (UI cere cota manual).
 * @param {string} countryCode
 * @param {string} onDate  'YYYY-MM-DD'
 * @param {Array<{code:string,standardBp:number,reducedBp:number[]}>} countries
 * @param {{ countryCode?:string }} [company]
 * @param {Array<{from:string,standardBp:number,reducedBp:number[]}>} [roVatRates]  extra față de plan: colecția roVatRates
 * @returns {{ standardBp:number, reducedBp:number[], unknown?:boolean }}
 */
export function defaultRateFor(countryCode, onDate, countries, company, roVatRates) {
  const code = String(countryCode || (company && company.countryCode) || '').toUpperCase();
  if (code === 'RO') {
    const r = roRateOn(roVatRates && roVatRates.length ? roVatRates : DEFAULT_RO_VAT_RATES, onDate);
    if (r) return { standardBp: r.standardBp, reducedBp: r.reducedBp.slice() };
  }
  const c = (countries || []).find((x) => x.code === code) || DEFAULT_COUNTRIES.find((x) => x.code === code);
  if (!c) return { standardBp: 0, reducedBp: [], unknown: true };
  return { standardBp: c.standardBp, reducedBp: c.reducedBp.slice() };
}

/**
 * Este TVA-ul acestei categorii nerambursabil în țara dată? (Country.nonRefundableGroups: id de grupă sau '*').
 * @param {{nonRefundableGroups?:string[]}|null|undefined} country
 * @param {{group?:string, defaultVat?:{refundable?:boolean}}|null|undefined} category
 */
export function isVatNonRefundable(country, category) {
  const groups = (country && country.nonRefundableGroups) || [];
  if (groups.includes('*')) return true;
  if (category && category.group && groups.includes(category.group)) return true;
  return !!(category && category.defaultVat && category.defaultVat.refundable === false);
}

/**
 * Cost și TVA recuperabil pentru o sumă (în orice monedă, valorile sunt unități minore).
 * Identitate (valabilă pentru toate tratamentele):  cost = net + (vat − recoverable) + (reverse ? parte nedeductibilă din TVA autolichidat : 0)
 *
 *  - taxed:          recoverable = vat − mulDiv(vat, 100−deductiblePct, 100), numai dacă documentația e factură,
 *                    firma e plătitoare și (pentru țări străine) TVA-ul e rambursabil; altfel 0.
 *  - none/zero/nondeductible: recoverable 0, cost = brut.
 *  - reverse:        net fără TVA; TVA autolichidat = net·cota; cost = net + partea nedeductibilă; autolichidarea e raportată separat.
 *
 * ctx.countryCode: țara cheltuielii (implicit țara firmei); ctx.documentation: 'invoice' (implicit) | 'receipt' | 'none';
 * ctx.refundable: false ⇒ TVA străin nerambursabil (implicit true).
 * @param {{gross:number,net:number,vat:number}} a
 * @param {VatSpec} v
 * @param {{ company:{ vatPayer?:boolean, countryCode?:string }, countryCode?:string, documentation?:string, refundable?:boolean }} ctx
 * @returns {{ cost:number, recoverable:number, recoverableKind:'ro'|'foreign'|null, selfAssessedVat:number, selfNonRecoverable:number, nonRecoverableVat:number }}
 */
export function vatCost(a, v, ctx) {
  const company = (ctx && ctx.company) || {};
  const { gross, net, vat } = a;
  if (![gross, net, vat].every(isInt)) throw new RangeError('Sumele trebuie să fie întregi (unitate minoră).');
  const treatment = v && v.treatment;
  const ded = v && v.deductiblePct != null ? v.deductiblePct : 100;
  if (!VAT_TREATMENTS.includes(treatment)) throw new TypeError('Tratament TVA necunoscut: ' + treatment);
  if (!isInt(ded) || ded < 0 || ded > 100) throw new RangeError('deductiblePct trebuie să fie între 0 și 100.');
  const vatPayer = company.vatPayer !== false;
  const companyCountry = company.countryCode || 'RO';
  const country = (ctx && ctx.countryCode) || companyCountry;
  const documentation = (ctx && ctx.documentation) || 'invoice';
  const refundable = !(ctx && ctx.refundable === false);

  let recoverable = 0;
  let kind = null;
  let selfAssessedVat = 0;
  let selfNonRecoverable = 0;

  if (treatment === 'taxed') {
    const foreign = country !== companyCountry;
    if (vatPayer && documentation === 'invoice' && (!foreign || refundable) && vat > 0) {
      recoverable = vat - mulDiv(vat, 100 - ded, 100);
      kind = recoverable > 0 ? (foreign ? 'foreign' : 'ro') : null;
    }
  } else if (treatment === 'reverse') {
    const rate = v && isInt(v.rateBp) ? v.rateBp : 0;
    selfAssessedVat = mulDiv(net, rate, 10000);
    // Firma neplătitoare nu are drept de deducere asupra TVA autolichidat.
    const dedEff = vatPayer && documentation === 'invoice' ? ded : 0;
    selfNonRecoverable = mulDiv(selfAssessedVat, 100 - dedEff, 100);
  }

  const nonRecoverableVat = vat - recoverable;
  const cost = net + nonRecoverableVat + selfNonRecoverable;
  return { cost, recoverable, recoverableKind: kind, selfAssessedVat, selfNonRecoverable, nonRecoverableVat };
}

/**
 * VatSpec + regim + rambursabilitate implicite pentru o categorie într-o țară la o dată (valori de pornire pentru formular).
 *  - firmă neplătitoare ⇒ 'taxed' devine 'nondeductible';
 *  - TVA străin dintr-o grupă nerambursabilă ⇒ 'nondeductible' (nu 'toClaim');
 *  - 'taxed' fără cotă ⇒ cota standard a țării la data respectivă.
 * @param {{defaultVat?:object,group?:string}|null} category
 * @param {string} countryCode
 * @param {string} onDate
 * @param {{ company:object, countries:object[], roVatRates?:object[] }} ctx
 * @returns {{ vat:VatSpec, vatRegime:'domestic'|'ic'|'import'|'outOfScope', refundable:boolean, unknownCountry:boolean }}
 */
export function defaultVatFor(category, countryCode, onDate, ctx) {
  const company = ctx.company || {};
  const companyCountry = company.countryCode || 'RO';
  const code = countryCode || companyCountry;
  const dv = (category && category.defaultVat) || { treatment: 'taxed', vatRegime: 'domestic', deductiblePct: 100, refundable: true };
  const country = (ctx.countries || []).find((c) => c.code === code) || DEFAULT_COUNTRIES.find((c) => c.code === code) || null;
  const nonRefundable = code !== companyCountry && isVatNonRefundable(country, category);
  const rate = defaultRateFor(code, onDate, ctx.countries, company, ctx.roVatRates);
  let treatment = dv.treatment;
  let rateBp = null;
  if (treatment === 'taxed' || treatment === 'nondeductible' || treatment === 'reverse') {
    rateBp = treatment === 'reverse' ? defaultRateFor(companyCountry, onDate, ctx.countries, company, ctx.roVatRates).standardBp : rate.standardBp;
  }
  if (treatment === 'taxed' && (company.vatPayer === false || nonRefundable)) treatment = 'nondeductible';
  let vatRegime = dv.vatRegime || 'domestic';
  if (treatment === 'none' || (dv.vatRegime === 'outOfScope')) vatRegime = 'outOfScope';
  const ded = treatment === 'taxed' ? (dv.deductiblePct != null ? dv.deductiblePct : 100) : (dv.deductiblePct != null ? dv.deductiblePct : 0);
  return {
    vat: { treatment, rateBp, deductiblePct: ded },
    vatRegime,
    refundable: !nonRefundable,
    unknownCountry: !!rate.unknown,
  };
}
