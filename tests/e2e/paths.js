import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(here, '..', '..');
/** Directorul `dist/` testat (FLOTA_DIST sau app/dist). */
export const DIST = process.env.FLOTA_DIST ? resolve(process.env.FLOTA_DIST) : resolve(APP_DIR, 'dist');
export const PORT = Number(process.env.E2E_PORT || 4173);
