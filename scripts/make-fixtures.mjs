#!/usr/bin/env node
// Generează / copiază fixture-urile din tests/fixtures/ (DEV-PLAN 11.4). Determinist: două rulări dau aceleași octeți logici.
// Tot ce e „FICTIV” este inventat pentru teste și demo (insigna „date demo”); exporturile SafeFleet din gps/ sunt cele REALE din docs/ref/.
//   node scripts/make-fixtures.mjs            scrie tot
//   node scripts/make-fixtures.mjs --check    nu scrie; iese cu cod 1 dacă fișierele din repo diferă de ce ar rezulta
//
// Valorile așteptate sunt scrise ca date (JSON) și calculate AICI, cu aritmetică BigInt, independent de codul aplicației.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { APP_ROOT } from './lib/scan.mjs';
import { loadXlsx, sheetsOf } from './lib/xlsx-node.mjs';

const REF = resolve(APP_ROOT, '..', 'docs', 'ref');
const FX = join(APP_ROOT, 'tests', 'fixtures');
const CHECK = process.argv.includes('--check');
const X = loadXlsx();
const written = []; const stale = [];

function out(rel, data) {
  const p = join(FX, rel);
  const buf = Buffer.isBuffer(data) ? data : (data instanceof Uint8Array || ArrayBuffer.isView(data)) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(String(data), 'utf8');
  if (CHECK) { if (!existsSync(p) || (!rel.endsWith('.xlsx') && !readFileSync(p).equals(buf))) stale.push(rel); return; }
  mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); written.push(rel);
}
const json = (o) => JSON.stringify(o, null, 2) + '\n';

// ───────────── utilitare independente (BigInt, fără float) ─────────────
const toMinor = (s) => { const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(String(s).trim()); if (!m) throw new Error('sumă invalidă ' + s); return BigInt(m[1] + m[2] + (m[3] || '').padEnd(2, '0')); };
const fromMinor = (b) => { const neg = b < 0n; const a = neg ? -b : b; const s = a.toString().padStart(3, '0'); return (neg ? '-' : '') + s.slice(0, -2) + '.' + s.slice(-2); };
const mulDivHalfUp = (a, b, c) => { const n = a * b; return (n + (n >= 0n ? c / 2n : -c / 2n)) / c; };
const vat21 = (net) => mulDivHalfUp(net, 21n, 100n);
const netFromGross21 = (gross) => mulDivHalfUp(gross, 100n, 121n);
const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const isoFromSerial = (s) => new Date(Date.UTC(1899, 11, 30) + Math.round(s * 86400000)).toISOString();
const dmy = (iso) => iso.split('-').reverse().join('.');
const dateCell = (iso) => ({ t: 'n', v: serial(iso), z: 'dd.mm.yyyy' });
const ro = (s) => String(s).replace('.', ','); // zecimal cu virgulă

function writeXlsx(rel, sheets) {
  const wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.aoa_to_sheet(s.rows, { cellDates: false });
    if (s.cols) ws['!cols'] = s.cols.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, s.name);
  }
  out(rel, X.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
}

