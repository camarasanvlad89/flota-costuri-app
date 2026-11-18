// Import extras card combustibil / taxe de drum / bancă (CSV sau XLSX): mapper generic, FĂRĂ formate de furnizor inventate.
// Presetările pornesc goale: administratorul salvează maparea pe furnizor (cheie = furnizor + semnătura antetului).
import { normHeader, cellText, isBlank, rowIsEmpty, parseMoneyCell, parseDayCell, rowNo, colName } from './cells.js';
import { headerSignature } from './mapping.js';
import { countryCodeFromName } from './route.js';
import { normalizePlate } from '../core/plates.js';
import { foldKey, similarity } from '../core/text.js';
import { detId } from '../core/ids.js';
import { diffDays } from '../core/dates.js';
import { matchTruck } from './gps-importer.js';

export const EXPENSE_FIELD_LABELS = {
  date: 'Data', supplier: 'Furnizor / stație', amount: 'Sumă (brut)', net: 'Sumă fără TVA', vatAmount: 'TVA', currency: 'Valută', plate: 'Nr. înmatriculare',
  category: 'Produs / categorie', note: 'Observații', docNo: 'Nr. document', country: 'Țară', liters: 'Cantitate (litri)',
};
export const expenseFieldLabels = () => EXPENSE_FIELD_LABELS;
const DEFS = {
  date: ['data', 'date', 'datatranzactie', 'datatranzactiei', 'datum', 'transactiondate', 'datatr', 'datatankare', 'dataalimentare', 'datadocument'],
  supplier: ['furnizor', 'supplier', 'merchant', 'comerciant', 'statie', 'numestatie', 'stationname', 'locatie', 'vendor', 'beneficiar', 'partener', 'denumirefurnizor'],
  amount: ['suma', 'valoare', 'amount', 'total', 'totalcutva', 'brut', 'valoarebruta', 'gross', 'sumabruta', 'valoarecutva', 'sumacutva', 'grossamount'],
  net: ['valoarefaratva', 'net', 'netamount', 'suma net', 'sumanet', 'sumafaratva', 'valoarenet'],
  vatAmount: ['tva', 'vat', 'valoaretva', 'sumatva', 'vatamount'],
  currency: ['valuta', 'moneda', 'currency', 'deviza'],
  plate: ['nrinmatriculare', 'nrinmat', 'plate', 'vehicul', 'camion', 'nrauto', 'rendszam', 'numarauto', 'vehicle', 'licenseplate', 'numardeinmatriculare'],
  category: ['categorie', 'category', 'produs', 'product', 'tipprodus', 'articol', 'serviciu', 'goodstype', 'descriereprodus', 'tipcheltuiala'],
  note: ['observatii', 'note', 'detalii', 'comentariu', 'descriere', 'mentiuni', 'description'],
  docNo: ['nrdocument', 'nrfactura', 'factura', 'document', 'nrbon', 'bon', 'receipt', 'invoiceno', 'transactionid', 'nrtranzactie', 'idtranzactie', 'numardocument'],
  country: ['tara', 'country', 'countrycode', 'codtara'],
  liters: ['cantitate', 'litri', 'liters', 'litres', 'volume', 'quantity', 'qty'],
};
const REQUIRED = ['date', 'amount'];

/**
 * @param {any[][]} rows
 * @returns {{ mapping:{headerRow:number|null, cols:object, signature:string|null}, confidence:number, missing:string[] }}
 */
export function detectExpenseMapping(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    if (rowIsEmpty(rows[i])) continue;
    const cols = {};
    (rows[i] || []).forEach((cell, c) => {
      const h = normHeader(cell);
      if (!h) return;
      for (const [f, syn] of Object.entries(DEFS)) if (cols[f] == null && syn.map((s) => s.replace(/\s/g, '')).includes(h)) { cols[f] = c; break; }
    });
    const n = Object.keys(cols).length;
    if (REQUIRED.every((f) => cols[f] != null) && (!best || n > best.n)) best = { n, row: i, cols };
  }
  if (!best) return { mapping: { headerRow: null, cols: {}, signature: null }, confidence: 0, missing: [...REQUIRED] };
  return { mapping: { headerRow: best.row, cols: best.cols, signature: headerSignature(rows[best.row]) }, confidence: Math.min(1, best.n / 6), missing: [] };
}

/** Cheia sub care se salvează o mapare: furnizorul de card + semnătura antetului. */
export const expenseMappingKey = (provider, signature) => `${foldKey(provider || 'GENERIC')}:${signature}`;
/** Presetări livrate: GOALE (formatele exacte DKV/E100/Eurowag/UTA nu se inventează). */
export const EXPENSE_PRESETS = Object.freeze({});

