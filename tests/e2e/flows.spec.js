// Scenariile E2E din DEV-PLAN 11.2 (nr. 2–13, 15). Marcate `fixme` până când ecranele corespunzătoare există: fiecare are pașii,
// datele din fixture-uri și verificările exacte, ca să se poată activa pe rând (scoate `.fixme` și adaptează selectorii la contractul de ecrane).
// Selectori recomandați: role/label/text în română (strings.js); fără clase CSS.
import { test, expect } from '@playwright/test';
import { fixturePath } from '../helpers/fixtures.js';
import { stubExternal, watch } from './helpers.js';

test.beforeEach(async ({ page }) => { await stubExternal(page); });

test.fixme('(1) pornire demo: insigna „date demo”, Acasă cu clasament și KPI km pe gol', async ({ page }) => {
  await page.goto('/index.html#/acasa');
  await expect(page.getByText('date demo').first()).toBeVisible();
  await expect(page.getByText(/km pe gol/i).first()).toBeVisible();
});

test.fixme('(2) cheltuială în EUR cu TVA DE (19%) și curs manual: brut/net/TVA calculate, insigna „curs manual”', async ({ page }) => {
  // Pași: #/nou/cheltuiala ⇒ țară DE, monedă EUR, tratament „cu TVA”, introduce brut 119,00 ⇒ net 100,00 și TVA 19,00;
  // curs manual 5,3442 ⇒ echivalent RON 635,96 (brut) înghețat; insigna „curs manual”; salvare ⇒ apare în #/tranzactii cu valoarea originală lângă RON.
  await page.goto('/index.html#/nou/cheltuiala');
});

test.fixme('(3) utilizabilitate: 10 cheltuieli reale în ≤ 20 s fiecare (rând rapid + tastatură)', async ({ page }) => {
  // Cronometrează de la deschiderea panoului `n` până la salvare cu Enter; 10 iterații cu valorile implicite (ultima categorie/camion/plată).
  // Pragul 20 s/cheltuială; raportează media în test.info().annotations.
  const t0 = Date.now(); void t0;
});

test.fixme('(4) șablon fix + ceas fals 4 luni ⇒ catch-up + „Confirmă toate”; a doua deschidere nu adaugă nimic', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-10T09:00:00') });
  await page.goto('/index.html#/setari/cheltuieli-fixe');
  // creează „Chirie”, 1.500,00 RON, lunar, ziua 31, început 31.01.2026; avansează ceasul la 10.05.2026 ⇒ 4 ocurențe (31.01, 28.02, 31.03, 30.04)
  // „De verificat” arată 4 × „automat, de confirmat” cu insigna „Recurentă”; „Confirmă toate” ⇒ 0 rămase; reîncărcare ⇒ tot 4 (idempotent)
});

test.fixme('(5) ștergere + Anulează (15 s) readuce înregistrarea; „Anulează ultima acțiune” din meniu', async ({ page }) => {
  await page.goto('/index.html#/tranzactii');
});

test.fixme('(6) import curse: registrul aug.–oct. 2025 ⇒ 27 curse; reimport ⇒ 0 noi', async ({ page }) => {
  await page.goto('/index.html#/import');
  await page.setInputFiles('input[type=file]', fixturePath('courses', 'tabel-curse-registru-aug-oct-2025.xlsx'));
  // selectează foaia „XX00DEM 2025”, valuta RON (pas blocant, eșantion + total RON), previzualizare: 27 rânduri, 2 „derivat”, 1 „fără preț”
  // Importă ⇒ #/curse arată 27; al doilea import al aceluiași fișier ⇒ „0 noi, 27 neschimbate”
});

test.fixme('(7) import GPS (zilnic + călătorii) ⇒ Camion > Km 8.376,3 km; Confruntare listează curse și steaguri', async ({ page }) => {
  await page.goto('/index.html#/import');
  await page.setInputFiles('input[type=file]', [
    fixturePath('gps', 'safefleet-calatorii-XX00DEM-oct2026.xlsx'),
    fixturePath('gps', 'safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx'),
  ]);
  await expect(page.getByText(/8\.376,3\s*km/).first()).toBeVisible();
});

test.fixme('(8) km pe gol + panoul de calitate: încărcați + goi = GPS; zile fără activitate raportate separat', async ({ page }) => {
  await page.goto('/index.html#/km-pe-gol');
});

test.fixme('(9) export Excel: se descarcă .xlsx, structura OOXML validă, grafice native prezente, celula de verificare Σ camioane = total flotă', async ({ page }) => {
  await page.goto('/index.html#/rapoarte');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /export excel/i }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
});

test.fixme('(10) backup JSON ⇒ golire ⇒ restaurare (confirmare tastată „RESTAUREAZĂ”) ⇒ aceleași totaluri', async ({ page }) => {
  await page.goto('/index.html#/setari/date');
});

test.fixme('(12) mod Google cu stub: sincronizare, offline, conflict cu două contexte', async ({ browser }) => {
  const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
  await ctxA.close(); await ctxB.close();
});

test.fixme('(13) două file pe același context: editări în ambele fără pierderi; un singur lider de sincronizare', async ({ context }) => {
  const a = await context.newPage(); const b = await context.newPage();
  await a.goto('/index.html'); await b.goto('/index.html');
});

test.fixme('(15) buget de performanță: bază sintetică de 5 ani (~15 MB): pornire < 3 s, salvare < 500 ms', async ({ page }) => {
  const w = watch(page); void w;
  await page.goto('/index.html');
});
