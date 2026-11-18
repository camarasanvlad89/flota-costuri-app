// buildWorkbook: asamblează foile și graficele. Fazele grafice (D8): 'spike' = 1 grafic,
// 'three' = 3 grafice (implicit), 'all' = 6 grafice.
import { XlsxWorkbook, ST, colLetter } from './xlsx-writer.js';
import { roundDiv, coll, single, byId, inRange, monthOf, curKey, sumInts, kmStr, truckLabel, ratioStr, monthsInRange } from './data-access.js';
import { minorToDecimal, currencyExpLocal } from './csv-export.js';
import { LEDGER_HEADER, ledgerRows } from './ledger.js';
import { fleetPnl, courseRevenueInRange } from '../domain/profit.js';
import { emptyKmReport, categoryBreakdown } from '../domain/reports.js';
import { reconcile as reconcileDomain, FLAG_CODES } from '../domain/reconcile.js';
import { prepareTruck } from '../domain/emptyKm.js';
import { eachMonth, monthRange } from '../core/dates.js';

export const ALL_SHEETS = ['summary', 'ranking', 'monthly', 'categories', 'emptyKm', 'courses', 'entries', 'vat', 'journal', 'noDoc', 'reconcile', 'quality', 'rates', 'grouping'];
const NAMES = {
  summary: 'Rezumat', ranking: 'Clasament', monthly: 'Profit lunar', categories: 'Categorii', emptyKm: 'Km pe gol',
  courses: 'Curse', entries: 'Cheltuieli', vat: 'TVA', journal: 'Jurnal contabil', noDoc: 'Fără document',
  reconcile: 'Confruntare GPS', quality: 'Calitate date', rates: 'Cursuri', grouping: 'Grupare',
};
const REC_LABEL = { unload: 'la data descărcării', load: 'la data încărcării', prorata: 'proporțional pe zilele cursei' };
const DOC_LABEL = { invoice: 'factură', receipt: 'bon', none: 'fără document' };

function num(v) { return Number(v); }
function money(currency, m) { return { m, cur: currency }; }

class Ctx {
  constructor(state, opts) {
    this.state = state; this.opts = opts; this.range = opts.range; this.currency = opts.currency === 'EUR' ? 'EUR' : 'RON';
    this.k = curKey(this.currency);
    this.exp = currencyExpLocal(this.currency);
    this.company = single(state, 'company');
    this.trucks = coll(state, 'trucks'); this.truckMap = byId(this.trucks);
    this.cats = coll(state, 'categories'); this.catMap = byId(this.cats);
    this.entries = coll(state, 'entries').filter((e) => inRange(e.date, this.range));
    this.courses = coll(state, 'courses');
    this.recognition = opts.recognition || this.company.revenueRecognition || 'prorata';
    this.recLabel = REC_LABEL[this.recognition] || this.recognition;
    this.fxSources = [...new Set(this.entries.map((e) => e.fx?.source).filter(Boolean))].sort();
  }
  costOf(e) { return e[this.k]?.cost ?? 0; }
  courseNet(c) { return c[this.k]?.net ?? 0; }
  // recunoaștere simplificată în export: după data descărcării (sau încărcării); „prorata” se aproximează la descărcare.
  courseDate(c) { return this.recognition === 'load' ? c.loadDate : c.unloadDate; }
  coursesInRange() { return this.courses.filter((c) => inRange(this.courseDate(c), this.range)); }
  sheetNote(extra) {
    return `Perioadă ${this.range.from} – ${this.range.to} · valută de raportare ${this.currency} · venit recunoscut ${this.recLabel} · surse curs: ${this.fxSources.join(', ') || 'n/a'}${this.filtered ? ' · FILTRAT (camioane/categorii alese; costurile comune se repartizează doar pe camioanele alese)' : ''}${extra ? ' · ' + extra : ''}`;
  }
}

function openSheet(wb, ctx, key, title, widths, extraNote) {
  const sh = wb.addSheet(NAMES[key] || key);
  sh.addRow([{ v: title, s: ST.TITLE }], { height: 24 });
  sh.addRow([{ v: ctx.sheetNote(extraNote), s: ST.NOTE }]);
  sh.blank();
  sh.setCols(widths);
  return sh; // antetul tabelului = rândul 4
}
function numCol(n) { return { n: String(n) }; }

function aggregate(ctx) {
  const pre = ctx.opts.precomputed || {};
  const perTruck = new Map(ctx.trucks.map((t) => [t.id, { revenue: 0, cost: 0, courses: 0, entries: 0 }]));
  let commonCost = 0, otherIncome = 0, commonCount = 0;
  const byMonth = new Map();
  const month = (m) => { if (!byMonth.has(m)) byMonth.set(m, { revenue: 0, cost: 0 }); return byMonth.get(m); };
  for (const e of ctx.entries) {
    if (e.status === 'pending' && ctx.company.excludeAutoPendingFromProfit && e.source === 'recurring') continue;
    const mo = month(e.accrualMonth || monthOf(e.date));
    if (e.kind === 'income') {
      const v = e[ctx.k]?.net ?? 0;
      if (e.incomeType === 'freight' && e.courseId) continue; // venitul din curse vine din tabelul de curse
      const t = perTruck.get(e.target?.truckId);
      if (t) t.revenue += v; else otherIncome += v;
      mo.revenue += v;
    } else {
      const c = ctx.costOf(e);
      const t = perTruck.get(e.target?.truckId);
      if (t) { t.cost += c; t.entries++; } else { commonCost += c; commonCount++; }
      mo.cost += c;
    }
  }
  for (const c of ctx.coursesInRange()) {
    const v = ctx.courseNet(c);
    const t = perTruck.get(c.truckId);
    if (t) { t.revenue += v; t.courses++; } else otherIncome += v;
    month(monthOf(ctx.courseDate(c))).revenue += v;
  }
  const rows = ctx.trucks.map((t) => ({ id: t.id, label: truckLabel(t), ...perTruck.get(t.id) }));
  // Totalurile vin din domeniu (profit.js) ca să fie identice cu ecranele: amortizare, recunoaștere pro-rata, recuperări, cheltuieli comune.
  let monthlyDomain = null;
  try {
    const popt = { currency: ctx.currency, recognition: ctx.opts.recognition };
    const f = fleetPnl(ctx.state, ctx.range, popt);
    for (const r of rows) { const p = f.trucks[r.id]; if (p) { r.revenue = p.revenue; r.cost = p.costTotal; } }
    commonCost = f.unallocatedOverhead; otherIncome = f.unallocatedRevenue;
    ctx.domainProfit = f.total.profitOp;
    ctx.domainDepreciation = f.total.depreciation || 0;
    ctx.domainCostTotal = f.total.costTotal;
    monthlyDomain = eachMonth(ctx.range.from.slice(0, 7), ctx.range.to.slice(0, 7)).map((m) => {
      const mr = monthRange(m);
      const r = { from: mr.from < ctx.range.from ? ctx.range.from : mr.from, to: mr.to > ctx.range.to ? ctx.range.to : mr.to };
      const t = fleetPnl(ctx.state, r, popt).total;
      return { month: m, revenue: t.revenue, cost: t.costTotal };
    });
  } catch { /* stare minimală (teste): rămâne agregarea locală */ }
  if (Array.isArray(pre.ranking)) { // rezultatul domeniului are prioritate
    for (const r of pre.ranking) {
      const row = rows.find((x) => x.id === r.truckId);
      if (row) { row.revenue = r.revenue; row.cost = r.cost; }
    }
  }
  const monthly = monthlyDomain || [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => ({ month: m, ...v }));
  const preM = Array.isArray(pre.monthly) ? new Map(pre.monthly.map((r) => [r.month, r])) : null;
  if (preM) monthly.forEach((r) => { const p = preM.get(r.month); if (p) { r.revenue = p.revenue; r.cost = p.cost; } });
  return { rows, commonCost, otherIncome, commonCount, monthly };
}

