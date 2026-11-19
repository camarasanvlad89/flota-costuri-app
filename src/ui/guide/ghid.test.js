// Rulare: node --test src/ui/guide/ghid.test.js
// Conținutul ghidului: structură, legături către rute reale, confidențialitate, Markdown; ecranul: se construiește cu esbuild și se randează fără DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDE, NEWS, allIds, allLinks, cardText, filterGuide, guideFullText, inline, norm, plain, toMarkdown } from './content.js';
import { checkPrivacy } from '../../../build/check-privacy.mjs';
import { compile } from '../route-match.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', '..', '..');
const SCREENS = resolve(HERE, '..', '..', 'screens');

/** Rutele reale: citite din modulele de ecran (model `route: '…'`), fără a importa Preact. */
function realRoutes() {
  const out = [];
  for (const d of readdirSync(SCREENS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = join(SCREENS, d.name, 'index.js');
    if (!existsSync(f)) continue;
    const m = /route:\s*'(\/[^']*)'/.exec(readFileSync(f, 'utf8'));
    if (m) out.push(m[1]);
  }
  return out;
}
function settingsSections() {
  const src = readFileSync(join(SCREENS, 'settings', 'index.js'), 'utf8');
  return [...src.matchAll(/\['([a-z]+)',\s*'[^']+',\s*[A-Za-z]+Section\]/g)].map((m) => m[1]);
}
const routeOk = (path, routes) => routes.some((r) => compile(r).re.test(path));

test('structură: id-uri unice, fiecare secțiune și fiecare carte au conținut', () => {
  const seen = new Set();
  for (const s of GUIDE.sections) {
    assert.ok(s.title && s.cards.length, 'secțiune goală: ' + s.id);
    assert.ok(!seen.has(s.id), 'id duplicat ' + s.id); seen.add(s.id);
    for (const c of s.cards) {
      assert.ok(!seen.has(c.id), 'id duplicat ' + c.id); seen.add(c.id);
      assert.ok(c.title && c.blocks.length, 'carte goală: ' + c.id);
      assert.match(c.id, /^[a-z0-9-]+$/);
    }
  }
  assert.equal(GUIDE.sections.length, 8);
  assert.ok(GUIDE.sections.find((s) => s.id === 'retete').cards.length >= 20, 'cel puțin 20 de rețete');
  assert.ok(GUIDE.sections.find((s) => s.id === 'primii-pasi').cards[0].blocks.find((b) => b.t === 'steps').items.length === 10, '10 pași');
  assert.ok(NEWS.items.length >= 5);
});

test('legături: fiecare legătură din ghid duce la o rută reală, la o secțiune de setări reală sau la un id din ghid', () => {
  const routes = realRoutes();
  assert.ok(routes.includes('/ghid/:sectiune?'), 'ecranul ghid este în registru');
  assert.ok(routes.includes('/import') && routes.includes('/setari/:sectiune?'));
  const sets = settingsSections();
  assert.ok(sets.length >= 9, 'secțiunile de setări au fost citite: ' + sets.join(','));
  const ids = allIds(GUIDE);
  const links = allLinks(GUIDE);
  assert.ok(links.length > 30);
  const bad = [];
  for (const l of links) {
    if (!l.to.startsWith('/')) { bad.push(`${l.where}: legătură fără „/”: ${l.to}`); continue; }
    if (l.to.startsWith('/ghid/')) { if (!ids.has(l.to.slice(6))) bad.push(`${l.where}: id inexistent ${l.to}`); continue; }
    if (l.to.startsWith('/setari/')) { if (!sets.includes(l.to.slice(8))) bad.push(`${l.where}: secțiune de setări inexistentă ${l.to}`); continue; }
    if (!routeOk(l.to, routes)) bad.push(`${l.where}: rută inexistentă ${l.to}`);
  }
  assert.deepEqual(bad, []);
});

test('legăturile contextuale (HelpLink) din ecrane și din Setări duc la id-uri existente', () => {
  const ids = allIds(GUIDE);
  const found = new Set();
  for (const d of readdirSync(SCREENS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(SCREENS, d.name))) {
      if (!/\.js$/.test(f) || /\.test\./.test(f)) continue;
      const src = readFileSync(join(SCREENS, d.name, f), 'utf8');
      for (const m of src.matchAll(/<\$\{HelpLink\}\s+id="([^"]+)"/g)) found.add(m[1]);
    }
  }
  const sSrc = readFileSync(join(SCREENS, 'settings', 'index.js'), 'utf8');
  const map = /const HELP = \{([^}]+)\}/.exec(sSrc);
  assert.ok(map, 'harta HELP din Setări');
  for (const m of map[1].matchAll(/:\s*'([^']+)'/g)) found.add(m[1]);
  assert.ok(found.size >= 12, 'legături contextuale găsite: ' + [...found].join(','));
  for (const id of found) assert.ok(ids.has(id), 'HelpLink către id inexistent: ' + id);
  for (const need of ['ecran-import', 'ecran-curse', 'ecran-confruntare', 'ecran-km-gol', 'ecran-rapoarte', 'idee-fixe', 'rec-backup']) assert.ok(found.has(need), 'lipsește legătura contextuală ' + need);
});

