// Pornire, CSP, 0 cereri externe, responsive, file:// (DEV-PLAN 11.2 pct. 1, 11, 14). Independente de ecrane: rulează pe orice dist/ valid.
import { test, expect } from '@playwright/test';
import { watch, stubExternal, noHorizontalScroll, SINGLE_FILE_URL } from './helpers.js';

test('pornire pe dist/ servit: fără erori de consolă, fără încălcări CSP, fără cereri externe la pornire', async ({ page }) => {
  const w = watch(page);
  await stubExternal(page);
  await page.goto('/index.html');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#app, #root, main, body').first()).toBeVisible();
  expect(w.csp, 'încălcări CSP').toEqual([]);
  expect(w.errors, 'erori JS/consolă').toEqual([]);
  expect(w.external, 'cereri către gazde externe la pornire (4.9: nimic nu pleacă fără acțiune)').toEqual([]);
});

test('index.html: CSP prezent și scripturile inline au hash', async ({ page }) => {
  await page.goto('/index.html');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  const res = await page.request.get('/index.html');
  expect(res.headers()['content-security-policy'] ?? csp).toContain("default-src 'self'");
});

test('responsive 390×844: fără scroll orizontal al paginii', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await page.waitForLoadState('networkidle');
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('dist/flota-costuri.html prin file://: pornește, fără cereri externe, fără erori', async ({ page, browserName }) => {
  const w = watch(page);
  await page.goto(SINGLE_FILE_URL);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toBeVisible();
  expect(w.csp).toEqual([]); expect(w.errors).toEqual([]); expect(w.external).toEqual([]);
  // Mod local: Google nu se încarcă din file:// (config.js inline cu clientId gol)
  const cfg = await page.evaluate(() => window.FLOTA_CONFIG && window.FLOTA_CONFIG.googleClientId);
  expect(cfg).toBe('');
  test.info().annotations.push({ type: 'browser', description: browserName });
});

test('SheetJS este în pachet și se inițializează leneș la prima folosire', async ({ page }) => {
  await page.goto('/index.html');
  const v = await page.evaluate(() => globalThis.XLSX && globalThis.XLSX.version);
  expect(v).toMatch(/^0\.20\./);
});
