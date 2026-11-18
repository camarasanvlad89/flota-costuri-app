// Detecție antete pentru tabelul de curse (și utilitare comune de mapare). Fără diacritice, fără majuscule, cu sinonime.
import { fnv1a64Hex } from '../core/hash.js';
import { normHeader, cellText, isBlank, rowIsEmpty, parseDayCell } from './cells.js';
import { parsePlates } from '../core/plates.js';

/** Câmpurile unei curse și sinonimele lor (deja în formă normHeader). `exact` = potrivire integrală; `part` = conține. */
export const COURSE_FIELDS = {
  loadDate: { exact: ['dataincarcare', 'dataincarcarii', 'incarcare', 'datainc', 'dataloading', 'loaddate', 'loadingdate', 'loading', 'pickupdate', 'pickup', 'felrakodas', 'felrakodasdatuma', 'datainceput'], part: ['dataincarc'] },
  unloadDate: { exact: ['datadescarcare', 'datadescarcarii', 'descarcare', 'datadesc', 'unloaddate', 'unloadingdate', 'unloading', 'deliverydate', 'delivery', 'lerakodas', 'lerakodasdatuma', 'datasfarsit'], part: ['datadescarc'] },
  plates: { exact: ['nrcamionnrremorca', 'nrcamion', 'camion', 'camionremorca', 'plate', 'plates', 'truck', 'nrinmatriculare', 'numarinmatriculare', 'rendszam', 'vehicul', 'autovehicul'], part: ['nrcamion'] },
  driver: { exact: ['sofer', 'soferul', 'driver', 'sofor', 'conducator', 'soferi'], part: [] },
  route: { exact: ['ruta', 'traseu', 'route', 'utvonal', 'relatia', 'destinatie', 'cursa'], part: ['ruta'] },
  net: { exact: ['pretfaratva', 'pretnet', 'faratva', 'net', 'netto', 'valoarefaratva', 'valoarenet', 'freightnet', 'pretfaratva', 'pret', 'suma'], part: ['faratva'] },
  vat: { exact: ['tva', 'vat', 'afa', 'valoaretva', 'sumatva'], part: [] },
  gross: { exact: ['total', 'totalcutva', 'pretcutva', 'cutva', 'brut', 'gross', 'osszesen', 'totalbrut', 'valoarecutva'], part: ['totalcutva'] },
  note: { exact: ['observatii', 'observatie', 'note', 'notes', 'mentiuni', 'obs', 'megjegyzes', 'comentarii', 'comentariu'], part: ['observ'] },
  // opționale
  km: { exact: ['km', 'kmincarcati', 'distanta', 'distance', 'kilometri', 'kmloaded', 'kmrute', 'kmcursa', 'kmtotal'], part: [] },
  currency: { exact: ['valuta', 'moneda', 'currency', 'deviza'], part: [] },
  vatTreatment: { exact: ['tratamenttva', 'regimtva', 'tipultva', 'tiptva', 'vattreatment', 'tratamentul'], part: ['tratamenttva'] },
  invoiceNo: { exact: ['nrfactura', 'nrfact', 'factura', 'numarfactura', 'invoiceno', 'invoicenumber', 'invoice', 'seriafactura'], part: ['nrfactura'] },
  clientName: { exact: ['client', 'beneficiar', 'customer', 'clientul', 'partener'], part: [] },
  invoiceDate: { exact: ['datafacturii', 'datafactura', 'datafact', 'invoicedate', 'dataemiterii'], part: ['datafactur'] },
  dueDate: { exact: ['scadenta', 'datascadenta', 'datascadentei', 'termen', 'duedate', 'termenplata'], part: ['scaden'] },
  paidDate: { exact: ['dataincasarii', 'dataincasare', 'incasat', 'incasare', 'paiddate', 'dataplatii', 'dataplata'], part: ['dataincas'] },
  uit: { exact: ['uit', 'codeuit', 'cod uit', 'coduit'], part: [] },
};
const CORE_FIELDS = ['loadDate', 'unloadDate', 'plates', 'driver', 'route', 'net', 'vat', 'gross', 'note'];
export const COURSE_FIELD_LABELS = {
  loadDate: 'Data încărcare', unloadDate: 'Data descărcare', plates: 'Nr camion / Nr remorcă', driver: 'Șofer', route: 'Rută',
  net: 'Preț fără TVA', vat: 'TVA', gross: 'Total', note: 'Observații', km: 'Km', currency: 'Valută', vatTreatment: 'Tratament TVA',
  invoiceNo: 'Nr factură', clientName: 'Client', invoiceDate: 'Data facturii', dueDate: 'Scadență', paidDate: 'Data încasării', uit: 'UIT',
};

