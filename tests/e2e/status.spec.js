import { test, expect } from '@playwright/test';

async function startDemo(page) {
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Pornește cu date demo' }).click();
  await page.waitForSelector('.demo-badge', { state: 'attached' });
}

test('stare date: fără bannere permanente; iconița „Stare date” deschide panoul; „Mai târziu” amână memento-ul', async ({ page }) => {
  await startDemo(page);
  expect(await page.locator('.bands').count(), 'bannerele vechi nu mai există').toBe(0);
  const icon = page.getByTestId('data-status');
  await expect(icon).toHaveAttribute('aria-label', /Stare date: doar pe acest dispozitiv, backup niciodată/);
  await icon.click();
  const panel = page.getByTestId('data-status-panel');
  await expect(panel).toContainText('Doar pe acest dispozitiv');
  await expect(panel).toContainText('niciodată');
  await expect(panel).not.toContainText('acum 0 zile');
  await page.getByRole('button', { name: 'Închide' }).click();
  // memento: există date, niciun backup => notificare cu „Mai târziu” (amânare 24 h, păstrată după reîncărcare)
  const reminder = page.getByTestId('backup-reminder');
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'Mai târziu' }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('data-status')).toBeVisible();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
});

test('stare date pe telefon 390×844: fără scroll orizontal, panoul este deasupra barei de jos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.getByTestId('data-status').click();
  const btn = await page.getByRole('button', { name: 'Descarcă backup' }).last().boundingBox();
  const covered = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !(el && el.closest('.sheet')); }, { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 });
  expect(covered, 'butoanele panoului nu sunt acoperite de bara de jos sau de notificări').toBe(false);
});
