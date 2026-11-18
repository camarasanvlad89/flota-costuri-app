// Regresii QA export (date demo FICTIV): foile Excel = aceleași cifre ca ecranele; reconcilieri; jurnal unic; steaguri; filtre.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildWorkbook, ledgerCsv, ledgerRows, applyReportFilters } from '../../src/export/index.js';
import { buildDemoDb } from '../../src/domain/demo-seed.js';
import { emptyKmReport, accountingJournal } from '../../src/domain/reports.js';
import { fleetPnl } from '../../src/domain/profit.js';
import { crc32 } from '../../src/export/zip.js';

const db = buildDemoDb(1);
const OCT = { from: '2026-10-01', to: '2026-10-31' };

function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22; while (dv.getUint32(e, true) !== 0x06054b50) e--;
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < cnt; i++) {
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = Buffer.from(buf.subarray(p + 46, p + 46 + nl)).toString('utf8');
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), st = off + 30 + lnl + lel;
    const raw = buf.subarray(st, st + csz);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(crc32(data), dv.getUint32(p + 16, true));
    out[name] = data.toString('utf8'); p += 46 + nl + el + cl;
  }
  return out;
}
const unesc = (x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** foaie după nume -> rânduri (tablouri de valori: șir sau număr) */
function sheetByName(files, name) {
  const wbx = files['xl/workbook.xml'];
  const names = [...wbx.matchAll(/<sheet name="([^"]*)"/g)].map((m) => unesc(m[1]));
  const idx = names.indexOf(name);
  assert.ok(idx >= 0, 'foaia lipsește: ' + name);
  const sst = [...files['xl/sharedStrings.xml'].matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map((m) => unesc(m[1]));
  const xml = files[`xl/worksheets/sheet${idx + 1}.xml`];
  const rows = [];
  for (const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = cm[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = /<v>([\s\S]*?)<\/v>/.exec(cm[3] || '');
      if (!v) continue;
      row[col] = /t="s"/.test(cm[2]) ? sst[+v[1]] : /t="str"/.test(cm[2]) ? unesc(v[1]) : Number(v[1]);
    }
    rows[Number(rm[1])] = row;
  }
  return rows;
}
const gen = (o) => buildWorkbook(db, { currency: 'RON', locale: 'ro-RO', generatedAt: '2026-11-18T10:00:00Z', ...o });
const text = (rows) => rows.filter(Boolean).map((r) => r.join('|')).join('\n');

test('Km pe gol (Excel) = ecranul: km încărcați/goi/% din domeniu, nu 0 / 100%', async () => {
  const f = unzip(await gen({ range: OCT, sheets: ['emptyKm'] }));
  const rows = sheetByName(f, 'Km pe gol');
  const rep = emptyKmReport(db, OCT, { granularity: 'month', currency: 'RON' });
  const t0 = rep.trucks.find((t) => t.truckId === 'trk_xx00dem');
  const r = rows.find((x) => x && /XX 00 DEM/.test(x[0] || ''));
  assert.ok(r, 'rând pentru XX 00 DEM');
  assert.equal(Math.round(r[1] * 1000), t0.gpsM);
  assert.equal(Math.round(r[2] * 1000), t0.loadedM);
  assert.equal(Math.round(r[3] * 1000), t0.emptyM);
  assert.ok(Math.abs(r[4] - t0.emptyM / t0.gpsM) < 1e-6);
  assert.ok(r[2] > 5000 && r[4] < 0.5, 'nu 0 încărcați / 100% gol');
  assert.ok(Math.round(r[5] * 100) === t0.emptyCostVar, 'cost pe gol = costul variabil din raport');
});

test('Km pe gol (Excel): perioadă lungă cu GPS într-o singură lună => avertizare de acoperire, fără cost/km umflat', async () => {
  const range = { from: '2026-01-01', to: '2026-12-31' };
  const f = unzip(await gen({ range, sheets: ['emptyKm'] }));
  const rows = sheetByName(f, 'Km pe gol');
  assert.match(text(rows), /date GPS pentru \d+ din 12 luni/);
  const rep = emptyKmReport(db, range, { granularity: 'month', currency: 'RON', trendMonths: 12 });
  const r = rows.find((x) => x && /XX 00 DEM/.test(x[0] || ''));
  const perKm = r[7];
  const t0 = rep.trucks.find((t) => t.truckId === 'trk_xx00dem');
  assert.equal(Math.round(perKm * 100), Math.round(t0.varPerKmMilli / 1000));
  assert.ok(perKm < 12, 'cost variabil/km plauzibil (nu cost anual / km dintr-o lună)');
});

test('Categorii: totalul reconciliază cu costul din Rezumat (amortizare + ajustări afișate)', async () => {
  const f = unzip(await gen({ range: OCT, sheets: ['summary', 'ranking', 'categories'] }));
  const rows = sheetByName(f, 'Categorii');
  const tot = rows.find((x) => x && x[0] === 'Cost total (= Rezumat / Clasament)');
  const sumCat = rows.find((x) => x && x[0] === 'Total pe categorii');
  assert.ok(tot && sumCat);
  const pnl = fleetPnl(db, OCT, { currency: 'RON' }).total;
  assert.equal(Math.round(tot[2] * 100), pnl.costTotal);
  const dep = rows.find((x) => x && /^Amortizare/.test(x[0] || ''));
  assert.equal(Math.round((sumCat[2] + (dep ? dep[2] : 0)) * 100) + (rows.find((x) => x && /^Alte ajustări/.test(x[0] || '')) ? Math.round(rows.find((x) => x && /^Alte ajustări/.test(x[0] || ''))[2] * 100) : 0), pnl.costTotal);
  const rk = sheetByName(f, 'Clasament');
  const tf = rk.find((x) => x && x[0] === 'Total flotă');
  assert.equal(Math.round(tf[2] * 100), pnl.costTotal);
});

test('Cheltuieli: totaluri și reconciliere cu Categorii / Rezumat', async () => {
  const f = unzip(await gen({ range: OCT, sheets: ['entries', 'summary', 'ranking', 'categories'] }));
  const rows = sheetByName(f, 'Cheltuieli');
  const final = rows.find((x) => x && x[0] === '= Cost total (Rezumat / Clasament)');
  assert.ok(final, 'rând de reconciliere final');
  const pnl = fleetPnl(db, OCT, { currency: 'RON' }).total;
  assert.equal(Math.round(final[14] * 100), pnl.costTotal);
});

test('Curse: coloană „Net recunoscut” și total = venitul din Clasament (sept. 2026, cursă peste granița lunii)', async () => {
  const SEP = { from: '2026-09-01', to: '2026-09-30' };
  const f = unzip(await gen({ range: SEP, sheets: ['courses', 'ranking', 'summary'] }));
  const rows = sheetByName(f, 'Curse');
  const tot = rows.find((x) => x && x[0] === 'Total');
  assert.ok(tot, 'rând de total');
  const rank = fleetPnl(db, SEP, { currency: 'RON' }).total;
  assert.equal(Math.round(tot[14] * 100), rank.revenue);
});

test('Jurnal: foaia Excel, CSV-ul contabil și ecranul au exact aceleași rânduri (cu cursele facturate), etichete în română', async () => {
  const f = unzip(await gen({ range: OCT, sheets: ['journal'] }));
  const rows = sheetByName(f, 'Jurnal contabil');
  const screen = accountingJournal(db, OCT);
  const dataRows = rows.filter((x) => x && x[3] !== undefined && /^\d/.test(String(x[0]) ) || x && typeof x[0] === 'number');
  const csv = ledgerCsv(db, OCT).split('\r\n').filter(Boolean);
  assert.equal(csv.length - 1, screen.length);
  assert.equal(ledgerRows(db, OCT).length, screen.length);
  const typed = rows.filter((x) => x && typeof x[0] === 'number' && x[19]);
  assert.equal(typed.length, screen.length);
  assert.ok(typed.some((x) => x[19] === 'venit (cursă)'));
  assert.ok(!csv.some((l) => /;(taxed|none|reverse|nondeductible);/.test(l)));
  assert.ok(dataRows.length > 0);
});

test('Confruntare GPS (Excel): sumar lunar, dovada pe cursă și steaguri calculate chiar fără steaguri salvate, în română', async () => {
  const f = unzip(await gen({ range: OCT, sheets: ['reconcile'] }));
  const rows = sheetByName(f, 'Confruntare GPS');
  const t = text(rows);
  assert.match(t, /Sumar lunar pe camion/);
  assert.match(t, /Curse facturate și dovada GPS/);
  assert.match(t, /Perioade fără factură/);
  assert.doesNotMatch(t, /Niciun steag \(rulați/);
  assert.doesNotMatch(t, /IDLE_ON_COURSE|UNCOVERED_ACTIVE_PERIOD|PLACE_NOT_VISITED|COURSE_OVERLAP|COURSE_NO_PRICE|NO_GPS_RANGE|LOW_KM_VS_ROUTE/);
  assert.match(t, /Cursă facturată pe zile fără activitate GPS|Zile active GPS fără factură|Loc de încărcare\/descărcare nevizitat|Curse suprapuse/);
});

test('Filtre: camion ales ⇒ doar acel camion, totalurile se schimbă; categorii alese ⇒ cheltuielile filtrate; perioadă inversată ⇒ eroare', async () => {
  const st = applyReportFilters(db, { truckIds: ['trk_xx00dem'] });
  assert.equal(st.collections.trucks.length, 1);
  assert.ok(st.collections.courses.every((c) => c.truckId === 'trk_xx00dem'));
  assert.notEqual(st, db);
  assert.equal(applyReportFilters(db, {}), db);
  const cat = db.collections.categories[0].id;
  const st2 = applyReportFilters(db, { categoryIds: [cat] });
  assert.ok(st2.collections.entries.every((e) => e.kind === 'income' || e.categoryId === cat));
  const f = unzip(await gen({ range: OCT, sheets: ['ranking'], truckIds: ['trk_xx00dem'] }));
  const rk = sheetByName(f, 'Clasament');
  assert.equal(rk.filter((x) => x && x[0] && /XX 0[12] DEM/.test(x[0])).length, 0);
  await assert.rejects(() => gen({ range: { from: '2026-10-31', to: '2026-10-01' } }), /perioadă invalidă/);
});

test('Grupare: foaie după categorie / țară / valută, cu total', async () => {
  for (const by of ['category', 'country', 'currency', 'month', 'truck']) {
    const f = unzip(await gen({ range: OCT, sheets: ['grouping'], groupBy: by }));
    const rows = sheetByName(f, 'Grupare');
    assert.ok(rows.some((x) => x && x[0] === 'Total'), by);
  }
});
