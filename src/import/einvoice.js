// e-Factura (UBL 2.1 / CIUS-RO) încărcată manual: XML -> factură -> intrare (cheltuială / venit). Fără SPV.
import { fromDecimalString } from '../core/money.js';
import { foldKey } from '../core/text.js';
import { detId } from '../core/ids.js';
import { countryCodeFromName } from './route.js';

// ---------- mini parser XML (fără DOMParser: rulează și în node) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') { const cp = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return m; } }
    return ENT[g] ?? m;
  });
}
const local = (n) => n.replace(/^.*:/, '');

/** @returns {{name:string, attrs:object, children:object[], text:string}} rădăcina */
export function parseXml(xml) {
  const text = String(xml).replace(/^﻿/, '');
  if (/<!ENTITY/i.test(text)) throw new Error('XML cu definiții de entități: refuzat');
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length > 1 && local(m[2]) === top.name) stack.pop();
      else throw new Error(`XML malformat: </${m[2]}> neașteptat`);
    } else if (m[3] !== undefined) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
      const node = { name: local(m[3]), attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  if (stack.length !== 1) throw new Error('XML malformat: etichete neînchise');
  const el = root.children[0];
  if (!el) throw new Error('XML gol');
  return el;
}
const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n, name) => kids(n, name)[0] || null;
const at = (n, path) => { let cur = n; for (const p of path.split('/')) { cur = kid(cur, p); if (!cur) return null; } return cur; };
const txt = (n, path) => { const x = path ? at(n, path) : n; return x ? x.text.trim() : ''; };

const normVatId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** 'RO 12345678' | 'RO12345678' | '12345678' -> '12345678' pentru comparare. */
export function vatIdKey(s) { return normVatId(s).replace(/^[A-Z]{2}(?=\d)/, ''); }

function party(p) {
  const pp = kid(p, 'Party') || p;
  return {
    name: txt(pp, 'PartyLegalEntity/RegistrationName') || txt(pp, 'PartyName/Name'),
    vatId: txt(pp, 'PartyTaxScheme/CompanyID') || txt(pp, 'PartyLegalEntity/CompanyID'),
    countryCode: txt(pp, 'PostalAddress/Country/IdentificationCode') || null,
    city: txt(pp, 'PostalAddress/CityName') || '',
  };
}

function money(s, cur) { return s === '' || s == null ? null : fromDecimalString(s.trim(), cur); }
const bpOf = (s) => (s === '' ? null : Math.round(Number(s) * 100));

/**
 * @param {string} xmlText
 * @returns {{ ok:true, invoice:object, warnings:string[] }|{ ok:false, error:string }}
 */
