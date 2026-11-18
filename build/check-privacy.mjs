#!/usr/bin/env node
// Verificare de confidențialitate (DEV-PLAN D19, 12): oprește build-ul dacă dist/ sau fișierele publicabile (urmărite de git +
// neignorate) conțin plăcuțe reale, nume reale de șoferi sau adrese stradale reale. Tiparele sunt construite din bucăți ca scriptul
// să nu conțină el însuși valorile. Valorile suplimentare, specifice depozitului local, stau în `build/privacy-denylist.json`
// (git-ignorat; model: `build/privacy-denylist.example.json`).
//   node build/check-privacy.mjs [dist|all]    (implicit: dist + fișierele publicabile; tests/private/ este exclus)
// Fișierele .xlsx se deschid (zip → XML) și se scanează; dacă un .xlsx nu se poate citi, verificarea ESUEAZĂ (nu se ignoră tăcut).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const j = (...p) => p.join('');
const sp = '[ -]?';
const STREET_RO = '(?:Strada|Str\\.|Bulevardul|Bd\\.|Bdul\\.|Calea|Piața|Piata|Aleea|Șoseaua|Soseaua)';
const PATTERNS = [
  ['plăcuță reală', new RegExp(`\\b(${j('CJ', sp, '26')}|${j('CJ', sp, '35')}|${j('SM', sp, '54')}|${j('SM', sp, '07')}|${j('SM', sp, '33')}|${j('SM', sp, '17')})${sp}${j('B', 'OD')}\\b`, 'i')],
  ['nume real de șofer', new RegExp(`\\b(${j('DEN', 'ISZ')}|${j('KRIS', 'ZTI')}|${j('AD', 'AM')}|${j('ÁD', 'ÁM')})\\b`, 'i')],
  ['adresă stradală în poziție GPS', /\[\s*\d*[A-Z]?\s*(Strada|Str\.|Piața|Calea|Bulevardul)\s[^\]]*,[^\]]*,[^\]]*\]|\[[^\],]*\s(utca|út|tér|körút)\s*,[^\]]*,[^\]]*\]/i],
  // adresă stradală în text liber: „Strada Victoriei 10”, „Derkovits Gyula utca 137”
  ['adresă stradală (RO)', new RegExp(`\\b${STREET_RO}\\s+(?:[\\p{L}.'-]+\\s+){1,4}(?:nr\\.?\\s*)?\\d{1,4}\\b`, 'iu')],
  ['adresă stradală (HU)', /\b(?:\p{Lu}[\p{L}.'-]+\s+){1,3}(?:utca|út|tér|körút|krt\.)\s+\d{1,4}\b/u],
];
// Plăcuțe în date publice (dist/, fixture-uri): doar XX NN DEM (camion) și remorcile fictive XX 30/90 DEM sunt permise.
const PLATE_LIKE = /\b[A-Z]{1,2}[ -]?\d{2,3}[ -]?[A-Z]{3}\b/g;
const PLATE_OK = /^XX[ -]?\d{2}[ -]?DEM$/;
const TEXT = /\.(js|mjs|json|html|css|md|csv|xml|py|webmanifest|txt|svg|yml|yaml)$/i;
const SKIP_DIRS = new Set(['node_modules', 'private', 'dist-dev', '.git', 'playwright-report', 'test-results']);
const SELF = new Set(['build/check-privacy.mjs', 'build/privacy-denylist.json', 'build/privacy-denylist.example.json', 'tests/unit/privacy/privacy.test.js']);

function loadDenylist(root) {
  for (const base of new Set([root, ROOT])) {
    const p = join(base, 'build', 'privacy-denylist.json');
    if (existsSync(p)) {
      try {
        const o = JSON.parse(readFileSync(p, 'utf8'));
        return [...(o.terms || []).map((t) => ['termen din denylist', new RegExp(String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]),
          ...(o.patterns || []).map((t) => ['tipar din denylist', new RegExp(t, 'iu')])];
      } catch (e) { throw new Error('build/privacy-denylist.json invalid: ' + e.message); }
    }
  }
  return [];
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}
/** Fișierele care ar ajunge în depozitul public: urmărite + neurmărite dar neignorate (git), altfel parcurgere. */
function publishableFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
    const list = out.split('\0').filter(Boolean).map((r) => join(root, r)).filter((p) => existsSync(p) && !p.split(sep).some((s) => SKIP_DIRS.has(s)));
    if (list.length) return list;
  } catch { /* fără git: parcurgere */ }
  return ['src', 'tests', 'scripts', 'build', 'public', 'index.html', 'config.js'].flatMap((t) => {
    const b = join(root, t); return existsSync(b) ? (statSync(b).isDirectory() ? [...walk(b)] : [b]) : [];
  });
}

function scanText(rel, text, hits, { data, deny }) {
  for (const [what, re] of [...PATTERNS, ...deny]) { const m = re.exec(text); if (m) hits.push(`${rel}: ${what} («${m[0].slice(0, 40)}»)`); }
  if (data) {
    for (const m of text.matchAll(PLATE_LIKE)) {
      if (PLATE_OK.test(m[0])) continue;
      if (/^[A-Z]{3}-?\d{2}-?[A-Z]{3}$/.test(m[0])) continue;
      hits.push(`${rel}: plăcuță în afara listei permise XX NN DEM («${m[0]}»)`); break;
    }
  }
}

/** Cititor minimal de ZIP (director central + inflate), fără dependențe. Întoarce [{name, data:Buffer}]. */
export function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('nu e ZIP (lipsește directorul central)');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('director central corupt');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lh = off; const dstart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const raw = buf.subarray(dstart, dstart + csize);
    files.push({ name, data: method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => { throw new Error('metodă ZIP ' + method); })() });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