const KW = {
  fuel: /motorin|diesel|benzin|carburant|gasoil|gazole|fuel|adblue|ad blue|lpg|gasolio|kraftstoff|uzemanyag|gazolaj/,
  toll: /toll|maut|rovinieta|vignet|hu-go|hugo|autostrad|peaj|taxa drum|tolls|viapass|telepass|ecovignette|cestarina|autópálya|autopalya/,
  parking: /parcare|parking|park /,
  other: /^$/,
};
/** 'fuel' | 'toll' | 'parking' | 'other' din textul unei linii de extras. */
export function classifyStatementLine(text) {
  const t = foldKey(text).toLowerCase();
  for (const k of ['fuel', 'toll', 'parking']) if (KW[k].test(t)) return k;
  return 'other';
}

function ctry(v) {
  const t = cellText(v);
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return countryCodeFromName(t);
}

/**
 * @param {any[][]} rows
 * @param {{headerRow:number|null, cols:object}} mapping
 * @param {{ currency?:string, categoryId?:string, countryCode?:string, documentation?:string, vat?:object, payment?:string, provider?:string,
 *           entered?:'gross'|'net', truckId?:string|null }} [defaults]
 * @returns {{ drafts:object[], issues:Array }}
 */
export function parseExpenseCsv(rows, mapping, defaults = {}) {
  const cols = mapping.cols || {};
  const issues = [], drafts = [];
  const provider = defaults.provider || 'GENERIC';
  const cur0 = (defaults.currency || 'RON').toUpperCase();
  const issue = (i, severity, code, message, col) => issues.push({ row: rowNo(i), ...(col != null ? { col: colName(col) } : {}), severity, code, message });
  const get = (r, f) => (cols[f] == null ? null : r[cols[f]]);
  const seen = new Map();
  for (let i = (mapping.headerRow ?? -1) + 1; i < rows.length; i++) {
    const r = rows[i];
    if (rowIsEmpty(r)) continue;
    const date = parseDayCell(get(r, 'date'));
    if (!date) { issue(i, 'warn', 'bad_date', `Dată necitibilă: „${cellText(get(r, 'date'))}” (rând ignorat)`, cols.date); continue; }
    let currency = cur0;
    if (cols.currency != null && !isBlank(get(r, 'currency'))) {
      const c = cellText(get(r, 'currency')).toUpperCase().replace(/[^A-Z]/g, '');
      currency = c === 'LEI' ? 'RON' : c === 'EURO' ? 'EUR' : c === 'FT' ? 'HUF' : c.length === 3 ? c : cur0;
    }
    const a = parseMoneyCell(get(r, 'amount'), currency);
    const n = cols.net != null ? parseMoneyCell(get(r, 'net'), currency) : { ok: false, empty: true };
    const v = cols.vatAmount != null ? parseMoneyCell(get(r, 'vatAmount'), currency) : { ok: false, empty: true };
    let gross = a.ok ? a.minor : null, net = n.ok ? n.minor : null, vat = v.ok ? v.minor : null;
    if (a.ok && a.ambiguous) issue(i, 'warn', 'ambiguous_number', `Sumă ambiguă „${cellText(get(r, 'amount'))}” citită ca ${a.readAs}`, cols.amount);
    if (gross == null && net != null && vat != null) gross = net + vat;
    if (gross == null && net != null && defaults.vat?.treatment !== 'taxed') gross = net;
    if (gross == null) { issue(i, 'error', 'no_amount', 'Sumă lipsă sau necitibilă (rând ignorat)', cols.amount); continue; }
    if (gross < 0) issue(i, 'warn', 'negative_amount', 'Sumă negativă (storno / credit)', cols.amount);
    if (gross === 0) issue(i, 'info', 'zero_amount', 'Sumă zero');
    const plateRaw = cols.plate != null ? cellText(get(r, 'plate')) : '';
    const supplier = cellText(get(r, 'supplier'));
    const catText = cols.category != null ? cellText(get(r, 'category')) : '';
    const noteText = cols.note != null ? cellText(get(r, 'note')) : '';
    const docNo = cols.docNo != null ? cellText(get(r, 'docNo')) : '';
    const kind = classifyStatementLine(`${catText} ${noteText} ${supplier}`);
    const liters = cols.liters != null ? parseMoneyCell(get(r, 'liters'), 'EUR') : null;
    const key = [date, gross, currency, normalizePlate(plateRaw), foldKey(supplier), foldKey(docNo)].join('|');
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    const cc = (cols.country != null ? ctry(get(r, 'country')) : null) || defaults.countryCode || null;
    drafts.push({
      kind: 'expense', date, docDate: date, truckId: defaults.truckId ?? null, plate: plateRaw ? normalizePlate(plateRaw) : '',
      targetType: 'truck', categoryId: defaults.categoryId || null, categoryText: catText, lineKind: kind,
      supplier, counterpartyVatId: null, docNo, note: noteText,
      documentation: defaults.documentation || 'invoice', countryCode: cc,
      vat: defaults.vat || { treatment: 'taxed', rateBp: null, deductiblePct: 100 },
      currency, entered: 'gross', minor: gross, netMinor: net, vatMinor: vat,
      fuel: liters && liters.ok && kind === 'fuel' ? { ml: Math.round(liters.minor * 10) } : null, // litri cu 2 zecimale -> ml // money-ok: nu sunt bani (afișare, km, procente sau pondere)
      payment: defaults.payment || 'fuelcard', status: 'pending', source: 'import',
      importProvider: provider, importRow: rowNo(i), dupKey: key, ordinal,
      importKey: detId('imx', provider, key, ordinal),
      possibleDuplicate: false, include: true,
    });
    if (ordinal > 0) issue(i, 'info', 'repeat_in_file', 'Rând identic cu unul anterior din fișier (alimentări repetate?)');
  }
  return { drafts, issues };
}

