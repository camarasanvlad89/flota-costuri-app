// Transformări HTML pentru dist/index.html și dist/flota-costuri.html + verificări statice ale rezultatului.
// Contractul șablonului `index.html` (al shell-ului) – toate marcajele sunt OPȚIONALE:
//   <!--flota:csp-->      aici intră <meta http-equiv="Content-Security-Policy"> (altfel, la începutul <head>)
//   <!--flota:styles-->   aici intră CSS-ul (altfel, înainte de </head>)
//   <!--flota:config-->   aici intră config.js (altfel, înainte de scriptul aplicației)
//   <!--flota:scripts-->  aici intră scriptul aplicației (altfel, înainte de </body>)
//   {{APP_VERSION}} {{BUILD_ID}} {{BUILD_TIME}}  înlocuite oriunde în text
// Din șablon se ELIMINĂ: orice <meta> CSP existent, <script ... src="...src/main...">, <link rel=stylesheet> către src/ui/styles,
// și <script src="config.js"> (se reinserează controlat).
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildCsp, ALLOWED_EXTERNAL_HOSTS } from './csp.mjs';

export const sha256b64 = (s) => createHash('sha256').update(s).digest('base64');
export const cspHash = (text) => `sha256-${sha256b64(text)}`;

export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flota Costuri</title>
<!--flota:csp-->
<!--flota:styles-->
</head>
<body>
<div id="app"></div>
<noscript>Flota Costuri are nevoie de JavaScript.</noscript>
<!--flota:config-->
<!--flota:scripts-->
</body>
</html>
`;

function stripTemplate(html) {
  return html
    .replace(/<meta\s+[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*\bsrc=["'][^"']*src\/main[^"']*["'][^>]*>\s*<\/script>\s*/gi, '')
    .replace(/<script\b[^>]*\bsrc=["'](?:\.\/)?config\.js["'][^>]*>\s*<\/script>\s*/gi, '')
    .replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["'][^"']*src\/ui\/styles[^"']*["'][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*href=["'][^"']*src\/ui\/styles[^"']*["'][^>]*rel=["']?stylesheet["']?[^>]*>\s*/gi, '');
}

function place(html, marker, content, fallbackRe, where) {
  if (html.includes(marker)) return html.replace(marker, () => content);
  const m = fallbackRe.exec(html);
  if (!m) return where === 'before' ? html + content : content + html;
  const i = where === 'before' ? m.index : m.index + m[0].length;
  return html.slice(0, i) + content + '\n' + html.slice(i);
}

/** Extrage conținutul scripturilor inline (fără src) ca să li se calculeze hash-urile CSP. */
export function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    if (/type\s*=\s*["']?(application\/(ld\+)?json|importmap|text\/template)/i.test(m[1])) continue; // blocuri de date, nu se execută
    if (m[2].trim() === '') continue;
    out.push(m[2]);
  }
  return out;
}

/** Escapează text JS pentru a sta într-un <script> inline. */
export function escapeInlineJs(js) {
  const out = js.replace(/<\/script/gi, '<\\/script');
  if (/<!--/.test(out) && /<script/i.test(out.slice(out.indexOf('<!--')))) {
    throw new Error('Scriptul inline conține „<!--” urmat de „<script”: poate rupe HTML-ul. Reformulează sursa.');
  }
  return out;
}

/**
 * dist/index.html
 * @param {{ template:string, css:string, js:string, config:boolean, vars:Record<string,string> }} o  css/js = nume de fișier
 */
export function renderMulti({ template, cssFile, jsFile, hasConfig, vars }) {
  let html = applyVars(stripTemplate(template || DEFAULT_TEMPLATE), vars);
  html = place(html, '<!--flota:styles-->', `<link rel="stylesheet" href="${cssFile}">`, /<\/head>/i, 'before');
  if (hasConfig) html = place(html, '<!--flota:config-->', `<script src="config.js"></script>`, /<\/body>/i, 'before');
  else html = html.replace('<!--flota:config-->', '');
  html = place(html, '<!--flota:scripts-->', `<script src="${jsFile}"></script>`, /<\/body>/i, 'before');
  const hashes = inlineScripts(html).map(cspHash);
  const csp = buildCsp({ inlineHashes: hashes, mode: 'multi', meta: true });
  html = insertCsp(html, csp);
  return { html, csp, hashes, headerCsp: buildCsp({ inlineHashes: hashes, mode: 'multi', meta: false }) };
}

/** dist/flota-costuri.html – un singur fișier (CSS + config + aplicație inline). */
export function renderSingle({ template, css, js, vars, clientConfigJs }) {
  let html = applyVars(stripTemplate(template || DEFAULT_TEMPLATE), vars);
  // Fără legături către fișiere locale care nu există în varianta cu un singur fișier.
  html = html.replace(/<link\b[^>]*rel=["']?(?:manifest|icon|shortcut icon|apple-touch-icon)["']?[^>]*>\s*/gi, '');
  html = html.replace(/<link\b[^>]*href=["'](?:\.\/)?(?:manifest\.webmanifest|icons\/)[^"']*["'][^>]*>\s*/gi, '');
  html = place(html, '<!--flota:styles-->', `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`, /<\/head>/i, 'before');
  html = place(html, '<!--flota:config-->', `<script>${escapeInlineJs(clientConfigJs)}</script>`, /<\/body>/i, 'before');
  html = place(html, '<!--flota:scripts-->', `<script>${escapeInlineJs(js)}</script>`, /<\/body>/i, 'before');
  const hashes = inlineScripts(html).map(cspHash);
  const csp = buildCsp({ inlineHashes: hashes, mode: 'single', meta: true });
  html = insertCsp(html, csp);
  return { html, csp, hashes };
}

function insertCsp(html, csp) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (html.includes('<!--flota:csp-->')) return html.replace('<!--flota:csp-->', () => tag);
  // după <meta charset> (trebuie să rămână în primii 1024 de octeți), altfel imediat după <head>
  if (/<meta\s+charset=[^>]*>/i.test(html)) return html.replace(/<meta\s+charset=[^>]*>/i, (m0) => `${m0}\n${tag}`);
  return html.replace(/<head([^>]*)>/i, (m0) => `${m0}\n${tag}`);
}

function applyVars(html, vars = {}) {
  return html.replace(/\{\{(APP_VERSION|BUILD_ID|BUILD_TIME)\}\}/g, (_, k) => vars[k] ?? '');
}

// ───────────────────────── verificări pe rezultat ─────────────────────────

/** Extrage meta CSP dintr-un HTML. */
export function metaCsp(html) {
  const m = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]*)"/i.exec(html);
  return m ? m[1] : null;
}

/**
 * Verifică un HTML construit: CSP prezent, hash-urile scripturilor inline coincid cu cele din CSP, fără
 * `http(s)://` în atribute src/href/action (cereri externe la pornire), fără handlere inline (onclick=…).
 * @returns {string[]} problemele găsite (gol = bine)
 */
