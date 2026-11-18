import test from 'node:test';
import assert from 'node:assert/strict';
import { HAS_XLSX, XLSX, HEADER } from './helpers.mjs';
import { readCsv, decodeText } from '../csv.js';
import { readWorkbook } from '../xlsx-reader.js';
import { detectCourseMapping } from '../mapping.js';
import { parseCourseRows, planCourseImport } from '../courses-importer.js';
import { detectExpenseMapping, parseExpenseCsv, planExpenseImport, classifyStatementLine, suggestParentInvoice, EXPENSE_PRESETS } from '../expenses-importer.js';
import { parseEinvoiceXml, einvoiceToDraft, planEinvoiceImport, learnSupplierRule, suggestCategory, vatIdKey } from '../einvoice.js';

const opts = { skip: !HAS_XLSX && 'SheetJS lipsește' };

test('csv: delimitator, ghilimele, BOM, diacritice', () => {
  const r = readCsv('﻿Data;Furnizor;Suma\r\n01.10.2025;"Stație; Arad";"1.234,56"\r\n');
  assert.equal(r.delimiter, ';');
  assert.deepEqual(r.rows[1], ['01.10.2025', 'Stație; Arad', '1.234,56']);
  assert.equal(readCsv('a,b\n1,"x""y"').rows[1][1], 'x"y');
  const win = new Uint8Array([0x53, 0x74, 0x61, 0xfe, 0x69, 0x65]); // 'Staţie' în Windows-1250 (ţ = 0xFE)
  assert.match(decodeText(win), /^Sta.ie$/);
  assert.equal(decodeText(new TextEncoder().encode('Orașu')), 'Orașu');
});

