// Import tabel de curse: parsare rânduri, reguli de preț (5.7), plan idempotent. Nu scrie în store.
import { parseDayCell, cellText, isBlank, rowIsEmpty, parseMoneyCell, kmToMeters, rowNo, colName } from './cells.js';
import { parseRoute, normRoute } from './route.js';
import { normalizePlate, parsePlates } from '../core/plates.js';
import { detId } from '../core/ids.js';
import { mulDiv, currencyExp } from '../core/money.js';
import { foldKey } from '../core/text.js';
import { diffDays } from '../core/dates.js';
import { fmtMoney } from '../core/format.js';

export { detectCourseMapping } from './mapping.js';

/** Cote TVA România (puncte de bază) folosite când nu se primește `roVatRates`. */
export const DEFAULT_RO_VAT_RATES = [
  { from: '2010-07-01', standardBp: 2400, reducedBp: [900, 500] },
  { from: '2016-01-01', standardBp: 2000, reducedBp: [900, 500] },
  { from: '2017-01-01', standardBp: 1900, reducedBp: [900, 500] },
  { from: '2025-08-01', standardBp: 2100, reducedBp: [1100, 900, 500] },
];
/** Cote efective acceptate la validarea H/G (0, 5, 9, 11, 19, 21%) + cele istorice 20/24%. */
export const VALID_RATES_BP = [0, 500, 900, 1100, 1900, 2100];
const KNOWN_RATES_BP = [...VALID_RATES_BP, 2000, 2400];

export function standardVatBpOn(date, rates = DEFAULT_RO_VAT_RATES) {
  const sorted = [...rates].sort((a, b) => (a.from < b.from ? -1 : 1));
  let r = sorted[0];
  for (const x of sorted) if (x.from <= date) r = x;
  return r.standardBp;
}

/** Id de cursă (determinist): plăcuță + date + rută normalizată (+ ordinal pentru rânduri identice, 0 => fără). */
export function courseKeyId(c, ordinal = 0) {
  const parts = [c.plate, c.loadDate, c.unloadDate, normRoute(c.route ?? c.routeRaw ?? '')];
  if (ordinal > 0) parts.push(ordinal);
  return detId('crs', ...parts);
}

const TREATMENT_WORDS = [
  [/(^|\b)(0|zero|0%|scutit|exempt|export|intra|ic|intracomunitar)(\b|$)/, 'zero'],
  [/(inversa|reverse|rc|autolichidare|autolichidat)/, 'reverse'],
  [/(taxat|cutva|tva|21|19|vat|taxed|normal|standard)/, 'taxed'],
];
export function parseTreatment(v) {
  const t = foldKey(cellText(v)).toLowerCase();
  if (!t) return null;
  for (const [re, val] of TREATMENT_WORDS) if (re.test(t)) return val;
  return null;
}

function priceRule({ G, H, I, treatment, rateBp, cur }) {
  const r = { net: null, vat: null, gross: null, vatBp: null, vatDerived: false, priceStatus: 'missing', warnings: [], status: 'ok' };
  const has = (x) => x != null;
  const zeroLike = treatment === 'zero' || treatment === 'reverse';
  if (has(G) && has(H) && has(I)) {
    r.net = G; r.vat = H; r.gross = I;
    if (Math.abs(G + H - I) > 1) { r.warnings.push({ code: 'sum_mismatch', message: `Preț + TVA ≠ Total (${fmtMoney(G, cur)} + ${fmtMoney(H, cur)} ≠ ${fmtMoney(I, cur)})` }); r.status = 'review'; }
    r.priceStatus = 'ok';
  } else if (has(G) && has(H)) {
    r.net = G; r.vat = H; r.gross = G + H; r.priceStatus = 'ok';
  } else if (has(G) && has(I)) {
    r.net = G; r.gross = I; r.vat = I - G; r.vatDerived = true; r.priceStatus = 'derived';
    if (r.vat < 0) { r.warnings.push({ code: 'negative_vat', message: 'Total mai mic decât prețul fără TVA' }); r.status = 'review'; }
  } else if (has(G)) {
    r.net = G; r.vat = zeroLike ? 0 : mulDiv(G, rateBp, 10000); r.gross = G + r.vat; r.vatDerived = !zeroLike; r.priceStatus = zeroLike ? 'ok' : 'derived';
  } else if (has(I) && has(H)) {
    r.gross = I; r.vat = H; r.net = I - H; r.priceStatus = 'ok';
  } else if (has(I)) {
    r.gross = I;
    if (zeroLike) { r.net = I; r.vat = 0; r.priceStatus = 'ok'; r.vatBp = 0; }
    else { r.net = mulDiv(I, 10000, 10000 + rateBp); r.vat = I - r.net; r.vatDerived = true; r.priceStatus = 'derived'; }
  } else if (has(H)) {
    r.vat = H; r.priceStatus = 'missing'; r.status = 'review';
    r.warnings.push({ code: 'vat_only', message: 'Doar TVA completat, fără preț' });
  } else {
    r.priceStatus = 'missing'; r.status = 'review';
  }
  // cota efectivă
  if (r.net != null && r.vat != null && r.priceStatus !== 'missing') {
    if (zeroLike || r.vat === 0) r.vatBp = 0;
    else if (r.vatDerived) r.vatBp = rateBp;
    else if (r.net !== 0) {
      const exact = mulDiv(r.vat, 10000, r.net);
      const near = KNOWN_RATES_BP.find((x) => Math.abs(x - exact) <= 20);
      if (near != null) r.vatBp = near;
      else { r.vatBp = exact; r.warnings.push({ code: 'unknown_vat_rate', message: `Cota TVA efectivă ${(exact / 100).toFixed(2).replace('.', ',')}% nu este una cunoscută` }); } // money-ok: nu sunt bani (afișare, km, procente sau pondere)
    }
  }
  return r;
}