function scanXlsx(p, rel, hits, o) {
  try {
    const raw = readFileSync(p);
    if (raw.subarray(0, 2).toString('latin1') !== 'PK') { scanText(rel, raw.toString('utf8'), hits, o); return; } // „.xlsx” care este de fapt text (ex. licență)
    for (const f of readZip(raw)) if (/\.(xml|rels)$/.test(f.name)) scanText(`${rel}!${f.name}`, f.data.toString('utf8'), hits, o);
  } catch (e) { hits.push(`${rel}: .xlsx ilizibil pentru verificarea de confidențialitate (${e.message})`); }
}

/**
 * @param {{root?:string, targets?:string[], git?:boolean, dist?:boolean}} o
 *  - targets: directoare/fișiere relative la `root` (implicit: fișierele publicabile + dist/)
 *  - dist: tratează toate țintele ca date publicate (verificare strictă a plăcuțelor)
 */
export async function checkPrivacy({ root = ROOT, targets = null, dist = false } = {}) {
  const hits = [];
  const deny = loadDenylist(root);
  let files;
  if (targets) files = targets.flatMap((t) => { const b = join(root, t); return existsSync(b) ? (statSync(b).isDirectory() ? [...walk(b)] : [b]) : []; });
  else files = [...publishableFiles(root), ...walk(join(root, 'dist'))];
  for (const p of new Set(files)) {
    const rel = relative(root, p).split(sep).join('/');
    if (SELF.has(rel)) continue;
    const data = dist || rel.startsWith('dist/') || rel.startsWith('tests/fixtures/');
    const o = { data, deny };
    scanText(rel, rel, hits, { data: false, deny }); // și numele fișierului
    if (/\.xlsx$/i.test(p)) scanXlsx(p, rel, hits, o);
    else if (TEXT.test(p)) scanText(rel, readFileSync(p, 'utf8'), hits, o);
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const hits = await checkPrivacy(mode === 'dist' ? { targets: ['dist'], dist: true } : {});
  if (hits.length) { console.error(`CONFIDENȚIALITATE: ${hits.length} potriviri\n` + hits.slice(0, 40).map((h) => '  ' + h).join('\n')); process.exit(1); }
  console.log('confidențialitate: OK (fără plăcuțe, șoferi sau adrese reale în dist/ și în fișierele publicabile)');
}
