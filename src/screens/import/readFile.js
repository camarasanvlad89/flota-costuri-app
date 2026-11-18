// Citire fișier tabelar (CSV / XLSX) pentru expeditoarele de import: întoarce foile cu rânduri brute.
import { call } from '../../ui/api.js';

export async function readFileRows(file) {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = call('decodeText', await file.arrayBuffer());
    const r = call('readCsv', text);
    return { file: file.name, sheets: [{ name: 'csv', plate: null, year: null, rows: r.rows, rowCount: r.rows.length, defaultSelected: true }] };
  }
  return call('readWorkbook', file);
}
export const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