const HANDOVER_RE = /lepakolni\s+([\p{L}][\p{L}.\-]*)/iu;

/**
 * @param {any[][]} rows
 * @param {object} mapping de la detectCourseMapping (sau salvată/editată)
 * @param {{ plate:string, year?:number|null, currency?:string, company?:object, roVatRates?:Array, file?:string, sheet?:string,
 *           vatTreatment?:'taxed'|'zero'|'reverse', defaultDriver?:string, courseId?:Function }} o
 * @returns {{ drafts: object[], issues: Array<{row:number,col?:string,severity:'info'|'warn'|'error',code:string,message:string}>, stats:object }}
 */
export function parseCourseRows(rows, mapping, o) {
  const cur = (o.currency || 'RON').toUpperCase();
  const sheetTreatment = o.vatTreatment || 'taxed';
  const rates = o.roVatRates && o.roVatRates.length ? o.roVatRates : (o.company?.roVatRates?.length ? o.company.roVatRates : DEFAULT_RO_VAT_RATES);
  const idFn = o.courseId || courseKeyId;
  const cols = mapping?.cols || {};
  const strayCols = mapping?.strayCols || [];
  const issues = [];
  const drafts = [];
  const seen = new Map();
  const sheetPlate = o.plate ? normalizePlate(o.plate) : '';
  const start = mapping?.headerRow != null ? mapping.headerRow + 1 : 0;
  let skippedEmpty = 0, incomplete = 0;

  const issue = (i, severity, code, message, col) => issues.push({ row: rowNo(i), ...(col ? { col } : {}), severity, code, message });
  const get = (r, f) => (cols[f] == null ? null : r[cols[f]]);

  if (cols.loadDate == null && cols.unloadDate == null) {
    issues.push({ row: 0, severity: 'error', code: 'no_date_column', message: 'Nicio coloană de dată nu este mapată' });
    return { drafts, issues, stats: { rows: rows.length, parsed: 0, skippedEmpty: 0, incomplete: 0 } };
  }

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (rowIsEmpty(r)) { skippedEmpty++; continue; }
    let loadDate = parseDayCell(get(r, 'loadDate'));
    let unloadDate = parseDayCell(get(r, 'unloadDate'));
    const strays = strayCols.map((c) => ({ c, v: r[c] })).filter((x) => !isBlank(x.v));
    const strayValues = [];
    for (const s of strays) {
      const m = parseMoneyCell(s.v, cur);
      if (m.ok) strayValues.push(m.minor / 10 ** currencyExp(cur));
    }
    if (!loadDate && !unloadDate) {
      incomplete++;
      const anyPrice = ['net', 'vat', 'gross'].some((f) => !isBlank(get(r, f)));
      issue(i, anyPrice ? 'warn' : 'info', 'incomplete_row', anyPrice ? 'Rând cu sume dar fără date (total/subtotal?): ignorat' : 'Rând incomplet (fără date): ignorat');
      if (strays.length) issue(i, 'info', 'stray_value', 'Valoare rătăcită în coloana fără antet', colName(strays[0].c));
      continue;
    }
    const rowIssues = [];
    let status = 'ok';
    const rpush = (severity, code, message, col) => { rowIssues.push({ severity, code, message, col }); if (severity !== 'info' && status === 'ok') status = 'review'; };
    if (!loadDate) { loadDate = unloadDate; rpush('warn', 'missing_load_date', 'Lipsește data încărcării: folosită data descărcării', cols.loadDate != null ? colName(cols.loadDate) : undefined); }
    if (!unloadDate) { unloadDate = loadDate; rpush('warn', 'missing_unload_date', 'Lipsește data descărcării: folosită data încărcării', cols.unloadDate != null ? colName(cols.unloadDate) : undefined); }
    if (cols.loadDate != null && isBlank(get(r, 'loadDate')) === false && !parseDayCell(get(r, 'loadDate'))) rpush('warn', 'bad_date', `Dată necitibilă: „${cellText(get(r, 'loadDate'))}”`, colName(cols.loadDate));
    if (cols.unloadDate != null && isBlank(get(r, 'unloadDate')) === false && !parseDayCell(get(r, 'unloadDate'))) rpush('warn', 'bad_date', `Dată necitibilă: „${cellText(get(r, 'unloadDate'))}”`, colName(cols.unloadDate));
    if (diffDays(loadDate, unloadDate) < 0) rpush('warn', 'date_order', 'Data descărcării este înaintea încărcării', cols.unloadDate != null ? colName(cols.unloadDate) : undefined);
    if (diffDays(loadDate, unloadDate) > 14) rpush('info', 'long_course', 'Cursă de peste 14 zile: verificați datele');

    // plăcuțe
    const platesRaw = cellText(get(r, 'plates'));
    const pl = parsePlates(platesRaw);
    let plate = pl.truck || sheetPlate;
    if (!plate) rpush('error', 'no_plate', 'Nicio plăcuță (nici în rând, nici în numele foii)');
    else if (pl.truck && sheetPlate && pl.truck !== sheetPlate) rpush('warn', 'plate_mismatch', `Plăcuța din rând (${pl.truck}) diferă de foaie (${sheetPlate}); se folosește cea din rând`, colName(cols.plates));

    // șofer, rută
    const driverRaw = cellText(get(r, 'driver')) || (o.defaultDriver || '');
    const routeRaw = cellText(get(r, 'route'));
    const route = parseRoute(routeRaw);
    if (!routeRaw) rpush('warn', 'no_route', 'Rută lipsă', cols.route != null ? colName(cols.route) : undefined);
    else if (!route.parsed && !route.countryOnly) rpush('info', 'route_unparsed', 'Ruta nu are forma „ORIGINE - DESTINAȚIE”');
    if (route.countryOnly) rpush('info', 'dest_country_only', 'Destinație doar țară: km necesită introducere manuală');

    // valută / tratament pe rând
    let currency = cur;
    if (cols.currency != null && !isBlank(get(r, 'currency'))) {
      const cc = cellText(get(r, 'currency')).toUpperCase().replace(/[^A-Z]/g, '');
      const map = { LEI: 'RON', RON: 'RON', EURO: 'EUR', EUR: 'EUR', FT: 'HUF', HUF: 'HUF' };
      currency = map[cc] || (cc.length === 3 ? cc : cur);
    }
    let treatment = sheetTreatment;
    if (cols.vatTreatment != null) { const t = parseTreatment(get(r, 'vatTreatment')); if (t) treatment = t; }

    // sume
    const money = {};
    for (const [f, k] of [['net', 'G'], ['vat', 'H'], ['gross', 'I']]) {
      const m = parseMoneyCell(get(r, f), currency);
      if (m.ok) { money[k] = m.minor; if (m.ambiguous) rpush('warn', 'ambiguous_number', `Număr ambiguu „${cellText(get(r, f))}” citit ca ${m.readAs}`, colName(cols[f])); }
      else if (!m.empty) rpush('warn', 'bad_number', `Sumă necitibilă: „${cellText(get(r, f))}”`, colName(cols[f]));
    }
    const invoiceDate = cols.invoiceDate != null ? parseDayCell(get(r, 'invoiceDate')) : null;
    const rateDate = invoiceDate || loadDate;
    const rateBp = standardVatBpOn(rateDate, rates);
    const price = priceRule({ G: money.G, H: money.H, I: money.I, treatment, rateBp, cur: currency });
    for (const w of price.warnings) rpush('warn', w.code, w.message);
    if (price.status === 'review' && status === 'ok') status = 'review';
    if (price.priceStatus === 'missing') {
      rpush('warn', 'no_price', strayValues.length ? `Fără preț; în coloana fără antet: ${strayValues.join(', ')} (posibil preț?)` : 'Cursă fără preț (factură în așteptare?)');
    } else if (price.vatDerived) rpush('info', 'vat_derived', price.priceStatus === 'derived' && money.G == null ? 'Doar Total completat: net și TVA derivate' : 'TVA derivat');
    if (strayValues.length && price.priceStatus !== 'missing') rpush('info', 'stray_value', `Valoare în coloana fără antet: ${strayValues.join(', ')}`);
    if (price.net != null && price.net < 0) rpush('warn', 'negative_price', 'Preț negativ (storno?)');

    // km, note, câmpuri opționale
    let loadedKm = null;
    if (cols.km != null) {
      const m = kmToMeters(get(r, 'km'));
      if (m != null && m > 0) loadedKm = { meters: m, source: 'column', confidence: 'high' };
    }
    const note = cellText(get(r, 'note'));
    const hm = HANDOVER_RE.exec(note);
    const uitCode = cols.uit != null ? cellText(get(r, 'uit')) : '';

    const base = { plate: plate || '', loadDate, unloadDate, routeRaw };
    let ordinal = 0;
    const dupKey = `${base.plate}|${loadDate}|${unloadDate}|${normRoute(routeRaw)}`;
    ordinal = seen.get(dupKey) ?? 0;
    seen.set(dupKey, ordinal + 1);
    if (ordinal > 0) rpush('info', 'duplicate_row', `Rând identic cu un rând anterior (#${ordinal + 1})`);

    const draft = {
      id: idFn(base, ordinal), ordinal,
      plate: base.plate, trailerPlate: pl.trailer || null,
      driverRaw, driverName: driverRaw ? driverRaw.trim() : '',
      loadDate, unloadDate, invoiceDate,
      routeRaw, origin: route.origin, destinations: route.destinations, extras: route.extras,
      originCountry: route.originCountry, destCountry: route.destCountry, destCountryOnly: route.countryOnly,
      invoiceNo: cols.invoiceNo != null ? cellText(get(r, 'invoiceNo')) || undefined : undefined,
      clientName: cols.clientName != null ? cellText(get(r, 'clientName')) || undefined : undefined,
      dueDate: cols.dueDate != null ? parseDayCell(get(r, 'dueDate')) || undefined : undefined,
      paidDate: cols.paidDate != null ? parseDayCell(get(r, 'paidDate')) || undefined : undefined,
      uit: uitCode ? { code: uitCode } : undefined,
      currency,
      vatTreatment: treatment, net: price.net, vatBp: price.vatBp, vat: price.vat, gross: price.gross,
      vatDerived: price.vatDerived, priceStatus: price.priceStatus,
      vatRateBasis: invoiceDate ? 'invoiceDate' : 'loadDate', vatRateAssumed: !invoiceDate && price.vatDerived,
      loadedKm,
      note, handoverTo: hm ? hm[1] : null, strayValues,
      sheet: { file: o.file || null, name: o.sheet || null, row: rowNo(i) },
      manualFields: [], status,
    };
    drafts.push(draft);
    for (const x of rowIssues) issue(i, x.severity, x.code, x.message, x.col);
  }

  // suprapuneri reale (> 1 zi) pe același camion; lanțul în aceeași zi nu e suprapunere
  const byPlate = new Map();
  for (const d of drafts) { if (!byPlate.has(d.plate)) byPlate.set(d.plate, []); byPlate.get(d.plate).push(d); }
  for (const list of byPlate.values()) {
    const sorted = [...list].sort((a, b) => (a.loadDate < b.loadDate ? -1 : a.loadDate > b.loadDate ? 1 : a.unloadDate < b.unloadDate ? -1 : 1));
    let prev = null;
    for (const d of sorted) {
      if (prev && d.loadDate < prev.unloadDate) {
        issues.push({ row: d.sheet.row, severity: 'warn', code: 'course_overlap', message: `Se suprapune cu rândul ${prev.sheet.row} (${prev.loadDate} – ${prev.unloadDate})` });
        if (d.status === 'ok') d.status = 'review';
      }
      if (!prev || d.unloadDate > prev.unloadDate) prev = d;
    }
  }
  issues.sort((a, b) => a.row - b.row);
  return { drafts, issues, stats: { rows: rows.length - start, parsed: drafts.length, skippedEmpty, incomplete } };
}

