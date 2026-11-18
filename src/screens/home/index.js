import { html } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useStore, useCollection, useSingleton } from '../../ui/hooks.js';
import { useDomain, useReportCtx, money, ledgerLink, coursesLink, useToday } from '../../ui/screen-utils.js';
import { Kpi, Card, PageHeader, Table, Pl, Chart, EmptyState, Loading, ErrorState, Note, Button, Icon, Badge, DemoBadge } from '../../ui/components/index.js';
import { verifyQueue, isFirstRun, firstRunSteps, monthLabel, isClosed, coll, shiftMonth, truckLabel } from '../../ui/selectors.js';
import { fmtPct, fmtKm, fmtNumber, monthRange } from '../../core/index.js';

const STEP_LABELS = t.states.firstRun;

function FirstRun({ steps }) {
  const ctx = useCtx();
  const first = steps.findIndex((s) => !s.done);
  return html`<${Card} title="Primii pași"><ol class="checklist">${steps.map((s, i) => html`<li>
    <span class=${'st ' + (s.done ? 'c-gain' : i === first ? 'c-accent' : 'c-neutral')}><${Icon} name=${s.done ? 'check' : 'chev'} /></span>
    <span class="tx"><b>${i + 1}. ${STEP_LABELS[i]}</b></span>
    ${!s.done ? html`<${Button} sm kind=${i === first ? undefined : 'sec'} onClick=${() => ctx.nav(s.route)}>Începe<//>` : html`<span class="muted sm">Gata</span>`}</li>`)}</ol><//>`;
}

function Alerts({ items }) {
  const ctx = useCtx();
  if (!items.length) return html`<p class="muted">Nicio alertă.</p>`;
  return html`<ul class="alerts">${items.map((a) => html`<li><button type="button" onClick=${() => ctx.nav(a.to)}>
    <span class=${'ico c-' + (a.tone || 'neutral')}><${Icon} name=${a.icon || 'alert'} /></span><span class="tx">${a.text}</span><${Icon} name="chev" size="sm" /></button></li>`)}</ul>`;
}

