// Structura exportului Excel față de referința XlsxWriter (DEV-PLAN 9, faza 2). Excel „repară” la orice abatere de ordine din grafice;
// XML bine format și openpyxl nu o prind. Acest test NU înlocuiește deschiderea în Excel/LibreOffice (docs/RELEASE-CHECKLIST.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFixtureJson } from '../../helpers/fixtures.js';
import { unzip, parseXml, kindOf, orderViolations, walk } from '../../helpers/ooxml.js';
import { buildWorkbook } from '../../../src/export/index.js';
import { buildDemoDb } from '../../../src/domain/demo-seed.js';

const REF = readFixtureJson('xlsx-ref', 'structure.json');
const state = buildDemoDb(1);
const range = { from: '2026-06-01', to: '2026-10-31' };
const make = async (chartSet) => unzip(await buildWorkbook(state, { range, currency: 'RON', sheets: [], locale: 'ro-RO', generatedAt: '2026-11-18T10:00:00Z', chartSet }));

for (const [set, count] of [['spike', 1], ['three', 3]]) {
  test(`export (${set}): părți, tipuri de conținut, relații și ordinea elementelor din grafice = referința XlsxWriter`, async () => {
    const f = await make(set);
    const names = Object.keys(f);
    // 1. fiecare parte există în referință (orice parte în plus trebuie justificată), iar cele esențiale nu lipsesc
    for (const need of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/charts/chartN.xml', 'xl/drawings/drawingN.xml', 'xl/drawings/_rels/drawingN.xml.rels', 'xl/worksheets/_rels/sheetN.xml.rels']) {
      assert.ok(names.some((n) => kindOf(n) === need), 'lipsește partea ' + need);
    }
    for (const n of names) assert.ok(REF.parts.includes(kindOf(n)), `parte necunoscută față de referință: ${n}`);
    // 2. tipuri de conținut
    const ct = parseXml(f['[Content_Types].xml'].toString('utf8'));
    const over = Object.fromEntries(ct.children.filter((c) => c.name === 'Override').map((c) => [c.attrs.PartName, c.attrs.ContentType]));
    for (const n of names.filter((x) => /\.xml$/.test(x) && x !== '[Content_Types].xml' && !x.endsWith('.rels'))) {
      const k = kindOf('/' + n); const want = REF.contentTypeOverridesByKind[k];
      if (want) assert.equal(over['/' + n], want, `tip de conținut pentru ${n}`);
    }
    // 3. relații
    for (const n of names.filter((x) => x.endsWith('.rels') && REF.relationshipTypesByRels[kindOf(x)])) {
      const types = parseXml(f[n].toString('utf8')).children.map((c) => c.attrs.Type);
      for (const t of types) assert.ok(REF.relationshipTypesByRels[kindOf(n)].includes(t), `${n}: tip de relație necunoscut ${t}`);
    }
    // 4. grafice: număr, țintele relațiilor, ordinea elementelor
    const charts = names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
    assert.equal(charts.length, count);
    for (const c of charts) {
      const bad = orderViolations(parseXml(f[c].toString('utf8')), REF.chartChildOrder);
      assert.deepEqual(bad, [], `${c}: ordine de elemente diferită de referință ⇒ Excel poate cere „reparare”`);
    }
    // 5. toate fișierele XML sunt bine formate, cu declarație, iar șirurile sunt în sharedStrings (fără inlineStr)
    for (const n of names.filter((x) => /\.(xml|rels)$/.test(x))) {
      assert.ok(f[n].toString('utf8').startsWith('<?xml'), n + ' fără declarație XML');
      parseXml(f[n].toString('utf8'));
    }
    for (const n of names.filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x))) assert.ok(!/t="inlineStr"/.test(f[n].toString('utf8')), n + ': inlineStr amestecat cu sharedStrings');
    // 6. fiecare serie de grafic referă celule existente (foaie + interval)
    const wb = parseXml(f['xl/workbook.xml'].toString('utf8'));
    const sheetNames = [...walk(wb)].filter((x) => x.name === 'sheet').map((x) => x.attrs.name);
    for (const c of charts) for (const fnode of [...walk(parseXml(f[c].toString('utf8')))].filter((x) => x.name === 'c:f')) {
      const sheet = /^'?([^'!]+)'?!/.exec(fnode.text)?.[1];
      assert.ok(sheetNames.includes(sheet), `${c}: seria referă foaia inexistentă „${sheet}” (${fnode.text})`);
    }
  });
}

test('export: nu conține xl/tables în v1 (doar autoFilter) și nu are taine', async () => {
  const f = await make('three');
  assert.ok(!Object.keys(f).some((n) => n.startsWith('xl/tables/')));
  for (const n of Object.keys(f)) assert.ok(!/ya29\.|GOCSPX|client_secret/.test(f[n].toString('utf8')), 'taină în ' + n);
});
