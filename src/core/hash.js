// FNV-1a 64 bit (BigInt) și 32 bit, pe octeți UTF-8. Determinist, fără dependențe.
const enc = new TextEncoder();
const OFFSET64 = 0xcbf29ce484222325n;
const PRIME64 = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** @param {string} s @returns {bigint} */
export function fnv1a64(s) {
  let h = OFFSET64;
  for (const b of enc.encode(String(s))) {
    h ^= BigInt(b);
    h = (h * PRIME64) & MASK64;
  }
  return h;
}

/** 16 caractere hex. @param {string} s */
export function fnv1a64Hex(s) {
  return fnv1a64(s).toString(16).padStart(16, '0');
}

/** @param {string} s @returns {number} întreg fără semn pe 32 de biți */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(String(s))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