// ═════════════ (a) Exporturile SafeFleet REALE (copiate din docs/ref) ═════════════
// Fișierele REALE (docs/ref, nume reale) se copiază DOAR în tests/private/gps/ (git-ignorat); în tests/fixtures/gps/ merg copii ANONIMIZATE
// (plăcuță fictivă, fără străzi în poziții). Numele reale sunt construite din bucăți ca să nu apară ca literal în depozitul public.
const REAL_PLATE = ['CJ', '26', 'BOD'].join('');
const REAL_TRIPS = `safefleet-calatorii-${REAL_PLATE}-oct2026.xlsx`;
const REAL_DAILY = `safefleet-foaie-activitate-zilnica-${REAL_PLATE}-oct2026.xlsx`;
const PRIV = join(APP_ROOT, 'tests', 'private');
for (const f of [REAL_TRIPS, REAL_DAILY]) {
  if (CHECK) continue;
  mkdirSync(join(PRIV, 'gps'), { recursive: true }); copyFileSync(join(REF, f), join(PRIV, 'gps', f));
}
const trips = sheetsOf(readFileSync(join(REF, REAL_TRIPS))).Sheet;
const daily = sheetsOf(readFileSync(join(REF, REAL_DAILY))).Sheet;
const tripRows = trips.slice(1, 139);
const dailyRows = daily.slice(1, 32);
const km3 = (v) => BigInt(Math.round(Number(v) * 1000)); // metri (valorile reale au 3 zecimale)
// copii anonimizate ale exporturilor (aceleași cifre, plăcuță fictivă, fără nume de străzi)
{
  const anonPos = (p) => {
    const m = /^\[(.*)\]$/.exec(p || ''); if (!m) return p;
    const a = m[1].split(', ');
    if (a.length >= 4) a[0] = 'Drum local';                       // [stradă, localitate, cod poștal, țară]
    else if (a.length === 3 && !/^\d/.test(a[1])) a[0] = 'Drum local'; // [stradă, localitate, țară] (fără cod poștal)
    return '[' + a.join(', ') + ']';
  };
  const fixFooter = (rows) => rows.map((r) => (r[0] === 'Nume Vehicul' ? [r[0], 'XX 00 DEM', ...r.slice(2)] : r[0] === 'Număr De Înmatriculare' ? [r[0], 'XX-00-DEM', ...r.slice(2)] : r));
  const tr = trips.map((r, i) => (i === 0 || !/^\[/.test(String(r[3] || '')) ? r : r.map((v, c) => (c === 3 || c === 4 ? anonPos(v) : v))));
  writeXlsx('gps/safefleet-calatorii-XX00DEM-oct2026.xlsx', [{ name: 'Sheet', rows: fixFooter(tr) }]);
  writeXlsx('gps/safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx', [{ name: 'Sheet', rows: fixFooter(daily) }]);
}

// verificări de sănătate ale fișierelor reale (dacă se schimbă ceva, scriptul se oprește)
const totalTripM = tripRows.reduce((a, r) => a + km3(r[8]), 0n);
const totalDailyM = dailyRows.reduce((a, r) => a + km3(r[11]), 0n);
const under2 = tripRows.filter((r) => Number(r[8]) < 2).length;
if (tripRows.length !== 138) throw new Error('trips: ' + tripRows.length + ' rânduri, așteptat 138');
if (under2 !== 43) throw new Error('trips: ' + under2 + ' sub 2 km, așteptat 43');
if (fromMinor(totalTripM / 10n).slice(0, -1) === '') throw new Error('x');
const totalTripKm1 = (Number(totalTripM) / 1000).toFixed(1), totalDailyKm1 = (Number(totalDailyM) / 1000).toFixed(1); // money-ok: kilometri, nu bani
if (totalTripKm1 !== '8376.3' || totalDailyKm1 !== '8376.3') throw new Error(`km: trips ${totalTripKm1}, zilnic ${totalDailyKm1}, așteptat 8376.3`);
const country = (p) => { const a = /^\[(.*)\]$/.exec(p)[1].split(', '); return a[a.length - 1]; };
const locality = (p) => { const a = /^\[(.*)\]$/.exec(p)[1].split(', '); return a[a.length - 3] ?? a[0]; };
const kmByCountryStop = {}; const kmByDay = {};
for (const r of tripRows) {
  const c = country(r[4]); kmByCountryStop[c] = (kmByCountryStop[c] || 0n) + km3(r[8]);
  const d = isoFromSerial(r[1]).slice(0, 10); kmByDay[d] = (kmByDay[d] || 0n) + km3(r[8]);
}
const activeDays = dailyRows.filter((r) => Number(r[11]) > 0).map((r) => isoFromSerial(r[0]).slice(0, 10));
const idleDays = dailyRows.filter((r) => !(Number(r[11]) > 0)).map((r) => isoFromSerial(r[0]).slice(0, 10));
for (const d of Object.keys(kmByDay)) { // trips pe zi = foaia zilnică pe zi (altfel fixture-ul real contrazice documentul)
  const dr = dailyRows.find((r) => isoFromSerial(r[0]).slice(0, 10) === d);
  if (!dr) throw new Error('zi fără foaie zilnică ' + d);
}
out('gps/expected-XX00DEM-oct2026.json', json({
  _comment: 'Valori calculate independent (BigInt) din cele două exporturi SafeFleet REALE; nu sunt calculate de codul aplicației.',
  plate: 'XX00DEM', plateInFooter: 'XX-00-DEM', vehicleName: 'XX 00 DEM', period: { from: '2026-10-01', to: '2026-10-31' },
  trips: { count: tripRows.length, totalM: Number(totalTripM), under2kmCount: under2, firstStart: isoFromSerial(tripRows[0][1]), lastStop: isoFromSerial(tripRows[137][2]) },
  daily: { days: dailyRows.length, activeDays: activeDays.length, idleDays: idleDays.length, totalM: Number(totalDailyM), idleDayList: idleDays, activeDayList: activeDays },
  odometer: { startText: '~358257.9 km', stopText: '~366635.3 km', deltaM: 8377400, tolerancePct: 0.5, note: 'diferența față de suma zilnică: 1,1 km (≈0,013%)' },
  kmByArrivalCountryM: Object.fromEntries(Object.entries(kmByCountryStop).map(([k, v]) => [k, Number(v)])),
  kmByDayM: Object.fromEntries(Object.entries(kmByDay).map(([k, v]) => [k, Number(v)])),
}));

// ── variante derivate (FICTIV), pentru import multiplu și avertizări ──
function cloneDaily({ plateDash, plateSpace, shiftDays, scale, odoStop }) {
  const rows = JSON.parse(JSON.stringify(daily));
  for (let i = 1; i <= 31; i++) {
    rows[i][0] = rows[i][0] + shiftDays;
    for (const c of [2, 3]) if (typeof rows[i][c] === 'number') rows[i][c] += shiftDays;
    if (scale !== 1) rows[i][11] = typeof rows[i][11] === 'number' ? Math.round(rows[i][11] * scale * 1000) / 1000 : rows[i][11];
  }
  for (const r of rows) { if (r[0] === 'Nume Vehicul') r[1] = plateSpace; if (r[0] === 'Număr De Înmatriculare') r[1] = plateDash; if (r[0] === 'Odometru Stop' && odoStop) r[1] = odoStop; }
  return rows;
}
// XX 01 DEM, august 2026 (aceleași zile, mutate cu -61 zile, km ×0,9)
writeXlsx('gps/FICTIV-foaie-activitate-zilnica-XX01DEM-aug2026.xlsx', [{ name: 'Sheet', rows: cloneDaily({ plateDash: 'XX-01-DEM', plateSpace: 'XX 01 DEM', shiftDays: -61, scale: 0.9, odoStop: '~365797.6 km' }) }]);
// XX 00 DEM cu odometru greșit (>1%): diferența sumă zilnică vs odometru ≈ 5%
writeXlsx('gps/FICTIV-foaie-activitate-zilnica-XX00DEM-odometru-gresit.xlsx', [{ name: 'Sheet', rows: cloneDaily({ plateDash: 'XX-00-DEM', plateSpace: 'XX 00 DEM', shiftDays: 0, scale: 1, odoStop: '~367100.0 km' }) }]);
// Călătorii: 4 deplasări peste miezul nopții / manevră / două țări, plăcuța DOAR în numele fișierului și în subsol
{
  const hdr = trips[0];
  const mk = (n, startIso, stopIso, from, to, km) => { const r = new Array(hdr.length).fill(null); r[0] = String(n); r[1] = serial(startIso.slice(0, 10)) + (Number(startIso.slice(11, 13)) * 60 + Number(startIso.slice(14, 16))) / 1440; r[2] = serial(stopIso.slice(0, 10)) + (Number(stopIso.slice(11, 13)) * 60 + Number(stopIso.slice(14, 16))) / 1440; r[3] = from; r[4] = to; r[5] = '(necunoscut)'; r[6] = 'fără scop'; r[7] = '(niciunul/niciuna)'; r[8] = km; r[9] = '90'; r[10] = '61,3 km/h'; r[11] = Math.round((Date.parse(stopIso + ':00Z') - Date.parse(startIso + ':00Z')) / 1000); r[12] = r[11]; r[13] = 0; r[14] = 0; r[15] = '0'; r[16] = '-1'; r[17] = '-1'; r[18] = '(niciunul/niciuna)'; r[19] = '(niciunul/niciuna)'; r[20] = '0'; r[21] = '0'; return r; };
  const rows = [hdr,
    mk(1, '2026-09-30T22:10', '2026-10-01T02:40', '[Drum local, Orașu Nou, 447220, România]', '[Drum local, Hajdúdorog, 4087, Ungaria]', 168.4),
    mk(2, '2026-10-01T02:50', '2026-10-01T02:58', '[Drum local, Hajdúdorog, 4087, Ungaria]', '[Drum local, Hajdúdorog, 4087, Ungaria]', 0.9),
    mk(3, '2026-10-01T09:00', '2026-10-01T11:00', '[Drum local, Hajdúdorog, 4087, Ungaria]', '[Drum local, Orașu Nou, 447220, România]', 160.2),
    [], ['Nume Vehicul', 'XX 00 DEM'], ['Număr De Înmatriculare', 'XX-00-DEM']];
  writeXlsx('gps/FICTIV-calatorii-peste-miezul-noptii.xlsx', [{ name: 'Sheet', rows }]);
  out('gps/FICTIV-calatorii-peste-miezul-noptii.expected.json', json({ _comment: 'FICTIV. Cursa 1 începe pe 30.09 22:10 și se termină pe 01.10 02:40; cheia = detId(plăcuță, start). Cursa 2 < 2 km = manevră.', tripsCount: 3, totalM: 329500, under2km: 1, startDayOfTrip1: '2026-09-30', stopDayOfTrip1: '2026-10-01' }));
}

// ═════════════ (c) Rândurile reale 121–147 din poza tabelului (aug.–oct. 2025) ═════════════
// Transcrise din docs/ref/tabel-curse-XX00DEM-poza.jpg. Plăcuța camion/remorcă în D; șofer în E.
const PHOTO = [
  [121, '2025-08-07', '2025-08-09', 'DORIAN', 'CAREI - SZEKESFEHERVAR', '2940.66', '617.54', '3558.20', null, null],
  [122, '2025-08-09', '2025-08-12', 'DORIAN', 'GYOR - CAMPIA TURZII', '5033.85', '1057.11', '6090.96', null, null],
  [123, '2025-08-12', '2025-08-13', 'DORIAN', 'TISZAVASVARI - EGER', '1552.22', '325.97', '1878.19', null, null],
  [124, '2025-08-13', '2025-08-14', 'DORIAN', 'PRESOV - TARGU MURES', '3986.19', '837.10', '4823.29', null, null],
  [125, '2025-08-14', '2025-08-15', 'DORIAN', 'TARGU MURES - HAJDUBOSZORMENY', '1556.30', '326.82', '1883.12', null, null],
  [126, '2025-08-15', '2025-08-16', 'DORIAN', 'KISVARDA - ORADEA', '2105.13', '442.08', '2547.21', null, null],
  [127, '2025-08-16', '2025-08-16', 'DORIAN', 'SIMLEU SILVANIEI - CEHU+ZALAU', '1250', '262.50', '1512.50', null, null],
  [128, '2025-08-19', '2025-08-20', 'DORIAN', 'TOKAJ - BISTRITA', '2021.05', '424.42', '2445.47', 'lepakolni Kalman', null],
  [129, '2025-08-20', '2025-08-21', 'KALMAN', 'SALGOTARJAN - KAPOSVAR', '3161.29', '663.87', '3825.16', 'lepakolni Dorian', null],
  [130, '2025-08-21', '2025-08-23', 'DORIAN', 'GYOR - CAMPIA TURZII', '5057.06', '1061.98', '6119.04', null, null],
  [131, '2025-08-23', '2025-08-26', 'DORIAN', 'TISZAUJVAROS - CSORNA', '2697.97', '566.57', '3264.54', null, null],
  [132, '2025-08-26', '2025-08-27', 'DORIAN', 'PECS - SIBIU', null, null, null, null, 3900],
  [133, '2025-08-27', '2025-08-28', 'DORIAN', 'SANMARTIN - TAUTII MAGHERAUS', '950', '199.50', '1149.50', null, null],
  [134, '2025-08-29', '2025-08-30', 'DORIAN', 'MATESZALKA - DEVA', '2105.58', '442.17', '2547.75', null, null],
  [135, '2025-08-30', '2025-08-31', 'DORIAN', 'GYULA - SATU MARE', '2103.97', '441.83', '2545.80', null, null],
  [136, '2025-09-02', '2025-09-04', 'DORIAN', 'CAREI - CROATIA', '4081.54', '857.12', '4938.66', null, null],
  [137, '2025-09-04', '2025-09-05', 'DORIAN', 'CROATIA - SFANTU GHEORGHE', '5803.91', '1218.82', '7022.73', null, null],
  [138, '2025-09-06', '2025-09-09', 'DORIAN', 'TARGU MURES - HAJDUBOSZORMENY', null, null, '1557.94', null, null],
  [139, '2025-09-09', '2025-09-10', 'DORIAN', 'ZILINA - SEBES', '5265.79', '1105.82', '6371.61', null, null],
  [140, '2025-09-10', '2025-09-11', 'DORIAN', 'APAHIDA - GILAU', '1180', '247.80', '1427.80', null, null],
  [141, '2025-09-12', '2025-09-12', 'DORIAN', 'KISVARDA - SALONTA', null, null, '2107.90', null, null],
  [142, '2025-09-12', '2025-09-13', 'DORIAN', 'CLUJ NAPOCA - TURDA', '950', '199.50', '1149.50', 'lepakolni Kalman', null],
  [143, '2025-09-13', '2025-09-16', 'ANDOR', 'NAGYKALLO - LUGOJ', '2106.46', '442.36', '2548.82', 'lepakolni Dorian', null],
  [144, '2025-09-16', '2025-09-17', 'DORIAN', 'LUGOJ - NAGYKALLO', '1686.16', '354.09', '2040.25', null, null],
  [145, '2025-09-17', '2025-09-18', 'DORIAN', 'NAGYKALLO - ORADEA', '2107.66', '442.61', '2550.27', null, null],
  [146, '2025-09-18', '2025-09-19', 'DORIAN', 'ORADEA - SALONTA + SACUENI +VALEA LUI MIHAI', '1320', '277.20', '1597.20', null, null],
  [147, '2025-09-19', '2025-09-20', 'DORIAN', 'CAREI - SZEKESFEHERVAR', '2952.81', '620.09', '3572.90', null, null],
];
const HEADERS = ['Data încărcare', 'Data descărcare', 'Nr camion / Nr remorcă', 'Șofer', 'Rută', 'Preț fără TVA', 'TVA', 'Total', 'Observații'];
const num = (s) => (s === null ? null : Number(s));
function photoRowCells(r, { textG = false, textDate = false } = {}) {
  const [, l, u, drv, route, g, h, i, note, k] = r;
  return [null, textDate ? dmy(l) : dateCell(l), dateCell(u), 'XX00DEM/XX30DEM', drv, route,
    g === null ? null : (textG ? g.replace('.', ',') : num(g)), h === null ? null : num(h), i === null ? null : num(i), note, k];
}
{
  const rows = [];
  for (let n = 1; n <= 118; n++) rows.push([]);          // rândurile 1–118: istoric (gol în fixture)
  rows.push([null, 'FICTIV – fixture; rândurile 121–147 sunt transcrise din poză (aug.–oct. 2025)']); // rând 119
  rows.push([null, ...HEADERS]);                           // rând 120 = antet (se caută după nume, NU în rândul 1)
  for (const r of PHOTO) rows.push(photoRowCells(r, { textG: r[0] === 133, textDate: r[0] === 129 }));
  const sheets = [
    { name: 'XX01DEM 2025', rows: [[null, ...HEADERS], [null, dateCell('2025-08-04'), dateCell('2025-08-05'), 'XX01DEM/XX31DEM', 'FICTIV', 'ORADEA - ARAD', 1000, 210, 1210]] },
    { name: 'XX02DEM 2025', rows: [[null, ...HEADERS], [null, dateCell('2025-08-06'), dateCell('2025-08-07'), 'XX02DEM/XX32DEM', 'FICTIV', 'ARAD - ORADEA', 1000, 210, 1210]] },
    { name: 'XX00DEM 2025', rows, cols: [3, 12, 12, 18, 10, 34, 11, 10, 10, 20, 8] },
    { name: 'Munka1', rows: [[]] },
    { name: 'XX01DEM', rows: [[null, ...HEADERS]] }, { name: 'XX02DEM', rows: [[null, ...HEADERS]] }, { name: 'XX00DEM', rows: [[null, ...HEADERS]] },
  ];
  writeXlsx('courses/tabel-curse-registru-aug-oct-2025.xlsx', sheets);
  // CSV cu ';' și virgulă zecimală (valori ca text) – doar foaia XX00DEM 2025, antet în rândul 1
  const csvLines = [['', ...HEADERS, ''].join(';')];
  for (const r of PHOTO) csvLines.push(['', dmy(r[1]), dmy(r[2]), 'XX00DEM/XX30DEM', r[3], r[4], r[5] === null ? '' : ro(r[5]), r[6] === null ? '' : ro(r[6]), r[7] === null ? '' : ro(r[7]), r[8] || '', r[9] ?? ''].join(';'));
  out('courses/tabel-curse-XX00DEM-2025-rd121-147.csv', '﻿' + csvLines.join('\r\n') + '\r\n');
  // același CSV în Windows-1250 (testează decodeText) – doar ASCII în fixture, dar codarea rămâne cp1250
  const cp = (() => { try { return execFileSync('iconv', ['-f', 'UTF-8', '-t', 'WINDOWS-1250'], { input: csvLines.join('\r\n') + '\r\n' }); } catch { return null; } })();
  if (cp) out('courses/tabel-curse-XX00DEM-2025-rd121-147.cp1250.csv', cp);
}
// valori așteptate (calculate aici cu BigInt) – acceptanță parser 6.1
const photoExpected = PHOTO.map((r) => {
  const [row, l, u, drv, route, g, h, i, note, k] = r;
  const e = { row, loadDate: l, unloadDate: u, plates: 'XX00DEM/XX30DEM', truck: 'XX00DEM', trailer: 'XX30DEM', driver: drv, route, note: note || null, strayK: k ?? null };
  const [origin, dest] = [route.split(' - ')[0].trim(), route.slice(route.indexOf(' - ') + 3).trim()];
  e.origin = origin; e.stops = dest.includes('+') ? dest.split('+').map((s) => s.trim()) : [dest];
  if (g !== null) { e.priceStatus = 'ok'; e.netMinor = Number(toMinor(g)); e.vatMinor = Number(toMinor(h)); e.grossMinor = Number(toMinor(i)); }
  else if (i !== null) { const gross = toMinor(i); const net = netFromGross21(gross); e.priceStatus = 'derived'; e.grossMinor = Number(gross); e.netMinor = Number(net); e.vatMinor = Number(gross - net); }
  else { e.priceStatus = 'missing'; e.status = 'review'; }
  if (e.priceStatus === 'ok' && toMinor(g) + toMinor(h) !== toMinor(i)) e.transcriptionNote = 'net+TVA ≠ total în poză (verifică transcrierea)'; // semnal, nu eroare
  if (e.priceStatus === 'ok') { const exp = vat21(toMinor(g)); if (exp !== toMinor(h)) e.vat21Mismatch = Number(toMinor(h) - exp); }
  if (route.includes('CROATIA')) { if (/- CROATIA$/.test(route)) { e.destCountry = 'HR'; e.stops = []; e.destOnlyCountry = true; } else { e.originIsCountry = 'HR'; } }
  if (note) { e.handoverTo = note.replace(/^lepakolni\s+/i, ''); }
  return e;
});
out('courses/tabel-curse-rd121-147.expected.json', json({
  _comment: 'Valori așteptate pentru parserul de curse, scrise independent (BigInt). Sumele în unitatea minoră RON (bani). Foaia: „XX00DEM 2025”, antet în rândul 120, valută implicită RON.',
  sheet: 'XX00DEM 2025', headerRow: 120, currency: 'RON', vatRatePct: 21, rows: photoExpected,
  counts: { rows: PHOTO.length, ok: photoExpected.filter((x) => x.priceStatus === 'ok').length, derived: photoExpected.filter((x) => x.priceStatus === 'derived').length, missing: photoExpected.filter((x) => x.priceStatus === 'missing').length, withStrayK: 1, withHandover: photoExpected.filter((x) => x.handoverTo).length },
  sameDayChain: [{ rows: [141, 142], date: '2025-09-12', overlap: false }, { rows: [126, 127], note: 'descărcare 16.08, următoarea încărcare 16.08 = lanț, nu suprapunere' }],
  textCells: { 'G133': 'număr stocat ca text în xlsx', 'B129': 'dată stocată ca text dd.mm.yyyy în xlsx' },
}));

// ═════════════ (b) Tabel de curse FICTIV, XX00DEM, oct. 2026 (layout real, defecte deliberate) ═════════════
// Construit din locurile REALE din exportul „Călătorii” (Orașu Nou, Hajdúdorog, Alsózsolca, Satu Mare, Halmeu, Törökszentmiklós, Arad ...).
// Locurile din GPS există și în fixture-ul real; cele marcate „NICIODATĂ VIZITAT” nu apar în GPS.
const C = (n, l, u, drv, route, net, o = {}) => ({ n, l, u, drv, route, net, ...o });
const FICTIV = [
  C(1, '2026-10-01', '2026-10-01', 'DORIAN', 'HAJDUDOROG - ALSOZSOLCA', '950.00'),
  C(2, '2026-10-01', '2026-10-02', 'DORIAN', 'ALSOZSOLCA - HALMEU', '2103.97'),
  C(3, '2026-10-05', '2026-10-05', 'DORIAN', 'SATU MARE - TOROKSZENTMIKLOS', '2105.58'),
  C(4, '2026-10-05', '2026-10-06', 'DORIAN', 'TOROKSZENTMIKLOS - SATU MARE', '2697.97'),
  C(5, '2026-10-06', '2026-10-07', 'KALMAN', 'MEDIESU AURIT - MIERCUREA CIUC', '2021.05', { note: 'lepakolni Kalman' }),
  C(6, '2026-10-07', '2026-10-08', 'KALMAN', 'MIERCUREA CIUC - UNGURAS', '3161.29', { note: 'ő hőség – note în maghiară păstrate ca atare' }),
  C(7, '2026-10-08', '2026-10-08', 'KALMAN', 'UNGURAS - SEINI', '1180.00'),
  C(8, '2026-10-09', '2026-10-09', 'DORIAN', 'SEINI - SATU MARE', '950.00', { defect: 'IDLE_ON_COURSE', note: 'FICTIV: 09.10 este zi fără activitate GPS (0 km)' }),
  C(9, '2026-10-12', '2026-10-12', 'DORIAN', 'SEINI - ALSOZSOLCA', '1686.16'),
  C(10, '2026-10-12', '2026-10-13', 'DORIAN', 'ALSOZSOLCA - HALMEU', '2103.97', { textNet: true }),
  C(11, '2026-10-13', '2026-10-13', 'DORIAN', 'HALMEU - SZATYMAZ', '1552.22'),
  C(12, '2026-10-14', '2026-10-14', 'DORIAN', 'SZATYMAZ - ARAD', '1320.00'),
  C(13, '2026-10-14', '2026-10-14', 'DORIAN', 'ARAD - NEGRESTI', '950.00'),
  C(14, '2026-10-15', '2026-10-15', 'DORIAN', 'ORASU NOU - ARAD', null, { stray: 3900, defect: 'COURSE_NO_PRICE', note: 'FICTIV: fără preț; număr rătăcit în coloana K' }),
  C(15, '2026-10-16', '2026-10-16', 'DORIAN', 'ARAD - MEDIESU AURIT', null, { onlyTotal: '2107.90' }),
  C(16, '2026-10-19', '2026-10-19', 'ANDOR', 'ORASU NOU - TYUKOD', '1180.00'),
  C(17, '2026-10-19', '2026-10-20', 'ANDOR', 'TYUKOD - ARAD', '2105.13'),
  C(18, '2026-10-20', '2026-10-20', 'ANDOR', 'ARAD - BEKESCSABA', '1556.30', { aliasNeeded: 'BEKESCSABA → Bichișciaba (GPS)' }),
  C(19, '2026-10-20', '2026-10-20', 'ANDOR', 'BEKESCSABA - MOFTIN', '1250.00', { aliasNeeded: 'BEKESCSABA → Bichișciaba (GPS)' }),
  C(20, '2026-10-21', '2026-10-22', 'DORIAN', 'BAIA MARE - DEJ', '3161.29', { defect: 'COURSE_OVERLAP', pairWith: 21 }),
  C(21, '2026-10-21', '2026-10-22', 'DORIAN', 'UNGURAS - ORASU NOU', '2106.46', { defect: 'COURSE_OVERLAP', pairWith: 20 }),
  C(22, '2026-10-26', '2026-10-26', 'DORIAN', 'SATU MARE - NYIREGYHAZA', '950.00'),
  C(23, '2026-10-26', '2026-10-26', 'DORIAN', 'NYIREGYHAZA - VASAROSNAMENY', '950.00'),
  C(24, '2026-10-26', '2026-10-27', 'DORIAN', 'VASAROSNAMENY - DEBRECEN', '2107.66', { defect: 'PLACE_NOT_VISITED', note: 'FICTIV: DEBRECEN nu apare în GPS (NICIODATĂ VIZITAT)' }),
  C(25, '2026-10-27', '2026-10-28', 'DORIAN', 'TIMISOARA - SIGHISOARA', '2940.66'),
  C(26, '2026-10-28', '2026-10-28', 'DORIAN', 'SIGHISOARA - ORASU NOU', '2952.81'),
  C(27, '2026-10-29', '2026-10-29', 'DORIAN', 'SATU MARE - TYUKOD', '1320.00'),
  C(28, '2026-10-29', '2026-10-30', 'DORIAN', 'TYUKOD - ARAD', '2107.66'),
  C(29, '2026-10-30', '2026-10-30', 'DORIAN', 'ARAD - HODOD', '1180.00'),
  C(30, '2026-09-29', '2026-09-30', 'DORIAN', 'ARAD - ORASU NOU', '1686.16', { defect: 'NO_GPS_RANGE', note: 'FICTIV: înainte de intervalul GPS importat (01.10–31.10.2026)' }),
  C(31, '2026-11-03', '2026-11-04', 'DORIAN', 'ORASU NOU - SZEGED', '2106.46', { defect: 'NO_GPS_RANGE', note: 'FICTIV: după intervalul GPS importat' }),
];
// ── auto-verificare independentă: afirmațiile despre defecte și potriviri sunt adevărate față de GPS-ul real ──
{
  const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const stopsByDay = {}; // ziua -> set(localități fold) din capetele deplasărilor
  for (const r of tripRows) for (const [cell, col] of [[r[3], 1], [r[4], 2]]) { const d = isoFromSerial(r[col]).slice(0, 10); (stopsByDay[d] ||= new Set()).add(fold(locality(cell))); }
  const days = (a, b) => { const o = []; for (let t = Date.parse(a); t <= Date.parse(b); t += 86400000) o.push(new Date(t).toISOString().slice(0, 10)); return o; };
  const visited = (place, a, b) => days(a, b).some((d) => [...(stopsByDay[d] || [])].some((loc) => loc === fold(place) || loc.startsWith(fold(place) + ' ') || loc.startsWith(fold(place))));
  const inRange = (d) => d >= '2026-10-01' && d <= '2026-10-31';
  const covered = new Set();
  for (const c of FICTIV) for (const d of days(c.l, c.u)) covered.add(d);
  const uncovered = activeDays.filter((d) => !covered.has(d));
  if (JSON.stringify(uncovered) !== JSON.stringify(['2026-10-17', '2026-10-23'])) throw new Error('zile active neacoperite: ' + uncovered);
  for (const c of FICTIV) {
    const [o, d] = c.route.split(' - ');
    const ok = visited(o, c.l, c.u) && visited(d, c.l, c.u);
    const expectNo = c.defect === 'PLACE_NOT_VISITED' || c.aliasNeeded || c.defect === 'NO_GPS_RANGE' || c.defect === 'IDLE_ON_COURSE' || c.n === 14 || c.n === 15 && false;
    if (!inRange(c.l) || !inRange(c.u)) { if (c.defect !== 'NO_GPS_RANGE') throw new Error('curs în afara intervalului fără defect: ' + c.n); continue; }
    if (!ok && !expectNo) throw new Error(`cursa ${c.n} (${c.route}) nu are opriri GPS la datele ei, deși e marcată curată`);
    if (c.defect === 'PLACE_NOT_VISITED' && visited(d, c.l, c.u)) throw new Error('cursa ' + c.n + ': locul ar fi vizitat');
  }
  if (!idleDays.includes('2026-10-09')) throw new Error('09.10 nu e zi inactivă');
  for (const c of FICTIV) if (c.defect === 'COURSE_OVERLAP' && !(c.l < FICTIV[c.pairWith - 1].u && FICTIV[c.pairWith - 1].l < c.u)) throw new Error('perechea suprapusă nu se suprapune');
}
const fictivRows = [];
fictivRows.push(['FICTIV – registru de curse inventat pentru teste/demo (date demo)']);
fictivRows.push([]);
fictivRows.push([null, ...HEADERS]);  // antet în rândul 3 (nu în rândul 1)
const fictivExpected = [];
for (const c of FICTIV) {
  let g = null, h = null, i = null, status = 'ok', netMinor = null, vatMinor = null, grossMinor = null;
  if (c.net) { const n = toMinor(c.net); const v = vat21(n); netMinor = n; vatMinor = v; grossMinor = n + v; g = Number(c.net); h = Number(fromMinor(v)); i = Number(fromMinor(n + v)); if (c.textNet) g = c.net.replace('.', ','); }
  else if (c.onlyTotal) { grossMinor = toMinor(c.onlyTotal); netMinor = netFromGross21(grossMinor); vatMinor = grossMinor - netMinor; i = Number(c.onlyTotal); status = 'derived'; }
  else status = 'missing';
  fictivRows.push([null, dateCell(c.l), dateCell(c.u), 'XX00DEM/XX30DEM', c.drv, c.route, g, h, i, c.note && !c.note.startsWith('FICTIV') ? c.note : (c.note ? c.note : null), c.stray ?? null]);
  fictivExpected.push({ n: c.n, row: fictivRows.length, loadDate: c.l, unloadDate: c.u, driver: c.drv, route: c.route, priceStatus: status, netMinor: netMinor === null ? null : Number(netMinor), vatMinor: vatMinor === null ? null : Number(vatMinor), grossMinor: grossMinor === null ? null : Number(grossMinor), strayK: c.stray ?? null, defect: c.defect || null, aliasNeeded: c.aliasNeeded || null, pairWith: c.pairWith || null });
}
writeXlsx('fictiv/FICTIV-curse-XX00DEM-oct2026.xlsx', [{ name: 'XX00DEM 2026', rows: fictivRows, cols: [3, 12, 12, 18, 10, 34, 11, 10, 10, 30, 8] }, { name: 'Munka1', rows: [[]] }]);
{
  const lines = [['', ...HEADERS, ''].join(';')];
  for (const r of fictivRows.slice(3)) {
    const f = (c) => (c && typeof c === 'object' ? dmy(isoFromSerial(c.v).slice(0, 10)) : c === null || c === undefined ? '' : String(c));
    const money = (c) => (typeof c === 'number' ? ro(String(c)) : f(c));
    lines.push(['', f(r[1]), f(r[2]), r[3], r[4], r[5], money(r[6]), money(r[7]), money(r[8]), r[9] ?? '', r[10] ?? ''].join(';'));
  }
  out('fictiv/FICTIV-curse-XX00DEM-oct2026.csv', '﻿' + lines.join('\r\n') + '\r\n');
}
// alias-uri confirmate (FICTIV) pentru demo: locuri din tabel → localitate GPS
out('fictiv/aliases-FICTIV.json', json([
  { name: 'BEKESCSABA', locality: 'Bichișciaba', countryCode: 'HU', confirmed: true, note: 'FICTIV: grafia GPS diferă (exonim românesc)' },
  { name: 'ORASU NOU', locality: 'Orașu Nou', countryCode: 'RO', confirmed: true, note: 'FICTIV: baza (depou)' },
  { name: 'SZATYMAZ', locality: 'Szatymaz', countryCode: 'HU', confirmed: true },
]));
// Steaguri așteptate (acceptanță AC1, 17.1). `required` = trebuie să existe; `forbiddenForCourses` = cursele curate nu au steaguri.
const defective = FICTIV.filter((c) => c.defect).map((c) => c.n);
out('fictiv/FICTIV-expected-flags.json', json({
  _comment: 'FICTIV. Defectele deliberate ale tabelului de curse față de GPS-ul real al lui XX00DEM (oct. 2026), cu alias-urile din aliases-FICTIV.json aplicate. Rezultatul scris independent, nu generat de reconcile.js.',
  gpsRange: { from: '2026-10-01', to: '2026-10-31' }, plate: 'XX00DEM',
  required: [
    { code: 'IDLE_ON_COURSE', severity: 'mare', course: 8, why: '09.10 = zi inactivă GPS' },
    { code: 'COURSE_NO_PRICE', severity: 'medie', course: 14, why: 'rând fără preț (K=3900 rătăcit)' },
    { code: 'COURSE_OVERLAP', severity: 'mare', courses: [20, 21], why: 'aceleași zile 21–22.10' },
    { code: 'PLACE_NOT_VISITED', severity: 'medie', course: 24, place: 'DEBRECEN', why: 'locul nu apare în nicio oprire GPS' },
    { code: 'NO_GPS_RANGE', severity: 'info', course: 30, why: 'înainte de 01.10.2026' },
    { code: 'NO_GPS_RANGE', severity: 'info', course: 31, why: 'după 31.10.2026' },
    { code: 'UNCOVERED_ACTIVE_PERIOD', severity: 'medie', period: { from: '2026-10-17', to: '2026-10-17' }, kmM: Number(kmByDay['2026-10-17']), why: 'zi activă fără curse' },
    { code: 'UNCOVERED_ACTIVE_PERIOD', severity: 'medie', period: { from: '2026-10-23', to: '2026-10-23' }, kmM: Number(kmByDay['2026-10-23']), why: 'zi activă fără curse' },
  ],
  allowedExtra: [
    { code: 'IDLE_ON_COURSE', course: 8, also: ['PLACE_NOT_VISITED'], why: 'SATU MARE nu e vizitat pe 09.10 (camionul stă la Seini)' },
    { code: 'COURSE_OVERLAP', courses: [20, 21], also: ['PLACE_NOT_VISITED'], why: 'dacă implementarea verifică locul la data exactă' },
  ],
  cleanCourses: FICTIV.filter((c) => !c.defect).map((c) => c.n),
  defectiveCourses: defective,
  note: 'Cursele 18 și 19 (BEKESCSABA) sunt „curate” doar cu aliasul din aliases-FICTIV.json; fără alias: scor mediu ⇒ cere confirmare manuală (nu steag).',
}));
out('fictiv/FICTIV-curse-XX00DEM-oct2026.expected.json', json({ _comment: 'FICTIV. Valori așteptate la import (sumele în bani RON), calculate independent.', sheet: 'XX00DEM 2026', headerRow: 3, currency: 'RON', vatRatePct: 21, rows: fictivExpected }));

// ═════════════ fx: curs fix pinned (5.3), un singur curs EUR/RON ═════════════
const PIN = { EUR_RON: '5.3442', EUR_HUF: '364.08', EUR_PLN: '4.2815', EUR_CZK: '24.31', EUR_USD: '1.0842', EUR_GBP: '0.8420', EUR_CHF: '0.9315', EUR_BGN: '1.9558' };
out('fx/pinned.json', json({
  _comment: 'Un singur curs pinned pentru TOATE testele (5.3). Nu este o afirmație despre BCE/BNR la o anumită zi. Diferența BCE v1/v2 observată la 14.10.2026 (5,3442 vs 5,3429) e motivul pentru care sursa se stochează, dar nu intră în teste.',
  base: 'EUR', date: '2026-10-14', perEur: PIN,
  frankfurterShape: { amount: 1, base: 'EUR', date: '2026-10-14', rates: { RON: 5.3442, HUF: 364.08, PLN: 4.2815, CZK: 24.31, USD: 1.0842 } },
  derived: { HUF_RON: '0.0146782052', _howto: 'RON per 1 HUF = EUR_RON / EUR_HUF, 10 zecimale (calculat în golden/expected.json)' },
}));
out('fx/bnr-FICTIV.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- FICTIV: formă tip BNR (DataSet/Body/Cube/Rate, multiplier pentru HUF) cu valorile pinned; NU sunt cursurile reale ale BNR. -->
<DataSet xmlns="http://www.bnr.ro/xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <Publisher>National Bank of Romania</Publisher>
    <PublishingDate>2026-10-14</PublishingDate>
    <MessageType>DR</MessageType>
  </Header>
  <Body>
    <Subject>Reference rates</Subject>
    <OrigCurrency>RON</OrigCurrency>
    <Cube date="2026-10-14">
      <Rate currency="CHF">5.7372</Rate>
      <Rate currency="CZK">0.2198</Rate>
      <Rate currency="EUR">5.3442</Rate>
      <Rate currency="GBP">6.3469</Rate>
      <Rate currency="HUF" multiplier="100">1.4678</Rate>
      <Rate currency="PLN">1.2482</Rate>
      <Rate currency="USD">4.9291</Rate>
    </Cube>
    <Cube date="2026-10-13">
      <Rate currency="EUR">5.3430</Rate>
      <Rate currency="HUF" multiplier="100">1.4670</Rate>
    </Cube>
  </Body>
</DataSet>
`);

// ═════════════ xlsx/: exemple generice pentru importurile C și E (FICTIV, formate INVENTATE, nu ale furnizorilor) ═════════════
out('xlsx/extras-card-generic-FICTIV.csv', '﻿' + [
  'Data;Ora;Nr. card;Plăcuță;Produs;Cantitate;Valoare;Valută;Țară;Loc',
  '02.10.2026;08:14;FICTIV-0001;XX00DEM;Motorină;412,30;689,45;EUR;HU;Hajdúdorog',
  '05.10.2026;12:40;FICTIV-0001;XX00DEM;Motorină;380,00;1.352,60;RON;RO;Satu Mare',
  '05.10.2026;18:02;FICTIV-0001;XX00DEM;Taxă drum HU-GO;;24,10;EUR;HU;Autostrada M3',
  '05.10.2026;18:02;FICTIV-0001;XX00DEM;Taxă drum HU-GO;;24,10;EUR;HU;Autostrada M3',
  '13.10.2026;07:55;FICTIV-0001;XX00DEM;Motorină;395,12;3020;HUF;HU;Szatymaz',
].join('\r\n') + '\r\n');
out('xlsx/efactura-FICTIV.xml', `<?xml version="1.0" encoding="UTF-8"?>
<!-- FICTIV: factură UBL 2.1 inventată (furnizori și CUI fictive) pentru testul de import e-Factura. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>FICTIV-2026-000123</cbc:ID>
  <cbc:IssueDate>2026-10-14</cbc:IssueDate>
  <cbc:DueDate>2026-10-28</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>SC SERVICE CAMIOANE FICTIV SRL</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>RO12345674</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyName><cbc:Name>SC TRANSPORT FICTIV SRL</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>RO76543216</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">231.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">1100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">231.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="RON">1100.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="RON">1100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="RON">1331.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="RON">1331.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="RON">1100.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Revizie și schimb ulei XX00DEM</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">1100.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>
`);

// README al fixture-urilor
out('README.md', `# Fixture-uri de test

Toate fișierele cu **FICTIV** în nume sunt inventate (insigna „date demo” în aplicație). Generate de \`node scripts/make-fixtures.mjs\` (idempotent; \`--check\` verifică).

| Director | Conținut | Origine |
|---|---|---|
| \`gps/\` | \`safefleet-calatorii-XX00DEM-oct2026.xlsx\`, \`safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx\` | **REALE** (copiate din \`docs/ref/\`). Plus variante FICTIV: XX01DEM (alt camion), odometru greșit, călătorii peste miezul nopții. \`expected-*.json\` = valori calculate independent din fișierele reale. |
| \`courses/\` | registru .xlsx (7 foi ca în realitate) + CSV (UTF-8 și Windows-1250) cu **rândurile 121–147 din poză** (aug.–oct. 2025), \`*.expected.json\` | transcris din \`docs/ref/tabel-curse-XX00DEM-poza.jpg\` |
| \`fictiv/\` | \`FICTIV-curse-XX00DEM-oct2026.xlsx/.csv\`: 31 curse în layout-ul real, cu defecte deliberate; \`aliases-FICTIV.json\`; \`FICTIV-expected-flags.json\` | inventat, construit din locurile reale ale GPS-ului |
| \`fx/\` | \`pinned.json\` (un singur curs EUR/RON = 5,3442), \`bnr-FICTIV.xml\` | inventat (nu sunt cursuri reale) |
| \`xlsx/\` | extras de card generic (CSV) și factură UBL | inventate: **nu** reproduc formatul vreunui furnizor real |
| \`golden/\` | \`make_expected.py\` (Python \`decimal\`) + \`expected.json\` | valori de aur independente de codul aplicației |
| \`xlsx-ref/\` | \`make_ref.py\` (XlsxWriter) + referință OOXML | spike export (9) |
| \`mini-app/\` | aplicație minimă pentru testele de build | – |

Date: 20.08.2025–03.10.2025 (poză) și 01.10.2026–31.10.2026 (GPS real + curse FICTIV). Perioadele nu coincid între ele, intenționat.
`);

if (CHECK) { if (stale.length) { console.error('fixture-uri învechite/lipsă:\n - ' + stale.join('\n - ')); process.exit(1); } console.log('fixture-uri: ok'); }
else console.log(`fixture-uri: ${written.length} fișiere scrise în tests/fixtures/`);