const COMPARE_FIELDS = ['trailerPlate', 'driverRaw', 'routeRaw', 'currency', 'vatTreatment', 'net', 'vat', 'gross', 'vatBp', 'priceStatus', 'note', 'handoverTo',
  'invoiceNo', 'clientName', 'invoiceDate', 'dueDate', 'paidDate'];
const eq = (a, b) => (a ?? null) === (b ?? null);

/**
 * Plan idempotent. Cheia = id determinist; câmpurile din `existing.manualFields` nu se suprascriu.
 * `orphaned` = curse existente din aceeași foaie care nu mai apar în fișier (se listează, nu se șterg).
 * @returns {{ add:object[], update:Array<{existing:object, draft:object, changes:string[], patch:object}>, unchanged:string[], orphaned:object[], states:{[id:string]:'nou'|'actualizat'|'neschimbat'} }}
 */
export function planCourseImport(drafts, existing) {
  const live = (existing || []).filter((c) => !c.deletedAt);
  const byId = new Map(live.map((c) => [c.id, c]));
  const add = [], update = [], unchanged = [], states = {};
  for (const d of drafts) {
    const ex = byId.get(d.id);
    if (!ex) { add.push(d); states[d.id] = 'nou'; continue; }
    const manual = new Set(ex.manualFields || []);
    const changes = [];
    const patch = {};
    for (const f of COMPARE_FIELDS) {
      if (manual.has(f)) continue;
      if (!eq(ex[f], d[f])) { changes.push(f); patch[f] = d[f] ?? null; }
    }
    // km din coloană: nu suprascrie un km manual / calculat mai bun
    const exKm = ex.loadedKm;
    if (d.loadedKm && !manual.has('loadedKm') && !(exKm && exKm.source === 'manual') && (!exKm || exKm.meters !== d.loadedKm.meters || exKm.source !== d.loadedKm.source)) {
      changes.push('loadedKm'); patch.loadedKm = d.loadedKm;
    }
    if (changes.length) { update.push({ existing: ex, draft: d, changes, patch }); states[d.id] = 'actualizat'; }
    else { unchanged.push(d.id); states[d.id] = 'neschimbat'; }
  }
  const ids = new Set(drafts.map((d) => d.id));
  const sheets = new Set(drafts.map((d) => `${d.sheet?.name ?? ''}`));
  const orphaned = live.filter((c) => c.sheet && sheets.has(`${c.sheet.name ?? ''}`) && !ids.has(c.id));
  return { add, update, unchanged, orphaned, states };
}

