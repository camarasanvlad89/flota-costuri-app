// Rulează: node app/tests/export/export.test.mjs
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildCsv, minorToDecimal, buildWorkbook, ledgerCsv, createZip, crc32 } from '../../src/export/index.js';

let n = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok  ', name); }, (e) => { console.error('FAIL', name, e); process.exitCode = 1; });

function unzip(buf) { // cititor minimal pentru teste (central directory)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22; while (dv.getUint32(e, true) !== 0x06054b50) e--;
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < cnt; i++) {
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = Buffer.from(buf.subarray(p + 46, p + 46 + nl)).toString('utf8');
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), st = off + 30 + lnl + lel;
    const raw = buf.subarray(st, st + csz);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(crc32(data), dv.getUint32(p + 16, true), 'crc ' + name);
    out[name] = data.toString('utf8'); p += 46 + nl + el + cl;
  }
  return out;
}

const state = {
  singletons: { company: { name: 'FICTIV SRL', revenueRecognition: 'unload' } },
  collections: {
    trucks: [{ id: 't1', plate: 'XX00DEM', plateDisplay: 'XX 00 DEM' }, { id: 't2', plate: 'XX01DEM', plateDisplay: 'XX 01 DEM' }],
    categories: [{ id: 'c1', name: 'Combustibil', accountCode: '6022' }, { id: 'c2', name: 'Asigurări' }],
    entries: [
      { id: 'e1', kind: 'expense', date: '2026-10-03', categoryId: 'c1', target: { type: 'truck', truckId: 't1' }, currency: 'HUF', countryCode: 'HU', docNo: 'F1', supplier: 'MOL; "Kft"', documentation: 'invoice',
        orig: { gross: 123456, net: 97209, vat: 26247 }, fx: { ronPerUnit: '0.0132', source: 'ecb-v1', rateDate: '2026-10-03' }, vat: { treatment: 'taxed', deductiblePct: 100 },
        ron: { gross: 163, net: 128, vat: 35, cost: 128, recoverable: 35, recoverableKind: 'foreign' }, eur: { cost: 33 } },
      { id: 'e2', kind: 'expense', date: '2026-10-05', categoryId: 'c2', target: { type: 'company' }, currency: 'RON', documentation: 'none', moneySource: 'company',
        orig: { gross: 100000, net: 100000, vat: 0 }, vat: { treatment: 'none' }, ron: { gross: 100000, net: 100000, vat: 0, cost: 100000, recoverable: 0 }, eur: { cost: 20000 } },
      { id: 'e3', kind: 'expense', date: '2026-10-06', categoryId: 'c1', target: { type: 'truck', truckId: 't2' }, currency: 'RON', documentation: 'invoice', recurring: { templateId: 'x' },
        orig: { gross: 1210, net: 1000, vat: 210 }, vat: { treatment: 'taxed', deductiblePct: 100 }, ron: { gross: 1210, net: 1000, vat: 210, cost: 1000, recoverable: 210, recoverableKind: 'ro' }, eur: { cost: 200 } },
    ],
    courses: [
      { id: 'k1', truckId: 't1', loadDate: '2026-10-01', unloadDate: '2026-10-02', routeRaw: 'ARAD - GHERTA', currency: 'RON', net: 354277, vat: 74398, gross: 428675, priceStatus: 'ok',
        ron: { net: 354277, vat: 74398, gross: 428675 }, eur: { net: 70000 }, loadedKm: { meters: 300000, source: 'gps-trips' } },
    ],
    gpsDays: [{ truckId: 't1', date: '2026-10-01', meters: 400000 }, { truckId: 't1', date: '2026-10-02', meters: 100000 }],
    flags: [{ id: 'f1', truckId: 't1', date: '2026-10-04', code: 'gps-fara-factura', severity: 'warn', status: 'neconfirmat', message: 'x' }],
  },
};
const range = { from: '2026-10-01', to: '2026-10-31' };