const entryKey = (date, gross, cur, truck, supplier, docNo) => [date, gross, cur, truck, foldKey(supplier), foldKey(docNo)].join('|');

/**
 * Detectare dubluri față de intrările existente: aceeași dată + sumă + valută + camion + furnizor + document.
 * Rândurile identice repetate în fișier se numără (n-a apariție e dublură doar dacă există ≥ n intrări).
 * Dublurile primesc `possibleDuplicate:true, include:false` (nu se importă fără bifă).
 * @returns {{ add:object[], duplicates:object[], states:{[importKey:string]:'nou'|'posibilă dublură'} }}
 */
export function planExpenseImport(drafts, existingEntries = [], trucks = []) {
  const counts = new Map();
  for (const e of existingEntries) {
    if (e.deletedAt || e.kind !== 'expense') continue;
    const gross = e.orig?.gross ?? null;
    if (gross == null) continue;
    const k = entryKey(e.date, gross, e.currency, normalizePlate(trucks.find((t) => t.id === e.target?.truckId)?.plate || ''), e.supplier || '', e.docNo || '');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const seen = new Map();
  const add = [], duplicates = [], states = {};
  for (const d of drafts) {
    const t = d.plate ? matchTruck(d.plate, trucks) : (d.truckId ? trucks.find((x) => x.id === d.truckId) : null);
    const k = entryKey(d.date, d.minor, d.currency, normalizePlate(t?.plate || ''), d.supplier, d.docNo);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    const out = { ...d, truckId: t ? t.id : d.truckId };
    if ((counts.get(k) || 0) >= n) { out.possibleDuplicate = true; out.include = false; duplicates.push(out); states[d.importKey] = 'posibilă dublură'; }
    else { add.push(out); states[d.importKey] = 'nou'; }
  }
  return { add, duplicates, states };
}

/**
 * Sugerează factura-părinte (regula anti-dublare 5.2: tranzacțiile de card legate de o factură nu se adună de două ori).
 * Candidați: aceeași factură după nr. document, sau același furnizor, factură ≥ suma tranzacției, în ±`windowDays` zile.
 * Doar sugestii; legătura (`parentDocId`) o confirmă ecranul.
 */
export function suggestParentInvoice(draft, entries, o = {}) {
  const windowDays = o.windowDays ?? 45;
  const out = [];
  for (const e of entries) {
    if (e.deletedAt || e.kind !== 'expense' || e.documentation !== 'invoice' || e.parentDocId) continue;
    let score = 0;
    if (draft.docNo && e.docNo && foldKey(draft.docNo) === foldKey(e.docNo)) score += 1;
    const sim = draft.supplier && e.supplier ? similarity(draft.supplier, e.supplier) : 0;
    if (sim >= 0.85) score += 0.5;
    const dd = Math.abs(diffDays(e.docDate || e.date, draft.date));
    if (dd <= windowDays) score += 0.25;
    if ((e.orig?.gross ?? 0) >= Math.abs(draft.minor) && e.currency === draft.currency) score += 0.15;
    if (score >= 0.75) out.push({ entry: e, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