/** Etichetă de previzualizare: nou / actualizat / neschimbat / derivat / fără preț / eroare. */
export function draftPreviewState(draft, planState, issues = []) {
  if (!draft.plate) return 'eroare';
  if (issues.some((x) => x.row === draft.sheet?.row && x.severity === 'error')) return 'eroare';
  if (draft.priceStatus === 'missing') return 'fără preț';
  if (draft.priceStatus === 'derived' && planState === 'nou') return 'derivat';
  return planState || 'nou';
}

/**
 * Pasul „Valută” (blocant în wizard): eșantion de 5 rânduri cu prețuri + total foaie.
 * @returns {{ currency:string, sample:Array<{row:number,routeRaw:string,net:number,vat:number,gross:number,text:string}>, totals:{net:number,vat:number,gross:number,count:number,missing:number} }}
 */
export function currencySample(drafts, currency, n = 5) {
  const priced = drafts.filter((d) => d.priceStatus === 'ok' && d.net != null && d.vat != null && d.gross != null);
  const sample = priced.slice(0, n).map((d) => {
    const pct = d.net ? ` ${(d.vatBp / 100).toString().replace('.', ',')}%` : '';
    return { row: d.sheet?.row ?? 0, routeRaw: d.routeRaw, net: d.net, vat: d.vat, gross: d.gross,
      text: `${fmtMoney(d.net, currency)} + TVA ${fmtMoney(d.vat, currency)} = ${fmtMoney(d.gross, currency)}: arată ca ${currency === 'RON' ? 'lei' : currency} cu TVA${pct}` };
  });
  let net = 0, vat = 0, gross = 0, missing = 0;
  for (const d of drafts) {
    if (d.priceStatus === 'missing') { missing++; continue; }
    net += d.net ?? 0; vat += d.vat ?? 0; gross += d.gross ?? 0;
  }
  return { currency, sample, totals: { net, vat, gross, count: drafts.length - missing, missing } };
}

