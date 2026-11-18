// Ecranele, după nume fix (10.9). Fiecare modul exportă `screen`.
import { screen as home } from '../screens/home/index.js';
import { screen as truck } from '../screens/truck/index.js';
import { screen as entry } from '../screens/entry/index.js';
import { screen as ledger } from '../screens/ledger/index.js';
import { screen as verify } from '../screens/verify/index.js';
import { screen as courses } from '../screens/courses/index.js';
import { screen as importScreen } from '../screens/import/index.js';
import { screen as reconcile } from '../screens/reconcile/index.js';
import { screen as emptykm } from '../screens/emptykm/index.js';
import { screen as reports } from '../screens/reports/index.js';
import { screen as settings } from '../screens/settings/index.js';

export const screens = [home, truck, ledger, entry, verify, courses, importScreen, reconcile, emptykm, reports, settings];
export const byId = (id) => screens.find((s) => s.id === id);
/** Ecranele afișate în meniul lateral, ordonate. */
export function navItems() {
  return screens.filter((s) => s.nav).sort((a, b) => (a.nav.order || 0) - (b.nav.order || 0));
}
