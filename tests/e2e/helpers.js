import { ALLOWED_EXTERNAL_HOSTS } from '../../build/csp.mjs';
import { DIST } from './paths.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SINGLE_FILE_URL = pathToFileURL(join(DIST, 'flota-costuri.html')).href;
/** Ecranele de parcurs (rute hash, 2.3). */
export const ROUTES = ['#/acasa', '#/tranzactii', '#/nou/cheltuiala', '#/nou/venit', '#/verificare', '#/curse', '#/import', '#/confruntare', '#/km-pe-gol', '#/rapoarte', '#/setari/firma', '#/setari/cheltuieli-fixe', '#/ghid', '#/ghid/rec-backup'];

/** Pornește urmărirea erorilor de consolă/CSP și a cererilor către gazde externe. */
export function watch(page, { allowExternal = false } = {}) {
  const errors = []; const external = []; const csp = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) csp.push(t);
    else if (m.type() === 'error' && !/favicon|Failed to load resource.*(404)/i.test(t)) errors.push(t);
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/^(data|blob|about):/.test(r.url())) return;
    if (u.protocol === 'file:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return;
    if (allowExternal && ALLOWED_EXTERNAL_HOSTS.includes(u.host)) return;
    external.push(r.url());
  });
  return { errors, external, csp };
}

/** Interceptează serviciile externe permise (11.2): Frankfurter / OSRM / Nominatim ⇒ răspunsuri fixe, fără rețea reală. */
export async function stubExternal(page) {
  await page.route('https://api.frankfurter.dev/**', (route) => route.fulfill({ json: { amount: 1, base: 'EUR', date: '2026-10-14', rates: { RON: 5.3442, HUF: 364.08, PLN: 4.2815 } } }));
  await page.route('https://router.project-osrm.org/**', (route) => route.fulfill({ json: { code: 'Ok', routes: [{ distance: 250000, duration: 11000 }] } }));
  await page.route('https://nominatim.openstreetmap.org/**', (route) => route.fulfill({ json: [{ lat: '47.15', lon: '23.05', display_name: 'FICTIV' }] }));
}

export async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}
