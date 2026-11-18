import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCurrencies, DEFAULT_CURRENCIES, currencyExpFrom, isCurrencyCode } from '../../../src/data/currencies.js';
import { defaultCountries, defaultRoVatRates, VAT_RATES_DISCLAIMER } from '../../../src/data/vat-defaults.js';
import { defaultCategories, CATEGORY_GROUPS } from '../../../src/data/categories-default.js';
import { currencyExp } from '../../../src/core/money.js';

test('monede: HUF cu 0 zecimale, restul 2; copiile sunt mutabile și independente; exponentul coincide cu core', () => {
  assert.equal(currencyExpFrom(null, 'HUF'), 0);
  assert.equal(currencyExpFrom(null, 'EUR'), 2);
  for (const c of DEFAULT_CURRENCIES) assert.equal(currencyExp(c.code), c.exp, c.code);
  const a = defaultCurrencies(); a[0].enabled = false;
  assert.equal(defaultCurrencies()[0].enabled, true);
  assert.ok(isCurrencyCode('RON') && !isCurrencyCode('ron'));
  assert.deepEqual(defaultCurrencies().filter((c) => c.enabled).map((c) => c.code), ['RON', 'EUR', 'HUF', 'PLN', 'CZK', 'USD', 'GBP', 'CHF']);
});

test('țări, cote RO și categorii: copii independente, grupe cunoscute, avertizare de verificare', () => {
  const c = defaultCountries(); c[0].standardBp = 1;
  assert.equal(defaultCountries()[0].standardBp, 2100);
  assert.equal(defaultRoVatRates().at(-1).standardBp, 2100);
  assert.match(VAT_RATES_DISCLAIMER, /verifică/);
  for (const cat of defaultCategories()) assert.ok(CATEGORY_GROUPS[cat.group], cat.id);
});
