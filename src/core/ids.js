import { fnv1a64Hex } from './hash.js';

const SEP = '␟'; // '␟'
const withUnderscore = (p) => (p.endsWith('_') ? p : p + '_');

function randomBase36(n, random) {
  let out = '';
  while (out.length < n) {
    let r;
    if (random) r = random();
    else if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      r = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    } else r = Math.random();
    out += Math.floor(r * 36).toString(36);
  }
  return out;
}

/**
 * Id nou: prefix + '_' + 10 caractere base36 (6 = secunde, sortabil; 4 = aleator).
 * @param {string} prefix  'ent' sau 'ent_'
 * @param {{now?:()=>number, random?:()=>number}} [o] injectabil pentru teste
 */
export function newId(prefix, o = {}) {
  const t = Math.floor((o.now ? o.now() : Date.now()) / 1000).toString(36).padStart(6, '0').slice(-6);
  return withUnderscore(prefix) + t + randomBase36(4, o.random);
}

/**
 * Id determinist: prefix + '_' + FNV-1a 64 bit hex (16 caractere) din parts.join('␟').
 * @param {string} prefix @param {...(string|number)} parts
 */
export function detId(prefix, ...parts) {
  return withUnderscore(prefix) + fnv1a64Hex(parts.join(SEP));
}
