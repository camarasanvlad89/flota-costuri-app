// @axe-core/playwright pe fiecare ecran (DEV-PLAN 11.2, 8.0.2). Doar încălcările serious/critical blochează.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES } from './helpers.js';

for (const route of ROUTES) {
  for (const scheme of ['light', 'dark']) {
    test(`axe ${route} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      // cu date demo (altfel ecranele sunt goale și axe nu vede tabele, grupuri de navigare, bare de defilare)
      await page.goto('/index.html');
      await page.getByRole('button', { name: 'Pornește cu date demo' }).click();
      await page.waitForSelector('.demo-badge');
      await page.evaluate((r) => { location.hash = r; }, route);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      expect(bad.map((v) => `${v.id}: ${v.nodes.length} noduri`), JSON.stringify(bad.map((v) => v.help))).toEqual([]);
    });
  }
}
