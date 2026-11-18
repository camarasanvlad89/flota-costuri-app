// Regresie QA: check-privacy detectează adrese, șoferi reali, plăcuțe în afara XX NN DEM și citește .xlsx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPrivacy, readZip } from '../../../build/check-privacy.mjs';

const APP = fileURLToPath(new URL('../../../', import.meta.url));
const withDist = async (files, fn) => {
  const root = mkdtempSync(join(tmpdir(), 'priv-'));
  try { mkdirSync(join(root, 'dist')); for (const [n, c] of Object.entries(files)) writeFileSync(join(root, 'dist', n), c); return await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('adrese stradale în text liber, șofer real și plăcuță nepermisă sunt detectate', async () => {
  const hits = await withDist({ 'a.txt': 'Încărcare la Strada Victoriei 10, Satu Mare', 'b.txt': 'Derkovits Gyula utca 137', 'c.txt': 'șofer ADAM', 'd.txt': 'camion B 123 ABC' }, (root) => checkPrivacy({ root, targets: ['dist'] }));
  const joined = hits.join('\n');
  assert.match(joined, /a\.txt: adresă stradală \(RO\)/);
  assert.match(joined, /b\.txt: adresă stradală \(HU\)/);
  assert.match(joined, /c\.txt: nume real de șofer/);
  assert.match(joined, /d\.txt: plăcuță în afara listei permise/);
});

test('plăcuțele XX NN DEM și textul inofensiv trec', async () => {
  const hits = await withDist({ 'ok.json': '{"plate":"XX 00 DEM","trailer":"XX30DEM","loc":"Drum local, Arad"}' }, (root) => checkPrivacy({ root, targets: ['dist'] }));
  assert.deepEqual(hits, []);
});

test('fixture-urile publice (.xlsx incluse) nu conțin adrese sau plăcuțe reale; .xlsx se citește cu adevărat', async () => {
  const hits = await checkPrivacy({ root: APP, targets: ['tests/fixtures'] });
  assert.deepEqual(hits, []);
  const zip = readZip(readFileSync(join(APP, 'tests/fixtures/gps/safefleet-calatorii-XX00DEM-oct2026.xlsx')));
  assert.ok(zip.some((f) => /sheet1\.xml$/.test(f.name)), 'zip citit');
});

test('un .xlsx corupt face verificarea să eșueze (nu se ignoră tăcut)', async () => {
  const hits = await withDist({ 'x.xlsx': Buffer.from('PK\u0003\u0004 nu e zip valid') }, (root) => checkPrivacy({ root, targets: ['dist'] }));
  assert.ok(hits.some((h) => /ilizibil/.test(h)));
});
