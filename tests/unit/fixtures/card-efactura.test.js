// Funcțiile C (extras card) și E (e-Factura) pe fixture-urile FICTIV generice (formate INVENTATE, nu ale unui furnizor real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFixtureBytes } from '../../helpers/fixtures.js';
import { readCsv, decodeText, detectExpenseMapping, parseExpenseCsv, planExpenseImport, parseEinvoiceXml, einvoiceToDraft, planEinvoiceImport } from '../../../src/import/index.js';

const buf = (...p) => { const b = readFixtureBytes(...p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('extras card generic (FICTIV): mapare detectată, 5 tranzacții, dublura exactă semnalată, reimport = 0 noi', () => {
  const csv = readCsv(decodeText(buf('xlsx', 'extras-card-generic-FICTIV.csv')));
  assert.equal(csv.delimiter, ';');
  const det = detectExpenseMapping(csv.rows);
  assert.ok(det.mapping.cols.date === 0 && det.mapping.cols.amount === 6 && det.mapping.cols.currency === 7, 'maparea se detectează după antet');
  const p = parseExpenseCsv(csv.rows, det.mapping, {});
  assert.equal(p.drafts.length, 5, 'cinci tranzacții în fișier (inclusiv dublura exactă)');
  assert.deepEqual(p.issues.filter((i) => i.severity === 'error'), [], 'fără erori (HUF fără zecimale)');
  assert.ok(p.issues.some((i) => i.code === 'repeat_in_file'), 'rândul identic din fișier (taxa HU-GO de două ori) e semnalat');
  assert.deepEqual(p.drafts.filter((d) => d.lineKind === 'toll').map((d) => d.countryCode), ['HU', 'HU']);
  const trucks = [{ id: 'trk_cj', plate: 'XX00DEM' }];
  const plan = planExpenseImport(p.drafts, [], trucks);
  assert.equal(plan.add.length, 5);
  const stored = plan.add.map((d) => ({ kind: 'expense', date: d.date, currency: d.currency, orig: { gross: d.minor }, target: { truckId: d.truckId }, supplier: d.supplier, docNo: d.docNo }));
  const again = planExpenseImport(p.drafts, stored, trucks);
  assert.equal(again.add.length, 0, 'reimport = 0 noi');
  assert.equal(again.duplicates.length, 5, 'toate cele 5 rânduri sunt „posibilă dublură”');
});

test('e-Factura UBL (FICTIV): factură de furnizor ⇒ cheltuială; aceeași factură de două ori ⇒ o singură intrare', () => {
  const xml = new TextDecoder().decode(buf('xlsx', 'efactura-FICTIV.xml'));
  const r = parseEinvoiceXml(xml);
  assert.equal(r.ok, true);
  const inv = r.invoice;
  assert.equal(inv.docNo, 'FICTIV-2026-000123');
  assert.deepEqual([inv.net, inv.vat, inv.gross], [110000, 23100, 133100]);
  assert.equal(inv.supplier.vatId, 'RO12345674');
  const draft = einvoiceToDraft(inv, { direction: 'supplier' });
  assert.ok(draft, 'ciornă de cheltuială');
  const first = planEinvoiceImport([draft], []);
  assert.equal(first.add.length, 1);
  const second = planEinvoiceImport([draft, draft], first.add.map((d) => ({ ...d })));
  assert.equal(second.add.length, 0, 'dublura după nr. factură + furnizor nu se mai adaugă');
});