function maxPos(n, min) { return Math.max(n, min); }

function chartAnchor(sh, afterCol, row0 = 3) { return { col: afterCol, row: row0, toCol: afterCol + 9, toRow: row0 + 20 }; }

function buildRanking(wb, ctx, agg, charts) {
  const sh = openSheet(wb, ctx, 'ranking', 'Clasamentul camioanelor', [22, 16, 16, 16, 12, 10]);
  sh.addHeader(['Camion', 'Venit net', 'Cost', 'Profit operațional', 'Marjă', 'Curse']);
  const first = sh.lastRow + 1;
  const sorted = [...agg.rows].sort((a, b) => (b.revenue - b.cost) - (a.revenue - a.cost));
  for (const r of sorted) {
    const row = sh.lastRow + 1;
    sh.addRow([r.label, money(ctx.currency, r.revenue), money(ctx.currency, r.cost),
      { f: `B${row}-C${row}`, v: minorToDecimal(r.revenue - r.cost, ctx.exp), s: ST.MONEY },
      r.revenue ? { f: `IF(B${row}=0,0,D${row}/B${row})`, v: String(Math.round(((r.revenue - r.cost) / r.revenue) * 1e6) / 1e6), s: ST.PCT } : null, // money-ok: nu sunt bani (afișare, km, procente sau pondere)
      { v: r.courses, s: ST.INT }]);
  }
  const last = sh.lastRow;
  const commonRow = sh.addRow(['Comun firmă / nealocat', money(ctx.currency, agg.otherIncome), money(ctx.currency, agg.commonCost),
    { f: `B${sh.lastRow + 1}-C${sh.lastRow + 1}`, v: minorToDecimal(agg.otherIncome - agg.commonCost, ctx.exp), s: ST.MONEY }]);
  const sumRev = sumInts(agg.rows.map((r) => r.revenue)) + agg.otherIncome;
  const sumCost = sumInts(agg.rows.map((r) => r.cost)) + agg.commonCost;
  sh.addRow([{ v: 'Total flotă', s: ST.BOLD },
    { f: `SUM(B${first}:B${commonRow})`, v: minorToDecimal(sumRev, ctx.exp), s: ST.MONEY_B },
    { f: `SUM(C${first}:C${commonRow})`, v: minorToDecimal(sumCost, ctx.exp), s: ST.MONEY_B },
    { f: `SUM(D${first}:D${commonRow})`, v: minorToDecimal(sumRev - sumCost, ctx.exp), s: ST.MONEY_B }]);
  sh.freezeAt(4);
  agg.totals = { revenue: sumRev, cost: sumCost, profit: sumRev - sumCost, totalRow: sh.lastRow, firstRow: first, commonRow };
  if (charts.has('profitTruck') && sorted.length) {
    sh.addChart({
      type: 'col', title: `Profit pe camion (${ctx.currency})`, valFmt: '#,##0', valTitle: ctx.currency, legend: false,
      series: [{ name: 'Profit operațional', nameRef: sh.ref(3, 4), catRef: sh.ref(0, first, last), valRef: sh.ref(3, first, last),
        cats: sorted.map((r) => r.label), vals: sorted.map((r) => num(minorToDecimal(r.revenue - r.cost, ctx.exp))) }],
    }, chartAnchor(sh, 7));
  }
  return sh;
}

function buildMonthly(wb, ctx, agg, charts) {
  const sh = openSheet(wb, ctx, 'monthly', 'Profit lunar al flotei', [14, 16, 16, 18]);
  sh.addHeader(['Luna', 'Venit net', 'Cost', 'Profit operațional']);
  const first = sh.lastRow + 1;
  for (const r of agg.monthly) {
    const row = sh.lastRow + 1;
    sh.addRow([r.month, money(ctx.currency, r.revenue), money(ctx.currency, r.cost),
      { f: `B${row}-C${row}`, v: minorToDecimal(r.revenue - r.cost, ctx.exp), s: ST.MONEY }]);
  }
  const last = sh.lastRow;
  sh.freezeAt(4);
  if (agg.monthly.length) {
    sh.addRow([{ v: 'Total', s: ST.BOLD },
      { f: `SUM(B${first}:B${last})`, v: minorToDecimal(sumInts(agg.monthly.map((r) => r.revenue)), ctx.exp), s: ST.MONEY_B },
      { f: `SUM(C${first}:C${last})`, v: minorToDecimal(sumInts(agg.monthly.map((r) => r.cost)), ctx.exp), s: ST.MONEY_B },
      { f: `SUM(D${first}:D${last})`, v: minorToDecimal(sumInts(agg.monthly.map((r) => r.revenue - r.cost)), ctx.exp), s: ST.MONEY_B }]);
  }
  if (charts.has('profitMonth') && agg.monthly.length) {
    sh.addChart({
      type: 'col', title: `Profit lunar flotă (${ctx.currency})`, valFmt: '#,##0', legend: false,
      series: [{ name: 'Profit operațional', nameRef: sh.ref(3, 4), catRef: sh.ref(0, first, last), valRef: sh.ref(3, first, last),
        cats: agg.monthly.map((r) => r.month), vals: agg.monthly.map((r) => num(minorToDecimal(r.revenue - r.cost, ctx.exp))) }],
    }, chartAnchor(sh, 5));
  }
}





// ---------------------------------------------------------------------------------------------- reconcilierea costurilor
/** Cost total (Rezumat) = Σ categorii + amortizare + ajustări; „Σ cheltuieli listate” + repartizări pe luni = Σ categorii. */
function costRecon(ctx, agg) {
  const listed = sumInts(ctx.entries.filter((e) => e.kind !== 'income').map((e) => ctx.costOf(e)));
  let cats = null;
  try { cats = categoryBreakdown(ctx.state, ctx.range, { currency: ctx.currency, recognition: ctx.opts.recognition }); } catch { cats = null; }
  if (!cats) { // stare minimală (teste): gruparea locală pe intrările din perioadă
    const m = new Map();
    for (const e of ctx.entries) {
      if (e.kind === 'income') continue;
      const r = m.get(e.categoryId) || { categoryId: e.categoryId, cost: 0, noDoc: 0 };
      const c = ctx.costOf(e);
      r.cost += c; if (e.documentation === 'none') r.noDoc += c;
      m.set(e.categoryId, r);
    }
    cats = [...m.values()].sort((a, b) => b.cost - a.cost);
  }
  const catSum = sumInts(cats.map((r) => r.cost));
  const total = agg && agg.totals ? agg.totals.cost : catSum;
  const dep = ctx.domainDepreciation || 0;
  return { listed, cats, catSum, dep, other: total - catSum - dep, total, spread: catSum - listed };
}

