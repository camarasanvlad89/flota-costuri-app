#!/usr/bin/env node
// Regula „bani” (D4, 11.1): în fișierele care manipulează bani nu există aritmetică float și nici formatare dependentă de platformă.
// Înlocuiește regula ESLint (fără dependențe): rulează pe src/core/money.js, src/core/format.js, src/domain/*, src/import/*, src/export/*.
// Interzis (cod, nu comentarii/șiruri):
//   parseFloat( · .toFixed( · .toLocaleString( · Intl.NumberFormat · Number.parseFloat · Math.round( · Math.floor( · Math.ceil( ·
//   Math.trunc( · literale zecimale în expresii aritmetice (ex.  x * 1.21, / 100.0)
// Excepții: comentariu `// money-ok: <motiv>` pe aceeași linie sau deasupra; fișiere NON-bani (scoruri, distanțe, geometrie) din NON_MONEY.
import { APP_ROOT, Report, blank, lineOf, listFiles, read, rel } from './lib/scan.mjs';
import { join } from 'node:path';

const MONEY_GLOBS = [/src\/core\/(money|format)\.js$/, /src\/domain\/[^/]+\.js$/, /src\/import\/[^/]+\.js$/, /src\/export\/[^/]+\.js$/];
/** Fișiere din straturile de mai sus care nu calculează bani (potrivire de nume, similitudini, coordonate, formate de dată). */
export const NON_MONEY = [/src\/domain\/(placeMatch|places|routing|expiry|gpsKm)\.js$/, /src\/import\/(cells|csv|xlsx-reader)\.js$/, /src\/export\/(zip|download)\.js$/];

const RULES = [
  [/\bparseFloat\s*\(/g, 'parseFloat'], [/\.\s*toFixed\s*\(/g, 'toFixed'], [/\.\s*toLocaleString\s*\(/g, 'toLocaleString'],
  [/\bIntl\s*\.\s*NumberFormat\b/g, 'Intl.NumberFormat (D17: formatator propriu)'],
  [/\bMath\s*\.\s*(round|floor|ceil|trunc)\s*\(/g, 'Math.round/floor/ceil/trunc pe valori de bani (folosește mulDiv/integer BigInt)'],
  // literal zecimal ca operand aritmetic:  * 1.21   / 100.0   + 0.5
  [/[*\/]\s*\d+\.\d+\b|\b\d+\.\d+\s*[*\/]/g, 'literal zecimal în înmulțire/împărțire (float)'],
];

export function checkMoney({ srcDir = join(APP_ROOT, 'src') } = {}) {
  const rep = new Report('bani: fără float (check-money)');
  const files = listFiles(srcDir).filter((f) => !/\.test\.m?js$/.test(f) && !/[\\/]_tests[\\/]/.test(f))
    .filter((f) => MONEY_GLOBS.some((r) => r.test(rel(f))) && !NON_MONEY.some((r) => r.test(rel(f))));
  for (const f of files) {
    const src = read(f); const raw = src.split('\n');
    const code = blank(src, { strings: true });
    for (const [re, name] of RULES) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(code))) {
        const ln = lineOf(code, m.index);
        if ((raw[ln - 1] || '').includes('money-ok:') || (raw[ln - 2] || '').includes('money-ok:')) continue;
        rep.error(`${rel(f)}:${ln}: ${name}. Dacă nu e bani, marchează „// money-ok: motiv”; altfel folosește core/money.js`);
      }
    }
  }
  return { rep, files: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rep, files } = checkMoney();
  console.log(`(${files} fișiere cu bani analizate)`);
  process.exit(rep.print() ? 0 : 1);
}
