// Ajutoare comune pentru teste: căi către fixture-uri, citire JSON/octeți, fișiere „File-like” pentru importuri.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = join(APP, 'tests', 'fixtures');
export const fixturePath = (...p) => join(FIXTURES, ...p);
export const readFixtureJson = (...p) => JSON.parse(readFileSync(fixturePath(...p), 'utf8'));
export const readFixtureBytes = (...p) => readFileSync(fixturePath(...p));
/** Obiect de tip File pentru readWorkbook / parseGpsFiles (name + arrayBuffer()). */
export function fixtureFile(...p) {
  const buf = readFixtureBytes(...p);
  return { name: p[p.length - 1], size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}
