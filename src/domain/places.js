// domain/places.js: nume de locuri (normalizare), țări, parsarea rutei „ORIGINE - DESTINAȚIE”,
// dicționarul `places` și coada „Locuri de rezolvat”. Pur (fără DOM, fără I/O).
// Dependențe: core/ids. Toate celelalte fișiere din „Curse, locuri, km” se sprijină pe acesta.

import { detId } from '../core/ids.js';

/**
 * @typedef {{ id:string, key:string, aliases:string[], display:string, lat:number|null, lon:number|null,
 *   countryCode:string|null, source:'nominatim'|'manual'|'gps'|'seed', confirmed:boolean, updatedAt?:string }} Place
 */

const EXTRA_FOLD = { 'ß': 'SS', 'ł': 'L', 'Ł': 'L', 'đ': 'D', 'Đ': 'D', 'ø': 'O', 'Ø': 'O', 'æ': 'AE', 'œ': 'OE', 'ı': 'I' };

/**
 * Normalizare pentru comparare: majuscule, fără diacritice (inclusiv ő ű ș ț ă î č ć ł), fără semne,
 * spații comprimate. „Mediești-Aurit” și „MEDIESU AURIT” nu devin egale (ortografii diferite), dar
 * „Cluj-Napoca”, „CLUJ NAPOCA”, „Nyíregyháza”, „NYIREGYHAZA” da.
 * @param {string} s
 * @returns {string}
 */
export function placeKey(s) {
  let t = String(s ?? '');
  t = t.replace(/[ßłŁđĐøØæœı]/g, (c) => EXTRA_FOLD[c] || c);
  t = t.normalize('NFD').replace(/\p{M}+/gu, '');
  t = t.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  return t.replace(/\s+/g, ' ');
}

/** Nume de țări (ro/hu/en/de, normalizate cu placeKey) -> cod ISO-2. */
const COUNTRY_NAMES = {
  RO: ['ROMANIA', 'ROMANIAI', 'ROMANIA ROU', 'ROMENIA'],
  HU: ['UNGARIA', 'HUNGARY', 'MAGYARORSZAG', 'UNGARN', 'HONGRIE'],
  HR: ['CROATIA', 'CROATIE', 'HORVATORSZAG', 'KROATIEN', 'HRVATSKA'],
  AT: ['AUSTRIA', 'OSTERREICH', 'AUSZTRIA', 'OESTERREICH'],
  DE: ['GERMANIA', 'GERMANY', 'DEUTSCHLAND', 'NEMETORSZAG', 'ALEMANIA'],
  SK: ['SLOVACIA', 'SLOVAKIA', 'SZLOVAKIA', 'SLOWAKEI'],
  SI: ['SLOVENIA', 'SZLOVENIA', 'SLOWENIEN'],
  RS: ['SERBIA', 'SZERBIA'],
  BG: ['BULGARIA', 'BOLGARORSZAG'],
  CZ: ['CEHIA', 'CZECHIA', 'CZECH REPUBLIC', 'CSEHORSZAG', 'REPUBLICA CEHA', 'TSCHECHIEN'],
  PL: ['POLONIA', 'POLAND', 'LENGYELORSZAG', 'POLEN'],
  IT: ['ITALIA', 'ITALY', 'OLASZORSZAG', 'ITALIEN'],
  FR: ['FRANTA', 'FRANCE', 'FRANCIA', 'FRANCIAORSZAG', 'FRANKREICH'],
  ES: ['SPANIA', 'SPAIN', 'SPANYOLORSZAG', 'SPANIEN'],
  NL: ['OLANDA', 'NETHERLANDS', 'HOLLANDIA', 'NIEDERLANDE', 'THE NETHERLANDS'],
  BE: ['BELGIA', 'BELGIUM', 'BELGIUM BELGIEN', 'BELGIEN'],
  UA: ['UCRAINA', 'UKRAINE', 'UKRAJNA'],
  MD: ['MOLDOVA', 'REPUBLICA MOLDOVA', 'MOLDAVIA'],
  GR: ['GRECIA', 'GREECE', 'GOROGORSZAG'],
  TR: ['TURCIA', 'TURKEY', 'TOROKORSZAG', 'TURKIYE'],
  CH: ['ELVETIA', 'SWITZERLAND', 'SVAJC', 'SCHWEIZ'],
  GB: ['MAREA BRITANIE', 'UNITED KINGDOM', 'ANGLIA', 'UK'],
  BA: ['BOSNIA SI HERTEGOVINA', 'BOSNIA', 'BOSNIA HERZEGOVINA'],
  ME: ['MUNTENEGRU', 'MONTENEGRO'],
  MK: ['MACEDONIA', 'MACEDONIA DE NORD', 'NORTH MACEDONIA'],
  AL: ['ALBANIA'],
  LU: ['LUXEMBURG', 'LUXEMBOURG'],
  DK: ['DANEMARCA', 'DENMARK'],
  SE: ['SUEDIA', 'SWEDEN'],
  NO: ['NORVEGIA', 'NORWAY'],
  FI: ['FINLANDA', 'FINLAND'],
  PT: ['PORTUGALIA', 'PORTUGAL'],
  LT: ['LITUANIA', 'LITHUANIA'],
  LV: ['LETONIA', 'LATVIA'],
  EE: ['ESTONIA'],
};
const COUNTRY_INDEX = new Map();
for (const [cc, names] of Object.entries(COUNTRY_NAMES)) {
  COUNTRY_INDEX.set(cc, cc);
  for (const n of names) COUNTRY_INDEX.set(placeKey(n), cc);
}