test('xlsx: registru multi-foaie, import direct, 3000 rânduri rapid, reimport idempotent', opts, async () => {
  const rows = [[null, ...HEADER]];
  for (let i = 0; i < 3000; i++) {
    const d = new Date(Date.UTC(2025, 0, 1 + (i % 300)));
    const dd = `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
    rows.push([null, dd, dd, 'XX00DEM/XX30DEM', 'DORIAN', `ARAD - PLACE${i}`, 1000 + i, 210 + i * 0.21, null, null]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'XX00DEM 2025');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Munka1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const t0 = Date.now();
  const w = await readWorkbook(buf.buffer ? buf : new Uint8Array(buf));
  assert.deepEqual(w.sheets.map((s) => [s.name, s.plate, s.year, s.defaultSelected]), [['XX00DEM 2025', 'XX00DEM', 2025, true], ['Munka1', null, null, false]]);
  const sh = w.sheets[0];
  const det = detectCourseMapping(sh.rows);
  assert.equal(det.headerRow, 0);
  const { drafts } = parseCourseRows(sh.rows, det.mapping, { plate: sh.plate, year: sh.year });
  assert.equal(drafts.length, 3000);
  assert.ok(Date.now() - t0 < 3000);
  const plan = planCourseImport(drafts, drafts);
  assert.equal(plan.add.length, 0); assert.equal(plan.unchanged.length, 3000);
});

test('xlsx: date reale Excel (serial) și numere ca text', opts, async () => {
  const hdr = [null, ...HEADER];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([hdr, [null, 45889, 45891, 'XX00DEM', 'ANDOR', 'A - B', '1.400,50', '294,10', '1.694,60', null, null]]);
  XLSX.utils.book_append_sheet(wb, ws, 'XX00DEM');
  const w = await readWorkbook(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
  const s = w.sheets[0];
  const { drafts } = parseCourseRows(s.rows, detectCourseMapping(s.rows).mapping, { plate: 'XX00DEM' });
  assert.equal(drafts[0].loadDate, '2025-08-20');
  assert.deepEqual([drafts[0].net, drafts[0].vat, drafts[0].gross], [140050, 29410, 169460]);
});

test('extras card: mapper generic, dubluri, repetări, presetări goale', () => {
  const rows = [['Extras'], ['Data tranzacției', 'Stație', 'Produs', 'Nr. înmatriculare', 'Valoare', 'Moneda', 'Țara', 'Cantitate'],
    ['01.10.2025', 'Stație Arad', 'Motorină', 'XX 00 DEM', '1.234,56', 'RON', 'RO', '210,5'],
    ['01.10.2025', 'Stație Arad', 'Motorină', 'XX 00 DEM', '1.234,56', 'RON', 'RO', '210,5'],
    ['02.10.2025', 'HU-GO', 'Taxa drum HU-GO', 'XX00DEM', '45000', 'HUF', 'HU', ''],
    ['x', 'y', 'z', '', '5', '', '', '']];
  const det = detectExpenseMapping(rows);
  assert.equal(det.mapping.headerRow, 1);
  assert.deepEqual(Object.keys(det.mapping.cols).sort(), ['amount', 'category', 'country', 'currency', 'date', 'liters', 'plate', 'supplier']);
  assert.deepEqual(EXPENSE_PRESETS, {});
  const { drafts, issues } = parseExpenseCsv(rows, det.mapping, { provider: 'TEST', payment: 'fuelcard' });
  assert.equal(drafts.length, 3);
  assert.equal(drafts[0].minor, 123456); assert.equal(drafts[0].plate, 'XX00DEM'); assert.equal(drafts[0].lineKind, 'fuel');
  assert.equal(drafts[2].currency, 'HUF'); assert.equal(drafts[2].minor, 45000); assert.equal(drafts[2].lineKind, 'toll'); assert.equal(drafts[2].countryCode, 'HU');
  assert.equal(drafts[0].fuel.ml, 210500);
  assert.ok(issues.some((i) => i.code === 'bad_date'));
  assert.ok(issues.some((i) => i.code === 'repeat_in_file'));
  assert.notEqual(drafts[0].importKey, drafts[1].importKey);
  const trucks = [{ id: 'trk_1', plate: 'XX00DEM' }];
  let plan = planExpenseImport(drafts, [], trucks);
  assert.equal(plan.add.length, 3);
  const existing = plan.add.map((d) => ({ kind: 'expense', date: d.date, currency: d.currency, orig: { gross: d.minor }, supplier: d.supplier, docNo: d.docNo, target: { truckId: d.truckId } }));
  plan = planExpenseImport(drafts, existing, trucks);
  assert.equal(plan.add.length, 0); assert.equal(plan.duplicates.length, 3);
  assert.ok(plan.duplicates.every((d) => d.include === false && d.possibleDuplicate));
  // doar unul existent din două identice: primul dublură, al doilea nou
  plan = planExpenseImport(drafts.slice(0, 2), existing.slice(0, 1), trucks);
  assert.equal(plan.add.length, 1); assert.equal(plan.duplicates.length, 1);
  assert.equal(classifyStatementLine('ADBLUE'), 'fuel');
  const inv = { kind: 'expense', documentation: 'invoice', supplier: 'Stație Arad SRL', date: '2025-10-05', docNo: 'F1', currency: 'RON', orig: { gross: 500000 } };
  assert.equal(suggestParentInvoice(drafts[0], [inv]).length, 1);
});

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
 <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
 <cbc:ID>ABC 123</cbc:ID><cbc:IssueDate>2025-09-30</cbc:IssueDate><cbc:DueDate>2025-10-30</cbc:DueDate>
 <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:Note>Combustibil &amp; AdBlue</cbc:Note><cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
 <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>PETROM SRL</cbc:Name></cac:PartyName>
  <cac:PostalAddress><cbc:CityName>Arad</cbc:CityName><cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
  <cac:PartyTaxScheme><cbc:CompanyID>RO 1590082</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>OMV PETROM MARKETING SRL</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
 <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>RO12345678</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>TRANS DEMO SRL</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
 <cac:TaxTotal><cbc:TaxAmount currencyID="RON">210.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">1000.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">210.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
 <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="RON">1000.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="RON">1000.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="RON">1210.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="RON">1210.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
 <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="LTR">180</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="RON">1000.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Motorină</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item></cac:InvoiceLine>
</Invoice>`;

test('e-Factura UBL: parsare, direcție, dubluri, reguli furnizor', () => {
  const r = parseEinvoiceXml(UBL);
  assert.ok(r.ok, r.error);
  const inv = r.invoice;
  assert.deepEqual([inv.docNo, inv.issueDate, inv.net, inv.vat, inv.gross, inv.currency], ['ABC 123', '2025-09-30', 100000, 21000, 121000, 'RON']);
  assert.equal(inv.supplier.name, 'OMV PETROM MARKETING SRL'); assert.equal(inv.note, 'Combustibil & AdBlue');
  assert.equal(inv.lines.length, 1); assert.equal(inv.cius, true);
  let d = einvoiceToDraft(inv, { company: { cui: 'RO 12345678' } });
  assert.equal(d.kind, 'expense'); assert.equal(d.minor, 121000); assert.deepEqual([d.vat.treatment, d.vat.rateBp], ['taxed', 2100]);
  assert.equal(d.counterpartyVatId, 'RO 1590082');
  d = einvoiceToDraft(inv, { company: { cui: '1590082' } });
  assert.equal(d.kind, 'income');
  const rule = learnSupplierRule([], { vatId: 'RO1590082', name: 'x' }, 'cat_fuel', '2026-01-01T00:00:00Z');
  assert.equal(suggestCategory([rule], 'RO 1590082', 'altceva').categoryId, 'cat_fuel');
  const d2 = einvoiceToDraft(inv, { company: { cui: '12345678' }, supplierRules: [rule] });
  assert.equal(d2.categoryId, 'cat_fuel');
  const plan = planEinvoiceImport([d2, d2], []);
  assert.equal(plan.add.length, 1); assert.equal(plan.duplicates[0].reason, 'în lot');
  const ex = [{ docNo: 'ABC 123', counterpartyVatId: 'RO1590082', supplier: 'Petrom' }];
  assert.equal(planEinvoiceImport([d2], ex).duplicates[0].reason, 'existent');
  assert.equal(vatIdKey('RO 1590082'), '1590082');
});

test('e-Factura: credit note negativ, AE reverse, XML invalid', () => {
  const cn = UBL.replace('<Invoice ', '<CreditNote ').replace('</Invoice>', '</CreditNote>').replace(/InvoiceLine/g, 'CreditNoteLine').replace(/InvoicedQuantity/g, 'CreditedQuantity');
  const r = parseEinvoiceXml(cn);
  assert.ok(r.ok); assert.equal(r.invoice.gross, -121000);
  const ae = UBL.replace('<cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:TaxCategory>', '<cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent></cac:TaxCategory>');
  assert.equal(einvoiceToDraft(parseEinvoiceXml(ae).invoice, { company: { cui: '12345678' } }).vat.treatment, 'reverse');
  assert.equal(parseEinvoiceXml('<a><b></a>').ok, false);
  assert.equal(parseEinvoiceXml('<Foo/>').ok, false);
  assert.equal(parseEinvoiceXml('<!DOCTYPE x [<!ENTITY a "b">]><Invoice/>').ok, false);
});
