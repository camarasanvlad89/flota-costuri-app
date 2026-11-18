import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useStore, useCollection, useDisplayCurrency } from '../../ui/hooks.js';
import { useDomain, useReportCtx, money, ledgerLink, coursesLink, useToday } from '../../ui/screen-utils.js';
import { Card, PageHeader, Tabs, Kpi, Table, Pl, Chart, HBars, Badge, EmptyState, ErrorState, Loading, Note, Button, Icon, Select } from '../../ui/components/index.js';
import { truckLabel, coll, nameMap, monthLabel, shiftMonth, filterEntries, amountPair, monthOfEntry } from '../../ui/selectors.js';
import { fmtKm, fmtPct, fmtDate, fmtMoney, monthRange } from '../../core/index.js';

const TABS = [{ id: 'rezumat', label: 'Rezumat' }, { id: 'cheltuieli', label: 'Cheltuieli' }, { id: 'curse', label: 'Curse' }, { id: 'km', label: 'Km & GPS' }, { id: 'docs', label: 'Documente / Valută' }, { id: 'costuri', label: 'Structura costurilor' }];

function Why({ p, rank, cur }) {
  if (!p || !rank) return null;
  const f = rank.total;
  const mine = rank.rows.find((r) => r.truckId === p.truckId);
  const parts = [];
  const fleetEmpty = f.km && f.km.gpsM ? (f.km.emptyM || 0) / f.km.gpsM : null;
  const myEmpty = p.km && p.km.gpsM ? (p.km.emptyM || 0) / p.km.gpsM : null;
  if (myEmpty != null && fleetEmpty != null) parts.push(`km pe gol ${fmtPct(myEmpty, 0)} față de ${fmtPct(fleetEmpty, 0)} în flotă`);
  if (p.perKm && p.perKm.revenue != null && f.km && f.km.gpsM) parts.push(`venit/km ${fmtMoney(p.perKm.revenue, cur)}${mine && mine.approx ? ' (≈)' : ''}`);
  if (p.profitOp < 0) parts.push('costurile depășesc venitul în această lună');
  return html`<div class="why"><b>${p.profitOp < 0 ? 'De ce pierde?' : 'De ce câștigă?'}</b> ${parts.length ? parts.join(' · ') : 'Nu sunt destule date GPS/curse pentru o explicație.'}</div>`;
}

function Summary({ truck, p, rank, cur }) {
  const ctx = useCtx();
  const { month } = useReportCtx();
  return html`<div class="stack">
    <div class="kpis">
      <${Kpi} big label="Profit operațional" value=${html`<${Pl} value=${p.profitOp} cur=${cur} />`} delta=${html`documentat ${money(p.profitDoc, cur, { sign: true })}`} />
      <${Kpi} label="Venit" value=${money(p.revenue, cur)} onClick=${() => ctx.nav(coursesLink({ luna: month, camion: truck.id }))} />
      <${Kpi} label="Cost" value=${money(p.costTotal, cur)} onClick=${() => ctx.nav(ledgerLink({ luna: month, camion: truck.id }))} delta=${p.overhead ? 'din care comun ' + money(p.overhead, cur) : null} />
      <${Kpi} label="Profit / km" value=${p.perKm && p.perKm.profit != null ? (p.kmConfidence && p.kmConfidence !== 'high' ? '≈ ' : '') + money(p.perKm.profit, cur) : '—'} delta=${p.perKm && p.perKm.estimated ? 'cost estimat' : null} />
      <${Kpi} label="Cost / km" value=${p.perKm && p.perKm.cost != null ? money(p.perKm.cost, cur) : '—'} />
    </div>
    <${Why} p=${{ ...p, truckId: truck.id }} rank=${rank} cur=${cur} />
    <p class="muted sm">${t.notProfit} Mod recunoaștere: ${p.recognition || '—'}.</p></div>`;
}

