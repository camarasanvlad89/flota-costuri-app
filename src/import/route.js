// Rută 'ORIGINE - DESTINAȚIE' în text liber (maghiară/română/croată), plus țări.
import { foldKey } from '../core/text.js';

/** Nume de țări (pliate cu foldKey) -> cod ISO. Ro / hu / en / nume native uzuale. */
const COUNTRY_NAMES = {
  RO: ['ROMANIA', 'ROMANYA'],
  HU: ['UNGARIA', 'HUNGARY', 'MAGYARORSZAG', 'HUNGARIA'],
  HR: ['CROATIA', 'CROATIE', 'HORVATORSZAG', 'HRVATSKA'],
  DE: ['GERMANIA', 'GERMANY', 'NEMETORSZAG', 'DEUTSCHLAND'],
  AT: ['AUSTRIA', 'OSZTRAK', 'OSTERREICH', 'OSZTRAKORSZAG'],
  SK: ['SLOVACIA', 'SLOVAKIA', 'SZLOVAKIA', 'SLOVENSKO'],
  CZ: ['CEHIA', 'CZECHIA', 'CSEHORSZAG', 'REPUBLICA CEHA', 'CESKO'],
  PL: ['POLONIA', 'POLAND', 'LENGYELORSZAG', 'POLSKA'],
  BG: ['BULGARIA', 'BOLGARORSZAG'],
  IT: ['ITALIA', 'ITALY', 'OLASZORSZAG'],
  FR: ['FRANTA', 'FRANCE', 'FRANCIAORSZAG'],
  ES: ['SPANIA', 'SPAIN', 'SPANYOLORSZAG', 'ESPANA'],
  NL: ['OLANDA', 'NETHERLANDS', 'HOLLANDIA', 'NEDERLAND'],
  BE: ['BELGIA', 'BELGIUM', 'BELGIUM'],
  SI: ['SLOVENIA', 'SZLOVENIA'],
  RS: ['SERBIA', 'SZERBIA'],
  UA: ['UCRAINA', 'UKRAINE', 'UKRAJNA'],
  GR: ['GRECIA', 'GREECE', 'GOROGORSZAG'],
  TR: ['TURCIA', 'TURKEY', 'TORKORSZAG', 'TURKIYE'],
  MD: ['MOLDOVA', 'REPUBLICA MOLDOVA'],
  CH: ['ELVETIA', 'SWITZERLAND', 'SVAJC'],
  DK: ['DANEMARCA', 'DENMARK'],
  SE: ['SUEDIA', 'SWEDEN'],
  GB: ['MAREA BRITANIE', 'UNITED KINGDOM', 'UK', 'ANGLIA'],
  BA: ['BOSNIA', 'BOSNIA SI HERTEGOVINA', 'BOSNIA HERZEGOVINA'],
  ME: ['MUNTENEGRU', 'MONTENEGRO'],
  MK: ['MACEDONIA', 'MACEDONIA DE NORD'],
  AL: ['ALBANIA'],
  LT: ['LITUANIA', 'LITHUANIA'],
  LV: ['LETONIA', 'LATVIA'],
  EE: ['ESTONIA'],
  FI: ['FINLANDA', 'FINLAND'],
  PT: ['PORTUGALIA', 'PORTUGAL'],
  LU: ['LUXEMBURG', 'LUXEMBOURG'],
  IE: ['IRLANDA', 'IRELAND'],
};
const NAME2CC = new Map();
for (const [cc, names] of Object.entries(COUNTRY_NAMES)) {
  for (const n of names) NAME2CC.set(foldKey(n), cc);
}
// coduri scurte nu se tratează ca nume de țară în rută (ex. 'AT', 'DE' pot fi alte lucruri), doar în coloane de țară
const ISO_CODES = new Set(Object.keys(COUNTRY_NAMES));

/** 'România' | 'Ungaria' | 'HU' | 'Hungary' -> 'RO'|'HU'|…; necunoscut => null. */
export function countryCodeFromName(s) {
  const k = foldKey(s);
  if (!k) return null;
  if (NAME2CC.has(k) && !ISO_CODES.has(k)) return NAME2CC.get(k);
  if (/^[A-Z]{2}$/.test(k) && ISO_CODES.has(k)) return k;
  return NAME2CC.get(k) || null;
}

/** Cod ISO dacă textul este (doar) o țară cunoscută în nume lung; folosit pentru „destinație doar țară”. */
export function countryOnlyCode(s) {
  const k = foldKey(s);
  if (!k || (/^[A-Z]{2}$/.test(k))) return null;
  return NAME2CC.get(k) && !ISO_CODES.has(k) ? NAME2CC.get(k) : null;
}

const SEP = /\s+[-–—]\s+|\s*[–—]\s*/;

/**
 * @param {string} text  'ARAD - GHERTA + TURT +NEGRESTI'
 * @returns {{ origin:string, destinations:string[], countryOnly:boolean, destCountry:string|null, originCountry:string|null, extras:string[], parsed:boolean }}
 *   `destinations` = opriri după „ - ” (separate cu `+`); `extras` = puncte suplimentare de încărcare (`+` în origine).
 */
export function parseRoute(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const out = { origin: '', destinations: [], countryOnly: false, destCountry: null, originCountry: null, extras: [], parsed: false };
  if (!raw) return out;
  let originPart = raw, destPart = '';
  const m = SEP.exec(raw);
  if (m) {
    originPart = raw.slice(0, m.index);
    destPart = raw.slice(m.index + m[0].length);
  } else {
    // fără separator spațiat: încearcă un singur '-' fără spații doar dacă nu e nume compus cu cratimă
    const parts = raw.split(/\s*-\s*/);
    if (parts.length === 2 && parts[0] && parts[1] && !/\s/.test(raw)) { originPart = parts[0]; destPart = parts[1]; }
  }
  const split = (p) => p.split('+').map((x) => x.trim()).filter(Boolean);
  const o = split(originPart);
  out.origin = o[0] || '';
  out.extras = o.slice(1);
  const d = split(destPart);
  out.parsed = !!(out.origin && d.length);
  const oc = o.length === 1 ? countryOnlyCode(out.origin) : null;
  if (oc) { out.originCountry = oc; }
  if (d.length === 1 && countryOnlyCode(d[0])) {
    out.countryOnly = true;
    out.destCountry = countryOnlyCode(d[0]);
    out.destinations = [];
  } else {
    out.destinations = d;
  }
  return out;
}

/** Cheie normalizată de rută pentru identificare idempotentă. */
export function normRoute(text) {
  return foldKey(text).replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ');
}
