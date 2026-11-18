// Monede implicite (CurrencyCfg). Lista este configurabilă în Setări > Valute.
// Exponentul (exp) = numărul de zecimale ale unității minore; HUF are 0.
// Înregistrările au `id = code`, ca să poată sta într-o colecție (3.1).

/** @typedef {{ id:string, code:string, name:string, exp:number, enabled:boolean, symbol:string, note?:string }} CurrencyCfg */

/** @type {ReadonlyArray<CurrencyCfg>} */
export const DEFAULT_CURRENCIES = Object.freeze([
  { id: 'RON', code: 'RON', name: 'Leu românesc', exp: 2, enabled: true, symbol: 'lei' },
  { id: 'EUR', code: 'EUR', name: 'Euro', exp: 2, enabled: true, symbol: '€' },
  { id: 'HUF', code: 'HUF', name: 'Forint maghiar', exp: 0, enabled: true, symbol: 'HUF' },
  { id: 'PLN', code: 'PLN', name: 'Zlot polonez', exp: 2, enabled: true, symbol: 'PLN' },
  { id: 'CZK', code: 'CZK', name: 'Coroană cehă', exp: 2, enabled: true, symbol: 'CZK' },
  { id: 'USD', code: 'USD', name: 'Dolar american', exp: 2, enabled: true, symbol: 'USD' },
  { id: 'GBP', code: 'GBP', name: 'Liră sterlină', exp: 2, enabled: true, symbol: 'GBP' },
  { id: 'CHF', code: 'CHF', name: 'Franc elvețian', exp: 2, enabled: true, symbol: 'CHF' },
  // Bulgaria a trecut la euro la 01.01.2026: BGN rămâne în listă doar pentru documente vechi.
  { id: 'BGN', code: 'BGN', name: 'Leva bulgărească (înlocuită de euro din 2026)', exp: 2, enabled: false, symbol: 'BGN',
    note: 'Bulgaria folosește euro din 01.01.2026; activează doar pentru documente mai vechi (verifică).' },
]);

/** Copie mutabilă (pentru seed în colecția `currencies`). */
export function defaultCurrencies() {
  return DEFAULT_CURRENCIES.map((c) => ({ ...c }));
}

/** Cod ISO 4217 plauzibil (3 litere mari). */
export function isCurrencyCode(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

/** Exponentul unei monede din lista dată, altfel din implicite, altfel 2. */
export function currencyExpFrom(list, code) {
  const c = (list || DEFAULT_CURRENCIES).find((x) => x.code === code) || DEFAULT_CURRENCIES.find((x) => x.code === code);
  return c ? c.exp : 2;
}
