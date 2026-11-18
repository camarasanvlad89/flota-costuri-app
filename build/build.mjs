#!/usr/bin/env node
// Build Flota Costuri (DEV-PLAN 12). Un singur format de rulare (D2): același pachet IIFE în dev și în producție.
//   node build/build.mjs                 → dist/ (index.html + app.<hash>.js/.css + flota-costuri.html)
//   node build/build.mjs --dev [--port N]→ dist-dev/ + esbuild watch + server static (fără minificare, cu sourcemap)
// Opțiuni: --root <dir> (implicit app/), --out <dir>, --version X, --sourcemap, --no-single, --quiet
import { build as esbuild, context as esContext } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { xlsxLazyPrelude } from './xlsx-lazy.mjs';
import { renderMulti, renderSingle, verifyDist } from './inline.mjs';
import { buildHeadersFile } from './csp.mjs';
import { serve } from './serve.mjs';
import { verifyVendor } from './vendor.mjs';
import { checkPrivacy } from './check-privacy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const o = { dev: false, port: 5173, root: resolve(HERE, '..'), out: null, version: null, sourcemap: false, single: true, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') o.dev = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--root') o.root = resolve(argv[++i]);
    else if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--version') o.version = argv[++i];
    else if (a === '--sourcemap') o.sourcemap = true;
    else if (a === '--no-single') o.single = false;
    else if (a === '--quiet') o.quiet = true;
    else throw new Error(`opțiune necunoscută: ${a}`);
  }
  o.out = o.out || join(o.root, o.dev ? 'dist-dev' : 'dist');
  return o;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function gitShort(root) {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}

function vendorAlias(vendorDir) {
  const map = { preact: 'preact.module.js', 'preact/hooks': 'preact-hooks.module.js', htm: 'htm.module.js', fflate: 'fflate.browser.js' };
  return {
    name: 'flota-vendor',
    setup(b) {
      b.onResolve({ filter: /^(preact|preact\/hooks|htm|fflate)$/ }, (a) => {
        const f = join(vendorDir, map[a.path]);
        if (!existsSync(f)) return { errors: [{ text: `lipsește vendor/${map[a.path]} (rulează: npm run vendor)` }] };
        return { path: f };
      });
    },
  };
}

function copyDir(src, dst, filter = () => true) {
  if (!existsSync(src)) return [];
  const copied = [];
  cpSync(src, dst, { recursive: true, filter: (s) => { const ok = filter(s); return ok; } });
  (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : copied.push(relative(src, p)); } })(src);
  return copied;
}

/**
 * Construiește o dată. Întoarce { out, files, problems, info }.
 * @param {ReturnType<typeof parseArgs>} o
 */
