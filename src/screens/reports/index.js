import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useDisplayCurrency, useMonth, useCompany } from '../../ui/hooks.js';
import { useDomain, money, useToday } from '../../ui/screen-utils.js';
import { Card, PageHeader, Button, Table, Badge, Note, Chart, HBars, Checkbox, DateInput, Select, ErrorState, Pl, EmptyState } from '../../ui/components/index.js';
import { call, api } from '../../ui/api.js';
import { saveBytes } from '../../ui/actions.js';
import { nameMap, truckLabel, monthLabel, shiftMonth, coll } from '../../ui/selectors.js';
import { fmtDate, fmtMoney, fmtNumber, monthRange, displayPlate } from '../../core/index.js';

const LIST = [
  ['ranking', 'Clasamentul camioanelor'], ['monthly', 'Profit lunar flotă'], ['categories', 'Cheltuieli pe categorii'], ['trucksheet', 'Fișa camionului'],
  ['emptykm', 'Km pe gol'], ['reconcile', 'Confruntare GPS vs facturat'], ['vatforeign', 'TVA străin de recuperat'], ['vat', 'Sumar TVA'], ['journal', 'Jurnal contabil'],
  ['nodoc', 'Fără document'], ['unpaid', 'Neîncasat (info)'], ['fx', 'Cursuri folosite și manuale'], ['quality', 'Calitatea datelor'], ['diurna', 'Diurnă externă'], ['decision', 'Decizie pe cursă'], ['custom', 'Personalizat + Excel'],
];
const SHEETS = [['summary', 'Rezumat'], ['ranking', 'Clasament'], ['monthly', 'Profit lunar'], ['categories', 'Categorii'], ['emptyKm', 'Km pe gol'], ['courses', 'Curse'], ['entries', 'Cheltuieli'], ['vat', 'TVA'], ['journal', 'Jurnal contabil'], ['noDoc', 'Fără document'], ['reconcile', 'Confruntare GPS'], ['quality', 'Calitate date'], ['rates', 'Cursuri']];
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function Meta({ range, cur }) {
  const m = useDomain('reportMeta', (s) => [s, range, { currency: cur }], [range.from, range.to, cur]);
  if (!m.data) return null;
  return html`<p class="muted sm" data-testid="report-meta">Mod recunoaștere: <b>${m.data.recognitionLabel || m.data.recognition}</b> · curs: <b>${m.data.fxSourcesLabel}</b>. ${m.data.disclaimer}</p>`;
}
const Missing = ({ name }) => html`<${Note} kind="warn">${t.errors.missingApi(name)}<//>`;

