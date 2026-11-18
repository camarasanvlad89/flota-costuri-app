// Rapoarte informative (5.5, 5.10, 8.9, 17.2, 17.3 H din docs/DEV-PLAN.md): serii lunare, categorii, TVA, jurnal contabil,
// „fără document”, neîncasat, cursuri folosite, km pe gol cu KPI și repere.
// Calcul pur, doar din stare; rapoartele NU sunt declarații fiscale (D300 etc.). Fără I/O.
import { mulDiv } from '../core/money.js';
import { eachMonth, monthRange } from '../core/dates.js';
import { computeEmptyKm } from './emptyKm.js';
import {
  coll, companyOf, singleton, memo, ledgerLines, fleetPnl, truckPnl, costRates, rollingWindow, isBnrSource,
  rangeOfMonth, clipRange, monthOf,
} from './profit.js';

const inRange = (d, r) => d >= r.from && d <= r.to;
const cur0 = (o) => (o && o.currency === 'EUR' ? 'EUR' : 'RON');

export const BENCHMARK_DEFAULTS = Object.freeze({
  avgEmptyPct: 20, targetEmptyPct: 5, label: 'orientativ, sursă comercială',
});
export function benchmarksOf(state) {
  return { ...BENCHMARK_DEFAULTS, ...(singleton(state, 'benchmarks') || {}) };
}

const RECOGNITION_RO = { prorata: 'venit pe zile (prorata)', unload: 'venit la descărcare', load: 'venit la încărcare', mixt: 'mod de recunoaștere mixt' };
const FX_SOURCE_RO = {
  ron: 'RON', bnr: 'BNR', 'bnr-manual': 'BNR (manual)', 'ecb-v1': 'BCE (indicativ)', 'ecb-v2': 'BCE (indicativ)',
  manual: 'curs manual', 'last-known': 'ultimul curs cunoscut (vechi)',
};
/** Etichetele cerute pe fiecare raport (8.9 AC6): modul de recunoaștere și sursa cursului. */
export function reportMeta(state, range, o = {}) {
  const f = fleetPnl(state, range, o).total;
  const sources = f.fxSources.filter((s) => s !== 'ron');
  return {
    currency: cur0(o),
    recognition: f.recognition || companyOf(state).revenueRecognition,
    recognitionLabel: RECOGNITION_RO[f.recognition] || RECOGNITION_RO[companyOf(state).revenueRecognition] || '',
    fxSources: f.fxSources,
    fxSourcesLabel: sources.length ? sources.map((s) => FX_SOURCE_RO[s] || s).join(', ') : 'fără valută străină',
    nonBnrCount: f.nonBnrCount,
    provisionalCount: f.provisionalCount,
    disclaimer: 'Niciunul dintre aceste profituri nu este profitul contabil sau fiscal.',
  };
}

// ----------------------------------------------------------------------------- serii și categorii
/** Σ km GPS / goi pe flotă pe luni, într-o singură trecere prin computeEmptyKm. Cheie = 'YYYY-MM'. */
function fleetEmptyByMonth(state, range) {
  return memo(state, `fleetEmpty|${range.from}|${range.to}`, () => {
    const truckIds = coll(state, 'trucks').map((t) => t.id);
    const r = computeEmptyKm({
      truckIds, range, granularity: 'month', courses: coll(state, 'courses'), gpsDays: coll(state, 'gpsDays'), gpsTrips: coll(state, 'gpsTrips'),
      aliases: coll(state, 'aliases'), company: companyOf(state),
    });
    const m = new Map();
    for (const row of r.rows) {
      if (row.gpsM === null || row.gpsM === undefined) continue;
      const k = String(row.bucket).slice(0, 7);
      const a = m.get(k) || { gpsM: 0, loadedM: 0, emptyM: 0 };
      a.gpsM += row.gpsM; a.loadedM += row.loadedM || 0; a.emptyM += row.emptyM || 0;
      m.set(k, a);
    }
    return m;
  });
}

