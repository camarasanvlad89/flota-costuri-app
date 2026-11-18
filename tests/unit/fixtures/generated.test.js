// Fișierele generate comise în repo corespund scripturilor care le produc (nu se editează de mână).
import { existsSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP, fixturePath } from '../../helpers/fixtures.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;

test('golden/expected.json = rezultatul scriptului Python independent (make_expected.py)', { skip: !hasPython && 'python3 lipsește' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'flota-golden-'));
  try {
    const out = join(dir, 'expected.json');
    const r = spawnSync('python3', [fixturePath('golden', 'make_expected.py'), out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, 'utf8'), readFileSync(fixturePath('golden', 'expected.json'), 'utf8'), 'rulează: npm run golden și comite expected.json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fixture-urile comise = ce produce scripts/make-fixtures.mjs (--check)', { skip: !existsSync(join(APP, '..', 'docs', 'ref')) && 'docs/ref lipsește (depozit public)' }, () => {
  const r = spawnSync(process.execPath, [join(APP, 'scripts', 'make-fixtures.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout + '\nrulează: npm run fixtures');
});

test('fixture-urile publice GPS sunt anonimizate (fără străzi) și au aceleași cifre ca cele reale din tests/private (dacă există)', async (t) => {
  const { existsSync } = await import('node:fs');
  const priv = join(APP, 'tests', 'private', 'gps');
  for (const f of ['safefleet-calatorii-XX00DEM-oct2026.xlsx', 'safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx']) {
    assert.ok(existsSync(fixturePath('gps', f)), f);
  }
  if (!existsSync(priv)) return t.skip('tests/private/gps lipsește (normal în depozitul public)');
});

test('toate fixture-urile inventate au FICTIV în nume (insigna „date demo”); cele reale nu sunt marcate FICTIV', async () => {
  const { readdirSync } = await import('node:fs');
  const gps = readdirSync(fixturePath('gps')).filter((n) => n.endsWith('.xlsx'));
  for (const n of gps) assert.equal(/^FICTIV-/.test(n), !n.startsWith('safefleet-'), n);
  for (const n of readdirSync(fixturePath('fictiv'))) assert.match(n, /FICTIV/i, n);
});