test('confidențialitate: ghidul (text, sursă și Markdown) nu conține plăcuțe, șoferi sau adrese reale', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ghid-'));
  try {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'ghid.md'), toMarkdown(GUIDE));
    writeFileSync(join(root, 'dist', 'ghid.txt'), guideFullText(GUIDE));
    writeFileSync(join(root, 'dist', 'content.js'), readFileSync(join(HERE, 'content.js'), 'utf8'));
    writeFileSync(join(root, 'dist', 'view.js'), readFileSync(join(HERE, 'view.js'), 'utf8'));
    const hits = await checkPrivacy({ root, targets: ['dist'] });
    assert.deepEqual(hits, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
  const txt = guideFullText(GUIDE);
  for (const m of txt.matchAll(/\b[A-Z]{1,2}[ -]?\d{2,3}[ -]?[A-Z]{3}\b/g)) assert.match(m[0], /^XX[ -]?\d{2}[ -]?DEM$/, 'plăcuță nepermisă: ' + m[0]);
  assert.match(txt, /XX 00 DEM/, 'exemplele folosesc plăcuțe fictive');
});

test('marcaje: inline() și plain() tratează **, `cod` și legături', () => {
  const parts = inline('Vezi **Import** și [Setări](/setari/fixe), apoi `n`.');
  assert.deepEqual(parts.map((p) => p.t), ['text', 'b', 'text', 'link', 'text', 'code', 'text']);
  assert.equal(parts[3].to, '/setari/fixe');
  assert.equal(plain('a **b** [c](/x) `d`'), 'a b c d');
});

test('căutare: fără diacritice și fără majuscule; mai multe cuvinte = toate trebuie să apară', () => {
  assert.equal(norm('Restaurează'), 'restaureaza');
  const r = filterGuide(GUIDE, 'restauREAZA backup');
  const ids = r.flatMap((s) => s.cards.map((c) => c.id));
  assert.ok(ids.includes('rec-restaurare'));
  assert.ok(filterGuide(GUIDE, 'km pe gol').flatMap((s) => s.cards.map((c) => c.id)).includes('ecran-km-gol'));
  assert.equal(filterGuide(GUIDE, 'zzzzqqqq').length, 0);
  assert.equal(filterGuide(GUIDE, '').length, GUIDE.sections.length);
  for (const c of GUIDE.sections.flatMap((s) => s.cards)) assert.ok(cardText(c).length > 40, 'carte prea scurtă: ' + c.id);
});

test('Markdown: titlu, cuprins, ancore pentru fiecare secțiune și carte; legăturile către ghid devin ancore', () => {
  const md = toMarkdown(GUIDE);
  assert.match(md, /^# Ghid: cum se folosește aplicația/);
  for (const id of allIds(GUIDE).keys()) assert.ok(md.includes(`<a id="${id}"></a>`) || md.includes(`(#${id})`), 'lipsește ancora ' + id);
  assert.ok(md.includes('(#idee-fara-document)'), 'legătură către ghid = ancoră');
  assert.ok(md.includes('Noutăți în versiunea ' + NEWS.version));
  if (existsSync(join(APP, '..', 'docs', 'GHID-UTILIZATOR.md'))) {
    assert.equal(readFileSync(join(APP, '..', 'docs', 'GHID-UTILIZATOR.md'), 'utf8'), md, 'docs/GHID-UTILIZATOR.md este depășit: rulează npm run guide');
  }
});

test('ecran: view.js se construiește cu esbuild și blocurile se randează (fiecare tip de bloc, ambele moduri)', async () => {
  const { build } = await import('esbuild');
  const vendor = join(APP, 'vendor');
  const map = { preact: 'preact.module.js', 'preact/hooks': 'preact-hooks.module.js', htm: 'htm.module.js', fflate: 'fflate.browser.js' };
  const r = await build({
    entryPoints: [join(HERE, 'view.js')], bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent',
    plugins: [{ name: 'v', setup(b) { b.onResolve({ filter: /^(preact|preact\/hooks|htm|fflate)$/ }, (a) => ({ path: join(vendor, map[a.path]) })); } }],
  });
  const code = r.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  assert.equal(typeof mod.GuideView, 'function');
  assert.equal(typeof mod.AboutBlock, 'function');
  const text = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v === 'string' || typeof v === 'number' ? String(v)
    : Array.isArray(v) ? v.map(text).join('') : typeof v.type === 'function' ? text(v.type({ ...v.props, children: v.props.children })) : text(v.props && v.props.children));
  const kinds = new Set();
  const nav = () => {}; const go = () => {};
  for (const c of GUIDE.sections.flatMap((s) => s.cards)) for (const b of c.blocks) {
    kinds.add(b.t);
    const out = mod.Block({ b, embedded: false, go, nav });
    assert.ok(out, `bloc nerandat (${c.id}, ${b.t})`);
    assert.ok(text(out).length > 5, `bloc fără text (${c.id}, ${b.t})`);
    assert.ok(mod.Block({ b, embedded: true, go, nav }), 'embedded ' + c.id);
  }
  assert.deepEqual([...kinds].sort(), ['dl', 'ex', 'note', 'ol', 'p', 'steps', 'ul', 'warn']);
  // legătură în modul normal = <a href="#/rută">; în modul „embedded” către un ecran = text neclicabil, către ghid = clicabil
  const link = mod.Inline({ text: '[Import](/import) și [backup](/ghid/rec-backup)', embedded: false, go });
  const html1 = JSON.stringify(link, (k, v) => (k === '__' ? undefined : v));
  assert.match(html1, /#\/import/);
  const emb = JSON.stringify(mod.Inline({ text: '[Import](/import) și [backup](/ghid/rec-backup)', embedded: true, go }));
  assert.ok(!emb.includes('"#/import"'), 'în embedded legătura către ecran nu este href');
  assert.ok(emb.includes('#/ghid/rec-backup'));
});