function KmTab({ truck }) {
  const ctx = useCtx();
  const { month } = useReportCtx();
  const [gran, setGran] = useState('week');
  const range = gran === 'month' ? { from: monthRange(shiftMonth(month, -5)).from, to: monthRange(month).to } : monthRange(month);
  const rep = useDomain('emptyKmReport', (s) => [s, range, { granularity: gran }], [month, gran]);
  const q = useDomain('dataQuality', (s) => [s, range], [month, gran]);
  if (rep.error) return html`<${ErrorState} error=${rep.error} />`;
  if (rep.missing) return html`<${Note} kind="warn">${t.errors.missingApi('emptyKmReport')}<//>`;
  const rows = rep.data.rows.filter((r) => r.truckId === truck.id);
  const gaps = (rep.data.gaps || []).filter((g) => g.truckId === truck.id);
  const hasGps = rows.some((r) => r.gpsM != null);
  const issues = ((q.data) || []).filter((i) => i.truckId === truck.id);
  const lbl = (b) => (gran === 'day' ? b.slice(8) : gran === 'month' ? t.monthsShort[Number(b.slice(5, 7)) - 1] : b.slice(5));
  return html`<div class="stack">
    <div class="toolbar"><div class="opts" role="group" aria-label="Granularitate">${[['day', 'Zile'], ['week', 'Săptămâni'], ['month', 'Luni']].map(([v, l]) => html`<button type="button" class="opt" aria-pressed=${gran === v} onClick=${() => setGran(v)}>${l}</button>`)}</div></div>
    ${!hasGps ? html`<${EmptyState} icon="gps" title="Fără date GPS" action=${html`<${Button} onClick=${() => ctx.nav('/import')}>Importă export SafeFleet<//>`}>Km pe gol: <b>—</b> (necunoscut, nu 0).<//>` : html`
      <${Chart} type="stacked" title="Km încărcați vs goi" desc="Kilometri încărcați și goi pe perioadă" labels=${rows.map((r) => lbl(r.bucket))}
        series=${[{ name: 'Încărcați', data: rows.map((r) => Math.round((r.loadedM || 0) / 1000)) }, { name: 'Goi', data: rows.map((r) => Math.round((r.emptyM || 0) / 1000)), color: 'var(--caution)' }]} format=${(v) => String(Math.round(v))} />
      <${Table} caption="Km pe perioadă" rowKey=${(r) => r.bucket} rows=${rows} columns=${[
        { key: 'bucket', header: 'Perioadă', render: (r) => r.bucket },
        { key: 'gps', header: 'GPS', align: 'r', render: (r) => (r.gpsM == null ? '—' : fmtKm(r.gpsM, 1)) },
        { key: 'loaded', header: 'Încărcați', align: 'r', render: (r) => fmtKm(r.loadedM || 0, 1) },
        { key: 'empty', header: 'Goi', align: 'r', render: (r) => (r.emptyM == null ? '—' : fmtKm(r.emptyM, 1)) },
        { key: 'pct', header: '% gol', align: 'r', render: (r) => (r.pctEmpty == null ? '—' : fmtPct(r.pctEmpty, 1)) },
        { key: 'fl', header: 'Observații', render: (r) => (r.flags || []).join(', ') }]}
        footer=${['Total', fmtKm(rows.reduce((a, r) => a + (r.gpsM || 0), 0), 1), fmtKm(rows.reduce((a, r) => a + (r.loadedM || 0), 0), 1), fmtKm(rows.reduce((a, r) => a + (r.emptyM || 0), 0), 1), '', '']} />
      <p class="sm muted">Încărcați + goi = GPS pe fiecare rând (verificat în raport).</p>`}
    ${gaps.length ? html`<${Card} title="Goluri între curse"><${Table} rowKey=${(g) => g.afterCourseId + g.beforeCourseId} rows=${gaps} columns=${[
      { key: 'from', header: 'De la', render: (g) => fmtDate(g.from) }, { key: 'to', header: 'Până la', render: (g) => fmtDate(g.to) },
      { key: 'e', header: 'Km pe gol', align: 'r', render: (g) => fmtKm(g.emptyM, 1) }, { key: 'm', header: 'Mod', render: (g) => (g.mode === 'trips' ? 'din călătorii GPS' : 'pe zile' + (g.mixedDays && g.mixedDays.length ? ' (zile mixte)' : '')) }]} /><//>` : null}
    ${issues.length ? html`<${Card} title="Calitatea datelor"><ul class="alerts">${issues.map((i) => html`<li><span class="tx"><${Badge} kind=${i.severity === 'error' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}>${i.code}<//> ${i.message}</span></li>`)}</ul><//>` : null}</div>`;
}

function DocsTab({ truck }) {
  const today = useToday();
  const ex = useDomain('expiryList', (s) => [s, today], [today]);
  const entries = useCollection('entries');
  const mine = entries.filter((e) => e.target && e.target.truckId === truck.id && e.currency && e.currency !== 'RON').slice(0, 30);
  const list = (ex.data || []).filter((x) => x.subjectType === 'truck' && x.subjectId === truck.id);
  return html`<div class="stack">
    <${Card} title="Scadențe (ITP, RCA, CASCO, tahograf, rovinietă)">${list.length ? html`<ul class="alerts">${list.map((x) => html`<li><span class="tx"><b>${x.label}</b> · ${fmtDate(x.dueDate)} <${Badge} kind=${x.daysLeft < 0 ? 'bad' : x.daysLeft <= 30 ? 'warn' : 'neutral'}>${x.text}<//></span></li>`)}</ul>` : html`<p class="muted">Nicio scadență definită. Adaugă în Setări › Scadențe.</p>`}<//>
    <${Card} title="Cheltuieli în valută">${mine.length ? html`<${Table} rowKey=${(e) => e.id} rows=${mine} columns=${[{ key: 'd', header: 'Data', render: (e) => fmtDate(e.date) }, { key: 's', header: 'Furnizor', render: (e) => e.supplier || '' },
      { key: 'a', header: 'Sumă', align: 'r', render: (e) => amountPair(e, 'RON') }, { key: 'b', header: 'Curs', render: (e) => (e.fx && e.fx.manual ? html`<${Badge} kind="manual-fx" />` : e.fx && e.fx.stale ? html`<${Badge} kind="stale-fx" />` : e.fx ? e.fx.source : '') }]} />` : html`<p class="muted">Nicio cheltuială în valută.</p>`}<//></div>`;
}

function TruckDetail({ truck }) {
  const ctx = useCtx();
  const { month, range, cur } = useReportCtx();
  const [tab, setTab] = useState('rezumat');
  const pnl = useDomain('truckPnl', (s) => [s, truck.id, range, { currency: cur }], [truck.id, month, cur]);
  const rank = useDomain('fleetRanking', (s) => [s, range, { currency: cur }], [month, cur]);
  const entries = useCollection('entries');
  const courses = useCollection('courses');
  const cats = useStore((s) => nameMap(s, 'categories'));
  const myEntries = useMemo(() => filterEntries(entries, { truckId: truck.id, month }), [entries, truck.id, month]);
  const myCourses = courses.filter((c) => c.truckId === truck.id && c.loadDate && c.loadDate.slice(0, 7) <= month && (c.unloadDate || c.loadDate).slice(0, 7) >= month);
  if (pnl.error) return html`<${ErrorState} error=${pnl.error} />`;
  if (pnl.missing) return html`<${Note} kind="warn">${t.errors.missingApi('truckPnl')}<//>`;
  const p = pnl.data;
  return html`<div class="stack"><${Tabs} tabs=${TABS} value=${tab} onChange=${setTab} label="Secțiuni camion" />
    ${tab === 'rezumat' ? html`<${Summary} truck=${truck} p=${p} rank=${rank.data} cur=${cur} />` : null}
    ${tab === 'cheltuieli' ? html`<${Table} rowKey=${(e) => e.id} rows=${myEntries} onRowClick=${() => ctx.nav(ledgerLink({ luna: month, camion: truck.id }))} emptyText=${t.states.noEntries} columns=${[
      { key: 'd', header: 'Data', render: (e) => fmtDate(e.date) }, { key: 'c', header: 'Categorie', render: (e) => (cats.get(e.categoryId) || {}).name || '' },
      { key: 's', header: 'Furnizor', render: (e) => e.supplier || '' }, { key: 'a', header: 'Sumă', align: 'r', render: (e) => amountPair(e, cur) }]} />` : null}
    ${tab === 'curse' ? html`<${Table} rowKey=${(c) => c.id} rows=${myCourses} emptyText=${t.states.noCourses} onRowClick=${() => ctx.nav(coursesLink({ luna: month, camion: truck.id }))} columns=${[
      { key: 'd', header: 'Date', render: (c) => fmtDate(c.loadDate) + ' → ' + fmtDate(c.unloadDate) }, { key: 'r', header: 'Rută', render: (c) => c.routeRaw },
      { key: 'n', header: 'Net', align: 'r', render: (c) => (c.net == null ? '—' : fmtMoney(c.net, c.currency || 'RON')) },
      { key: 'k', header: 'Km', align: 'r', render: (c) => (c.loadedKm && c.loadedKm.meters ? fmtKm(c.loadedKm.meters, 0) : '—') }]} />` : null}
    ${tab === 'km' ? html`<${KmTab} truck=${truck} />` : null}
    ${tab === 'docs' ? html`<${DocsTab} truck=${truck} />` : null}
    ${tab === 'costuri' ? html`<${Card} title="Structura costurilor pe categorii">${p.byCategory && p.byCategory.length ? html`<${HBars} rows=${p.byCategory.map((x) => ({ label: (cats.get(x.categoryId) || {}).name || x.categoryId, value: x.cost, display: money(x.cost, cur), nd: x.noDoc > 0 }))} />
      <div class="legend"><span><i></i>cu document</span><span><i class="nd"></i>include fără document</span></div>` : html`<p class="muted">Fără costuri în această lună.</p>`}<//>` : null}</div>`;
}

function TruckScreen({ params }) {
  const ctx = useCtx();
  const trucks = useCollection('trucks');
  const sorted = [...trucks].sort((a, b) => String(a.plate).localeCompare(String(b.plate)));
  const sel = sorted.find((x) => x.id === params.id) || null;
  if (!sorted.length) return html`<${EmptyState} icon="truck" title="Nu ai camioane" action=${html`<${Button} onClick=${() => ctx.nav('/setari/camioane')}>Adaugă camioane<//>`} />`;
  return html`<div class="stack"><${PageHeader} title=${sel ? truckLabel(sel) : t.nav.trucks} sub=${sel ? [sel.model, sel.year].filter(Boolean).join(' · ') : 'Alege un camion'} />
    <div class="split"><nav aria-label="Camioane" class="card listnav">${sorted.map((x) => html`<button type="button" aria-current=${sel && sel.id === x.id ? 'true' : null} onClick=${() => ctx.nav('/camion/' + x.id)}>${truckLabel(x)}<span class="muted sm">${x.model || ''}</span></button>`)}</nav>
      <div>${sel ? html`<${TruckDetail} truck=${sel} key=${sel.id} />` : html`<${EmptyState} icon="truck" title="Alege un camion din listă" />`}</div></div></div>`;
}
export const screen = {
  id: 'truck', route: '/camion/:id?', title: () => t.nav.trucks,
  nav: { label: t.nav.trucks, icon: 'truck', order: 1.5, group: 'work', path: '/camion' }, component: TruckScreen,
};
