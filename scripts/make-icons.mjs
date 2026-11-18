// Generează pictogramele PWA (PNG simplu, fără dependențe): fundal teal + literă "F" albă. Rulează: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(n) {
  const raw = Buffer.alloc((n * 3 + 1) * n);
  const inF = (x, y) => { const u = x / n, v = y / n; return (u > .30 && u < .42 && v > .25 && v < .75) || (u >= .42 && u < .70 && v > .25 && v < .37) || (u >= .42 && u < .62 && v > .45 && v < .56); };
  for (let y = 0; y < n; y++) { raw[y * (n * 3 + 1)] = 0; for (let x = 0; x < n; x++) { const o = y * (n * 3 + 1) + 1 + x * 3, w = inF(x, y); raw[o] = w ? 255 : 15; raw[o + 1] = w ? 255 : 118; raw[o + 2] = w ? 255 : 110; } }
  const h = Buffer.alloc(13); h.writeUInt32BE(n, 0); h.writeUInt32BE(n, 4); h[8] = 8; h[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
for (const n of [180, 192, 512]) writeFileSync(`public/icons/icon-${n}.png`, png(n));