/** Serie lunară pentru flotă: venit, cost, profit op., % gol. */
export function monthlySeries(state, range, o = {}) {
  const byMonth = fleetEmptyByMonth(state, range);
  return eachMonth(monthOf(range.from), monthOf(range.to)).map((month) => {
    const seg = clipRange(range, rangeOfMonth(month));
    const t = fleetPnl(state, seg, o).total;
    const k = byMonth.get(month);
    return { month, revenue: t.revenue, cost: t.costTotal, profitOp: t.profitOp, emptyPct: k && k.gpsM ? k.emptyM / k.gpsM : null };
  });
}

/** Cheltuieli pe categorii (directe + comune, fără amortizare și fără sume „în numerar”), cu/fără document. */
export function categoryBreakdown(state, range, o = {}) {
  const cur = cur0(o);
  const m = new Map();
  for (const l of ledgerLines(state)) {
    if ((l.kind !== 'cost' && l.kind !== 'recovery') || !inRange(l.anchor, range)) continue;
    const r = m.get(l.categoryId) || { categoryId: l.categoryId, cost: 0, noDoc: 0 };
    r.cost += l.v[cur];
    r.noDoc += l.noDoc ? l.noDoc[cur] : 0;
    m.set(l.categoryId, r);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || (a.categoryId < b.categoryId ? -1 : 1));
}

/** Linia permanentă „cheltuieli fără document: X lei (Y% din cost)”. */
export function noDocLine(state, range, o = {}) {
  const t = fleetPnl(state, range, o).total;
  return { amount: t.noDocCost, costTotal: t.costTotal, pct: t.costTotal > 0 ? t.noDocCost / t.costTotal : null, currency: cur0(o) };
}

// ----------------------------------------------------------------------------- TVA
const detailFree = (e) => !e.parentDocId;
function expenseEntries(state, range) {
  return coll(state, 'entries').filter((e) => e.kind === 'expense' && detailFree(e) && inRange(e.docDate || e.date, range));
}

/** Deadline-ul rambursării (informativ): țara.refundDeadlineMmDd în anul următor intrării. */
function refundDeadline(state, e) {
  const c = coll(state, 'countries').find((x) => x.code === e.countryCode || x.id === e.countryCode);
  const mmdd = c?.refundDeadlineMmDd || '09-30';
  return `${+(e.date.slice(0, 4)) + 1}-${mmdd}`;
}

/** TVA străin de recuperat (doar informativ): pe țară și monedă, intrările `toClaim` și `claimed`. */
export function foreignVatReceivable(state, range) {
  const g = new Map();
  for (const e of expenseEntries(state, range)) {
    if (e.ron?.recoverableKind !== 'foreign' || !(e.ron.recoverable > 0)) continue;
    if (e.foreignVatStatus !== 'toClaim' && e.foreignVatStatus !== 'claimed') continue;
    const key = e.countryCode + '|' + e.currency;
    const r = g.get(key) || { countryCode: e.countryCode, currency: e.currency, vat: 0, ron: 0, count: 0, deadline: null };
    const orig = e.ron.vat > 0 && e.orig?.vat ? mulDiv(e.orig.vat, e.ron.recoverable, e.ron.vat) : e.ron.recoverable;
    r.vat += orig; r.ron += e.ron.recoverable; r.count++;
    const dl = refundDeadline(state, e);
    if (!r.deadline || dl < r.deadline) r.deadline = dl;
    g.set(key, r);
  }
  return [...g.values()].sort((a, b) => (a.countryCode < b.countryCode ? -1 : a.countryCode > b.countryCode ? 1 : a.currency < b.currency ? -1 : 1));
}

/**
 * Sumar TVA pe interval (5.10). Valori în RON; TVA străin și în moneda originală. Informativ, nu este decont (D300).
 */
