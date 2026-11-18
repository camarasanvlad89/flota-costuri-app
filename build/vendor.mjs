#!/usr/bin/env node
// npm run vendor        – descarcă o dată versiunile fixate, scrie în vendor/ și actualizează VENDOR.lock.json (SHA-256)
// npm run vendor -- --verify   – doar verifică (offline) că vendor/ coincide cu VENDOR.lock.json
// Build-ul (build.mjs) NU accesează rețeaua; doar acest script o face, și doar când îl rulezi.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const LOCK = join(VENDOR, 'VENDOR.lock.json');

/** Versiuni fixate. Schimbarea unei versiuni = schimbare conștientă, cu commit al lock-ului. */
export const PACKAGES = [
  { name: 'preact', version: '10.29.8', files: [
    { from: 'package/dist/preact.module.js', to: 'preact.module.js' },
    { from: 'package/hooks/dist/hooks.module.js', to: 'preact-hooks.module.js' },
    { from: 'package/LICENSE', to: 'LICENSE.preact' } ] },
  { name: 'htm', version: '3.1.1', files: [
    { from: 'package/dist/htm.module.js', to: 'htm.module.js' },
    { from: 'package/LICENSE', to: 'LICENSE.htm' } ] },
  { name: 'fflate', version: '0.8.3', files: [
    { from: 'package/esm/browser.js', to: 'fflate.browser.js' },
    { from: 'package/LICENSE', to: 'LICENSE.fflate' } ] },
];
/** SheetJS CE nu mai e publicat pe npm: se ia de la cdn.sheetjs.com (Apache-2.0). */
export const SHEETJS = { version: '0.20.3',
  url: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  licenseUrl: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE',
  to: 'xlsx.full.min.js', licenseTo: 'LICENSE.xlsx' };

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function get(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} la ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

export function verifyVendor() {
  if (!existsSync(LOCK)) return { ok: false, problems: ['lipsește vendor/VENDOR.lock.json (rulează npm run vendor)'] };
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const problems = [];
  for (const [file, meta] of Object.entries(lock.files)) {
    const p = join(VENDOR, file);
    if (!existsSync(p)) { problems.push(`lipsește ${file}`); continue; }
    if (sha256(readFileSync(p)) !== meta.sha256) problems.push(`SHA-256 diferit pentru ${file}`);
  }
  return { ok: problems.length === 0, problems, lock };
}

async function main() {
  if (process.argv.includes('--verify')) {
    const v = verifyVendor();
    if (!v.ok) { console.error('vendor: ' + v.problems.join('\n        ')); process.exit(1); }
    console.log(`vendor: ok (${Object.keys(v.lock.files).length} fișiere)`);
    return;
  }
  mkdirSync(VENDOR, { recursive: true });
  const old = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { files: {} };
  const lock = { generatedBy: 'build/vendor.mjs', files: {} };
  const tmp = mkdtempSync(join(tmpdir(), 'flota-vendor-'));
  try {
    for (const pkg of PACKAGES) {
      const meta = JSON.parse((await get(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`)).toString('utf8'));
      const tgz = await get(meta.dist.tarball);
      const [algo, b64] = String(meta.dist.integrity).split('-');
      const got = createHash(algo).update(tgz).digest('base64');
      if (got !== b64) throw new Error(`integritate nepotrivită pentru ${pkg.name}@${pkg.version}`);
      const dir = join(tmp, pkg.name); mkdirSync(dir);
      writeFileSync(join(dir, 'p.tgz'), tgz);
      execFileSync('tar', ['-xzf', join(dir, 'p.tgz'), '-C', dir]);
      for (const f of pkg.files) {
        copyFileSync(join(dir, f.from), join(VENDOR, f.to));
        lock.files[f.to] = { source: `npm:${pkg.name}@${pkg.version}`, sha256: sha256(readFileSync(join(VENDOR, f.to))), npmIntegrity: meta.dist.integrity };
      }
    }
    const x = await get(SHEETJS.url);
    writeFileSync(join(VENDOR, SHEETJS.to), x);
    lock.files[SHEETJS.to] = { source: `${SHEETJS.url}`, sha256: sha256(x) };
    try { const l = await get(SHEETJS.licenseUrl); writeFileSync(join(VENDOR, SHEETJS.licenseTo), l);
      lock.files[SHEETJS.licenseTo] = { source: SHEETJS.licenseUrl, sha256: sha256(l) }; } catch { /* licența e opțională */ }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  // SheetJS nu are hash publicat: dacă lock-ul vechi avea alt hash pentru aceeași versiune, e o alarmă.
  for (const [f, m] of Object.entries(lock.files)) {
    const o = old.files[f];
    if (o && o.source === m.source && o.sha256 !== m.sha256) throw new Error(`ATENȚIE: ${f} are alt conținut decât lock-ul pentru aceeași sursă. Verifică manual înainte de a șterge lock-ul.`);
  }
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log(`vendor: ${Object.keys(lock.files).length} fișiere scrise în vendor/ și blocate în VENDOR.lock.json`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