function HomeScreen() {
  const ctx = useCtx();
  const { month, range, cur } = useReportCtx();
  const today = useToday();
  const trucks = useCollection('trucks');
  const company = useSingleton('company');
  const queue = useStore(verifyQueue);
  const rank = useDomain('fleetRanking', (s) => [s, range, { currency: cur }], [month, cur]);
  const noDoc = useDomain('noDocLine', (s) => [s, range, { currency: cur }], [month, cur]);
  const yearRange = { from: monthRange(shiftMonth(month, -11)).from, to: range.to };
  const series = useDomain('monthlySeries', (s) => [s, yearRange, { currency: cur }], [month, cur]);
  const empty = useDomain('emptyKmReport', (s) => [s, range, { granularity: 'month', currency: cur }], [month, cur]);
  const expiries = useDomain('expiryAlerts', (s) => [s, today], [today]);
  const auto = useDomain('summaryForMonth', (s) => [s, month], [month]);
  const flags = useCollection('flags');
  const steps = useStore(firstRunSteps);
  const first = useStore(isFirstRun);
  const closed = useStore((s) => isClosed(s, month));

  if (rank.error) return html`<${ErrorState} error=${rank.error} />`;
  const total = rank.data && rank.data.total;
  const rows = (rank.data && rank.data.rows) || [];
  const meta = total ? { recognition: total.recognition, fx: total.fxSources || [] } : null;
  const alerts = [];
  if (queue.total) alerts.push({ icon: 'inbox', tone: 'caution', text: `${queue.total} de verificat`, to: '/verificare' });
  if (queue.courses.length) alerts.push({ icon: 'route', tone: 'caution', text: `${queue.courses.length} curse fără preț sau de verificat`, to: '/verificare' });
  if (total && total.nonBnrCount) alerts.push({ icon: 'globe', tone: 'info', text: t.banners.nonBnr(total.nonBnrCount), to: '/tranzactii?cursManual=1' });
  const openFlags = flags.filter((f) => f.status === 'neconfirmat' && f.severity !== 'info').length;
  if (openFlags) alerts.push({ icon: 'gps', tone: 'caution', text: `${openFlags} steaguri GPS vs facturat neconfirmate`, to: '/confruntare' });
  for (const x of (expiries.data || []).slice(0, 6)) alerts.push({ icon: 'doc', tone: x.daysLeft < 0 ? 'loss' : x.daysLeft <= 7 ? 'caution' : 'neutral', text: `${x.label} ${x.subjectName}: ${x.text}`, to: '/setari/expirari' });

  const cols = [
    { key: 'plate', header: 'Camion', render: (r) => html`<span class="plate">${r.plateDisplay}</span>`, },
    { key: 'revenue', header: 'Venit', align: 'r', render: (r) => html`<button type="button" class="cell-link" onClick=${() => ctx.nav(coursesLink({ luna: month, camion: r.truckId }))}>${money(r.revenue, cur)}</button>` },
    { key: 'cost', header: 'Cost', align: 'r', render: (r) => html`<button type="button" class="cell-link" onClick=${() => ctx.nav(ledgerLink({ luna: month, camion: r.truckId }))}>${money(r.cost, cur)}</button>` },
    { key: 'profit', header: 'Profit', align: 'r', render: (r) => html`<${Pl} value=${r.profit} cur=${cur} />` },
    { key: 'ppk', header: 'Profit/km', align: 'r', render: (r) => (r.profitPerKm == null ? html`<span title="Fără km GPS suficienți sau încredere scăzută">—</span>` : html`${r.approx ? '≈ ' : ''}${money(r.profitPerKm, cur)}`) },
    { key: 'empty', header: 'Km pe gol', align: 'r', render: (r) => (r.pctEmpty == null ? html`<span title="Fără date GPS">—</span>` : html`${fmtPct(r.pctEmpty, 0)}`) },
  ];
  const e = empty.data;
  const n = rows.length;
  return html`<div class="stack">
    <${PageHeader} title=${t.nav.home} sub=${monthLabel(month) + ' · ' + trucks.length + ' camioane'}>
      <${DemoBadge} />${closed ? html`<${Badge} kind="closed">${t.badges.closed}<//>` : null}<//>
    ${rank.missing ? html`<${Note} kind="warn">Calculul de profit nu este disponibil în această versiune.<//>` : null}
    ${queue.total ? html`<button type="button" class="banner caution" onClick=${() => ctx.nav('/verificare')}><${Icon} name="alert" /><span><b>Luna nu e completă:</b> ${queue.total} de verificat. Cifrele includ doar ce e introdus.</span><b>Vezi ce lipsește</b><${Icon} name="chev" size="sm" /></button>` : null}
    ${first ? html`<${FirstRun} steps=${steps} />` : null}
    ${!rank.data && !rank.missing ? html`<${Loading} />` : null}
    ${total ? html`<div class="kpis">
      <${Kpi} big label="Profit operațional" tone=${total.profitOp < 0 ? 'neg' : 'pos'} value=${html`<${Pl} value=${total.profitOp} cur=${cur} />`}
        delta=${html`documentat ${money(total.profitDoc, cur, { sign: true })}`} hint=${t.notProfit} />
      <${Kpi} label="Venit" value=${money(total.revenue, cur)} onClick=${() => ctx.nav(coursesLink({ luna: month }))} delta="fără TVA" />
      <${Kpi} label="Costuri" value=${money(total.costTotal, cur)} onClick=${() => ctx.nav(ledgerLink({ luna: month }))} delta=${total.provisionalCount ? `include ${total.provisionalCount} sume provizorii` : null} />
      <${Kpi} label="Km pe gol" value=${e && e.kpis && e.kpis.pctEmpty != null ? fmtPct(e.kpis.pctEmpty, 1) : '—'} onClick=${() => ctx.nav('/km-pe-gol')}
        delta=${e && e.kpis && e.kpis.emptyM != null ? fmtKm(e.kpis.emptyM, 0) + ' goi' : 'fără date GPS'} />
    </div>
    <p class="muted sm">Mod recunoaștere: <b>${meta.recognition || '—'}</b> · curs: <b>${meta.fx.length ? meta.fx.join(', ') : 'RON'}</b>. ${t.notProfit}</p>` : null}
    ${noDoc.data ? html`<p class="sm" data-testid="nodoc-line"><${Icon} name="docoff" size="sm" /> cheltuieli fără document: <b>${money(noDoc.data.amount, cur)}</b> (${noDoc.data.pct == null ? '—' : fmtPct(noDoc.data.pct, 1)} din cost)</p>` : null}
    ${n === 0 && !first ? html`<${EmptyState} icon="chart" title="Nu sunt date în această lună" action=${html`<div class="toolbar"><${Button} onClick=${() => ctx.openEntry('expense')}>Adaugă prima cheltuială<//><${Button} kind="sec" onClick=${() => ctx.nav('/import')}>Importă curse<//></div>`} />` : null}
    ${n > 0 ? html`<${Card} title="Camioane · de la cel mai slab" right=${html`<span class="muted sm">apasă pe un rând pentru fișa camionului</span>`}>
      <${Table} caption="Clasamentul camioanelor" columns=${cols} rows=${rows} rowKey=${(r) => r.truckId} onRowClick=${(r) => ctx.nav('/camion/' + r.truckId)}
        footer=${total ? ['Flota', money(total.revenue, cur), money(total.costTotal, cur), money(total.profitOp, cur, { sign: true }), '', e && e.kpis && e.kpis.pctEmpty != null ? fmtPct(e.kpis.pctEmpty, 0) : '—'] : null} /><//>` : null}
    <div class="g-2">
      <${Card} title="Alerte"><${Alerts} items=${alerts} /><//>
      <${Card} title="Luna asta: ce s-a adăugat automat">${auto.data ? html`
        ${auto.data.byTemplate.length === 0 ? html`<p class="muted">Nicio cheltuială fixă generată în această lună.</p>` : html`
          <ul class="alerts">${auto.data.byTemplate.map((x) => html`<li><button type="button" onClick=${() => ctx.nav('/verificare?sursa=recurenta')}><span class="ico c-accent"><${Icon} name="repeat" /></span><span class="tx"><b>${x.name}</b><br /><span class="muted sm">${x.count} · ${money(x.totalRon, 'RON')}${x.pending ? ` · ${x.pending} de confirmat` : ''}</span></span></button></li>`)}</ul>`}
        <${Button} kind="sec" sm onClick=${() => ctx.nav('/setari/fixe')}>Cheltuieli fixe<//>` : html`<p class="muted">—</p>`}<//>
    </div>
    ${series.data ? html`<${Card} title="Profit operațional pe lună" right=${html`<span class="muted sm">ultimele 12 luni, ${cur}</span>`}>
      <${Chart} type="bar" title="Profit operațional pe lună" desc="Profitul operațional al flotei pe ultimele 12 luni" labels=${series.data.map((x) => t.monthsShort[Number(x.month.slice(5)) - 1])}
        series=${[{ name: 'Profit', data: series.data.map((x) => x.profitOp) }]} format=${(v) => fmtNumber(Math.round(v / 100), 0)} /><//>` : null}
  </div>`;
}

export const screen = {
  id: 'home', route: '/acasa', title: () => t.nav.home,
  nav: { label: t.nav.home, icon: 'home', order: 1, group: 'work' },
  component: HomeScreen,
};