export function vatSummary(state, range) {
  let deductibleRo = 0, nonDeductible = 0, selfAssessed = 0, foreignRecoverable = 0, rejected = 0, refunded = 0;
  const byRegime = {};
  for (const e of expenseEntries(state, range)) {
    const r = e.ron || {};
    const t = e.vat?.treatment;
    byRegime[e.vatRegime] = (byRegime[e.vatRegime] || 0) + (r.vat || 0);
    if (r.recoverableKind === 'ro') deductibleRo += r.recoverable || 0;
    if (r.recoverableKind === 'foreign') {
      if (e.foreignVatStatus === 'rejected') rejected += r.recoverable || 0;
      else if (e.foreignVatStatus === 'refunded') refunded += r.recoverable || 0;
      else foreignRecoverable += r.recoverable || 0;
    }
    if ((t === 'taxed' || t === 'nondeductible') && (r.vat || 0) > 0) nonDeductible += r.vat - (r.recoverable || 0);
    selfAssessed += r.selfAssessedVat || 0;
  }
  let collected = 0;
  for (const c of coll(state, 'courses')) {
    if (inRange(c.invoiceDate || c.loadDate, range)) collected += c.ron?.vat || 0;
  }
  return {
    deductibleRo, nonDeductible, selfAssessed, foreignRecoverable, foreignRejected: rejected, foreignRefunded: refunded, collected,
    foreign: foreignVatReceivable(state, range), byRegime,
    note: 'Nu este decont de TVA (D300). Contabilul rămâne responsabil.',
  };
}

// ----------------------------------------------------------------------------- jurnal contabil / export contabil (H)
const DOC_RO = { invoice: 'factură', receipt: 'bon', none: 'fără document' };
export const JOURNAL_COLUMNS = Object.freeze([
  'kind', 'date', 'docDate', 'docNo', 'supplier', 'supplierVatId', 'countryCode', 'currency', 'origNet', 'origVat', 'origGross',
  'ronNet', 'ronVat', 'ronGross', 'eurGross', 'vatTreatment', 'vatRegime', 'deductiblePct', 'accountCode', 'category', 'documentation',
  'documentationLabel', 'moneySource', 'fxSource', 'fxRate', 'truck', 'status',
]);

/**
 * Jurnal contabil (5.10, 17.3 H): un rând per intrare (cheltuieli și „alte venituri”) și, dacă `includeCourses`, per cursă facturată.
 * Sumele rămân Minor (originale în valuta lor, RON separat); exportul le formatează.
 */