function buildCategories(wb, ctx, agg, charts) {
  const sh = openSheet(wb, ctx, 'categories', 'Cheltuieli pe categorii', [34, 20, 16, 18, 12], 'categoriile urmează luna de contabilizare (repartizări pe luni incluse); la final: reconcilierea cu costul total din Rezumat');
  sh.addHeader(['Categorie', 'Grup', 'Cost', 'din care fără document', '% din cost']);
  const rec = costRecon(ctx, agg);
  const rows = rec.cats.map((r) => ({ id: r.categoryId, name: ctx.catMap.get(r.categoryId)?.name || r.categoryId || '(fără categorie)', group: ctx.catMap.get(r.categoryId)?.group || '', cost: r.cost, noDoc: r.noDoc || 0 })).sort((a, b) => b.cost - a.cost);
  const total = rec.catSum;
  const first = sh.lastRow + 1;
  for (const r of rows) {
    const row = sh.lastRow + 1;
    sh.addRow([r.name, r.group, money(ctx.currency, r.cost), money(ctx.currency, r.noDoc),
      { f: `IF(SUM(C$${first}:C$${first + rows.length - 1})=0,0,C${row}/SUM(C$${first}:C$${first + rows.length - 1}))`, v: ratioStr(r.cost, total), s: ST.PCT }]);
  }
  const last = sh.lastRow;
  if (rows.length) {
    const totRow = sh.addRow([{ v: 'Total pe categorii', s: ST.BOLD }, '', { f: `SUM(C${first}:C${last})`, v: minorToDecimal(total, ctx.exp), s: ST.MONEY_B },
      { f: `SUM(D${first}:D${last})`, v: minorToDecimal(sumInts(rows.map((r) => r.noDoc)), ctx.exp), s: ST.MONEY_B }]);
    // reconcilierea cu Rezumatul: amortizarea și ajustările nu sunt cheltuieli pe categorii
    sh.blank();
    let acc = `C${totRow}`;
    if (rec.dep) { const r = sh.addRow(['Amortizare (nu apare pe categorii)', '', money(ctx.currency, rec.dep)]); acc += `+C${r}`; }
    if (rec.other) { const r = sh.addRow(['Alte ajustări de repartizare (diferență față de Rezumat)', '', money(ctx.currency, rec.other)]); acc += `+C${r}`; }
    sh.addRow([{ v: 'Cost total (= Rezumat / Clasament)', s: ST.BOLD }, '', { f: acc, v: minorToDecimal(rec.total, ctx.exp), s: ST.MONEY_B }]);
  }
  sh.freezeAt(4);
  if (charts.has('categories') && rows.length) {
    const top = rows.slice(0, 12);
    sh.addChart({
      type: 'bar', title: `Cheltuieli pe categorii (${ctx.currency})`, valFmt: '#,##0', legend: false,
      series: [{ name: 'Cost', nameRef: sh.ref(2, 4), catRef: sh.ref(0, first, first + top.length - 1), valRef: sh.ref(2, first, first + top.length - 1),
        cats: top.map((r) => r.name), vals: top.map((r) => num(minorToDecimal(r.cost, ctx.exp))) }],
    }, chartAnchor(sh, 6));
  }
}

const ISSUE_SEV = { error: 'eroare', warn: 'atenție', info: 'info', high: 'mare', medium: 'medie' };

function buildEmptyKm(wb, ctx, agg, charts) {
  const sh = openSheet(wb, ctx, 'emptyKm', 'Km pe gol', [24, 14, 14, 14, 10, 18, 18, 16, 18, 4],
    'aceleași cifre ca ecranul Km pe gol: km încărcați = km GPS din călătoriile cursei (sau estimare pe zile), goi = GPS − încărcați; costurile sunt cele variabile/complete pe km din fereastra mobilă a aplicației');
  sh.addHeader(['Camion', 'Km GPS', 'Km încărcați', 'Km pe gol', '% gol', 'Cost variabil pe gol', 'Cost complet pe gol', 'Cost variabil / km', 'Venit / km încărcat']);
  let rep = null;
  try {
    rep = emptyKmReport(ctx.state, ctx.range, { granularity: 'month', currency: ctx.currency, recognition: ctx.opts.recognition, trendMonths: Math.min(24, monthsInRange(ctx.range)) });
  } catch { rep = null; }
  if (!rep) { sh.addRow([{ v: 'Calculul km pe gol nu este disponibil pentru această stare a datelor.', s: ST.NOTE }]); return; }
  const first = sh.lastRow + 1;
  const withGps = rep.trucks.filter((t) => t.gpsM != null);
  const noGps = rep.trucks.filter((t) => t.gpsM == null);
  const label = (t) => truckLabel(ctx.truckMap.get(t.truckId)) || t.plate || t.truckId;
  for (const t of withGps) {
    const row = sh.lastRow + 1;
    sh.addRow([label(t) + (t.approx ? ' (≈ estimat)' : ''), { n: kmStr(t.gpsM), s: ST.KM }, { n: kmStr(t.loadedM || 0), s: ST.KM },
      { f: `B${row}-C${row}`, v: kmStr(t.emptyM), s: ST.KM },
      t.gpsM ? { f: `IF(B${row}=0,0,D${row}/B${row})`, v: ratioStr(t.emptyM, t.gpsM), s: ST.PCT } : null,
      t.emptyCostVar == null ? null : money(ctx.currency, t.emptyCostVar), t.emptyCostFull == null ? null : money(ctx.currency, t.emptyCostFull),
      t.varPerKmMilli == null ? null : money(ctx.currency, roundDiv(t.varPerKmMilli, 1, 1000)),
      t.revenuePerLoadedKm == null ? null : money(ctx.currency, t.revenuePerLoadedKm)]);
  }
  const last = sh.lastRow;
  if (withGps.length) {
    const tg = sumInts(withGps.map((t) => t.gpsM)), tl = sumInts(withGps.map((t) => t.loadedM || 0)), te = sumInts(withGps.map((t) => t.emptyM));
    const row = sh.lastRow + 1;
    sh.addRow([{ v: 'Total flotă (camioane cu GPS)', s: ST.BOLD }, { f: `SUM(B${first}:B${last})`, v: kmStr(tg), s: ST.KM }, { f: `SUM(C${first}:C${last})`, v: kmStr(tl), s: ST.KM },
      { f: `SUM(D${first}:D${last})`, v: kmStr(te), s: ST.KM }, tg ? { f: `IF(B${row}=0,0,D${row}/B${row})`, v: ratioStr(te, tg), s: ST.PCT } : null,
      { f: `SUM(F${first}:F${last})`, v: minorToDecimal(sumInts(withGps.map((t) => t.emptyCostVar || 0)), ctx.exp), s: ST.MONEY_B },
      { f: `SUM(G${first}:G${last})`, v: minorToDecimal(sumInts(withGps.map((t) => t.emptyCostFull || 0)), ctx.exp), s: ST.MONEY_B }]);
  }
  sh.freezeAt(4);
  if (noGps.length) sh.addRow([{ v: `Fără date GPS în aplicație (necunoscut, nu 0): ${noGps.map(label).join(', ')}.`, s: ST.WARN }]);
  // acoperirea GPS pe luni: cifrele se referă doar la zilele cu GPS (nu se împart costurile unei perioade lungi la km dintr-o singură lună)
  const trend = (rep.trend || []).filter((x) => x.month >= ctx.range.from.slice(0, 7) && x.month <= ctx.range.to.slice(0, 7));
  const gpsMonths = trend.filter((x) => x.gpsM != null && x.gpsM > 0).length;
  const nMonths = monthsInRange(ctx.range);
  if (withGps.length && gpsMonths < nMonths) sh.addRow([{ v: `Atenție: date GPS pentru ${gpsMonths} din ${nMonths} luni ale perioadei. Km, % gol și costurile pe km se referă doar la zilele cu GPS; costul pe km nu se calculează din costul întregii perioade.`, s: ST.WARN }]);
  if (withGps.length && charts.has('loadedEmpty')) {
    sh.addChart({
      type: 'col', grouping: 'stacked', title: 'Km încărcați vs pe gol', valFmt: '#,##0',
      series: [
        { name: 'Km încărcați', nameRef: sh.ref(2, 4), catRef: sh.ref(0, first, last), valRef: sh.ref(2, first, last), cats: withGps.map(label), vals: withGps.map((t) => (t.loadedM || 0) / 1000), color: '548235' },
        { name: 'Km pe gol', nameRef: sh.ref(3, 4), catRef: sh.ref(0, first, last), valRef: sh.ref(3, first, last), cats: withGps.map(label), vals: withGps.map((t) => t.emptyM / 1000), color: 'C55A11' },
      ],
    }, chartAnchor(sh, 10));
  }
  if (withGps.length && charts.has('costKm')) {
    sh.addChart({
      type: 'col', title: `Cost variabil pe km (${ctx.currency})`, valFmt: '#,##0.00', legend: false,
      series: [{ name: 'Cost variabil / km', nameRef: sh.ref(7, 4), catRef: sh.ref(0, first, last), valRef: sh.ref(7, first, last),
        cats: withGps.map(label), vals: withGps.map((t) => (t.varPerKmMilli == null ? null : num(minorToDecimal(roundDiv(t.varPerKmMilli, 1, 1000), ctx.exp)))) }],
    }, { col: 10, row: 25, toCol: 19, toRow: 45 });
  }
  // trend lunar % gol, cu reperele (orientative) din Setări
  const months = trend.filter((x) => x.gpsM != null && x.gpsM > 0);
  if (months.length) {
    sh.blank();
    const b = rep.benchmarks || {};
    const hr = sh.addHeader(['Luna', 'Km GPS', 'Km încărcați', 'Km pe gol', '% gol', 'Reper medie (orientativ, sursă comercială)', 'Țintă (orientativ, sursă comercială)']);
    const f2 = sh.lastRow + 1;
    for (const v of months) {
      const row = sh.lastRow + 1;
      sh.addRow([v.month, { n: kmStr(v.gpsM), s: ST.KM }, { n: kmStr(v.loadedM || 0), s: ST.KM }, { f: `B${row}-C${row}`, v: kmStr(v.emptyM), s: ST.KM },
        { f: `IF(B${row}=0,0,D${row}/B${row})`, v: ratioStr(v.emptyM, v.gpsM), s: ST.PCT },
        b.avgEmptyPct != null ? { n: String(b.avgEmptyPct / 100), s: ST.PCT } : null, b.targetEmptyPct != null ? { n: String(b.targetEmptyPct / 100), s: ST.PCT } : null]);
    }
    const l2 = sh.lastRow;
    if (charts.has('emptyPctMonth')) {
      const series = [{ name: '% gol', nameRef: sh.ref(4, hr), catRef: sh.ref(0, f2, l2), valRef: sh.ref(4, f2, l2), cats: months.map((x) => x.month), vals: months.map((v) => v.emptyM / v.gpsM) }];
      if (b.avgEmptyPct != null) series.push({ name: 'Reper medie (orientativ)', nameRef: sh.ref(5, hr), catRef: sh.ref(0, f2, l2), valRef: sh.ref(5, f2, l2), cats: months.map((x) => x.month), vals: months.map(() => b.avgEmptyPct / 100), color: 'A5A5A5' });
      if (b.targetEmptyPct != null) series.push({ name: 'Țintă (orientativ)', nameRef: sh.ref(6, hr), catRef: sh.ref(0, f2, l2), valRef: sh.ref(6, f2, l2), cats: months.map((x) => x.month), vals: months.map(() => b.targetEmptyPct / 100), color: '548235' });
      sh.addChart({ type: 'line', title: '% km pe gol pe lună', valFmt: '0%', legend: series.length > 1, series }, { col: 10, row: 46, toCol: 19, toRow: 66 });
    }
  }
  const issues = (rep.issues || []).slice(0, 60);
  if (issues.length) {
    sh.blank();
    sh.addRow([{ v: 'Calitatea datelor (km pe gol)', s: ST.BOLD }]);
    sh.addHeader(['Severitate', 'Data', 'Camion', 'Mesaj']);
    for (const q of issues) sh.addRow([ISSUE_SEV[q.severity] || q.severity || '', q.date ? { d: q.date } : '', truckLabel(ctx.truckMap.get(q.truckId)), q.message || '']);
  }
}

