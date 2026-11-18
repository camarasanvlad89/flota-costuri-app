// CSV: detecție delimitator, ghilimele, UTF-8 / Windows-1250.

/** Decodează octeți: UTF-8 (cu BOM tolerat); dacă nu e UTF-8 valid, Windows-1250 (ro/hu). */
export function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let t;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { t = new TextDecoder('windows-1250').decode(bytes); }
    catch { t = new TextDecoder('latin1').decode(bytes); }
  }
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

function detectDelimiter(text) {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 12);
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const line of sample) {
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch in counts) counts[ch]++;
    }
  }
  let best = ';', max = -1;
  for (const d of [';', '\t', ',']) if (counts[d] > max) { max = counts[d]; best = d; }
  return max <= 0 ? ';' : best;
}

/**
 * @param {string} text
 * @param {{delimiter?:string}} [o]
 * @returns {{ delimiter:string, rows:string[][], encodingGuess:string }}
 */
export function readCsv(text, o = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = o.delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], cell = '', q = false, i = 0;
  const n = text.length;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { q = true; i++; continue; }
    if (ch === delimiter) { pushCell(); i++; continue; }
    if (ch === '\r') { pushRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) pushRow();
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  const encodingGuess = /�|Ã[\u0080-¿]|Ä[\u0080-¿]/.test(text) ? 'suspect (diacritice stricate; încercați Windows-1250)' : 'utf-8';
  return { delimiter, rows, encodingGuess };
}
