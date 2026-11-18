// Utilitare comune pentru verificările statice (fără dependențe).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function listFiles(dir, re = /\.(m?js)$/, skip = /(^|[\\/])(node_modules|dist|dist-dev|vendor|\.git)([\\/]|$)/) {
  const out = [];
  if (!existsSync(dir)) return out;
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (skip.test(p)) continue;
      if (statSync(p).isDirectory()) walk(p); else if (re.test(n)) out.push(p);
    }
  })(dir);
  return out.sort();
}

/**
 * Înlocuiește comentariile și (opțional) conținutul șirurilor cu spații, păstrând liniile/coloanele.
 * Tratează șiruri ', ", `, regex simplu nu (regex-urile care conțin // sunt rare; vezi `looksRegexStart`).
 */
export function blank(src, { strings = false } = {}) {
  let out = ''; let i = 0; const n = src.length;
  const blankCh = (c) => (c === '\n' ? '\n' : ' ');
  let prevSig = '';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += blankCh(src[i]); i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += strings ? '  ' : src.substr(i, 2); i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') { // expresie în template: păstrată ca cod
          let depth = 0; const start = i; out += '${'; i += 2; depth = 1;
          let inner = '';
          while (i < n && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; } inner += src[i]; i++; }
          out += blank(inner, { strings }) + '}'; i++; void start; continue;
        }
        out += strings ? blankCh(src[i]) : src[i]; i++;
      }
      out += q; i++; prevSig = q; continue;
    }
    if (c === '/' && /[=(,:;!&|?{}\[]\s*$/.test(prevSig + '') === false && false) { /* regex literals: ignorate */ }
    out += c; if (!/\s/.test(c)) prevSig = c; i++;
  }
  return out;
}

/** Specificatori importați: statici (import/export from) și dinamici. */
export function parseImports(src) {
  const code = blank(src);
  const rs = [];
  const staticRe = /(?:^|[;\n}])\s*(?:import\s*(?:[^'"()]*?\sfrom\s*)?|export\s*(?:\*|\{[^}]*\})(?:\s*as\s+\w+)?\s*from\s*)(['"])([^'"]+)\1/g;
  let m;
  while ((m = staticRe.exec(code))) rs.push({ spec: m[2], dynamic: false, index: m.index });
  const dynRe = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = dynRe.exec(code))) rs.push({ spec: m[2], dynamic: true, index: m.index });
  return rs;
}

export function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const c of [base, base + '.js', base + '.mjs', join(base, 'index.js')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return undefined; // relativ, dar inexistent
}

export const rel = (p) => relative(APP_ROOT, p).split(sep).join('/');
export const read = (p) => readFileSync(p, 'utf8');
export function lineOf(src, index) { return src.slice(0, index).split('\n').length; }

export class Report {
  constructor(name) { this.name = name; this.errors = []; this.warnings = []; }
  error(msg) { this.errors.push(msg); }
  warn(msg) { this.warnings.push(msg); }
  print() {
    const max = Number(process.env.CHECK_MAX_LINES || 25);
    for (const w of this.warnings.slice(0, max)) console.warn(`  avertisment: ${w}`);
    if (this.warnings.length > max) console.warn(`  … încă ${this.warnings.length - max} avertismente (CHECK_MAX_LINES=999 pentru toate)`);
    for (const e of this.errors.slice(0, max)) console.error(`  EROARE: ${e}`);
    if (this.errors.length > max) console.error(`  … încă ${this.errors.length - max} erori (CHECK_MAX_LINES=999 pentru toate)`);
    console.log(`${this.errors.length ? 'EȘEC' : 'ok  '} ${this.name}${this.errors.length ? ` (${this.errors.length} erori)` : ''}${this.warnings.length ? ` (${this.warnings.length} avertismente)` : ''}`);
    return this.errors.length === 0;
  }
}