export function parseEinvoiceXml(xmlText) {
  let root;
  try { root = parseXml(xmlText); } catch (e) { return { ok: false, error: `XML invalid: ${e.message}` }; }
  if (root.name !== 'Invoice' && root.name !== 'CreditNote') {
    return { ok: false, error: `Document neacceptat (${root.name}). Se acceptă UBL Invoice / CreditNote (e-Factura).` };
  }
  const warnings = [];
  const isCreditNote = root.name === 'CreditNote';
  const currency = (txt(root, 'DocumentCurrencyCode') || 'RON').toUpperCase();
  const sign = isCreditNote ? -1 : 1;
  const supplier = party(kid(root, 'AccountingSupplierParty'));
  const customer = party(kid(root, 'AccountingCustomerParty'));
  const lmt = kid(root, 'LegalMonetaryTotal');
  let net = money(txt(lmt, 'TaxExclusiveAmount'), currency);
  const lineExt = money(txt(lmt, 'LineExtensionAmount'), currency);
  let gross = money(txt(lmt, 'TaxInclusiveAmount'), currency);
  const payable = money(txt(lmt, 'PayableAmount'), currency);
  let vat = null;
  for (const tt of kids(root, 'TaxTotal')) {
    const amt = txt(tt, 'TaxAmount');
    if (amt === '') continue;
    const cur = (kid(tt, 'TaxAmount')?.attrs.currencyID || currency).toUpperCase();
    if (cur === currency) vat = (vat ?? 0) + money(amt, currency);
  }
  const breakdown = [];
  for (const tt of kids(root, 'TaxTotal')) {
    for (const st of kids(tt, 'TaxSubtotal')) {
      breakdown.push({
        taxable: money(txt(st, 'TaxableAmount'), currency), vat: money(txt(st, 'TaxAmount'), currency),
        rateBp: bpOf(txt(st, 'TaxCategory/Percent')), categoryCode: txt(st, 'TaxCategory/ID') || null,
        exemptionReason: txt(st, 'TaxCategory/TaxExemptionReason') || null,
      });
    }
  }
  if (net == null) net = lineExt;
  if (gross == null) gross = payable != null && !kid(lmt, 'PrepaidAmount') ? payable : (net != null && vat != null ? net + vat : payable);
  if (vat == null && net != null && gross != null) vat = gross - net;
  if (gross == null) return { ok: false, error: 'Totalul facturii lipsește (LegalMonetaryTotal)' };
  if (net == null) net = gross - (vat ?? 0);
  if (Math.abs(net + (vat ?? 0) - gross) > 1) warnings.push(`Net + TVA ≠ Total (${net} + ${vat ?? 0} ≠ ${gross})`);
  const lines = kids(root, isCreditNote ? 'CreditNoteLine' : 'InvoiceLine').map((ln) => ({
    id: txt(ln, 'ID'), name: txt(ln, 'Item/Name') || txt(ln, 'Item/Description'),
    qty: txt(ln, isCreditNote ? 'CreditedQuantity' : 'InvoicedQuantity') || null,
    net: money(txt(ln, 'LineExtensionAmount'), currency) * sign, rateBp: bpOf(txt(ln, 'Item/ClassifiedTaxCategory/Percent')),
    categoryCode: txt(ln, 'Item/ClassifiedTaxCategory/ID') || null,
  }));
  const docNo = txt(root, 'ID');
  if (!docNo) warnings.push('Numărul facturii lipsește');
  const invoice = {
    docNo, issueDate: txt(root, 'IssueDate') || null, dueDate: txt(root, 'DueDate') || txt(root, 'PaymentMeans/PaymentDueDate') || null,
    typeCode: txt(root, 'InvoiceTypeCode') || txt(root, 'CreditNoteTypeCode') || null, isCreditNote,
    currency, supplier, customer, net: net * sign, vat: (vat ?? 0) * sign, gross: gross * sign,
    breakdown: breakdown.map((b) => ({ ...b, taxable: b.taxable == null ? null : b.taxable * sign, vat: b.vat == null ? null : b.vat * sign })),
    lines, note: txt(root, 'Note'), cius: /CIUS-RO|EN16931/i.test(txt(root, 'CustomizationID')),
  };
  if (!invoice.issueDate) warnings.push('Data emiterii lipsește');
  return { ok: true, invoice, warnings };
}

export const supplierKey = (vatId, name) => (vatIdKey(vatId) ? `cui:${vatIdKey(vatId)}` : `nume:${foldKey(name)}`);
/** Cheie de dublură: furnizor (CUI sau nume) + număr factură. */
export const einvoiceKey = (vatId, name, docNo) => `${supplierKey(vatId, name)}|${foldKey(docNo)}`;

function chooseTreatment(inv, direction) {
  const b = inv.breakdown.filter((x) => x.taxable != null);
  if (!b.length) return { treatment: inv.vat === 0 ? 'zero' : 'taxed', rateBp: null };
  const main = [...b].sort((x, y) => Math.abs(y.taxable) - Math.abs(x.taxable))[0];
  if (main.categoryCode === 'AE') return { treatment: direction === 'expense' ? 'reverse' : 'zero', rateBp: 0 };
  if (['Z', 'E', 'O', 'K', 'G'].includes(main.categoryCode) || main.rateBp === 0) return { treatment: 'zero', rateBp: 0 };
  return { treatment: 'taxed', rateBp: main.rateBp };
}

/**
 * Factura parsată -> intrare propusă (status 'pending', nu se scrie nimic).
 * Direcția: furnizorul = firma noastră (CUI) => venit; clientul = firma noastră => cheltuială.
 * @param {object} inv rezultatul `parseEinvoiceXml(...).invoice`
 * @param {{ company?:{cui?:string}, supplierRules?:Array, direction?:'expense'|'income' }} [o]
 */