const COURSE_KM_SRC = { 'gps-trips': 'GPS (călătorii)', gps: 'GPS', column: 'din tabel', manual: 'manual', route: 'rută (estimat)', declared: 'declarat' };

function buildCourses(wb, ctx) {
  const sh = openSheet(wb, ctx, 'courses', 'Curse', [12, 12, 14, 12, 14, 34, 8, 14, 12, 14, 12, 14, 14, 14, 18, 14, 16, 12, 22], `„Net recunoscut” = partea din net care intră în perioadă după modul de recunoaștere (aceeași valoare ca în Clasament); „Net RON/EUR” = valoarea întreagă a cursei`);
  sh.addHeader(['Încărcare', 'Descărcare', 'Camion', 'Remorcă', 'Șofer', 'Rută', 'Valută', 'Net orig.', 'TVA orig.', 'Brut orig.', 'Curs', 'Sursă curs', 'Net RON', 'Net EUR', `Net recunoscut în perioadă (${ctx.currency})`, 'Km încărcați', 'Sursă km', 'Preț', 'Observații']);
  const hr = sh.lastRow;
  const overlap = (c) => c.loadDate && c.loadDate <= ctx.range.to && (c.unloadDate || c.loadDate) >= ctx.range.from;
  const list = ctx.courses.filter(overlap).sort((a, b) => (a.loadDate + a.id).localeCompare(b.loadDate + b.id));
  // km încărcați reali: oprirea de încărcare → oprirea de descărcare din călătoriile GPS (ca ecranul Km pe gol)
  const anchorKm = new Map();
  try {
    const gpsDays = coll(ctx.state, 'gpsDays'), gpsTrips = coll(ctx.state, 'gpsTrips'), aliases = coll(ctx.state, 'aliases');
    if (gpsTrips.length) {
      for (const tid of new Set(list.map((c) => c.truckId).filter(Boolean))) {
        const T = prepareTruck(tid, { courses: ctx.courses, gpsDays, gpsTrips, aliases });
        for (const [cid, a] of T.anchors) if (a && a.ok && a.meters != null) anchorKm.set(cid, a.meters);
      }
    }
  } catch { /* fără ancorare: rămân km declarați/estimați */ }
  const recognised = (c) => {
    try { return courseRevenueInRange(ctx.state, c, ctx.range, ctx.currency, ctx.opts.recognition); } catch { return inRange(ctx.courseDate(c), ctx.range) ? ctx.courseNet(c) : 0; }
  };
  let sumRec = 0, sumRon = 0, sumEur = 0;
  for (const c of list) {
    const cur = c.currency || 'RON';
    const rec = recognised(c);
    sumRec += rec; sumRon += c.ron?.net || 0; sumEur += c.eur?.net || 0;
    const gpsM = anchorKm.get(c.id);
    const km = gpsM != null ? { meters: gpsM, source: 'gps-trips' } : c.loadedKm && c.loadedKm.meters ? c.loadedKm : null;
    sh.addRow([{ d: c.loadDate }, { d: c.unloadDate }, truckLabel(ctx.truckMap.get(c.truckId)), c.trailerPlate || '', c.driverRaw || '', c.routeRaw || '', cur,
      c.net === null || c.net === undefined ? null : money(cur, c.net), c.vat === null || c.vat === undefined ? null : money(cur, c.vat), c.gross === null || c.gross === undefined ? null : money(cur, c.gross),
      c.fx?.ronPerUnit || (cur === 'RON' ? '1' : ''), c.fx?.source || (cur === 'RON' ? 'ron' : ''),
      c.ron ? money('RON', c.ron.net) : null, c.eur ? money('EUR', c.eur.net) : null, money(ctx.currency, rec),
      km ? { n: kmStr(km.meters), s: ST.KM } : null, km ? (COURSE_KM_SRC[km.source] || km.source || '') : '',
      { missing: 'lipsă', derived: 'derivat', ok: 'ok' }[c.priceStatus] || c.priceStatus || '', c.note || '']);
  }
  const last = sh.lastRow;
  sh.autoFilter(hr, last, 19);
  sh.freezeAt(hr, 3);
  if (list.length) {
    const tot = (col) => `SUM(${col}${hr + 1}:${col}${last})`;
    sh.addRow([{ v: 'Total', s: ST.BOLD }, '', '', '', '', '', '', '', '', '', '', '',
      { f: tot('M'), v: minorToDecimal(sumRon, 2), s: ST.MONEY_B }, { f: tot('N'), v: minorToDecimal(sumEur, 2), s: ST.MONEY_B }, { f: tot('O'), v: minorToDecimal(sumRec, ctx.exp), s: ST.MONEY_B }]);
    sh.addRow([{ v: `Net recunoscut = venitul net din curse din Clasament (${ctx.recLabel}); „Net RON/EUR” poate fi mai mare dacă o cursă depășește perioada.`, s: ST.NOTE }]);
  }
}

