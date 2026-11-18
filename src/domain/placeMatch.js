// domain/placeMatch.js: potrivirea numelor de locuri din tabelul de curse (ro/hu/hr, majuscule, fără diacritice)
// cu adresele din exportul GPS „Călătorii” (`[stradă, localitate, cod poștal, ȚARĂ]`). Pur.
//
// Scor: >= 0,85 automat; 0,60–0,85 cere confirmare manuală (UI cu candidatul și scorul); < 0,60 nepotrivit.
// Potrivirile confirmate se salvează ca alias-uri (colecția `aliases`) și au scor 1.

import { detId } from '../core/ids.js';
import { placeKey, countryCodeFromName } from './places.js';

export const AUTO_SCORE = 0.85;
export const CONFIRM_SCORE = 0.6;

/**
 * @typedef {{ street:string|null, locality:string|null, postcode:string|null, country:string|null, countryCode:string|null, raw:string|null }} GpsAddress
 * @typedef {{ id?:string, name:string, locality:string, countryCode?:string|null, confirmed?:boolean }} Alias
 * @typedef {{ score:number, locality:string|null, country:string|null, countryCode:string|null, via:'alias'|'exact'|'compact'|'tokens'|'typo'|'fuzzy'|'none', band:'auto'|'confirm'|'none' }} PlaceMatch
 */

/** @param {number} score @returns {'auto'|'confirm'|'none'} */
export function scoreBand(score) {
  return score >= AUTO_SCORE ? 'auto' : score >= CONFIRM_SCORE ? 'confirm' : 'none';
}

const looksLikePostcode = (s) => /^[A-Za-z]{0,3}[- ]?\d[\d -]{2,8}$/.test(String(s).trim());

/**
 * Parsează o adresă GPS din text `[DN19, Orașu Nou, 447220, România]` sau dintr-un obiect deja parsat.
 * Țara = ultimul element; codul poștal = penultimul dacă arată ca cod; localitatea = elementul dinaintea codului
 * (la 3 elemente `[Județ, cod, țară]`, primul). Fără cod poștal: localitatea = penultimul.
 * @param {string|object|null|undefined} addr
 * @returns {GpsAddress}
 */
export function parseGpsAddress(addr) {
  const empty = { street: null, locality: null, postcode: null, country: null, countryCode: null, raw: null };
  if (addr == null) return empty;
  if (typeof addr === 'object') {
    const country = addr.country ?? null;
    return {
      street: addr.street ?? null,
      locality: addr.locality ?? addr.city ?? null,
      postcode: addr.postcode ?? addr.zip ?? null,
      country,
      countryCode: addr.countryCode ?? (country ? countryCodeFromName(country) : null),
      raw: addr.raw ?? null,
    };
  }
  const raw = String(addr).trim();
  const inner = raw.replace(/^\s*\[/, '').replace(/\]\s*$/, '');
  const parts = inner.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (!parts.length) return { ...empty, raw };
  const country = parts.length >= 2 ? parts[parts.length - 1] : null;
  const rest = country ? parts.slice(0, -1) : parts;
  let postcode = null, locality = null, street = null;
  if (rest.length && looksLikePostcode(rest[rest.length - 1])) {
    postcode = rest[rest.length - 1];
    locality = rest.length >= 2 ? rest[rest.length - 2] : null;
    street = rest.length >= 3 ? rest.slice(0, -2).join(', ') : null;
  } else if (rest.length) {
    locality = rest[rest.length - 1];
    street = rest.length >= 2 ? rest.slice(0, -1).join(', ') : null;
  }
  return { street, locality, postcode, country, countryCode: country ? countryCodeFromName(country) : null, raw };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}

/**
 * Scor între două chei normalizate (placeKey), plus metoda.
 * @param {string} a @param {string} b
 * @returns {{ score:number, via:PlaceMatch['via'] }}
 */
export function nameScore(a, b) {
  if (!a || !b) return { score: 0, via: 'none' };
  if (a === b) return { score: 1, via: 'exact' };
  const ca = a.replace(/ /g, ''), cb = b.replace(/ /g, '');
  if (ca === cb) return { score: 0.97, via: 'compact' };
  const ta = a.split(' '), tb = b.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < long.length && short.every((t) => long.includes(t))) {
    const ratio = short.join('').length / long.join('').length;
    return { score: Math.min(0.84, 0.6 + 0.24 * ratio), via: 'tokens' };
  }
  const minLen = Math.min(ca.length, cb.length), maxLen = Math.max(ca.length, cb.length);
  const d = levenshtein(ca, cb);
  if (d === 1 && minLen >= 7) return { score: 0.9, via: 'typo' };
  if (d === 1) return { score: 0.78, via: 'typo' };
  if (d === 2 && minLen >= 9) return { score: 0.8, via: 'typo' };
  if (minLen < 4) return { score: 0, via: 'none' };
  const jw = jaroWinkler(ca, cb);
  const s = Math.min(0.84, jw * 0.93 * Math.sqrt(minLen / maxLen));
  return { score: s, via: 'fuzzy' };
}

/**
 * Potrivește un nume din tabelul de curse cu o adresă GPS.
 * @param {string} courseName  ex. „MEDIESU AURIT”, „VESZPREM”
 * @param {string|object|GpsAddress} gpsAddress  text `[…]` sau obiect
 * @param {Alias[]} [aliases]  alias-uri confirmate (scor 1 când numele + localitatea coincid)
 * @returns {PlaceMatch}
 */
export function matchPlace(courseName, gpsAddress, aliases = []) {
  const addr = gpsAddress && typeof gpsAddress === 'object' && 'locality' in gpsAddress && 'raw' in gpsAddress
    ? gpsAddress : parseGpsAddress(gpsAddress);
  const none = { score: 0, locality: addr.locality, country: addr.country, countryCode: addr.countryCode, via: 'none', band: 'none' };
  const nk = placeKey(courseName);
  if (!nk || !addr.locality) return none;
  const lk = placeKey(addr.locality);
  if (!lk) return none;
  for (const a of aliases || []) {
    if (a.deletedAt) continue;
    if (placeKey(a.name) === nk && placeKey(a.locality) === lk) {
      if (a.countryCode && addr.countryCode && a.countryCode !== addr.countryCode) continue;
      return { score: 1, locality: addr.locality, country: addr.country, countryCode: addr.countryCode, via: 'alias', band: 'auto' };
    }
  }
  const { score, via } = nameScore(nk, lk);
  const s = Math.round(score * 1000) / 1000;
  return { score: s, locality: addr.locality, country: addr.country, countryCode: addr.countryCode, via, band: scoreBand(s) };
}

/**
 * Alias confirmat de administrator („MEDIESU AURIT” = „Medieșu Aurit”). Id determinist.
 * @param {{ name:string, locality:string, countryCode?:string|null, now?:string }} i
 * @returns {Alias & { id:string, key:string, localityKey:string, confirmed:true, updatedAt?:string }}
 */
export function makeAlias(i) {
  const key = placeKey(i.name), localityKey = placeKey(i.locality);
  return {
    id: detId('als', key, localityKey, i.countryCode || ''),
    name: String(i.name).trim(),
    locality: String(i.locality).trim(),
    key, localityKey,
    countryCode: i.countryCode ?? null,
    confirmed: true,
    updatedAt: i.now,
  };
}
