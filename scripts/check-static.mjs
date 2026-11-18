#!/usr/bin/env node
// Verificări statice pe cod (DEV-PLAN 4.9, 11.3):
//  1. fără innerHTML / outerHTML / insertAdjacentHTML / document.write / dangerouslySetInnerHTML / eval / new Function
//     (excepție explicită: comentariu `// safe-html: <motiv>` pe aceeași linie sau pe linia de deasupra, doar pentru HTML constant)
//  2. fără gazde externe în cod în afara listei din build/csp.mjs (4.9: nicio dată nu pleacă spre alt server)
//     (excepție: `// ext-ok: <motiv>`; linkuri de documentație din comentarii și din text afișat se ignoră doar dacă sunt în comentarii)
//  3. fără secrete evidente (chei API / tokenuri / client secret) în sursă
import { APP_ROOT, Report, blank, lineOf, listFiles, read, rel } from './lib/scan.mjs';
import { join } from 'node:path';
import { ALLOWED_EXTERNAL_HOSTS } from '../build/csp.mjs';

const FORBIDDEN = [
  [/\.\s*innerHTML\b/g, 'innerHTML'], [/\.\s*outerHTML\b/g, 'outerHTML'], [/\binsertAdjacentHTML\b/g, 'insertAdjacentHTML'],
  [/\bdocument\s*\.\s*write(ln)?\s*\(/g, 'document.write'], [/\bdangerouslySetInnerHTML\b/g, 'dangerouslySetInnerHTML'],
  [/(^|[^.\w$])eval\s*\(/g, 'eval()'], [/\bnew\s+Function\s*\(/g, 'new Function()'], [/\bsetTimeout\s*\(\s*['"`]/g, 'setTimeout(string)'],
];
// Secrete: Client ID Google NU e secret (e public), dar token/secret da. Modele prudente.
// Spații de nume XML (identificatori, nu cereri de rețea).
const NAMESPACE_HOSTS = /^(www\.)?(w3\.org|purl\.org|schemas\.openxmlformats\.org|schemas\.microsoft\.com|openxmlformats\.org|xmlsoft\.org)$/;
const SECRETS = [[/GOCSPX-[A-Za-z0-9_-]{20,}/, 'Google client secret'], [/\bya29\.[A-Za-z0-9_-]{20,}/, 'token de acces Google'], [/AIza[0-9A-Za-z_-]{35}/, 'cheie API Google'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'cheie privată']];

export function checkStatic({ srcDir = join(APP_ROOT, 'src'), extraFiles = [] } = {}) {
  const rep = new Report('cod: HTML/eval, gazde externe, secrete (check-static)');
  const files = [...listFiles(srcDir).filter((f) => !/\.test\.m?js$/.test(f) && !/[\\/]_tests[\\/]/.test(f)), ...extraFiles];
  for (const f of files) {
    const src = read(f);
    const raw = src.split('\n');
    const code = blank(src, { strings: true });
    const withStrings = blank(src);
    const okLine = (ln, tag) => (raw[ln - 1] || '').includes(tag) || (raw[ln - 2] || '').includes(tag);
    for (const [re, name] of FORBIDDEN) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(code))) {
        const ln = lineOf(code, m.index);
        if (okLine(ln, 'safe-html:')) continue;
        rep.error(`${rel(f)}:${ln}: ${name} interzis (XSS/CSP). Folosește noduri DOM/Preact sau marchează cu „// safe-html: motiv” doar pentru HTML constant`);
      }
    }
    // gazde externe în șiruri (comentariile sunt deja golite)
    const hostRe = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi; let m;
    while ((m = hostRe.exec(withStrings))) {
      const host = m[1].toLowerCase(); const ln = lineOf(withStrings, m.index);
      if (ALLOWED_EXTERNAL_HOSTS.includes(host) || NAMESPACE_HOSTS.test(host) || okLine(ln, 'ext-ok:')) continue;
      rep.error(`${rel(f)}:${ln}: gazdă externă „${host}” nu e în lista din build/csp.mjs (4.9). Adaugă-o acolo + în Setări > Date, sau marchează „// ext-ok: motiv” (ex. link afișat, nu cerere)`);
    }
    // D18: de la SafeFleet se importă doar exporturi Excel: fără adaptor GpsProvider și fără token SafeFleet
    for (const m2 of code.matchAll(/\bGpsProvider\b|safefleet\w*(?:token|api[_-]?key|secret)|(?:token|api[_-]?key|secret)\w*safefleet/gi)) rep.error(`${rel(f)}:${lineOf(code, m2.index)}: „${m2[0]}” contrazice D18 (SafeFleet = doar import de exporturi, fără API/token)`);
    for (const [re, name] of SECRETS) { const s = re.exec(src); if (s) rep.error(`${rel(f)}:${lineOf(src, s.index)}: pare ${name}`); }
  }
  return { rep, files: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rep, files } = checkStatic();
  console.log(`(${files} fișiere analizate)`);
  process.exit(rep.print() ? 0 : 1);
}