function buildEntries(wb, ctx, agg) {
  const sh = openSheet(wb, ctx, 'entries', 'Cheltuieli și venituri', [12, 10, 16, 22, 22, 7, 8, 14, 10, 14, 12, 14, 14, 14, 14, 14, 14, 14, 16, 16, 14, 10], 'intrările sunt listate după data documentului; la final: reconcilierea cu Categorii și cu costul total din Rezumat');
  sh.addHeader(['Data', 'Tip', 'Camion', 'Categorie', 'Furnizor', 'Țară', 'Valută', 'Sumă originală (brut)', 'Curs → RON', 'Dată curs', 'Sursă curs', 'Brut RON', 'Net RON', 'TVA RON', 'Cost RON', 'Cost EUR', 'Tratament TVA', 'Documentare', 'Status', 'Recurentă']);
  const hr = sh.lastRow;
  const list = [...ctx.entries].sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
  for (const e of list) {
    const cur = e.currency || 'RON';
    sh.addRow([{ d: e.date }, e.kind === 'income' ? 'venit' : 'cheltuială', e.target?.type === 'company' ? 'Comun firmă' : truckLabel(ctx.truckMap.get(e.target?.truckId)),
      ctx.catMap.get(e.categoryId)?.name || e.categoryId || '', e.supplier || '', e.countryCode || '', cur,
      e.orig ? money(cur, e.orig.gross) : null, e.fx?.ronPerUnit || (cur === 'RON' ? '1' : ''), e.fx?.rateDate ? { d: e.fx.rateDate } : null,
      (e.fx?.manual ? 'curs manual' : e.fx?.source) || (cur === 'RON' ? 'ron' : ''),
      money('RON', e.ron?.gross ?? 0), money('RON', e.ron?.net ?? 0), money('RON', e.ron?.vat ?? 0),
      money('RON', e.ron?.cost ?? 0), money('EUR', e.eur?.cost ?? 0),
      e.vat?.treatment || '', DOC_LABEL[e.documentation] || e.documentation || '', e.status || '', e.recurring ? 'da' : '']);
  }
  const last = sh.lastRow;
  sh.autoFilter(hr, last, 20);
  sh.freezeAt(hr, 1);
  if (!list.length) return;
  // totaluri și reconciliere (în valuta de raportare, coloana Cost RON sau Cost EUR)
  const col = ctx.currency === 'EUR' ? 15 : 14, L = colLetter(col);
  const rec = costRecon(ctx, agg);
  const put = (label, cell, bold) => { const cells = new Array(col + 1).fill(''); cells[0] = { v: label, s: bold ? ST.BOLD : ST.DEFAULT }; cells[col] = cell; return sh.addRow(cells); };
  sh.blank();
  const a = put('Total cost cheltuieli listate', { f: `SUMIF(B${hr + 1}:B${last},"cheltuială",${L}${hr + 1}:${L}${last})`, v: minorToDecimal(rec.listed, ctx.exp), s: ST.MONEY_B }, true);
  const b = put('+ Repartizări pe luni / intrări din alte perioade (în Categorii)', money(ctx.currency, rec.spread));
  const c = put('= Total pe categorii (foaia Categorii)', { f: `${L}${a}+${L}${b}`, v: minorToDecimal(rec.catSum, ctx.exp), s: ST.MONEY_B }, true);
  let acc = `${L}${c}`;
  if (rec.dep) { const r = put('+ Amortizare', money(ctx.currency, rec.dep)); acc += `+${L}${r}`; }
  if (rec.other) { const r = put('+ Alte ajustări de repartizare', money(ctx.currency, rec.other)); acc += `+${L}${r}`; }
  put('= Cost total (Rezumat / Clasament)', { f: acc, v: minorToDecimal(rec.total, ctx.exp), s: ST.MONEY_B }, true);
}

function buildJournal(wb, ctx) {
  const sh = openSheet(wb, ctx, 'journal', 'Jurnal contabil', [12, 12, 14, 24, 14, 7, 8, 13, 13, 13, 13, 13, 13, 16, 10, 8, 10, 22, 16, 14, 14, 14, 12, 12, 9], 'același set de rânduri ca CSV-ul contabil și ecranul Jurnal contabil (cheltuieli, alte venituri și curse facturate); sume în RON la cursul înghețat la introducere; export informativ, nu înlocuiește evidența contabilă');
  sh.addHeader(LEDGER_HEADER);
  const hr = sh.lastRow;
  const rows = ledgerRows(ctx.state, ctx.range);
  for (const r of rows) sh.addRow(r.cells);
  const first = hr + 1, last = sh.lastRow;
  sh.autoFilter(hr, last, LEDGER_HEADER.length); sh.freezeAt(hr, 1);
  if (rows.length) {
    const kinds = [...new Set(rows.map((r) => r.kind))];
    for (const k of kinds) {
      const sel = rows.filter((r) => r.kind === k);
      const sumOf = (pick) => sumInts(sel.map((r) => r.row[pick] || 0));
      sh.addRow(['', '', '', { v: `Total ${k}`, s: ST.BOLD }, '', '', '', '', '', '',
        { f: `SUMIF(T${first}:T${last},"${k}",K${first}:K${last})`, v: minorToDecimal(sumOf('ronNet'), 2), s: ST.MONEY_B },
        { f: `SUMIF(T${first}:T${last},"${k}",L${first}:L${last})`, v: minorToDecimal(sumOf('ronVat'), 2), s: ST.MONEY_B },
        { f: `SUMIF(T${first}:T${last},"${k}",M${first}:M${last})`, v: minorToDecimal(sumOf('ronGross'), 2), s: ST.MONEY_B }]);
    }
  }
}

const FLAG_LABEL = {
  IDLE_ON_COURSE: 'Cursă facturată pe zile fără activitate GPS', LOW_KM_VS_ROUTE: 'Prea puțini km GPS față de rută', PLACE_NOT_VISITED: 'Loc de încărcare/descărcare nevizitat',
  UNCOVERED_ACTIVE_PERIOD: 'Zile active GPS fără factură', COURSE_OVERLAP: 'Curse suprapuse', COURSE_NO_PRICE: 'Cursă fără preț', NO_GPS_RANGE: 'Fără date GPS pentru cursă',
};
const SEV_RO = { high: 'mare', medium: 'medie', info: 'info', warn: 'medie', error: 'mare' };
const SUPPORT_RO = { supported: 'cu suport GPS', unsupported: 'fără suport GPS', noGps: 'fără date GPS', none: '—' };

