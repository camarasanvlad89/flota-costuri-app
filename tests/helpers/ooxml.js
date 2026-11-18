// Ajutoare pentru verificarea fișierelor OOXML (.xlsx) în teste: cititor ZIP minimal + parser XML minimal (fără dependențe).
import zlib from 'node:zlib';

/** @param {Uint8Array} buf @returns {Record<string, Buffer>} nume ⇒ conținut (octeți) */
export function unzip(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('nu e ZIP (lipsește end-of-central-directory)');
  const count = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('director central corupt');
    const method = b.readUInt16LE(p + 10), csz = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString('utf8');
    const lnl = b.readUInt16LE(off + 26), lel = b.readUInt16LE(off + 28), st = off + 30 + lnl + lel;
    const raw = b.subarray(st, st + csz);
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    p += 46 + nl + el + cl;
  }
  return out;
}

/** Parser XML minimal: { name, attrs, children, text }. Păstrează prefixele (c:chart). Suficient pentru verificări de structură. */
export function parseXml(xml) {
  const s = String(xml).replace(/^﻿/, '').replace(/<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[5] !== undefined) { stack[stack.length - 1].text += m[5]; continue; }
    const [, close, name, attrStr, selfClose] = m;
    if (close) {
      const top = stack.pop();
      if (top.name !== name) throw new Error(`XML nealiniat: </${name}> închide <${top.name}>`);
      continue;
    }
    const attrs = {}; for (const a of attrStr.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    const node = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('XML neînchis: <' + stack[stack.length - 1].name + '>');
  if (root.children.length !== 1) throw new Error('XML fără rădăcină unică');
  return root.children[0];
}

export const kindOf = (name) => name.replace(/\d+/g, 'N');
export function* walk(node) { yield node; for (const c of node.children) yield* walk(c); }

/**
 * Ordinea relativă a copiilor unui container trebuie să fie consecventă cu ordinea de referință (cea acceptată de Excel).
 * Verifică perechi (a înaintea lui b în referință ⇒ la fel în rezultat) doar pentru etichetele prezente în ambele.
 * @returns {string[]} încălcările
 */
export function orderViolations(node, refOrders) {
  const out = [];
  for (const n of walk(node)) {
    const ref = refOrders[n.name];
    if (!ref || n.children.length < 2) continue;
    const names = n.children.map((c) => c.name);
    const idx = names.filter((x) => ref.includes(x)).map((x) => ref.indexOf(x));
    for (let i = 1; i < idx.length; i++) if (idx[i] < idx[i - 1]) out.push(`${n.name}: <${ref[idx[i]]}> după <${ref[idx[i - 1]]}> (în referință e invers); copii: ${names.join(', ')}`);
  }
  return out;
}