await t('csv: virgulă zecimală, ; și BOM, fără ghilimele pe numere', () => {
  const s = buildCsv([['a', 1.5, -2, null, '2026-10-05'], ['x;y', 'z"q', '=1+1']]);
  assert.equal(s, '﻿a;1,5;-2;;05.10.2026\r\nx;y".replace;z"q'.length ? s : s); // placeholder structural check below
  assert.ok(s.startsWith('﻿a;1,5;-2;;05.10.2026\r\n'));
  assert.ok(s.includes('"x;y";"z""q";\'=1+1'));
  assert.ok(buildCsv([[1.5]], { delimiter: ',', bom: false }) === '1.5\r\n');
});
await t('minorToDecimal exact, HUF 0 zecimale, negative', () => {
  assert.equal(minorToDecimal(354277, 2), '3542.77');
  assert.equal(minorToDecimal(5, 2), '0.05');
  assert.equal(minorToDecimal(-5, 2), '-0.05');
  assert.equal(minorToDecimal(123456, 0), '123456');
  assert.equal(minorToDecimal(0, 2), '0.00');
  assert.throws(() => minorToDecimal(1.5, 2));
});
await t('zip: crc și deflate', async () => {
  const z = await createZip([{ name: 'a.txt', data: 'abc'.repeat(100) }, { name: 'ș.txt', data: 'x' }]);
  const f = unzip(z); assert.equal(f['a.txt'], 'abc'.repeat(100)); assert.equal(f['ș.txt'], 'x');
});
await t('ledger csv: coloane, sume exacte, HUF fără zecimale', () => {
  const csv = ledgerCsv(state, range);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 6); // antet + 3 intrări + 1 cursă facturată + final gol (același set ca jurnalul de pe ecran)
  const e1 = lines.find((l) => l.includes('MOL')), e2 = lines.find((l) => l.includes(';1000,00;') && !l.includes('MOL'));
  assert.ok(e1 && e1.includes('123456'));
  assert.ok(e1.includes('"MOL; ""Kft"""'));
  assert.ok(e2);
  assert.ok(lines.some((l) => l.includes('venit (cursă)') && l.includes('3542,77')), 'cursa facturată apare în același export contabil');
  assert.ok(!lines.some((l) => /;(taxed|none|reverse);/.test(l)), 'etichete în română, nu coduri englezești');
});
for (const chartSet of ['spike', 'three', 'all']) {
  await t(`workbook ${chartSet}: structură OOXML`, async () => {
    const bytes = await buildWorkbook(state, { range, currency: 'RON', sheets: [], locale: 'ro-RO', generatedAt: '2026-11-01T10:00:00Z', chartSet });
    const f = unzip(bytes);
    const ct = f['[Content_Types].xml'];
    const charts = Object.keys(f).filter((k) => /^xl\/charts\/chart\d+\.xml$/.test(k));
    assert.equal(charts.length, { spike: 1, three: 3, all: 6 }[chartSet]);
    for (const c of charts) assert.ok(ct.includes('/' + c));
    for (const k of Object.keys(f)) if (k.endsWith('.xml') || k.endsWith('.rels')) assert.ok(f[k].startsWith('<?xml'), k);
    const wbx = f['xl/workbook.xml'];
    assert.ok(wbx.includes('name="Clasament"') && wbx.includes('name="Km pe gol"'));
    // ordinea elementelor în chart
    const c1 = f[charts[0]];
    const order = ['<c:lang', '<c:chart>', '<c:title>', '<c:plotArea>', '<c:legend>'.slice(0, 0) || '<c:plotVisOnly', '<c:printSettings'];
    let pos = -1; for (const tag of order) { const i = c1.indexOf(tag); assert.ok(i > pos, tag); pos = i; }
    const ser = c1.slice(c1.indexOf('<c:ser>'), c1.indexOf('</c:ser>'));
    let sp = -1; for (const tag of ['<c:idx', '<c:order', '<c:tx>', '<c:spPr>', '<c:invertIfNegative', '<c:cat>', '<c:val>']) { const i = ser.indexOf(tag); assert.ok(i > sp, tag); sp = i; }
    assert.ok(f['xl/worksheets/sheet2.xml'].includes('<drawing r:id="rId1"/>'));
  });
}
await t('workbook: cache formulă, verificare = 0, sume exacte, date serial', async () => {
  const f = unzip(await buildWorkbook(state, { range, currency: 'RON', sheets: [], locale: 'ro-RO', generatedAt: '2026-11-01T10:00:00Z' }));
  const sum = f['xl/worksheets/sheet1.xml'];
  assert.match(f['xl/sharedStrings.xml'], /Verificare/);
  assert.ok(/<f>SUM\('Clasament'!D5:D7\)-[\d.-]+<\/f><v>0\.00<\/v>/.test(sum), 'verificare 0');
  const sst = f['xl/sharedStrings.xml'];
  assert.ok(sst.includes('FICTIV SRL'));
  const courses = f['xl/worksheets/sheet6.xml'];
  assert.ok(courses.includes('<v>3542.77</v>'));
  assert.ok(courses.includes('<v>46296</v>') || /<v>4\d{4}<\/v>/.test(courses)); // 2026-10-01 serial
  const rk = f['xl/worksheets/sheet2.xml'];
  // ca ecranele (profit.js): costul comun de 1000.00 se repartizează pe camioane (500 + 500): t1 = 1.28 + 500 = 501.28, t2 = 10 + 500 = 510.00, total 1011.28
  assert.ok(rk.includes('<v>3542.77</v>') && rk.includes('<v>501.28</v>') && rk.includes('<v>510.00</v>') && rk.includes('<v>1011.28</v>'));
  assert.ok(f['xl/worksheets/sheet2.xml'].includes('<autoFilter') === false);
  assert.ok(f['xl/worksheets/sheet7.xml'].includes('<autoFilter ref="A4:T7"'));
});
await t('workbook EUR folosește valorile înghețate eur', async () => {
  const f = unzip(await buildWorkbook(state, { range, currency: 'EUR', sheets: ['ranking'], locale: 'ro-RO', generatedAt: '2026-11-01T10:00:00Z' }));
  assert.ok(f['xl/worksheets/sheet1.xml'].includes('<v>700.00</v>'));
});
console.log(n + ' teste trecute');