function scoreHeader(h, field) {
  if (!h) return 0;
  const def = COURSE_FIELDS[field];
  if (def.exact.includes(h)) return 1;
  for (const p of def.part) if (h.includes(p)) return 0.8;
  return 0;
}

/** Hash stabil al antetului (valori normalizate nevide) = „semnătura” sub care se salvează maparea. */
export function headerSignature(row) {
  const parts = (row || []).map(normHeader).filter(Boolean);
  return fnv1a64Hex(parts.join('|'));
}

function matchHeaderRow(row) {
  const best = {}; // field -> {col, score}
  (row || []).forEach((cell, col) => {
    const h = normHeader(cell);
    if (!h) return;
    for (const f of Object.keys(COURSE_FIELDS)) {
      const s = scoreHeader(h, f);
      if (s > 0 && (!best[f] || s > best[f].score)) best[f] = { col, score: s };
    }
  });
  // o coloană nu poate fi două câmpuri: câștigă scorul mai mare, apoi câmpul de bază
  const byCol = {};
  for (const [f, v] of Object.entries(best)) {
    const cur = byCol[v.col];
    if (!cur || v.score > cur.score || (v.score === cur.score && CORE_FIELDS.includes(f) && !CORE_FIELDS.includes(cur.f))) byCol[v.col] = { f, score: v.score };
  }
  const cols = {};
  for (const [col, v] of Object.entries(byCol)) cols[v.f] = +col;
  return cols;
}

const DATE_RATIO = 0.6;
function colValues(rows, col, from, to) {
  const out = [];
  for (let i = from; i < Math.min(rows.length, to); i++) {
    const v = rows[i]?.[col];
    if (!isBlank(v)) out.push(v);
  }
  return out;
}