export async function buildOnce(o, { esbuildCtx = null } = {}) {
  const t0 = Date.now();
  const root = o.root;
  const vendorDir = existsSync(join(root, 'vendor')) ? join(root, 'vendor') : resolve(HERE, '..', 'vendor'); // rădăcini de test folosesc vendor/ real
  const entry = join(root, 'src', 'main.js');
  if (!existsSync(entry)) throw new Error(`lipsește ${relative(process.cwd(), entry)}`);

  const pkg = existsSync(join(root, 'package.json')) ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : {};
  const git = gitShort(root);
  const appVersion = o.version || pkg.version || '0.0.0';
  const epoch = process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now();
  const builtAt = new Date(epoch).toISOString();
  const buildId = `${appVersion}${git ? '-' + git : ''}`;

  // vendor: lock-ul trebuie să coincidă cu fișierele (supraveghere, 14)
  const xlsxFile = join(vendorDir, 'xlsx.full.min.js');
  const hasVendor = existsSync(join(vendorDir, 'VENDOR.lock.json'));
  if (hasVendor && root === resolve(HERE, '..')) {
    const v = verifyVendor();
    if (!v.ok) throw new Error('vendor/ nu coincide cu VENDOR.lock.json: ' + v.problems.join('; '));
  }

  const define = {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(builtAt),
    'process.env.NODE_ENV': JSON.stringify(o.dev ? 'development' : 'production'),
  };
  const banner = existsSync(xlsxFile) ? xlsxLazyPrelude(xlsxFile) : '';

  const common = { absWorkingDir: root, bundle: true, write: false, logLevel: 'silent', legalComments: 'none', target: ['es2020', 'chrome100', 'firefox100', 'safari15'] };
  const jsOpts = { ...common, entryPoints: [entry], format: 'iife', minify: !o.dev, sourcemap: o.dev || o.sourcemap ? 'external' : false,
    define, banner: { js: banner }, plugins: [vendorAlias(vendorDir)], loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' }, entryNames: 'app', outdir: 'out' };

  // CSS: app.css + print.css (+ orice CSS importat din JS e ignorat: stilurile sunt în src/ui/styles)
  const stylesDir = join(root, 'src', 'ui', 'styles');
  const cssFiles = ['app.css', 'print.css'].filter((f) => existsSync(join(stylesDir, f)));
  const extra = existsSync(stylesDir) ? readdirSync(stylesDir).filter((f) => f.endsWith('.css') && !cssFiles.includes(f)).sort() : [];
  const cssList = [...cssFiles, ...extra];
  const cssOpts = { ...common, stdin: { contents: cssList.map((f) => `@import "./${f}";`).join('\n'), resolveDir: stylesDir, loader: 'css' },
    minify: !o.dev, loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' }, outfile: 'out/app.css', entryNames: 'app' };

  let jsRes, cssRes;
  if (esbuildCtx) { jsRes = await esbuildCtx.js.rebuild(); cssRes = esbuildCtx.css ? await esbuildCtx.css.rebuild() : null; }
  else { jsRes = await esbuild(jsOpts); cssRes = cssList.length ? await esbuild(cssOpts) : null; }
  for (const w of [...jsRes.warnings, ...(cssRes?.warnings || [])]) console.warn('avertisment esbuild:', w.text);

  const jsOut = jsRes.outputFiles.find((f) => f.path.endsWith('.js'));
  const mapOut = jsRes.outputFiles.find((f) => f.path.endsWith('.js.map'));
  const jsText = jsOut.text;
  const cssText = cssRes ? cssRes.outputFiles.find((f) => f.path.endsWith('.css')).text : '';

  const jsName = `app.${sha(jsText).slice(0, 10)}.js`;
  const cssName = cssText ? `app.${sha(cssText).slice(0, 10)}.css` : null;

  // ieșire curată
  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(o.out, { recursive: true });
  const files = [];
  const put = (name, data) => { const p = join(o.out, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); files.push(name); };

  put(jsName, mapOut ? jsText + `\n//# sourceMappingURL=${jsName}.map\n` : jsText);
  if (mapOut) put(jsName + '.map', mapOut.text);
  if (cssName) put(cssName, cssText);

  // config.js: neîmpachetat, editabil pe gazdă după build
  const configSrc = join(root, 'config.js');
  const hasConfig = existsSync(configSrc);
  if (hasConfig) put('config.js', readFileSync(configSrc));

  // public/: sw.js, manifest.webmanifest, icons/
  const pub = join(root, 'public');
  const pubFiles = copyDir(pub, o.out);
  for (const f of pubFiles) files.push(f);
  const precache = ['./', 'index.html', jsName, ...(cssName ? [cssName] : []), ...(hasConfig ? ['config.js'] : []), ...pubFiles.filter((f) => /^(manifest\.webmanifest|icons\/)/.test(f))];
  const swPath = join(o.out, 'sw.js');
  if (existsSync(swPath)) {
    let sw = readFileSync(swPath, 'utf8');
    sw = sw.replaceAll('__BUILD_ID__', buildId).replaceAll('__APP_VERSION__', appVersion).replaceAll('__PRECACHE__', JSON.stringify(precache));
    writeFileSync(swPath, sw);
  }

  const vars = { APP_VERSION: appVersion, BUILD_ID: buildId, BUILD_TIME: builtAt };
  const tplPath = join(root, 'index.html');
  const template = existsSync(tplPath) ? readFileSync(tplPath, 'utf8') : null;

  const multi = renderMulti({ template, cssFile: cssName, jsFile: jsName, hasConfig, vars });
  put('index.html', multi.html);
  put('404.html', multi.html);   // GitHub Pages (D20): rezervă; rutarea e pe hash, deci doar căile greșite ajung aici
  put('.nojekyll', '');          // Pages nu trece fișierele prin Jekyll
  put('_headers', buildHeadersFile({ csp: multi.headerCsp }));

  let singleBytes = 0;
  if (o.single) {
    const clientConfigJs = `window.FLOTA_CONFIG=Object.assign({googleClientId:'',appName:'Flota Costuri'},{googleClientId:'',singleFile:true,appVersion:${JSON.stringify(appVersion)}});`;
    const single = renderSingle({ template, css: cssText, js: jsText, vars, clientConfigJs });
    put('flota-costuri.html', single.html);
    singleBytes = Buffer.byteLength(single.html);
  }

  const info = { appVersion, buildId, builtAt, files: Object.fromEntries(files.map((f) => [f, statSize(join(o.out, f))])),
    jsGzipBytes: gzipSync(jsText).length, singleFileBytes: singleBytes, cspHashes: multi.hashes };
  writeFileSync(join(o.out, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

  const problems = o.dev ? [] : verifyDist(o.out, { requireSingle: o.single });
  if (!o.dev && !process.env.FLOTA_SKIP_PRIVACY) {
    for (const h of await checkPrivacy({ root: o.out, targets: ['.'], dist: true })) problems.push('confidențialitate: ' + h);
    for (const h of await checkPrivacy({ root })) problems.push('confidențialitate (fișiere publicabile): ' + h);   // git ls-files + dist/
  }
  return { out: o.out, files, problems, info, ms: Date.now() - t0, jsOpts, cssOpts, cssList };
}
function statSize(p) { return statSync(p).size; }

function report(r, o) {
  if (o.quiet) return;
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log(`build ${r.info.buildId} → ${relative(process.cwd(), r.out) || '.'} în ${r.ms} ms`);
  for (const f of r.files.filter((x) => /^(app\.|index\.html|flota-costuri\.html|config\.js)/.test(x))) console.log(`  ${f.padEnd(28)} ${kb(r.info.files[f])}`);
  console.log(`  js gzip ${kb(r.info.jsGzipBytes)}`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.dev) {
    const r = await buildOnce(o);
    report(r, o);
    if (r.problems.length) { console.error('\nVerificări eșuate:\n - ' + r.problems.join('\n - ')); process.exit(1); }
    return;
  }
  // dev: watch + server (același pachet, doar nemicșorat)
  let r = await buildOnce(o);
  const jsCtx = await esContext(r.jsOpts);
  const cssCtx = r.cssList.length ? await esContext(r.cssOpts) : null;
  report(r, o);
  const srv = await serve(o.out, { port: o.port });
  console.log(`dev: ${srv.url}  (reîncarcă pagina după fiecare modificare; Ctrl+C pentru oprire)`);
  const { watch } = await import('node:fs');
  let timer = null;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(async () => {
    try { r = await buildOnce(o, { esbuildCtx: { js: jsCtx, css: cssCtx } }); console.log(`rebuild ${r.ms} ms`); }
    catch (e) { console.error('eroare build:', e.errors ? e.errors.map((x) => x.text).join('; ') : e.message); } }, 120); };
  for (const d of ['src', 'public']) if (existsSync(join(o.root, d))) watch(join(o.root, d), { recursive: true }, rebuild);
  for (const f of ['index.html', 'config.js']) if (existsSync(join(o.root, f))) watch(join(o.root, f), rebuild);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.errors ? e.errors.map((x) => `${x.location ? x.location.file + ':' + x.location.line + ' ' : ''}${x.text}`).join('\n') : e.message); process.exit(1); });