/**
 * Cod ISO-2 dintr-un nume de țară (ro/hu/en/de) sau dintr-un cod ISO-2. `null` dacă nu este țară.
 * @param {string} name
 * @returns {string|null}
 */
export function countryCodeFromName(name) {
  const k = placeKey(name);
  if (!k) return null;
  return COUNTRY_INDEX.get(k) ?? null;
}

/** @param {string} name @returns {boolean} */
export function isCountryName(name) {
  const k = placeKey(name);
  // coduri de 2 litere scrise singure (ex. „HR”) sunt acceptate doar dacă sunt cod cunoscut
  return k.length > 0 && COUNTRY_INDEX.has(k);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/^[\s.,;:]+|[\s.,;:]+$/g, '').trim();

/**
 * Împarte ruta „ORIGINE - DESTINAȚIE [+ DESTINAȚIE2 …]”.
 * - separator: prima apariție a ` - ` (sau – — → >); fără spații: o singură cratimă;
 * - `+` pe partea de destinație => mai multe opriri; `+` pe partea de origine => încărcări suplimentare (`extras`);
 * - destinație care este doar o țară („CROATIA”) => `countryOnly`, `destCountry='HR'`, `destinations=[]`.
 * @param {string} text
 * @returns {{ origin:string, destinations:string[], countryOnly:boolean, destCountry:string|null, extras:string[], originCountry:string|null }}
 */
export function parseRoute(text) {
  const raw = clean(text);
  const out = { origin: '', destinations: [], countryOnly: false, destCountry: null, extras: [], originCountry: null };
  if (!raw) return out;
  let left = raw, right = '';
  const m = /\s+[-–—]+\s+|\s*→\s*|\s+>\s+/.exec(raw);
  if (m) {
    left = raw.slice(0, m.index);
    right = raw.slice(m.index + m[0].length);
  } else if (!/\s/.test(raw) && (raw.match(/-/g) || []).length === 1 && !raw.startsWith('-') && !raw.endsWith('-')) {
    const i = raw.indexOf('-');
    left = raw.slice(0, i);
    right = raw.slice(i + 1);
  }
  const lparts = left.split('+').map(clean).filter(Boolean);
  out.origin = lparts[0] || '';
  out.extras = lparts.slice(1);
  if (out.origin && isCountryName(out.origin)) out.originCountry = countryCodeFromName(out.origin);
  const dests = right.split('+').map(clean).filter(Boolean);
  const places = [];
  for (const d of dests) {
    if (isCountryName(d)) out.destCountry = countryCodeFromName(d);
    else places.push(d);
  }
  out.destinations = places;
  out.countryOnly = dests.length > 0 && places.length === 0 && out.destCountry != null;
  return out;
}

/**
 * Formă canonică a rutei (parte din cheia de reimport): „ORIGINE>DEST1+DEST2”, normalizată cu placeKey.
 * @param {string} text
 * @returns {string}
 */
export function normRoute(text) {
  const r = parseRoute(text);
  if (!r.origin && !r.destinations.length) return placeKey(text);
  const dest = r.destinations.map(placeKey);
  if (r.countryOnly && r.destCountry) dest.push(r.destCountry);
  const org = [r.origin, ...r.extras].map(placeKey).join('+');
  return `${org}>${dest.join('+')}`;
}

/**
 * Numele de locuri folosite de o cursă (origine, încărcări suplimentare, destinații), în ordine, fără țări.
 * @param {{ origin?:string, destinations?:string[], extras?:string[], routeRaw?:string }} course
 * @returns {string[]}
 */