/** Euristică pe conținut când nu există antet. Datele identice ca aspect NU se atribuie (decide utilizatorul). */
function contentHeuristic(rows) {
  const from = 0, to = Math.min(rows.length, 400);
  const width = Math.max(0, ...rows.slice(from, to).map((r) => (r ? r.length : 0)));
  const info = [];
  for (let c = 0; c < width; c++) {
    const vals = colValues(rows, c, from, to);
    if (vals.length < 3) { info.push({ c, n: vals.length }); continue; }
    const isDate = vals.filter((v) => parseDayCell(v) && (typeof v !== 'number' || (v > 36000 && v < 60000))).length / vals.length;
    const isPlate = vals.filter((v) => /^[A-Z]{1,2}\d{2,3}[A-Z]{3}(\s*[\/,]\s*[A-Z]{1,2}\d{2,3}[A-Z]{3})?$/i.test(cellText(v).replace(/\s+/g, ''))).length / vals.length;
    const isRoute = vals.filter((v) => typeof v === 'string' && /\s[-–]\s/.test(v)).length / vals.length;
    const isDriver = vals.filter((v) => typeof v === 'string' && /^[A-ZĂÂÎȘȚŐŰ]{3,12}$/.test(cellText(v))).length / vals.length;
    const isNum = vals.filter((v) => typeof v === 'number' || /^[\d.,\s]+$/.test(cellText(v))).length / vals.length;
    info.push({ c, n: vals.length, isDate, isPlate, isRoute, isDriver, isNum });
  }
  const cols = {};
  const ambiguities = [];
  const dateCols = info.filter((x) => x.isDate >= DATE_RATIO).map((x) => x.c);
  const take = (key, thr, field) => {
    const cand = info.filter((x) => x[key] >= thr && !Object.values(cols).includes(x.c));
    if (cand.length === 1) cols[field] = cand[0].c;
    else if (cand.length > 1) ambiguities.push({ fields: [field], columns: cand.map((x) => x.c) });
  };
  take('isPlate', 0.7, 'plates');
  take('isRoute', 0.6, 'route');
  // șofer: cuvânt scurt majuscule repetat
  const drv = info.filter((x) => x.isDriver >= 0.7 && x.isDate < 0.3 && !x.isPlate && !Object.values(cols).includes(x.c));
  if (drv.length === 1) cols.driver = drv[0].c;
  // trei coloane numerice consecutive cu H ≈ cotă·G
  const nums = info.filter((x) => x.isNum >= 0.5 && x.isDate < 0.3 && x.isPlate < 0.3 && !Object.values(cols).includes(x.c)).map((x) => x.c);
  for (let i = 0; i + 2 < nums.length; i++) {
    const [g, h, t] = [nums[i], nums[i + 1], nums[i + 2]];
    if (h !== g + 1 || t !== h + 1) continue;
    let ok = 0, tot = 0;
    for (const r of rows.slice(from, to)) {
      const G = toNum(r?.[g]), H = toNum(r?.[h]), T = toNum(r?.[t]);
      if (G && H && T) { tot++; if (Math.abs(G + H - T) <= 0.02 * Math.max(1, T) / 100 + 0.011) ok++; } // money-ok: nu sunt bani (afișare, km, procente sau pondere)
    }
    if (tot >= 3 && ok / tot > 0.8) { cols.net = g; cols.vat = h; cols.gross = t; break; }
  }
  if (dateCols.length === 2) ambiguities.push({ fields: ['loadDate', 'unloadDate'], columns: dateCols });
  else if (dateCols.length === 1) cols.loadDate = dateCols[0];
  else if (dateCols.length > 2) ambiguities.push({ fields: ['loadDate', 'unloadDate'], columns: dateCols });
  return { cols, ambiguities };
}
function toNum(v) {
  if (typeof v === 'number') return v;
  const t = cellText(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n : null;
}

/**
 * Detectează antetul (în primele 200 de rânduri, nu se presupune rândul 1) și coloanele.
 * @param {any[][]} rows
 * @returns {{ mapping: CourseMapping, confidence:number, headerRow:number|null }}
 *   CourseMapping = { headerRow:number|null (indice 0-based), cols:{[field]:number}, strayCols:number[], ambiguities:Array<{fields:string[],columns:number[]}>,
 *     needsUser:boolean, missing:string[], signature:string|null, method:'header'|'content' }
 */
export function detectCourseMapping(rows) {
  const limit = Math.min(rows.length, 200);
  let bestRow = null, bestCols = null, bestN = 0;
  for (let i = 0; i < limit; i++) {
    if (rowIsEmpty(rows[i])) continue;
    const cols = matchHeaderRow(rows[i]);
    const n = Object.keys(cols).filter((f) => CORE_FIELDS.includes(f)).length;
    if (n > bestN) { bestN = n; bestRow = i; bestCols = cols; }
  }
  let mapping;
  if (bestRow != null && bestN >= 3) {
    const mapped = new Set(Object.values(bestCols));
    const header = rows[bestRow] || [];
    const width = Math.max(header.length, ...rows.slice(bestRow + 1, bestRow + 400).map((r) => (r ? r.length : 0)));
    // coloane fără antet (ex. K) sau cu antet necunoscut, care au valori în rândurile de date
    const strayCols = [];
    for (let c = 0; c < width; c++) {
      if (mapped.has(c)) continue;
      const hasData = colValues(rows, c, bestRow + 1, bestRow + 5000).length > 0;
      if (hasData && isBlank(header[c])) strayCols.push(c);
    }
    const missing = CORE_FIELDS.filter((f) => !(f in bestCols) && ['loadDate', 'unloadDate', 'route'].includes(f));
    mapping = {
      headerRow: bestRow, cols: bestCols, strayCols, ambiguities: [], missing, needsUser: missing.length > 0,
      signature: headerSignature(header), method: 'header',
    };
    const coreFound = Object.keys(bestCols).filter((f) => CORE_FIELDS.includes(f)).length;
    return { mapping, confidence: Math.min(1, coreFound / CORE_FIELDS.length + (missing.length ? -0.2 : 0.05)), headerRow: bestRow };
  }
  const { cols, ambiguities } = contentHeuristic(rows);
  const missing = ['loadDate', 'unloadDate', 'route'].filter((f) => !(f in cols));
  mapping = { headerRow: null, cols, strayCols: [], ambiguities, missing, needsUser: true, signature: null, method: 'content' };
  const found = Object.keys(cols).length;
  return { mapping, confidence: Math.max(0, Math.min(0.5, found / 10)), headerRow: null };
}

/** Aplică o mapare salvată dacă semnătura antetului se potrivește; altfel null. */
export function applySavedMapping(saved, rows) {
  if (!saved || !saved.cols) return null;
  const fresh = detectCourseMapping(rows).mapping;
  if (saved.signature && fresh.signature && saved.signature !== fresh.signature) return null;
  return { ...fresh, ...saved, headerRow: fresh.headerRow ?? saved.headerRow ?? null };
}

/** Plăcuță de camion (prima) dintr-o celulă, cu remorca. Reexport comod pentru wizard. */
export { parsePlates };