export function accountingJournal(state, range, o = {}) {
  const cats = new Map(coll(state, 'categories').map((c) => [c.id, c]));
  const trucks = new Map(coll(state, 'trucks').map((t) => [t.id, t]));
  const rows = [];
  for (const e of coll(state, 'entries')) {
    if (!detailFree(e) || !inRange(e.docDate || e.date, range)) continue;
    if (e.kind === 'income' && e.incomeType === 'freight') continue;
    const c = cats.get(e.categoryId);
    const tr = e.target?.type === 'truck' ? trucks.get(e.target.truckId) : null;
    rows.push({
      kind: e.kind === 'income' ? 'venit' : 'cheltuială', date: e.date, docDate: e.docDate || e.date, docNo: e.docNo || '', supplier: e.supplier || '',
      supplierVatId: e.counterpartyVatId || '', countryCode: e.countryCode || '', currency: e.currency, origNet: e.orig?.net ?? 0,
      origVat: e.orig?.vat ?? 0, origGross: e.orig?.gross ?? 0, ronNet: e.ron?.net ?? 0, ronVat: e.ron?.vat ?? 0, ronGross: e.ron?.gross ?? 0,
      eurGross: e.eur?.gross ?? 0, vatTreatment: e.vat?.treatment || '', vatRegime: e.vatRegime || '', deductiblePct: e.vat?.deductiblePct ?? null,
      accountCode: c?.accountCode || '', category: c?.name || e.categoryId, documentation: e.documentation, documentationLabel: DOC_RO[e.documentation] || '',
      moneySource: e.moneySource || '', fxSource: e.fx?.source || '', fxRate: e.fx?.ronPerUnit || '', truck: tr ? (tr.plateDisplay || tr.plate) : (e.target?.type === 'company' ? 'comun' : ''),
      status: e.status, ref: { type: 'entry', id: e.id },
    });
  }
  if (o.includeCourses !== false) {
    for (const c of coll(state, 'courses')) {
      if (!inRange(c.invoiceDate || c.loadDate, range) || c.priceStatus === 'missing') continue;
      const tr = trucks.get(c.truckId);
      rows.push({
        kind: 'venit (cursă)', date: c.invoiceDate || c.loadDate, docDate: c.invoiceDate || c.loadDate, docNo: c.invoiceNo || '', supplier: c.clientName || '',
        supplierVatId: '', countryCode: '', currency: c.currency, origNet: c.net ?? 0, origVat: c.vat ?? 0, origGross: c.gross ?? 0,
        ronNet: c.ron?.net ?? 0, ronVat: c.ron?.vat ?? 0, ronGross: c.ron?.gross ?? 0, eurGross: c.eur?.gross ?? 0,
        vatTreatment: c.vatTreatment || '', vatRegime: '', deductiblePct: null, accountCode: '', category: 'Venit din curse',
        documentation: c.invoiceNo ? 'invoice' : 'none', documentationLabel: c.invoiceNo ? 'factură' : 'fără nr. factură', moneySource: '',
        fxSource: c.fx?.source || '', fxRate: c.fx?.ronPerUnit || '', truck: tr ? (tr.plateDisplay || tr.plate) : '', status: c.status,
        ref: { type: 'course', id: c.id },
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ref.id < b.ref.id ? -1 : 1));
  return rows;
}

/** Totaluri RON ale jurnalului pe tip de rând (egale la ban cu suma intrărilor din spate, 17.3 H AC). */
export function journalTotals(rows) {
  const out = {};
  for (const r of rows) {
    const t = out[r.kind] || (out[r.kind] = { ronNet: 0, ronVat: 0, ronGross: 0, count: 0 });
    t.ronNet += r.ronNet; t.ronVat += r.ronVat; t.ronGross += r.ronGross; t.count++;
  }
  return out;
}

// ----------------------------------------------------------------------------- fără document
/**
 * Raportul „Fără document” (5.4): intrările fără document, partea din cost și depășirile de plafon.
 */
export function noDocReport(state, range, o = {}) {
  const cur = cur0(o);
  const company = companyOf(state);
  const rows = [];
  const perMonthTruck = new Map();
  for (const e of coll(state, 'entries')) {
    if (e.kind !== 'expense' || e.documentation !== 'none' || e.parentDocId || !inRange(e.date, range)) continue;
    const v = (cur === 'EUR' ? e.eur : e.ron)?.cost ?? 0;
    const tid = e.target?.truckId || null;
    const k = `${monthOf(e.date)}|${tid || ''}`;
    perMonthTruck.set(k, (perMonthTruck.get(k) || 0) + (e.ron?.cost ?? 0));
    const over = (e.ron?.gross ?? 0) > (company.noDocCeilingMinor ?? Infinity);
    rows.push({
      entryId: e.id, date: e.date, truckId: tid, categoryId: e.categoryId, supplier: e.supplier, amount: v, moneySource: e.moneySource,
      justification: e.justification || null, approvedAt: e.approvedAt || null, overCeiling: over, missingJustification: over && !e.justification,
    });
  }
  const monthly = [];
  for (const [k, v] of perMonthTruck) {
    const [month, truckId] = k.split('|');
    const over = v > (company.noDocCeilingMonthlyPerTruckMinor ?? Infinity);
    monthly.push({ month, truckId: truckId || null, ron: v, overCeiling: over });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId < b.entryId ? -1 : 1));
  const line = noDocLine(state, range, o);
  return { rows, monthly, total: rows.reduce((s, r) => s + r.amount, 0), pctOfCost: line.pct, costTotal: line.costTotal, currency: cur };
}

/** Curse neîncasate (informativ): `paidDate` gol și termen depășit. Venitul NU se recunoaște după încasare (5.4). */
export function unpaidCourses(state, today) {
  const rows = [];
  for (const c of coll(state, 'courses')) {
    if (c.paidDate || !c.dueDate || c.dueDate >= today || c.priceStatus === 'missing') continue;
    rows.push({ courseId: c.id, truckId: c.truckId, clientName: c.clientName || '', invoiceNo: c.invoiceNo || '', dueDate: c.dueDate, ronGross: c.ron?.gross ?? 0, currency: c.currency, origGross: c.gross ?? 0 });
  }
  return rows.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

/** Cursurile folosite și cele manuale / vechi / ne-BNR în interval (raportul „Cursuri folosite”). */
export function fxUsage(state, range) {
  const rows = [];
  const add = (type, rec, date) => {
    if (!rec.fx || rec.fx.source === 'ron') return;
    rows.push({
      type, id: rec.id, date, currency: rec.currency, ronPerUnit: rec.fx.ronPerUnit, rateDate: rec.fx.rateDate, source: rec.fx.source,
      manual: !!rec.fx.manual, stale: !!rec.fx.stale, notBnr: !isBnrSource(rec.fx.source),
    });
  };
  for (const e of coll(state, 'entries')) if (inRange(e.docDate || e.date, range)) add('entry', e, e.date);
  for (const c of coll(state, 'courses')) if (inRange(c.loadDate, range)) add('course', c, c.loadDate);
  return { rows, manual: rows.filter((r) => r.manual).length, stale: rows.filter((r) => r.stale).length, notBnr: rows.filter((r) => r.notBnr).length };
}

// ----------------------------------------------------------------------------- km pe gol
const sumRows = (rows, truckId) => {
  let g = 0, l = 0, e = 0, any = false;
  for (const r of rows) {
    if (truckId && r.truckId !== truckId) continue;
    if (r.gpsM === null || r.gpsM === undefined) continue;
    any = true; g += r.gpsM; l += r.loadedM || 0; e += r.emptyM || 0;
  }
  return any ? { gpsM: g, loadedM: l, emptyM: e } : { gpsM: null, loadedM: 0, emptyM: null };
};

/**
 * Raportul „Km pe gol” (5.8, 17.2): EmptyKmResult + KPI, pe camion, trend 12 luni și reperele din Setări.
 * Costul km pe gol = km goi × cost variabil/km (fereastră mobilă de 3 luni); „cost complet” adaugă costurile fixe și comune pe km.
 * Nu se afișează 0 pentru lipsă de date: gpsM/emptyM/pct sunt null pentru camioane fără GPS.
 * @param {object} state @param {{from:string,to:string}} range @param {{granularity?:string, currency?:string, trendMonths?:number}} [o]
 */
export function emptyKmReport(state, range, o = {}) {
  const cur = cur0(o);
  const trucks = coll(state, 'trucks');
  const truckIds = trucks.map((t) => t.id);
  const res = computeEmptyKm({
    truckIds, range, granularity: o.granularity || 'month', courses: coll(state, 'courses'), gpsDays: coll(state, 'gpsDays'), gpsTrips: coll(state, 'gpsTrips'),
    aliases: coll(state, 'aliases'), company: companyOf(state),
  });
  const win = rollingWindow(range).range;
  const byTruck = [];
  let totG = 0, totL = 0, totE = 0, totCostVar = 0, totCostFull = 0, totRev = 0, anyKm = false, approx = false;
  const noGps = [];
  for (const t of trucks) {
    const s = sumRows(res.rows, t.id);
    const p = truckPnl(state, t.id, range, { currency: cur, recognition: o.recognition });
    const rates = costRates(state, t.id, range.to, { currency: cur, window: win });
    if (s.gpsM === null) { noGps.push(t.id); byTruck.push({ truckId: t.id, plate: t.plate, gpsM: null, loadedM: null, emptyM: null, pctEmpty: null, emptyCostVar: null, emptyCostFull: null, varPerKmMilli: null, fullPerKmMilli: null, revenue: p.revenue, revenuePerLoadedKm: null, revenuePerTotalKm: null, approx: false }); continue; }
    anyKm = true;
    const varMilli = rates.varPerKmMilli, fullMilli = rates.fullPerKmMilli;
    const costVar = varMilli === null ? null : mulDiv(varMilli, s.emptyM, 1000000);
    const costFull = fullMilli === null ? null : mulDiv(fullMilli, s.emptyM, 1000000);
    const conf = p.kmConfidence;
    const ap = conf === 'medium' || conf === 'low';
    approx = approx || ap;
    byTruck.push({
      truckId: t.id, plate: t.plate, gpsM: s.gpsM, loadedM: s.loadedM, emptyM: s.emptyM, pctEmpty: s.gpsM ? s.emptyM / s.gpsM : null,
      emptyCostVar: costVar, emptyCostFull: costFull, varPerKmMilli: varMilli, fullPerKmMilli: fullMilli, revenue: p.revenue,
      revenuePerLoadedKm: s.loadedM ? mulDiv(p.revenue, 1000, s.loadedM) : null, revenuePerTotalKm: s.gpsM ? mulDiv(p.revenue, 1000, s.gpsM) : null,
      approx: ap, lowConfidence: conf === 'low',
    });
    totG += s.gpsM; totL += s.loadedM; totE += s.emptyM; totRev += p.revenue;
    if (costVar !== null) totCostVar += costVar;
    if (costFull !== null) totCostFull += costFull;
  }
  byTruck.sort((a, b) => (a.pctEmpty === null) - (b.pctEmpty === null) || (b.pctEmpty ?? 0) - (a.pctEmpty ?? 0));

  // trend lunar: ultimele N luni până la luna finală a intervalului
  const nTrend = o.trendMonths ?? 12;
  const endM = monthOf(range.to);
  const months = eachMonth(shiftMonth(endM, -(nTrend - 1)), endM);
  const trendRange = { from: monthRange(months[0]).from, to: monthRange(endM).to };
  const byMonth = fleetEmptyByMonth(state, trendRange);
  const trend = months.map((month) => {
    const k = byMonth.get(month);
    return { month, gpsM: k ? k.gpsM : null, loadedM: k ? k.loadedM : null, emptyM: k ? k.emptyM : null, pctEmpty: k && k.gpsM ? k.emptyM / k.gpsM : null };
  });

  return {
    ...res,
    trucks: byTruck,   // pe camion, cu cost/venit pe km (EmptyKmResult.byTruck rămâne cel al motorului)
    trend,
    benchmarks: benchmarksOf(state),
    noGpsTruckIds: noGps,
    currency: cur,
    kpis: {
      pctEmpty: anyKm && totG ? totE / totG : null,
      gpsM: anyKm ? totG : null, loadedM: anyKm ? totL : null, emptyM: anyKm ? totE : null,
      emptyCostRon: anyKm ? totCostVar : null, emptyCostFullRon: anyKm ? totCostFull : null,
      emptyCost: anyKm ? totCostVar : null, emptyCostFull: anyKm ? totCostFull : null,
      revenuePerLoadedKm: anyKm && totL ? mulDiv(totRev, 1000, totL) : null,
      revenuePerTotalKm: anyKm && totG ? mulDiv(totRev, 1000, totG) : null,
      approx,
    },
  };
}

function shiftMonth(m, k) {
  let [y, mm] = m.split('-').map(Number);
  mm += k;
  while (mm < 1) { mm += 12; y--; }
  while (mm > 12) { mm -= 12; y++; }
  return `${String(y).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