export function courseLocationNames(course) {
  let origin = course.origin, dests = course.destinations, extras = course.extras || [];
  if ((origin == null || origin === '') && course.routeRaw) {
    const r = parseRoute(course.routeRaw);
    origin = r.origin; dests = r.destinations; extras = r.extras;
  }
  const names = [];
  if (origin && !isCountryName(origin)) names.push(origin);
  for (const e of extras) if (e && !isCountryName(e)) names.push(e);
  for (const d of dests || []) if (d && !isCountryName(d)) names.push(d);
  return names;
}

/**
 * Indexul dicționarului: cheie normalizată (nume afișat + alias-uri) -> Place.
 * @param {Place[]} places
 * @returns {Map<string, Place>}
 */
export function buildPlaceIndex(places) {
  const idx = new Map();
  for (const p of places || []) {
    if (!p || p.deletedAt) continue;
    const keys = new Set([p.key || placeKey(p.display), ...(p.aliases || []).map(placeKey)]);
    for (const k of keys) if (k && !idx.has(k)) idx.set(k, p);
  }
  return idx;
}

/**
 * @param {Map<string,Place>} index @param {string} name
 * @returns {Place|null}
 */
export function findPlace(index, name) {
  return index.get(placeKey(name)) ?? null;
}

/**
 * Creează o înregistrare Place (id determinist din cheie). Confirmată implicit doar dacă `confirmed:true`.
 * @param {{ display:string, lat?:number|null, lon?:number|null, countryCode?:string|null, source?:Place['source'],
 *   confirmed?:boolean, aliases?:string[], now?:string }} i
 * @returns {Place}
 */
export function makePlace(i) {
  const key = placeKey(i.display);
  const aliases = [...new Set((i.aliases || []).map((a) => clean(a)).filter((a) => a && placeKey(a) !== key))];
  return {
    id: detId('plc', key),
    key,
    aliases,
    display: clean(i.display),
    lat: i.lat ?? null,
    lon: i.lon ?? null,
    countryCode: i.countryCode ?? null,
    source: i.source || 'manual',
    confirmed: !!i.confirmed,
    updatedAt: i.now,
  };
}

/** Adaugă un alias unui loc (imuabil: întoarce o copie). @param {Place} p @param {string} alias @returns {Place} */
export function withAlias(p, alias, now) {
  const a = clean(alias);
  if (!a || placeKey(a) === p.key || (p.aliases || []).some((x) => placeKey(x) === placeKey(a))) return p;
  return { ...p, aliases: [...(p.aliases || []), a], updatedAt: now ?? p.updatedAt };
}

/**
 * Coada „Locuri de rezolvat”: nume din curse care nu sunt în dicționar, sortate după frecvență (desc),
 * apoi alfabetic. Permite confirmare în bloc (UI).
 * @param {Array<{ id:string, origin?:string, destinations?:string[], extras?:string[], routeRaw?:string, deletedAt?:string }>} courses
 * @param {Place[]|Map<string,Place>} places
 * @returns {Array<{ key:string, name:string, count:number, courseIds:string[], variants:string[] }>}
 */
export function unresolvedPlaces(courses, places) {
  const index = places instanceof Map ? places : buildPlaceIndex(places);
  const acc = new Map();
  for (const c of courses || []) {
    if (c.deletedAt) continue;
    const seenInCourse = new Set();
    for (const name of courseLocationNames(c)) {
      const key = placeKey(name);
      if (!key || index.has(key)) continue;
      let e = acc.get(key);
      if (!e) acc.set(key, (e = { key, name: clean(name), count: 0, courseIds: [], variants: [] }));
      if (!e.variants.includes(clean(name))) e.variants.push(clean(name));
      if (!seenInCourse.has(key)) { seenInCourse.add(key); e.count++; e.courseIds.push(c.id); }
    }
  }
  return [...acc.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ro'));
}

/**
 * Cursele care folosesc un loc (după cheie sau alias), pentru recalcularea km după confirmarea unui loc (AC4).
 * @param {Array<object>} courses @param {Place} place
 * @returns {string[]} id-urile curselor
 */
export function coursesUsingPlace(courses, place) {
  const keys = new Set([place.key, ...(place.aliases || []).map(placeKey)]);
  const ids = [];
  for (const c of courses || []) {
    if (c.deletedAt) continue;
    if (courseLocationNames(c).some((n) => keys.has(placeKey(n)))) ids.push(c.id);
  }
  return ids;
}