export function verifyHtml(html, label = 'html', { allowExternalHrefs = false } = {}) {
  const problems = [];
  const csp = metaCsp(html);
  if (!csp) problems.push(`${label}: lipsește meta CSP`);
  else {
    for (const s of inlineScripts(html)) {
      const h = cspHash(s);
      if (!csp.includes(`'${h}'`)) problems.push(`${label}: scriptul inline (${s.length} car.) nu are hash în CSP (${h})`);
    }
    if (/script-src[^;]*'unsafe-(inline|eval)'/.test(csp)) problems.push(`${label}: script-src permite unsafe-inline/eval`);
  }
  const attrRe = /\b(?:src|href|action|poster|data)\s*=\s*["'](https?:)?\/\/([^"'\/]+)[^"']*["']/gi;
  let m;
  while ((m = attrRe.exec(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (s) => s.match(/^<script\b[^>]*>/)[0] + '</script>')))) {
    if (!allowExternalHrefs || !ALLOWED_EXTERNAL_HOSTS.includes(m[2])) problems.push(`${label}: referință externă la pornire: ${m[0]}`);
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''))) problems.push(`${label}: handlere inline (onclick=…) interzise de CSP`);
  if (/<script\b[^>]*type=["']module["']/i.test(html)) problems.push(`${label}: <script type=module> nu e permis (format IIFE)`);
  return problems;
}

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

/** Verifică un director `dist/`: html-uri, fișiere referite există, dimensiuni. */
export function verifyDist(dist, { maxSingleBytes = 3 * 1024 * 1024, requireSingle = true } = {}) {
  const problems = [];
  const idx = join(dist, 'index.html');
  if (!existsSync(idx)) problems.push('lipsește dist/index.html');
  else {
    const html = readFileSync(idx, 'utf8');
    problems.push(...verifyHtml(html, 'index.html'));
    for (const m of html.matchAll(/\b(?:src|href)=["']([^"':#?]+)["']/g)) {
      if (!existsSync(join(dist, m[1]))) problems.push(`index.html face referire la ${m[1]} care nu există în dist/`);
    }
  }
  if (existsSync(idx)) { // GitHub Pages (D20)
    if (!existsSync(join(dist, '.nojekyll'))) problems.push('lipsește dist/.nojekyll');
    if (!existsSync(join(dist, '404.html'))) problems.push('lipsește dist/404.html');
  }
  const single = join(dist, 'flota-costuri.html');
  if (existsSync(single)) {
    const buf = readFileSync(single);
    if (buf.length > maxSingleBytes) problems.push(`flota-costuri.html are ${(buf.length / 1048576).toFixed(2)} MB (> ${(maxSingleBytes / 1048576).toFixed(1)} MB)`);
    const html = buf.toString('utf8');
    problems.push(...verifyHtml(html, 'flota-costuri.html'));
    if (/googleClientId\s*:\s*['"][^'"]+['"]/.test(html) && !/googleClientId\s*:\s*['"]{2}/.test(html)) problems.push('flota-costuri.html: googleClientId nu e gol');
    if (/<link\b[^>]*href=["'](?!data:)/i.test(html)) problems.push('flota-costuri.html: conține <link> către fișiere externe');
  } else if (requireSingle) problems.push('lipsește dist/flota-costuri.html');
  for (const f of walk(dist)) {
    if (/\.(js|css|html)$/.test(f) && /\bsourceMappingURL=/.test(readFileSync(f, 'utf8').slice(-300)) && !existsSync(f + '.map')) {
      problems.push(`${relative(dist, f)}: sourceMappingURL fără fișier .map`);
    }
  }
  return problems;
}