function buildReconcile(wb, ctx) {
  const sh = openSheet(wb, ctx, 'reconcile', 'Confruntare GPS vs facturat', [12, 16, 34, 14, 14, 14, 14, 16, 18, 18, 40],
    'rezultatul este calculat la export din cursele facturate și datele GPS (aceeași logică ca ecranul); starea și nota steagurilor vin din cele salvate');
  let r = null;
  try {
    r = reconcileDomain({
      truckIds: ctx.trucks.map((t) => t.id), courses: ctx.courses, gpsDays: coll(ctx.state, 'gpsDays'), gpsTrips: coll(ctx.state, 'gpsTrips'), aliases: coll(ctx.state, 'aliases'),
      existingFlags: coll(ctx.state, 'flags'), range: ctx.range, now: ctx.opts.generatedAt || new Date().toISOString(),
    });
  } catch { r = null; }
  const stored = coll(ctx.state, 'flags');
  const tl = (id) => truckLabel(ctx.truckMap.get(id));
  const mFrom = ctx.range.from.slice(0, 7), mTo = ctx.range.to.slice(0, 7);
  if (r) {
    sh.addRow([{ v: 'Sumar lunar pe camion', s: ST.BOLD }]);
    sh.addHeader(['Luna', 'Camion', 'Curse facturate', 'Cu suport GPS', 'Fără suport', 'Fără date GPS', 'Zile active neacoperite', 'Km total', 'Km în curse facturate', 'Km în afara curselor']);
    const monthly = r.monthly.filter((m) => m.month >= mFrom && m.month <= mTo);
    const f0 = sh.lastRow + 1;
    for (const m of monthly) sh.addRow([m.month, tl(m.truckId), { v: m.courses, s: ST.INT }, { v: m.withSupport, s: ST.INT }, { v: m.withoutSupport, s: ST.INT }, { v: m.noGps, s: ST.INT }, { v: m.uncoveredActiveDays, s: ST.INT },
      { n: kmStr(m.kmTotalM), s: ST.KM }, { n: kmStr(m.kmInInvoicedWindowsM), s: ST.KM }, { n: kmStr(m.kmOutsideM), s: ST.KM }]);
    if (monthly.length) {
      const l0 = sh.lastRow, S = (c) => `SUM(${c}${f0}:${c}${l0})`, I = (k) => sumInts(monthly.map((m) => m[k]));
      sh.addRow([{ v: 'Total', s: ST.BOLD }, '', { f: S('C'), v: String(I('courses')), s: ST.INT }, { f: S('D'), v: String(I('withSupport')), s: ST.INT }, { f: S('E'), v: String(I('withoutSupport')), s: ST.INT },
        { f: S('F'), v: String(I('noGps')), s: ST.INT }, { f: S('G'), v: String(I('uncoveredActiveDays')), s: ST.INT },
        { f: S('H'), v: kmStr(I('kmTotalM')), s: ST.KM }, { f: S('I'), v: kmStr(I('kmInInvoicedWindowsM')), s: ST.KM }, { f: S('J'), v: kmStr(I('kmOutsideM')), s: ST.KM }]);
    } else sh.addRow([{ v: 'Nicio cursă facturată sau zi GPS în perioadă.', s: ST.NOTE }]);

    sh.blank();
    sh.addRow([{ v: 'Curse facturate și dovada GPS', s: ST.BOLD }]);
    sh.addHeader(['Încărcare', 'Descărcare', 'Rută', 'Camion', 'Km GPS', 'Zile active', 'Zile inactive', 'Zile fără date', 'Opriri la locuri', 'Suport GPS', 'Steaguri']);
    const flagById = new Map(r.flags.map((f) => [f.id, f]));
    for (const e of r.evidence) {
      const anchor = !e.anchor ? '—' : e.anchor.ok ? (e.anchor.needsConfirm ? 'găsite, de confirmat' : 'găsite') : e.anchor.reason === 'LOAD_NOT_VISITED' ? 'încărcare nevizitată' : e.anchor.reason === 'UNLOAD_NOT_VISITED' ? 'descărcare nevizitată' : (e.anchor.reason || 'negăsite');
      sh.addRow([{ d: e.loadDate }, { d: e.unloadDate }, e.route || '', tl(e.truckId), e.noDataDays === e.days.length ? null : { n: kmStr(e.gpsKmM), s: ST.KM },
        { v: e.activeDays, s: ST.INT }, { v: e.idleDays, s: ST.INT }, { v: e.noDataDays, s: ST.INT }, anchor, SUPPORT_RO[e.support] || e.support,
        e.flagIds.map((id) => FLAG_LABEL[flagById.get(id)?.code] || flagById.get(id)?.code || '').filter(Boolean).join('; ')]);
    }
    if (!r.evidence.length) sh.addRow([{ v: 'Nicio cursă facturată în perioadă.', s: ST.NOTE }]);

    sh.blank();
    sh.addRow([{ v: 'Perioade fără factură (zile active GPS neacoperite de nicio cursă)', s: ST.BOLD }]);
    sh.addHeader(['De la', 'Până la', 'Camion', 'Zile', 'Km']);
    for (const p of r.uncoveredPeriods) sh.addRow([{ d: p.from }, { d: p.to }, tl(p.truckId), { v: p.days, s: ST.INT }, { n: kmStr(p.kmM), s: ST.KM }]);
    if (!r.uncoveredPeriods.length) sh.addRow([{ v: 'Nicio perioadă activă fără cursă.', s: ST.NOTE }]);
    sh.blank();
  }
  sh.addRow([{ v: 'Steaguri (stare și notă editabile în aplicație)', s: ST.BOLD }]);
  const hr = sh.addHeader(['Data', 'Camion', 'Tip', 'Severitate', 'Stare', 'Notă administrator', 'Mesaj']);
  const flags = r && r.flags.length ? r.flags : stored;
  for (const f of [...flags].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))) {
    sh.addRow([f.date ? { d: f.date } : '', tl(f.truckId), FLAG_LABEL[f.code] || f.code || '', SEV_RO[f.severity] || f.severity || '', f.status || 'neconfirmat', f.note || '', f.message || '']);
  }
  if (!flags.length) sh.addRow([{ v: 'Niciun steag: cursele facturate sunt susținute de GPS în perioadă.', s: ST.NOTE }]);
  sh.autoFilter(hr, sh.lastRow, 7);
}

/** Foaia „Grupare” a constructorului personalizat: luna / camion / categorie / țară / valută. */
const GROUP_LABEL = { month: 'Luna', truck: 'Camion', category: 'Categorie', country: 'Țara', currency: 'Valuta originală' };
function buildGrouping(wb, ctx, agg) {
  const by = GROUP_LABEL[ctx.opts.groupBy] ? ctx.opts.groupBy : 'month';
  const sh = openSheet(wb, ctx, 'grouping', `Grupare după: ${GROUP_LABEL[by].toLowerCase()}`, [30, 12, 18, 18, 18],
    by === 'month' || by === 'truck' ? 'venitul include cursele (recunoscut ca în Clasament); costul include amortizarea și repartizările' : 'venit = doar „alte venituri” din intrări; cursele nu se pot grupa după această dimensiune');
  sh.addHeader([GROUP_LABEL[by], 'Intrări', `Cost (${ctx.currency})`, `Venit net (${ctx.currency})`, `Profit (${ctx.currency})`]);
  let rows = [];
  const countBy = (keyFn) => { const m = new Map(); for (const e of ctx.entries) { const k = keyFn(e); m.set(k, (m.get(k) || 0) + 1); } return m; };
  if (by === 'month') {
    const cnt = countBy((e) => e.accrualMonth || monthOf(e.date));
    rows = agg.monthly.map((m) => ({ key: m.month, n: cnt.get(m.month) || 0, cost: m.cost, rev: m.revenue }));
  } else if (by === 'truck') {
    const cnt = countBy((e) => e.target?.truckId || '');
    rows = agg.rows.map((r) => ({ key: r.label, n: cnt.get(r.id) || 0, cost: r.cost, rev: r.revenue }));
    if (agg.commonCost || agg.otherIncome) rows.push({ key: 'Comun firmă / nealocat', n: cnt.get('') || 0, cost: agg.commonCost, rev: agg.otherIncome });
  } else {
    const keyOf = by === 'category' ? (e) => ctx.catMap.get(e.categoryId)?.name || e.categoryId || '(fără categorie)' : by === 'country' ? (e) => e.countryCode || '(fără țară)' : (e) => e.currency || 'RON';
    const m = new Map();
    for (const e of ctx.entries) {
      const k = keyOf(e);
      const r = m.get(k) || { key: k, n: 0, cost: 0, rev: 0 };
      r.n++;
      if (e.kind === 'income') { if (!(e.incomeType === 'freight' && e.courseId)) r.rev += e[ctx.k]?.net ?? 0; } else r.cost += ctx.costOf(e);
      m.set(k, r);
    }
    rows = [...m.values()].sort((a, b) => b.cost - a.cost);
  }
  const first = sh.lastRow + 1;
  for (const r of rows) {
    const row = sh.lastRow + 1;
    sh.addRow([r.key, { v: r.n, s: ST.INT }, money(ctx.currency, r.cost), money(ctx.currency, r.rev), { f: `D${row}-C${row}`, v: minorToDecimal(r.rev - r.cost, ctx.exp), s: ST.MONEY }]);
  }
  const last = sh.lastRow;
  if (rows.length) sh.addRow([{ v: 'Total', s: ST.BOLD }, { f: `SUM(B${first}:B${last})`, v: String(sumInts(rows.map((r) => r.n))), s: ST.INT },
    { f: `SUM(C${first}:C${last})`, v: minorToDecimal(sumInts(rows.map((r) => r.cost)), ctx.exp), s: ST.MONEY_B }, { f: `SUM(D${first}:D${last})`, v: minorToDecimal(sumInts(rows.map((r) => r.rev)), ctx.exp), s: ST.MONEY_B },
    { f: `SUM(E${first}:E${last})`, v: minorToDecimal(sumInts(rows.map((r) => r.rev - r.cost)), ctx.exp), s: ST.MONEY_B }]);
  else sh.addRow([{ v: 'Nicio intrare în perioadă pentru filtrele alese.', s: ST.NOTE }]);
  sh.freezeAt(4);
}

