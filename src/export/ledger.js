// Jurnal contabil (5.10 / 17.3 H): aceleași rânduri pentru foaia „Jurnal contabil”, CSV contabil.
import { coll, byId, inRange, sumInts } from './data-access.js';
import { accountingJournal } from '../domain/reports.js';
import { buildCsv, minorToCsv, currencyExpLocal } from './csv-export.js';

export const LEDGER_HEADER = [
  'Data', 'Data document', 'Nr. document', 'Furnizor / partener', 'CUI', 'Țară', 'Valută',
  'Brut orig.', 'Net orig.', 'TVA orig.', 'Net RON', 'TVA RON', 'Brut RON', 'Tratament TVA', 'Regim',
  '% deductibil', 'Cont', 'Categorie', 'Camion', 'Tip', 'Documentare', 'Sursa banilor', 'Sursă curs', 'Curs', 'Recurentă',
];

const DOC = { invoice: 'factură', receipt: 'bon', none: 'fără document' };
const TREAT = { taxed: 'cu TVA', none: 'fără TVA', zero: '0%', nondeductible: 'TVA nedeductibil', reverse: 'taxare inversă' };

/**
 * Rânduri tipizate (sumele sunt { m, cur } în minor exact). O singură sursă pentru jurnalul de pe ecran, foaia „Jurnal contabil” și CSV-ul
 * contabil: `accountingJournal` din domeniu (cheltuieli, alte venituri ȘI cursele facturate), cu etichete în română.
 */
export function ledgerRows(state, range, opts = {}) {
  const entries = byId(coll(state, 'entries'));
  const rows = accountingJournal(state, range, { includeCourses: opts.includeCourses !== false });
  return rows.map((r) => {
    const e = r.ref.type === 'entry' ? entries.get(r.ref.id) : null;
    const cur = r.currency || 'RON';
    const m = (v) => (v === null || v === undefined ? null : { m: v, cur });
    return {
      kind: r.kind, row: r, entry: e,
      cells: [
        { d: r.date }, r.docDate ? { d: r.docDate } : null, r.docNo || '', r.supplier || '', r.supplierVatId || '',
        r.countryCode || '', cur,
        m(r.origGross), m(r.origNet), m(r.origVat),
        { m: r.ronNet ?? 0, cur: 'RON' }, { m: r.ronVat ?? 0, cur: 'RON' }, { m: r.ronGross ?? 0, cur: 'RON' },
        TREAT[r.vatTreatment] || r.vatTreatment || '', r.vatRegime || '',
        r.deductiblePct ?? '', r.accountCode || '', r.category || '',
        r.truck === 'comun' ? 'Comun firmă' : (r.truck || ''),
        r.kind, r.documentationLabel || DOC[r.documentation] || r.documentation || '',
        r.moneySource || '', r.fxSource || (cur === 'RON' ? 'ron' : ''), r.fxRate || '',
        e && e.recurring ? 'da' : '',
      ],
    };
  });
}

export function ledgerTotals(state, range) {
  const rows = ledgerRows(state, range, { includeCourses: false }).filter((r) => r.entry);
  return {
    count: rows.length,
    netRon: sumInts(rows.map((r) => (r.entry.kind === 'income' ? 0 : r.entry.ron?.net || 0))),
    grossRon: sumInts(rows.map((r) => (r.entry.kind === 'income' ? 0 : r.entry.ron?.gross || 0))),
    vatRon: sumInts(rows.map((r) => (r.entry.kind === 'income' ? 0 : r.entry.ron?.vat || 0))),
    incomeGrossRon: sumInts(rows.map((r) => (r.entry.kind === 'income' ? r.entry.ron?.gross || 0 : 0))),
  };
}

function plain(cell, delimiter) {
  if (cell && typeof cell === 'object') {
    if (cell.m !== undefined) return minorToCsv(cell.m, cell.exp ?? currencyExpLocal(cell.cur), delimiter);
    if (cell.d !== undefined) return cell.d;
    return cell.v ?? '';
  }
  return cell;
}
// numerele din CSV rămân numere (fără ghilimele): minorToCsv dă șir cu virgulă, deci nu apare citat
// decât dacă delimitatorul e prezent în el (nu e, în modul ';').

export function ledgerCsv(state, range, opts = {}) {
  const delimiter = opts.delimiter || ';';
  const rows = ledgerRows(state, range).map((r) => r.cells.map((c) => plain(c, delimiter)));
  return buildCsv([LEDGER_HEADER, ...rows], { delimiter, bom: true });
}
export const buildAccountantCsv = ledgerCsv;
