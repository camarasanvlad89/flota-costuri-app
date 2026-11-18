// Testele build-ului (DEV-PLAN 12): construiesc aplicația minimă din tests/fixtures/mini-app, independent de restul modulelor.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { APP } from '../../helpers/fixtures.js';
import { buildOnce, parseArgs } from '../../../build/build.mjs';
import { verifyHtml, verifyDist, metaCsp, inlineScripts, cspHash, escapeInlineJs, renderMulti, renderSingle } from '../../../build/inline.mjs';
import { buildCsp, CONNECT_SRC, ALLOWED_EXTERNAL_HOSTS, buildHeadersFile } from '../../../build/csp.mjs';
import { xlsxLazyPrelude } from '../../../build/xlsx-lazy.mjs';
import { serve } from '../../../build/serve.mjs';
import { verifyVendor } from '../../../build/vendor.mjs';

const MINI = join(APP, 'tests', 'fixtures', 'mini-app');
let tmp; let res; let dist;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'flota-buildtest-'));
  process.env.SOURCE_DATE_EPOCH = '1760000000';
  res = await buildOnce(parseArgs(['--root', MINI, '--out', join(tmp, 'dist'), '--quiet']));
  dist = join(tmp, 'dist');
});
after(() => { rmSync(tmp, { recursive: true, force: true }); delete process.env.SOURCE_DATE_EPOCH; });

test('vendor/ coincide cu VENDOR.lock.json (SHA-256)', () => {
  const v = verifyVendor(); assert.deepEqual(v.problems, []);
});

test('build: ieșirea trece toate verificările și conține fișierele așteptate', () => {
  assert.deepEqual(res.problems, []);
  const names = readdirSync(dist);
  for (const f of ['index.html', 'flota-costuri.html', 'config.js', 'sw.js', 'manifest.webmanifest', '_headers', 'build-info.json', 'icons']) assert.ok(names.includes(f), 'lipsește ' + f);
  assert.ok(names.some((n) => /^app\.[0-9a-f]{10}\.js$/.test(n)), 'JS cu hash în nume');
  assert.ok(names.some((n) => /^app\.[0-9a-f]{10}\.css$/.test(n)), 'CSS cu hash în nume');
  assert.ok(!names.some((n) => n.endsWith('.map')), 'fără sourcemap în producție');
});

test('index.html: CSP cu hash pentru scriptul inline, fără unsafe-inline/eval pe scripturi, scriptul vechi de module scos', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const csp = metaCsp(html);
  assert.ok(csp, 'meta CSP');
  const inl = inlineScripts(html);
  assert.equal(inl.length, 1, 'un singur script inline (cel de pornire din șablon)');
  assert.ok(csp.includes(`'${cspHash(inl[0])}'`));
  assert.ok(!/unsafe-eval/.test(csp)); assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  assert.ok(!/type="module"/.test(html)); assert.ok(!/src\/main/.test(html)); assert.ok(!/default-src \*/.test(html), 'CSP-ul permisiv din șablon a fost înlocuit');
  assert.match(html, /<script src="config\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="app\.[0-9a-f]{10}\.css">/);
  assert.match(html, /dataset\.boot = '0\.0\.0'/, '{{BUILD_ID}} înlocuit înainte de calculul hash-ului');
  assert.match(html, /<title>Mini aplicație de test \(0\.0\.0\)<\/title>/);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP înaintea oricărui script');
  assert.ok(html.indexOf('<meta charset') < html.indexOf('Content-Security-Policy'), 'charset în primii octeți, înaintea CSP');
});

test('flota-costuri.html: un singur fișier, tot inline, fără cereri externe, clientId gol, CSP doar cu hash-uri', () => {
  const html = readFileSync(join(dist, 'flota-costuri.html'), 'utf8');
  assert.deepEqual(verifyHtml(html, 'single'), []);
  const csp = metaCsp(html);
  assert.match(csp, /^default-src 'none'/);
  assert.ok(!/accounts\.google\.com|googleapis/.test(csp), 'fără Google în varianta file://');
  assert.ok(!/<script[^>]*\ssrc=/.test(html)); assert.ok(!/<link\b[^>]*rel="stylesheet"/.test(html));
  assert.ok(!/rel="manifest"/.test(html));
  assert.match(html, /googleClientId:''/);
  assert.match(html, /<style>/);
  assert.ok(inlineScripts(html).length >= 2);
  for (const s of inlineScripts(html)) assert.ok(csp.includes(`'${cspHash(s)}'`));
});

test('SheetJS inclus în pachet, init leneș: versiunea e disponibilă doar după prima citire', () => {
  const code = xlsxLazyPrelude(join(APP, 'vendor', 'xlsx.full.min.js'));
  const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.equal(Object.getOwnPropertyDescriptor(ctx, 'XLSX').get !== undefined, true, 'încă neinițializat (getter)');
  assert.equal(vm.runInContext('XLSX.version', ctx), '0.20.3');
  assert.equal(Object.getOwnPropertyDescriptor(ctx, 'XLSX').get, undefined, 'după init e valoare');
  assert.equal(vm.runInContext('typeof XLSX.read + typeof XLSX.write + typeof XLSX.utils.sheet_to_json', ctx), 'functionfunctionfunction');
});

test('sw.js: marcajele __BUILD_ID__ și __PRECACHE__ sunt înlocuite', () => {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('__BUILD_ID__') && !sw.includes('__PRECACHE__'));
  const list = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(sw)[1]);
  assert.ok(list.includes('index.html') && list.some((f) => /^app\..*\.js$/.test(f)));
  for (const f of list.filter((x) => x !== './')) assert.ok(existsSync(join(dist, f)), 'precache: ' + f);
});