export function einvoiceToDraft(inv, o = {}) {
  const me = vatIdKey(o.company?.cui);
  let direction = o.direction || null;
  const flags = [];
  if (!direction) {
    if (me && vatIdKey(inv.supplier.vatId) === me) direction = 'income';
    else if (me && vatIdKey(inv.customer.vatId) === me) direction = 'expense';
    else { direction = 'expense'; flags.push('direction_unknown'); }
  }
  const cp = direction === 'expense' ? inv.supplier : inv.customer;
  const { treatment, rateBp } = chooseTreatment(inv, direction);
  if (new Set(inv.breakdown.map((b) => b.rateBp)).size > 1) flags.push('multiple_vat_rates');
  if (inv.isCreditNote) flags.push('credit_note');
  const rule = direction === 'expense' ? suggestCategory(o.supplierRules || [], cp.vatId, cp.name) : null;
  const cc = cp.countryCode || (cp.vatId.match(/^[A-Za-z]{2}/)?.[0].toUpperCase()) || 'RO';
  return {
    kind: direction, incomeType: direction === 'income' ? 'other' : null,
    date: inv.issueDate, docDate: inv.issueDate, dueDate: inv.dueDate,
    truckId: null, targetType: 'company', categoryId: rule ? rule.categoryId : null, categorySuggested: !!rule,
    supplier: cp.name, counterpartyVatId: cp.vatId || null, docNo: inv.docNo, note: inv.note || '',
    documentation: 'invoice', countryCode: countryCodeFromName(cc) || cc,
    vat: { treatment, rateBp, deductiblePct: 100 }, currency: inv.currency, entered: 'gross', minor: inv.gross, netMinor: inv.net, vatMinor: inv.vat,
    payment: 'bank', status: 'pending', source: 'import', importKind: 'efactura',
    lines: inv.lines, breakdown: inv.breakdown, flags,
    dupKey: einvoiceKey(cp.vatId, cp.name, inv.docNo), importKey: detId('efa', einvoiceKey(cp.vatId, cp.name, inv.docNo)),
    possibleDuplicate: false, include: true,
  };
}

/**
 * Dubluri după CUI/nume furnizor + nr. factură, față de intrările existente și în interiorul lotului.
 * @returns {{ add:object[], duplicates:Array<{draft:object, reason:'existent'|'în lot'}> }}
 */
export function planEinvoiceImport(drafts, existingEntries = []) {
  const keys = new Set();
  for (const e of existingEntries) {
    if (e.deletedAt || !e.docNo) continue;
    keys.add(einvoiceKey(e.counterpartyVatId, e.supplier, e.docNo));
  }
  const batch = new Set();
  const add = [], duplicates = [];
  for (const d of drafts) {
    if (keys.has(d.dupKey)) duplicates.push({ draft: { ...d, possibleDuplicate: true, include: false }, reason: 'existent' });
    else if (batch.has(d.dupKey)) duplicates.push({ draft: { ...d, possibleDuplicate: true, include: false }, reason: 'în lot' });
    else { batch.add(d.dupKey); add.push(d); }
  }
  return { add, duplicates };
}

/** Regula „furnizor -> categorie” (colecția `supplierRules`), învățată din confirmări. Nu modifică lista primită. */
export function learnSupplierRule(rules, { vatId, name }, categoryId, nowIso) {
  const key = supplierKey(vatId, name);
  const id = detId('sr', key);
  const prev = (rules || []).find((r) => r.id === id && !r.deletedAt);
  const count = prev && prev.categoryId === categoryId ? (prev.count || 1) + 1 : 1;
  return { id, supplierKey: key, supplierName: name || prev?.supplierName || '', categoryId, count, createdAt: prev?.createdAt || nowIso, updatedAt: nowIso };
}
export function suggestCategory(rules, vatId, name) {
  const key = supplierKey(vatId, name);
  const r = (rules || []).find((x) => !x.deletedAt && x.supplierKey === key) || (vatId ? (rules || []).find((x) => !x.deletedAt && x.supplierKey === `nume:${foldKey(name)}`) : null);
  return r || null;
}
