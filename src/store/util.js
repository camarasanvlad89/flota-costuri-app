// Mici utilitare interne ale stratului de stocare (fără dependențe de core/*, ca modulul să poată fi testat singur).

export const EPOCH0 = '1970-01-01T00:00:00.000Z';

export class StoreError extends Error {
  /** @param {string} code  ex. 'CLOSED_MONTH' | 'CONFLICT' | 'APP_TOO_OLD' | 'BAD_DOC' | 'NO_IDB' | 'UNKNOWN_COLLECTION' */
  constructor(code, message, extra) {
    super(message || code);
    this.name = 'StoreError';
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Egalitate structurală (independentă de ordinea cheilor; `undefined` = cheie lipsă). */
export function stableEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!stableEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!stableEqual(a[k], b[k])) return false;
  return true;
}

/** JSON cu chei sortate (pentru semnături). */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Elimină câmpurile strict locale (`_rev`) dintr-o valoare citită din IndexedDB. */
export function strip(v) {
  if (!v) return v;
  const { _rev, ...rest } = v;
  return rest;
}

export function randId(prefix = 'id', len = 10) {
  let s = '';
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const a = new Uint8Array(len);
    c.getRandomValues(a);
    for (const n of a) s += (n % 36).toString(36);
  } else {
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 36).toString(36);
  }
  return `${prefix}_${s}`;
}

export function isoFromClock(clock) {
  const t = clock && typeof clock.now === 'function' ? clock.now() : Date.now();
  return new Date(t).toISOString();
}

/** Ia luna 'YYYY-MM' dintr-o dată / lună ISO; null dacă nu e recunoscută. */
export function monthOf(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

export function todayIso(clock) {
  return isoFromClock(clock).slice(0, 10);
}

export function maxStr(a, b) {
  return a >= b ? a : b;
}