test('_headers: CSP complet cu frame-ancestors, COOP pentru popup-ul Google, cache imuabil pe app.*', () => {
  const h = readFileSync(join(dist, '_headers'), 'utf8');
  assert.match(h, /Content-Security-Policy: .*frame-ancestors 'none'/);
  assert.match(h, /Cross-Origin-Opener-Policy: same-origin-allow-popups/);
  assert.match(h, /\/app\.\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(h, /\/config\.js\n\s+Cache-Control: no-cache/);
});

test('CSP: lista de gazde = 4.9; fără wildcard; meta fără frame-ancestors', () => {
  assert.deepEqual(CONNECT_SRC, ["'self'", 'https://accounts.google.com', 'https://www.googleapis.com', 'https://oauth2.googleapis.com', 'https://api.frankfurter.dev', 'https://router.project-osrm.org', 'https://nominatim.openstreetmap.org']);
  assert.ok(ALLOWED_EXTERNAL_HOSTS.includes('api.frankfurter.dev') && ALLOWED_EXTERNAL_HOSTS.includes('nominatim.openstreetmap.org'));
  const m = buildCsp({ mode: 'multi', inlineHashes: ['sha256-AAA='], meta: true });
  assert.ok(!/frame-ancestors/.test(m)); assert.ok(!/\*/.test(m));
  for (const d of ["base-uri 'none'", "object-src 'none'", "form-action 'none'"]) assert.ok(m.includes(d), d);
  assert.ok(buildCsp({ mode: 'multi', meta: false }).includes("frame-ancestors 'none'"));
  assert.ok(buildHeadersFile({ csp: 'x' }).includes('Content-Security-Policy: x'));
});

test('verifyHtml prinde: script inline fără hash, referință externă, handler inline, script module', () => {
  const ok = renderMulti({ template: null, cssFile: 'a.css', jsFile: 'a.js', hasConfig: false, vars: {} }).html;
  assert.deepEqual(verifyHtml(ok), []);
  assert.ok(verifyHtml(ok.replace('</body>', '<script>alert(1)</script></body>')).some((p) => /nu are hash/.test(p)));
  assert.ok(verifyHtml(ok.replace('</body>', '<script src="https://cdn.example.com/x.js"></script></body>')).some((p) => /referință externă/.test(p)));
  assert.ok(verifyHtml(ok.replace('<div id="app">', '<div id="app" onclick="x()">')).some((p) => /handlere inline/.test(p)));
  assert.ok(verifyHtml(ok.replace('</body>', '<script type="module" src="m.js"></script></body>')).some((p) => /module/.test(p)));
  assert.ok(verifyHtml(ok.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')).some((p) => /lipsește meta CSP/.test(p)));
  assert.ok(verifyHtml('<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'"></head></html>').some((p) => /unsafe/.test(p)));
});

test('verifyDist: prinde fișier referit lipsă și single-file prea mare', () => {
  const d2 = join(tmp, 'dist2'); cpSync(dist, d2, { recursive: true });
  const m = readdirSync(d2).find((n) => /^app\..*\.css$/.test(n)); rmSync(join(d2, m));
  assert.ok(verifyDist(d2).some((p) => p.includes('care nu există')));
  assert.ok(verifyDist(dist, { maxSingleBytes: 1000 }).some((p) => /MB/.test(p)));
});

test('escapeInlineJs: </script se escapează; <!-- urmat de <script e refuzat', () => {
  assert.equal(escapeInlineJs('a="</script>"'), 'a="<\\/script>"');
  assert.throws(() => escapeInlineJs('x="<!--"; y="<script>"'), /<!--/);
  assert.doesNotThrow(() => escapeInlineJs('x="<!-- comentariu -->"'));
});

test('build determinist: aceleași surse + SOURCE_DATE_EPOCH ⇒ aceleași nume cu hash și același index.html', async () => {
  const again = await buildOnce(parseArgs(['--root', MINI, '--out', join(tmp, 'dist-b'), '--quiet']));
  const names = (d) => readdirSync(d).filter((n) => /^app\./.test(n)).sort();
  assert.deepEqual(names(join(tmp, 'dist-b')), names(dist));
  assert.equal(readFileSync(join(tmp, 'dist-b', 'index.html'), 'utf8'), readFileSync(join(dist, 'index.html'), 'utf8'));
  assert.deepEqual(again.problems, []);
});

test('build refuză importuri „goale” necunoscute și lipsa vendor-ului cere mesaj clar', async () => {
  const root = join(tmp, 'bad'); mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.js'), "import x from 'lodash'; console.log(x);");
  await assert.rejects(buildOnce(parseArgs(['--root', root, '--out', join(tmp, 'dist-bad'), '--quiet'])), (e) => /lodash|resolve/i.test(JSON.stringify(e.errors || e.message)));
});

test('parseArgs: valori implicite și opțiuni', () => {
  const o = parseArgs([]); assert.equal(o.dev, false); assert.match(o.out, /[\\/]dist$/);
  const d = parseArgs(['--dev', '--port', '8080']); assert.equal(d.dev, true); assert.equal(d.port, 8080); assert.match(d.out, /dist-dev$/);
  assert.throws(() => parseArgs(['--nu-exista']), /necunoscută/);
});

test('serve: servește dist/, 404, blochează ieșirea din director, aplică antetele din _headers', async () => {
  const s = await serve(dist);
  try {
    const r = await fetch(s.url + '/index.html'); assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal((await fetch(s.url + '/nu-exista.js')).status, 404);
    const t = await fetch(s.url + '/..%2f..%2fpackage.json'); assert.ok([403, 404].includes(t.status));
    assert.equal((await fetch(s.url + '/')).status, 200);
  } finally { await s.close(); }
});