function Report({ id, range, cur, month }) {
  const ctx = useCtx();
  const today = useToday();
  const tm = nameMap(ctx.store.state(), 'trucks'), cm = nameMap(ctx.store.state(), 'categories');
  const yr = { from: monthRange(shiftMonth(month, -11)).from, to: range.to };
  const FOR = { fleetRanking: 'ranking', monthlySeries: 'monthly', categoryBreakdown: 'categories', foreignVatReceivable: 'vatforeign', vatSummary: 'vat', accountingJournal: 'journal', noDocReport: 'nodoc', unpaidCourses: 'unpaid', fxUsage: 'fx', dataQuality: 'quality', diurnaReport: 'diurna' };
  const R = (name, build, deps) => useDomain(name, build, deps, id === FOR[name]); // doar raportul afișat se calculează
  const rank = R('fleetRanking', (s) => [s, range, { currency: cur }], [range.from, cur]);
  const series = R('monthlySeries', (s) => [s, yr, { currency: cur }], [range.from, cur]);
  const cats = R('categoryBreakdown', (s) => [s, range, { currency: cur }], [range.from, cur]);
  const vatF = R('foreignVatReceivable', (s) => [s, range], [range.from]);
  const vat = R('vatSummary', (s) => [s, range], [range.from]);
  const journal = R('accountingJournal', (s) => [s, range], [range.from]);
  const nodoc = R('noDocReport', (s) => [s, range, { currency: cur }], [range.from, cur]);
  const unpaid = R('unpaidCourses', (s) => [s, today], [today]);
  const fx = R('fxUsage', (s) => [s, range], [range.from]);
  const quality = R('dataQuality', (s) => [s, range], [range.from]);
  const diurna = R('diurnaReport', (s) => [s, range, {}], [range.from]);
  const err = (r) => (r.error ? html`<${ErrorState} error=${r.error} />` : null);
  if (id === 'ranking') return rank.missing ? html`<${Missing} name=${rank.missing} />` : err(rank) || html`<${Table} caption="Clasamentul camioanelor" rowKey=${(r) => r.truckId} rows=${rank.data.rows} onRowClick=${(r) => ctx.nav('/camion/' + r.truckId)} columns=${[
    { key: 'p', header: 'Camion', render: (r) => r.plateDisplay }, { key: 'v', header: 'Venit', align: 'r', render: (r) => money(r.revenue, cur) }, { key: 'c', header: 'Cost', align: 'r', render: (r) => money(r.cost, cur) },
    { key: 'pr', header: 'Profit', align: 'r', render: (r) => html`<${Pl} value=${r.profit} cur=${cur} />` }, { key: 'ppk', header: 'Profit/km', align: 'r', render: (r) => (r.profitPerKm == null ? '—' : (r.approx ? '≈ ' : '') + money(r.profitPerKm, cur)) },
    { key: 'g', header: '% gol', align: 'r', render: (r) => (r.pctEmpty == null ? '—' : Math.round(r.pctEmpty * 100) + '%') }]} footer=${['Flota', money(rank.data.total.revenue, cur), money(rank.data.total.costTotal, cur), money(rank.data.total.profitOp, cur, { sign: true }), '', '']} />`;
  if (id === 'monthly') return series.missing ? html`<${Missing} name=${series.missing} />` : err(series) || html`<${Chart} type="bar" title="Profit lunar flotă" desc="Profit operațional pe lună" labels=${series.data.map((x) => t.monthsShort[Number(x.month.slice(5)) - 1])}
    series=${[{ name: 'Profit', data: series.data.map((x) => x.profitOp) }]} format=${(v) => fmtNumber(Math.round(v / 100), 0)} />
    <${Table} caption="Serie lunară" rowKey=${(x) => x.month} rows=${series.data} columns=${[{ key: 'm', header: 'Luna', render: (x) => monthLabel(x.month) }, { key: 'r', header: 'Venit', align: 'r', render: (x) => money(x.revenue, cur) }, { key: 'c', header: 'Cost', align: 'r', render: (x) => money(x.cost, cur) }, { key: 'p', header: 'Profit', align: 'r', render: (x) => money(x.profitOp, cur, { sign: true }) }, { key: 'e', header: '% gol', align: 'r', render: (x) => (x.emptyPct == null ? '—' : Math.round(x.emptyPct * 100) + '%') }]} />`;
  if (id === 'categories') return cats.missing ? html`<${Missing} name=${cats.missing} />` : err(cats) || html`<${HBars} rows=${cats.data.map((c) => ({ label: (cm.get(c.categoryId) || {}).name || c.categoryId, value: c.cost, display: money(c.cost, cur) + (c.noDoc ? ` (din care fără doc. ${money(c.noDoc, cur)})` : ''), nd: c.noDoc > 0 }))} />`;
  if (id === 'trucksheet') return html`<div class="stack"><p>Fișa unui camion se deschide din listă.</p><div class="toolbar">${[...tm.values()].map((x) => html`<${Button} sm kind="sec" onClick=${() => ctx.nav('/camion/' + x.id)}>${truckLabel(x)}<//>`)}</div></div>`;
  if (id === 'emptykm') return html`<${Button} onClick=${() => ctx.nav('/km-pe-gol')}>Deschide raportul Km pe gol<//>`;
  if (id === 'reconcile') return html`<${Button} onClick=${() => ctx.nav('/confruntare')}>Deschide Confruntarea GPS vs facturat<//>`;
  if (id === 'vatforeign') return vatF.missing ? html`<${Missing} name=${vatF.missing} />` : err(vatF) || html`<${Note}>${t.vatWarn} Informativ: nu există flux de rambursare.<//>
    <${Table} caption="TVA străin de recuperat" rowKey=${(r) => r.countryCode + r.currency} rows=${vatF.data} emptyText="Niciun TVA străin de recuperat în perioadă." columns=${[{ key: 'c', header: 'Țara', render: (r) => r.countryCode }, { key: 'm', header: 'Valută', render: (r) => r.currency },
      { key: 'v', header: 'TVA (valută)', align: 'r', render: (r) => fmtMoney(r.vat, r.currency) }, { key: 'r', header: 'În RON', align: 'r', render: (r) => fmtMoney(r.ron, 'RON') }, { key: 'n', header: 'Intrări', align: 'r', render: (r) => r.count }, { key: 'd', header: 'Termen (info)', render: (r) => fmtDate(r.deadline) }]} />`;
  if (id === 'vat') return vat.missing ? html`<${Missing} name=${vat.missing} />` : err(vat) || html`<div class="kvgrid">${[['TVA deductibil RO', vat.data.deductibleRo], ['TVA străin de recuperat', vat.data.foreignRecoverable], ['TVA nedeductibil', vat.data.nonDeductible], ['TVA autolichidat', vat.data.selfAssessed], ['TVA colectat din curse', vat.data.collected]].map(([l, v]) => html`<div><span>${l}</span><span>${fmtMoney(v, 'RON')}</span></div>`)}</div><${Note}>${vat.data.note}<//>`;
  if (id === 'journal') return journal.missing ? html`<${Missing} name=${journal.missing} />` : err(journal) || html`<div class="toolbar"><${Button} sm kind="sec" icon="download" onClick=${() => exportJournal(ctx, range)}>Export CSV contabil<//></div>
    <${Table} caption="Jurnal contabil" rowKey=${(r) => r.ref.id} rows=${journal.data.slice(0, 200)} columns=${[{ key: 'd', header: 'Data', render: (r) => fmtDate(r.date) }, { key: 'k', header: 'Tip', render: (r) => r.kind }, { key: 'n', header: 'Nr. doc', render: (r) => r.docNo }, { key: 's', header: 'Furnizor / client', render: (r) => r.supplier },
      { key: 'net', header: 'Net RON', align: 'r', render: (r) => fmtMoney(r.ronNet, 'RON') }, { key: 'vat', header: 'TVA RON', align: 'r', render: (r) => fmtMoney(r.ronVat, 'RON') }, { key: 'g', header: 'Brut RON', align: 'r', render: (r) => fmtMoney(r.ronGross, 'RON') }, { key: 'c', header: 'Categorie', render: (r) => r.category }, { key: 'doc', header: 'Documentare', render: (r) => r.documentationLabel }]} />${journal.data.length > 200 ? html`<p class="muted sm">Primele 200 de ${journal.data.length}; exportul conține tot.</p>` : null}`;
  if (id === 'nodoc') return nodoc.missing ? html`<${Missing} name=${nodoc.missing} />` : err(nodoc) || html`<p data-testid="nodoc-line">cheltuieli fără document: <b>${money(nodoc.data.total, cur)}</b> (${nodoc.data.pctOfCost == null ? '—' : Math.round(nodoc.data.pctOfCost * 1000) / 10 + '%'} din cost)</p>
    <${Table} caption="Fără document" rowKey=${(r) => r.entryId} rows=${nodoc.data.rows} emptyText="Nicio cheltuială fără document." columns=${[{ key: 'd', header: 'Data', render: (r) => fmtDate(r.date) }, { key: 't', header: 'Camion', render: (r) => (r.truckId ? truckLabel(tm.get(r.truckId)) : 'comun') }, { key: 's', header: 'Furnizor', render: (r) => r.supplier || '' },
      { key: 'a', header: 'Sumă', align: 'r', render: (r) => money(r.amount, cur) }, { key: 'j', header: 'Justificare', render: (r) => (r.missingJustification ? html`<${Badge} kind="bad">lipsă (peste plafon)<//>` : r.justification || '—') }]} />`;
  if (id === 'unpaid') return unpaid.missing ? html`<${Missing} name=${unpaid.missing} />` : err(unpaid) || html`<${Table} caption="Curse neîncasate" rowKey=${(r) => r.courseId} rows=${unpaid.data} emptyText="Nicio factură scadentă neîncasată (necesită coloanele Scadență / Data încasării)." columns=${[{ key: 'c', header: 'Client', render: (r) => r.clientName }, { key: 'n', header: 'Factură', render: (r) => r.invoiceNo }, { key: 'd', header: 'Scadență', render: (r) => fmtDate(r.dueDate) }, { key: 'g', header: 'Total', align: 'r', render: (r) => fmtMoney(r.origGross, r.currency) }]} />`;
  if (id === 'fx') return fx.missing ? html`<${Missing} name=${fx.missing} />` : err(fx) || html`<p>${fx.data.manual} manuale · ${fx.data.stale} vechi · ${fx.data.notBnr} ne-BNR.</p><${Table} caption="Cursuri folosite" rowKey=${(r) => r.id} rows=${fx.data.rows.slice(0, 200)} emptyText="Nicio sumă în valută în perioadă." columns=${[{ key: 'd', header: 'Data', render: (r) => fmtDate(r.date) }, { key: 'c', header: 'Valută', render: (r) => r.currency }, { key: 'r', header: 'Curs', align: 'r', render: (r) => r.ronPerUnit }, { key: 'rd', header: 'Data cursului', render: (r) => fmtDate(r.rateDate) },
    { key: 's', header: 'Sursă', render: (r) => html`${r.source} ${r.manual ? html`<${Badge} kind="manual-fx" />` : null} ${r.stale ? html`<${Badge} kind="stale-fx" />` : null}` }]} />`;
  if (id === 'quality') return quality.missing ? html`<${Missing} name=${quality.missing} />` : err(quality) || (quality.data.length === 0 ? html`<${EmptyState} icon="check" title="Nicio problemă de calitate a datelor" />` : html`<ul class="alerts">${quality.data.map((i) => html`<li><span class="tx"><${Badge} kind=${i.severity === 'error' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}>${i.code}<//> ${i.message}</span></li>`)}</ul>`);
  if (id === 'diurna') return diurna.missing ? html`<${Missing} name=${diurna.missing} />` : err(diurna) || html`<${Note} kind="warn">Sume zilnice și plafon scutit: valori editabile, <b>de verificat cu contabilul</b>.<//>
    <${Table} caption="Diurnă pe șofer" rowKey=${(d) => d.driverId || d.driverName} rows=${diurna.data.byDriver} emptyText="Nicio zi în străinătate în perioadă." columns=${[{ key: 'n', header: 'Șofer', render: (d) => d.driverName }, { key: 'z', header: 'Zile', align: 'r', render: (d) => d.days }, { key: 'c', header: 'Țări', render: (d) => Object.entries(d.byCountry).map(([c, n]) => c + ' (' + n + ')').join(', ') },
      { key: 'a', header: 'Diurnă EUR', align: 'r', render: (d) => fmtMoney(d.amountEur, 'EUR') }, { key: 'f', header: 'Scutit', align: 'r', render: (d) => fmtMoney(d.taxFreeEur, 'EUR') }, { key: 'x', header: 'Impozabil', align: 'r', render: (d) => fmtMoney(d.taxableEur, 'EUR') },
      { key: 'p', header: '', render: (d) => html`<${Button} sm kind="ghost" icon="doc" onClick=${() => printSheet(ctx, diurna.data, d)}>Foaie de deplasare<//>` }]} />`;
  if (id === 'decision') return api('courseDecision') || api('decisionReport') ? html`<${Note}>Raport disponibil în Camion › Curse.<//>` : html`<${Note}>Rapoartele de decizie pe cursă (cost/km real, preț de echilibru, „Merită cursa?”) nu sunt încă disponibile în această versiune.<//>`;
  return null;
}

/** Export CSV contabil: aceeași funcție (`buildAccountantCsv`) ca foaia Excel „Jurnal contabil”, deci aceleași rânduri ca ecranul. */
function exportJournal(ctx, range) {
  try {
    const text = call('buildAccountantCsv', ctx.store.state(), range);
    saveBytes(new TextEncoder().encode(text), `jurnal-contabil-${range.from}_${range.to}.csv`, 'text/csv;charset=utf-8');
  } catch (e) { ctx.toast({ kind: 'error', text: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
}
function printSheet(ctx, report, d) {
  const sheet = call('travelSheet', report, d.driverId);
  const doc = call('travelSheetHtml', sheet, { company: (ctx.store.state().singletons.company || {}).name });
  const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const GROUPS = [['', 'Fără grupare'], ['month', 'Pe lună'], ['truck', 'Pe camion'], ['category', 'Pe categorie'], ['country', 'Pe țară'], ['currency', 'Pe valută originală']];
const isIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

function Custom({ range, cur }) {
  const ctx = useCtx();
  const trucksAll = useCollection('trucks'), catsAll = useCollection('categories');
  const [from, setFrom] = useState(range.from), [to, setTo] = useState(range.to);
  const [currency, setCurrency] = useState(cur);
  const [groupBy, setGroupBy] = useState('');
  const [truckIds, setTruckIds] = useState(new Set()), [categoryIds, setCategoryIds] = useState(new Set());
  const [sheets, setSheets] = useState(new Set(['summary', 'ranking', 'monthly', 'categories', 'emptyKm', 'courses', 'entries']));
  const [busy, setBusy] = useState(false);
  const errFrom = !isIso(from) ? 'Alege data de început' : '';
  const errTo = !isIso(to) ? 'Alege data de sfârșit' : (!errFrom && from > to ? 'Data de sfârșit este înaintea celei de început' : '');
  const invalid = !!(errFrom || errTo);
  const toggle = (set, setSet, id, on) => { const n = new Set(set); on ? n.add(id) : n.delete(id); setSet(n); };
  const filters = () => ({ truckIds: [...truckIds], categoryIds: [...categoryIds] });
  async function exportXlsx() {
    if (invalid) return;
    setBusy(true);
    try {
      const list = [...sheets];
      if (groupBy && !list.includes('grouping')) list.push('grouping');
      const bytes = await call('buildWorkbook', ctx.store.state(), { range: { from, to }, currency, sheets: list, groupBy: groupBy || undefined, ...filters(), locale: 'ro-RO', generatedAt: new Date().toISOString() });
      saveBytes(bytes, `flota-raport-${from}_${to}.xlsx`, XLSX_MIME);
      ctx.toast({ kind: 'ok', text: 'Fișierul Excel a fost generat (cu grafice native).' });
    } catch (e) { ctx.toast({ kind: 'error', text: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
    setBusy(false);
  }
  function exportCsv() {
    if (invalid) return;
    try {
      const st = call('applyReportFilters', ctx.store.state(), filters());
      const text = call('buildAccountantCsv', st, { from, to });
      saveBytes(new TextEncoder().encode(text), `jurnal-contabil-${from}_${to}.csv`, 'text/csv;charset=utf-8');
    } catch (e) { ctx.toast({ kind: 'error', text: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
  }
  const pick = (title, items, set, setSet) => html`<fieldset class="card"><legend>${title} <span class="muted sm">(${set.size ? set.size + ' alese' : 'toate'})</span></legend><div class="kvgrid">${items.map((x) => html`<${Checkbox} label=${x.label} checked=${set.has(x.id)} onChange=${(on) => toggle(set, setSet, x.id, on)} />`)}</div></fieldset>`;
  return html`<div class="stack"><div class="form-grid"><${DateInput} label=${t.common.from} value=${from} error=${errFrom || null} onChange=${(v) => setFrom(v || '')} /><${DateInput} label=${t.common.to} value=${to} error=${errTo || null} onChange=${(v) => setTo(v || '')} />
    <${Select} label="Valuta de afișare" value=${currency} onChange=${setCurrency} options=${['RON', 'EUR']} />
    <${Select} label="Grupare" value=${groupBy} onChange=${setGroupBy} options=${GROUPS.map(([value, label]) => ({ value, label }))} /></div>
    ${pick('Camioane', trucksAll.map((x) => ({ id: x.id, label: truckLabel(x) })), truckIds, setTruckIds)}
    ${pick('Categorii de cheltuieli', catsAll.map((x) => ({ id: x.id, label: x.name })), categoryIds, setCategoryIds)}
    <fieldset class="card"><legend>Foi incluse</legend><div class="kvgrid">${SHEETS.map(([v, l]) => html`<${Checkbox} label=${l} checked=${sheets.has(v)} onChange=${(on) => { const n = new Set(sheets); on ? n.add(v) : n.delete(v); setSheets(n); }} />`)}</div></fieldset>
    <div class="toolbar"><${Button} icon="download" onClick=${exportXlsx} disabled=${busy || invalid || (sheets.size === 0 && !groupBy)}>${busy ? 'Se generează…' : 'Exportă Excel (.xlsx)'}<//>
      <${Button} kind="sec" icon="download" onClick=${exportCsv} disabled=${invalid}>Exportă CSV contabil<//></div>
    ${truckIds.size ? html`<${Note}>Cu camioane alese, costurile comune ale firmei se repartizează doar pe camioanele alese. Fiecare foaie poartă mențiunea „FILTRAT”.<//>` : null}
    <${Note}>CSV-ul conține același jurnal contabil ca ecranul și foaia Excel (cheltuieli, alte venituri și curse facturate), cu filtrele de mai sus. Totalurile în EUR: ${t.eurNote} Fiecare foaie poartă modul de recunoaștere și sursa cursului. Verifică fișierul în Excel și LibreOffice înainte de a te baza pe el.<//></div>`;
}

function ReportsScreen({ query }) {
  const [id, setId] = useState(query.get('raport') || 'ranking');
  const [month] = useMonth();
  const [cur] = useDisplayCurrency();
  const range = monthRange(month);
  return html`<div class="stack"><${PageHeader} title=${t.nav.reports} sub=${monthLabel(month) + ' · ' + cur} />
    <div class="split"><nav class="card listnav" aria-label="Rapoarte">${LIST.map(([k, l]) => html`<button type="button" aria-current=${id === k ? 'true' : null} onClick=${() => setId(k)}>${l}</button>`)}</nav>
      <${Card} title=${(LIST.find((x) => x[0] === id) || [])[1]}>${id === 'custom' ? html`<${Custom} range=${range} cur=${cur} />` : html`<div class="stack"><${Report} id=${id} range=${range} cur=${cur} month=${month} /><${Meta} range=${range} cur=${cur} /></div>`}<//></div></div>`;
}
export const screen = { id: 'reports', route: '/rapoarte', title: () => t.nav.reports, nav: { label: t.nav.reports, icon: 'chart', order: 8, group: 'analysis' }, component: ReportsScreen };