/** Filtre ale constructorului personalizat: camioane și categorii. Întoarce o stare nouă (originalul rămâne neatins). */
export function applyReportFilters(state, f = {}) {
  const truckIds = Array.isArray(f.truckIds) && f.truckIds.length ? new Set(f.truckIds) : null;
  const categoryIds = Array.isArray(f.categoryIds) && f.categoryIds.length ? new Set(f.categoryIds) : null;
  if (!truckIds && !categoryIds) return state;
  const cols = { ...(state.collections || {}) };
  const live = (name) => coll(state, name);
  if (truckIds) {
    cols.trucks = live('trucks').filter((t) => truckIds.has(t.id));
    cols.courses = live('courses').filter((c) => truckIds.has(c.truckId));
    cols.gpsDays = live('gpsDays').filter((d) => truckIds.has(d.truckId));
    cols.gpsTrips = live('gpsTrips').filter((d) => truckIds.has(d.truckId));
    cols.flags = live('flags').filter((x) => !x.truckId || truckIds.has(x.truckId));
  }
  const keepEntry = (e) => (!truckIds || e.target?.type === 'company' || !e.target?.truckId || truckIds.has(e.target.truckId)) && (!categoryIds || e.kind === 'income' || categoryIds.has(e.categoryId));
  cols.entries = live('entries').filter(keepEntry);
  return { ...state, collections: cols };
}


function buildVat(wb, ctx) {
  const sh = openSheet(wb, ctx, 'vat', 'Sumar TVA lunar (informativ)', [12, 8, 18, 22, 18, 18], 'Nu este decont de TVA (D300). Contabilul rămâne responsabil. Cote și recuperări: de verificat.');
  sh.addHeader(['Luna', 'Țară', 'TVA deductibil RO (RON)', 'TVA străin de recuperat (RON)', 'TVA nedeductibil (RON)', 'TVA autolichidat (RON)']);
  const hr = sh.lastRow;
  const m = new Map();
  for (const e of ctx.entries) {
    if (e.kind === 'income') continue;
    const key = (e.accrualMonth || monthOf(e.date)) + '|' + (e.countryCode || '');
    const r = m.get(key) || { ro: 0, foreign: 0, nonded: 0, self: 0 };
    const rec = e.ron?.recoverable || 0;
    if (e.ron?.recoverableKind === 'ro') r.ro += rec; else if (e.ron?.recoverableKind === 'foreign') r.foreign += rec;
    if (e.vat?.treatment === 'reverse') r.self += e.ron?.selfAssessedVat || 0;
    else r.nonded += Math.max((e.ron?.vat || 0) - rec, 0);
    m.set(key, r);
  }
  const keys = [...m.keys()].sort();
  const f = sh.lastRow + 1;
  for (const k of keys) { const [mo, c] = k.split('|'); const r = m.get(k); sh.addRow([mo, c, money('RON', r.ro), money('RON', r.foreign), money('RON', r.nonded), money('RON', r.self)]); }
  const l = sh.lastRow;
  if (keys.length) {
    const tot = (fld) => sumInts(keys.map((k) => m.get(k)[fld]));
    sh.addRow([{ v: 'Total', s: ST.BOLD }, '', ...['ro', 'foreign', 'nonded', 'self'].map((fld, i) => ({ f: `SUM(${colLetter(i + 2)}${f}:${colLetter(i + 2)}${l})`, v: minorToDecimal(tot(fld), 2), s: ST.MONEY_B }))]);
  }
  sh.autoFilter(hr, l, 6); sh.freezeAt(hr);
}


function buildNoDoc(wb, ctx) {
  const sh = openSheet(wb, ctx, 'noDoc', 'Cheltuieli fără document justificativ', [12, 16, 22, 14, 14, 16, 36, 12], 'banii fără document plătiți din banii firmei sunt nedeductibili fiscal (de verificat cu contabilul)');
  sh.addHeader(['Data', 'Camion', 'Categorie', 'Valută', 'Sumă orig.', 'Sursa banilor', 'Justificare', 'Aprobat']);
  const hr = sh.lastRow;
  const list = ctx.entries.filter((e) => e.kind !== 'income' && e.documentation === 'none').sort((a, b) => a.date.localeCompare(b.date));
  for (const e of list) {
    const cur = e.currency || 'RON';
    sh.addRow([{ d: e.date }, e.target?.type === 'company' ? 'Comun firmă' : truckLabel(ctx.truckMap.get(e.target?.truckId)), ctx.catMap.get(e.categoryId)?.name || '', cur,
      e.orig ? money(cur, e.orig.gross) : null, e.moneySource || '', e.justification || '', e.approvedAt ? { d: e.approvedAt.slice(0, 10) } : '']);
  }
  const total = sumInts(list.map((e) => e.ron?.cost || 0));
  const first = hr + 1;
  sh.addRow([{ v: 'Total cost (RON)', s: ST.BOLD }, '', '', '', money('RON', total)]);
  sh.freezeAt(hr);
  return { first, count: list.length };
}


function buildQuality(wb, ctx) {
  const sh = openSheet(wb, ctx, 'quality', 'Calitatea datelor', [10, 12, 30, 16, 70]);
  sh.addHeader(['Severitate', 'Data', 'Cod', 'Camion', 'Mesaj']);
  const hr = sh.lastRow;
  const issues = Array.isArray(ctx.opts.quality) ? ctx.opts.quality : [];
  for (const q of issues) sh.addRow([q.severity || '', q.date ? { d: q.date } : '', q.code || '', truckLabel(ctx.truckMap.get(q.truckId)), q.message || '']);
  if (!issues.length) sh.addRow([{ v: 'Nicio problemă raportată.', s: ST.NOTE }]);
  sh.autoFilter(hr, sh.lastRow, 5); sh.freezeAt(hr);
}

