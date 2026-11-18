// Playwright (doar devDependency). Rulează pe dist/ servit local, în mod local (demo). DEV-PLAN 11.2.
//   npm run build && npx playwright install chromium firefox && npm run test:e2e
// Variabile: FLOTA_DIST (director dist, implicit app/dist), PW_CHANNEL=chrome (folosește Chrome-ul instalat în loc de Chromium descărcat),
//            E2E_PORT (implicit 4173), E2E_BROWSERS=chromium,firefox (implicit ambele; Firefox e obligatoriu pentru file://, 11.2 pct. 14)
import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR as app, DIST, PORT as port } from './paths.js';

const here = dirname(fileURLToPath(import.meta.url));
const want = (process.env.E2E_BROWSERS || 'chromium,firefox').split(',');

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.js$/,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: resolve(app, 'playwright-report') }]],
  outputDir: resolve(app, 'test-results'),
  use: { baseURL: `http://localhost:${port}`, locale: 'ro-RO', timezoneId: 'Europe/Bucharest', colorScheme: 'light', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    ...(want.includes('chromium') ? [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) } }] : []),
    ...(want.includes('firefox') ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : []),
  ],
  webServer: { command: `node ${resolve(app, 'build', 'serve.mjs')} ${DIST} ${port}`, port, reuseExistingServer: !process.env.CI, timeout: 20_000 },
});
