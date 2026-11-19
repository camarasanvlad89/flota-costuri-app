// Ghidul „Cum se folosește”: acces din meniu, din butonul „?” și din ecranul de bun venit; căutare; deschidere pe ancoră; telefon.
import { test, expect } from '@playwright/test';
import { watch, noHorizontalScroll } from './helpers.js';

async function startDemo(page) {
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Pornește cu date demo' }).click();
  await page.waitForSelector('.demo-badge', { state: 'attached' }); // pe telefon prima insignă este ascunsă
}

test('ghid: meniu „Cum se folosește”, titlul ecranului, bloc „Despre aplicație”, căutare și ancoră', async ({ page }) => {
  const w = watch(page);
  await startDemo(page);
  await page.getByRole('button', { name: 'Cum se folosește' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ghid: cum se folosește aplicația' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Despre aplicație' })).toBeVisible();
  await expect(page.getByText('Mod curent')).toBeVisible();
  await expect(page.getByText('Noutăți în versiunea')).toBeVisible();
  // căutare fără diacritice
  await page.getByLabel('Caută în ghid').fill('restaureaza');
  await expect(page.getByRole('button', { name: 'Restaurez un backup' })).toBeVisible();
  await page.getByLabel('Caută în ghid').fill('zzzzqq');
  await expect(page.getByText('Niciun rezultat')).toBeVisible();
  await page.getByLabel('Caută în ghid').fill('');
  // ancoră: deschide rețeta și o arată
  await page.evaluate(() => { location.hash = '#/ghid/rec-backup'; });
  const card = page.locator('#g-rec-backup');
  await expect(card.locator('button[aria-expanded="true"]')).toBeVisible();
  await expect(card.getByText('Descarcă backup').first()).toBeVisible();
  expect(w.errors, 'erori JS').toEqual([]);
});

test('ghid: butonul „?” din bara de sus (tooltip) și legăturile contextuale „Cum funcționează?”', async ({ page }) => {
  await startDemo(page);
  const q = page.getByRole('button', { name: 'Cum se folosește', exact: true });
  await expect(q.first()).toBeVisible();
  await page.evaluate(() => { location.hash = '#/import'; });
  await page.getByRole('button', { name: 'Cum funcționează?' }).click();
  await expect(page).toHaveURL(/#\/ghid\/ecran-import/);
  await expect(page.locator('#g-ecran-import button[aria-expanded="true"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/setari/fixe'; });
  await page.getByRole('button', { name: 'Cum funcționează?' }).click();
  await expect(page).toHaveURL(/#\/ghid\/idee-fixe/);
});

test('ghid: ecranul de bun venit are „Cum se folosește?” și se poate reveni', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Cum se folosește?' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ghid: cum se folosește aplicația' })).toBeVisible();
  await page.getByRole('button', { name: 'Înapoi la început' }).click();
  await expect(page.getByRole('button', { name: 'Pornește cu date demo' })).toBeVisible();
});

test('ghid pe telefon 390×844: fără scroll orizontal, cuprinsul se deschide din buton', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  await page.evaluate(() => { location.hash = '#/ghid'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Ghid: cum se folosește aplicația' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  const toc = page.getByRole('button', { name: 'Cuprins' });
  await expect(toc).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Cuprinsul ghidului' })).toBeHidden();
  await toc.click();
  await expect(page.getByRole('navigation', { name: 'Cuprinsul ghidului' })).toBeVisible();
});