function buildRates(wb, ctx) {
  const sh = openSheet(wb, ctx, 'rates', 'Cursuri valutare', [14, 12, 12, 16, 18], 'BNR ≠ BCE: cursul din fiecare sumă este cel înghețat la introducere; BCE este indicativ');
  sh.addHeader(['Data', 'Valută', 'Sursă', 'RON pentru 1 unitate', 'Folosit în sume']);
  const hr = sh.lastRow;
  const used = new Map();
  for (const e of ctx.entries) if (e.currency && e.currency !== 'RON' && e.fx) {
    const k = `${e.fx.rateDate || e.date}|${e.currency}|${e.fx.manual ? 'manual' : e.fx.source}|${e.fx.ronPerUnit}`;
    used.set(k, (used.get(k) || 0) + 1);
  }
  const rows = [...used.entries()].sort().map(([k, n]) => [...k.split('|'), n]);
  for (const [d, cur, src, rate, n] of rows) sh.addRow([{ d }, cur, src, rate, { v: n, s: ST.INT }]);
  if (!rows.length) sh.addRow([{ v: 'Nicio sumă în valută străină în perioadă.', s: ST.NOTE }]);
  sh.autoFilter(hr, sh.lastRow, 5); sh.freezeAt(hr);
}

function buildSummary(wb, ctx, agg, checkInfo) {
  const sh = openSheet(wb, ctx, 'summary', `${ctx.company.name || 'Flota'} – raport`, [34, 20, 20]);
  sh.hideGrid = true;
  const t = agg.totals;
  sh.addRow([{ v: 'Generat', s: ST.BOLD }, ctx.opts.generatedAt || '']);
  sh.addRow([{ v: 'Perioadă', s: ST.BOLD }, `${ctx.range.from} – ${ctx.range.to}`]);
  sh.addRow([{ v: 'Valută de raportare', s: ST.BOLD }, ctx.currency]);
  sh.addRow([{ v: 'Recunoașterea venitului', s: ST.BOLD }, ctx.recLabel]);
  sh.addRow([{ v: 'Surse curs în perioadă', s: ST.BOLD }, ctx.fxSources.join(', ') || 'n/a']);
  sh.blank();
  const rk = NAMES.ranking;
  const q = `'${rk}'`;
  sh.addRow([{ v: 'Venit net', s: ST.BOLD }, { f: `${q}!B${t.totalRow}`, v: minorToDecimal(t.revenue, ctx.exp), s: ST.MONEY }]);
  sh.addRow([{ v: 'Cost', s: ST.BOLD }, { f: `${q}!C${t.totalRow}`, v: minorToDecimal(t.cost, ctx.exp), s: ST.MONEY }]);
  sh.addRow([{ v: 'Profit operațional', s: ST.BOLD }, { f: `${q}!D${t.totalRow}`, v: minorToDecimal(t.profit, ctx.exp), s: ST.MONEY_B }]);
  sh.addRow([{ v: 'Număr cheltuieli / venituri', s: ST.BOLD }, { v: ctx.entries.length, s: ST.INT }]);
  sh.addRow([{ v: 'Număr curse', s: ST.BOLD }, { v: ctx.coursesInRange().length, s: ST.INT }]);
  sh.blank();
  // celula de verificare: Σ camioane + comun − total flotă (calculat independent din intrări) = 0
  const indep = checkInfo.independentProfit;
  sh.addRow([{ v: 'Verificare: Σ camioane + comun − total flotă (trebuie să fie 0)', s: ST.WARN },
    { f: `SUM(${q}!D${t.firstRow}:D${t.commonRow})-${minorToDecimal(indep, ctx.exp)}`, v: minorToDecimal(t.profit - indep, ctx.exp), s: ST.MONEY_B }]);
  sh.blank();
  sh.addRow([{ v: 'Raport informativ; nu este declarație fiscală. Contabilul rămâne responsabil. Fișierul nu conține secrete.', s: ST.NOTE }]);
}

const CHART_SETS = {
  spike: ['profitTruck'],
  three: ['profitTruck', 'profitMonth', 'loadedEmpty'],
  all: ['profitTruck', 'profitMonth', 'loadedEmpty', 'categories', 'emptyPctMonth', 'costKm'],
};

export async function buildWorkbook(state, opts) {
  const o = { ...opts };
  if (!o.range || !o.range.from || !o.range.to) throw new Error('buildWorkbook: lipsește opts.range');
  if (o.range.from > o.range.to) throw new Error('buildWorkbook: perioadă invalidă (data de început este după cea de sfârșit)');
  const filtered = !!((o.truckIds && o.truckIds.length) || (o.categoryIds && o.categoryIds.length));
  if (filtered) state = applyReportFilters(state, { truckIds: o.truckIds, categoryIds: o.categoryIds });
  const ctx = new Ctx(state, o);
  ctx.filtered = filtered;
  const charts = new Set(Array.isArray(o.charts) ? o.charts : CHART_SETS[o.chartSet || 'three'] || CHART_SETS.three);
  const want = (o.sheets && o.sheets.length ? o.sheets : ALL_SHEETS.filter((k) => k !== 'grouping' || o.groupBy));
  const agg = aggregate(ctx);
  const wb = new XlsxWorkbook({ title: `${ctx.company.name || 'Flota'} – raport`, created: isoUtc(o.generatedAt) });
  // Rezumat trebuie să fie prima foaie, dar depinde de totalurile din Clasament: construim Clasamentul întâi într-un registru separat de ordine.
  const order = ALL_SHEETS.filter((k) => want.includes(k) || (k === 'ranking' && want.includes('summary')));
  // foile se creează în ordinea ALL_SHEETS; pentru Rezumat folosim totaluri calculate înainte.
  const totals = precomputeTotals(ctx, agg);
  agg.totals = totals;
  totals.independentProfit = independentProfit(ctx);
  for (const key of order) {
    switch (key) {
      case 'summary': buildSummary(wb, ctx, agg, { independentProfit: totals.independentProfit }); break;
      case 'ranking': buildRanking(wb, ctx, agg, charts); break;
      case 'monthly': buildMonthly(wb, ctx, agg, charts); break;
      case 'categories': buildCategories(wb, ctx, agg, charts); break;
      case 'emptyKm': buildEmptyKm(wb, ctx, agg, charts); break;
      case 'courses': buildCourses(wb, ctx); break;
      case 'entries': buildEntries(wb, ctx, agg); break;
      case 'vat': buildVat(wb, ctx); break;
      case 'journal': buildJournal(wb, ctx); break;
      case 'noDoc': buildNoDoc(wb, ctx); break;
      case 'reconcile': buildReconcile(wb, ctx); break;
      case 'quality': buildQuality(wb, ctx); break;
      case 'rates': buildRates(wb, ctx); break;
      case 'grouping': buildGrouping(wb, ctx, agg); break;
      default: break;
    }
  }
  return wb.build({ compress: o.compress !== false });
}

// Totalurile Clasamentului sunt necesare Rezumatului (care vine primul): le calculăm identic, independent de foaie.
function precomputeTotals(ctx, agg) {
  const revenue = sumInts(agg.rows.map((r) => r.revenue)) + agg.otherIncome;
  const cost = sumInts(agg.rows.map((r) => r.cost)) + agg.commonCost;
  const n = agg.rows.length;
  // Clasament: antet la rândul 4, camioane 5..4+n, comun 5+n, total 6+n
  return { revenue, cost, profit: revenue - cost, firstRow: 5, commonRow: 5 + n, totalRow: 6 + n };
}

function isoUtc(v) {
  const d = v ? new Date(v) : new Date();
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  return t.toISOString().replace(/\.\d+Z$/, 'Z');
}

// Profit calculat direct din înregistrări (fără împărțire pe camioane): baza celulei de verificare.
function independentProfit(ctx) {
  if (ctx.domainProfit !== undefined) return ctx.domainProfit; // totalul flotei din domeniu, independent de însumarea pe rânduri a foii
  let income = 0, cost = 0;
  for (const e of ctx.entries) {
    if (e.status === 'pending' && ctx.company.excludeAutoPendingFromProfit && e.source === 'recurring') continue;
    if (e.kind === 'income') { if (!(e.incomeType === 'freight' && e.courseId)) income += e[ctx.k]?.net ?? 0; }
    else cost += ctx.costOf(e);
  }
  for (const c of ctx.coursesInRange()) income += ctx.courseNet(c);
  return income - cost;
}
