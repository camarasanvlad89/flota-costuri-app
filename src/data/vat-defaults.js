// Valori de pornire pentru tabelul de țări și TVA (5.2.1). NU sunt garantate:
// cotele se schimbă. Administratorul trebuie să le verifice (bandă permanentă în Setări > Țări & TVA).
// `verifiedAt: null` = nicio cotă nu a fost verificată încă pe pagina Comisiei Europene „VAT rates”.

/** @typedef {{ id:string, code:string, name:string, currency:string, standardBp:number, reducedBp:number[],
 *   nonRefundableGroups:string[], refundDeadlineMmDd:string, isEu:boolean, verifiedAt:string|null, note:string }} Country */
/** @typedef {{ id:string, from:string, standardBp:number, reducedBp:number[] }} RoVatRate */

export const VAT_RATES_DISCLAIMER =
  'Cotele sunt valori de pornire, nu garantate. Se schimbă; verifică-le cu contabilul și pe pagina Comisiei Europene „VAT rates”.';

// [cod, nume, monedă, cotă standard (bp), cote reduse (bp), UE?, notă]
const ROWS = [
  ['RO', 'România', 'RON', 2100, [1100], true, 'Din 01.08.2025: 21% standard, 11% redusă. Istoricul e în tabelul „Cote România pe perioade”.'],
  ['HU', 'Ungaria', 'HUF', 2700, [1800, 500], true, ''],
  ['DE', 'Germania', 'EUR', 1900, [700], true, ''],
  ['AT', 'Austria', 'EUR', 2000, [1000, 1300], true, ''],
  ['IT', 'Italia', 'EUR', 2200, [1000, 500, 400], true, ''],
  ['FR', 'Franța', 'EUR', 2000, [1000, 550, 210], true, ''],
  ['ES', 'Spania', 'EUR', 2100, [1000, 400], true, ''],
  ['NL', 'Olanda', 'EUR', 2100, [900], true, ''],
  ['BE', 'Belgia', 'EUR', 2100, [1200, 600], true, ''],
  ['PL', 'Polonia', 'PLN', 2300, [800, 500], true, ''],
  ['BG', 'Bulgaria', 'EUR', 2000, [900], true, 'Moneda este euro din 01.01.2026 (verifică).'],
  ['CZ', 'Cehia', 'CZK', 2100, [1200], true, ''],
  ['SK', 'Slovacia', 'EUR', 2300, [1900, 500], true, ''],
  ['HR', 'Croația', 'EUR', 2500, [1300, 500], true, 'Moneda este euro din 01.01.2023.'],
  ['SI', 'Slovenia', 'EUR', 2200, [950, 500], true, ''],
  ['GR', 'Grecia', 'EUR', 2400, [1300, 600], true, ''],
  ['PT', 'Portugalia', 'EUR', 2300, [1300, 600], true, ''],
  ['CH', 'Elveția', 'CHF', 810, [260], false, 'Nu este în UE: procedură diferită de recuperare; implicit nimic nu e marcat recuperabil.'],
];

/** @type {ReadonlyArray<Country>} */
export const DEFAULT_COUNTRIES = Object.freeze(
  ROWS.map(([code, name, currency, standardBp, reducedBp, isEu, note]) => Object.freeze({
    id: code, code, name, currency, standardBp, reducedBp: Object.freeze(reducedBp.slice()),
    // '*' = nicio categorie nu e rambursabilă (țări non-UE). Alte valori = id-uri de grupă (Category.group).
    nonRefundableGroups: Object.freeze(code === 'CH' ? ['*'] : []),
    refundDeadlineMmDd: '09-30', isEu, verifiedAt: null, note,
  })),
);

export function defaultCountries() {
  return DEFAULT_COUNTRIES.map((c) => ({ ...c, reducedBp: c.reducedBp.slice(), nonRefundableGroups: c.nonRefundableGroups.slice() }));
}

/** Cota României pe perioade (19% → 21% la 01.08.2025). Fiecare rând valabil de la `from` până la următorul. */
/** @type {ReadonlyArray<RoVatRate>} */
export const DEFAULT_RO_VAT_RATES = Object.freeze([
  { id: 'rovat_2016-01-01', from: '2016-01-01', standardBp: 2000, reducedBp: [900, 500] },
  { id: 'rovat_2017-01-01', from: '2017-01-01', standardBp: 1900, reducedBp: [900, 500] },
  { id: 'rovat_2025-08-01', from: '2025-08-01', standardBp: 2100, reducedBp: [1100] },
]);

export function defaultRoVatRates() {
  return DEFAULT_RO_VAT_RATES.map((r) => ({ ...r, reducedBp: r.reducedBp.slice() }));
}

/** Rândul valabil la data dată dintr-o listă de RoVatRate (cel mai recent cu from <= data); null dacă data e înaintea tuturor. */
export function roRateOn(rates, onDate) {
  let best = null;
  for (const r of rates || DEFAULT_RO_VAT_RATES) {
    if (r.from <= onDate && (!best || r.from > best.from)) best = r;
  }
  return best;
}
