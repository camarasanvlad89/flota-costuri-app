import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useMonth, useDisplayCurrency } from '../../ui/hooks.js';
import { useDomain } from '../../ui/screen-utils.js';
import { HelpLink, Card, PageHeader, Kpi, Chart, Table, Badge, EmptyState, Button, Note, ErrorState, Loading, DateInput } from '../../ui/components/index.js';
import { truckLabel, nameMap, monthLabel, shiftMonth } from '../../ui/selectors.js';
import { fmtKm, fmtPct, fmtMoney, fmtDate, monthRange } from '../../core/index.js';

const GRAN = [['day', 'Zile'], ['week', 'Săptămâni'], ['month', 'Luni']];

function EmptyKmScreen() {
  const ctx = useCtx();
  const [month] = useMonth();
  const [cur] = useDisplayCurrency();
  const [gran, setGran] = useState('month');
  const [span, setSpan] = useState(gran === 'month' ? 6 : 1);
  const range = useMemo(() => ({ from: monthRange(shiftMonth(month, -(gran === 'month' ? 5 : 0))).from, to: monthRange(month).to }), [month, gran]);
  const rep = useDomain('emptyKmReport', (s) => [s, range, { granularity: gran, currency: cur }], [month, gran, cur]);
  const tm = nameMap(ctx.store.state(), 'trucks');
  if (rep.error) return html`<${ErrorState} error=${rep.error} />`;
  if (rep.missing) return html`<${Note} kind="warn">${t.errors.missingApi('emptyKmReport')}<//>`;
  if (!rep.data) return html`<${Loading} />`;
  const r = rep.data, k = r.kpis, b = r.benchmarks || {};
  const trend = r.trend || [];
  const byBucket = new Map();
  for (const row of r.rows) { if (row.gpsM == null) continue; const a = byBucket.get(row.bucket) || { loaded: 0, empty: 0 }; a.loaded += row.loadedM || 0; a.empty += row.emptyM || 0; byBucket.set(row.bucket, a); }
  const buckets = [...byBucket.keys()].sort();
  const lbl = (x) => (gran === 'month' ? t.monthsShort[Number(x.slice(5, 7)) - 1] + ' ' + x.slice(2, 4) : x.slice(5));
  const noGps = (r.noGpsTruckIds || []);
  const above = k.pctEmpty != null && b.avgEmptyPct != null && k.pctEmpty * 100 > b.avgEmptyPct;
  return html`<div class="stack"><${PageHeader} title=${t.nav.emptykm} sub=${gran === 'month' ? 'Ultimele 6 luni până la ' + monthLabel(month) : monthLabel(month)}>
      <${HelpLink} id="ecran-km-gol" /><div class="opts" role="group" aria-label="Granularitate">${GRAN.map(([v, l]) => html`<button type="button" class="opt" aria-pressed=${gran === v} onClick=${() => setGran(v)}>${l}</button>`)}</div><//>
    <div class="kpis">
      <${Kpi} big label="% km pe gol" value=${k.pctEmpty == null ? '—' : fmtPct(k.pctEmpty, 1)} tone=${above ? 'neg' : ''}
        delta=${html`reper ≈ ${b.avgEmptyPct}% medie · țintă sub ${b.targetEmptyPct}% <span class="muted">(${b.label || 'orientativ, sursă comercială'})</span>`} />
      <${Kpi} label="Km GPS / goi" value=${k.gpsM == null ? '—' : fmtKm(k.gpsM, 0)} delta=${k.emptyM == null ? 'fără date GPS' : fmtKm(k.emptyM, 0) + ' goi'} />
      <${Kpi} label="Cost variabil km pe gol" value=${k.emptyCost == null ? '—' : fmtMoney(k.emptyCost, cur)} delta=${k.emptyCostFull != null ? 'cost complet ' + fmtMoney(k.emptyCostFull, cur) : null} hint="Combustibil, taxe de drum etc. pe fereastra de 3 luni; fără costuri fixe." />
      <${Kpi} label="Venit / km încărcat" value=${k.revenuePerLoadedKm == null ? '—' : (k.approx ? '≈ ' : '') + fmtMoney(k.revenuePerLoadedKm, cur)} delta=${k.revenuePerTotalKm != null ? 'pe km total ' + fmtMoney(k.revenuePerTotalKm, cur) : null} /></div>
    ${buckets.length === 0 ? html`<${EmptyState} icon="gps" title="Fără date GPS în perioadă" action=${html`<${Button} onClick=${() => ctx.nav('/import?tab=gps')}>Importă export SafeFleet<//>`}>Km pe gol: <b>—</b> (necunoscut, nu 0).<//>` : html`
    <${Card} title="Km încărcați vs goi"><${Chart} type="stacked" title="Km încărcați vs goi" desc="Kilometri încărcați și goi pe perioadă, flota" labels=${buckets.map(lbl)}
      series=${[{ name: 'Încărcați', data: buckets.map((x) => Math.round(byBucket.get(x).loaded / 1000)) }, { name: 'Goi', data: buckets.map((x) => Math.round(byBucket.get(x).empty / 1000)), color: 'var(--caution)' }]} format=${(v) => String(Math.round(v))} />
      <p class="sm muted">Încărcați + goi = GPS pe fiecare bară.</p><//>`}
    ${trend.length ? html`<${Card} title="Trend lunar: % gol"><${Chart} type="line" title="Procent km pe gol, pe lună" desc="Trendul lunar al procentului de km pe gol" labels=${trend.map((x) => t.monthsShort[Number(x.month.slice(5)) - 1])}
      series=${[{ name: '% gol', data: trend.map((x) => (x.pctEmpty == null ? 0 : Math.round(x.pctEmpty * 1000) / 10)) }, ...(b.avgEmptyPct != null ? [{ name: 'Reper medie (orientativ)', data: trend.map(() => b.avgEmptyPct), color: 'var(--faint)' }] : []), ...(b.targetEmptyPct != null ? [{ name: 'Țintă (orientativ)', data: trend.map(() => b.targetEmptyPct), color: 'var(--gain-solid)' }] : [])]} format=${(v) => v + '%'} />
      <p class="sm muted">Liniile de reper sunt editabile în Setări › Date și sunt marcate „${b.label || 'orientativ, sursă comercială'}”.</p><//>` : null}
    <${Card} title="Pe camion"><${Table} caption="Km pe gol pe camion" rowKey=${(x) => x.truckId} rows=${r.trucks} columns=${[
      { key: 't', header: 'Camion', render: (x) => truckLabel(tm.get(x.truckId)) },
      { key: 'g', header: 'Km GPS', align: 'r', render: (x) => (x.gpsM == null ? html`<span title="Fără date GPS">—</span>` : fmtKm(x.gpsM, 0)) },
      { key: 'l', header: 'Încărcați', align: 'r', render: (x) => (x.loadedM == null ? '—' : fmtKm(x.loadedM, 0)) }, { key: 'e', header: 'Goi', align: 'r', render: (x) => (x.emptyM == null ? '—' : fmtKm(x.emptyM, 0)) },
      { key: 'p', header: '% gol', align: 'r', render: (x) => (x.pctEmpty == null ? '—' : (x.approx ? '≈ ' : '') + fmtPct(x.pctEmpty, 1)) },
      { key: 'c', header: 'Cost variabil gol', align: 'r', render: (x) => (x.emptyCostVar == null ? '—' : fmtMoney(x.emptyCostVar, cur)) },
      { key: 'v', header: 'Venit/km încărcat', align: 'r', render: (x) => (x.revenuePerLoadedKm == null ? '—' : fmtMoney(x.revenuePerLoadedKm, cur)) }]}
      onRowClick=${(x) => ctx.nav('/camion/' + x.truckId)} /><//>
    ${noGps.length ? html`<${Note} kind="warn">Fără date GPS: ${noGps.map((id) => truckLabel(tm.get(id))).join(', ')}. Apar cu „—”, nu cu 0.<//>` : null}
    ${(r.gaps || []).length ? html`<${Card} title="Goluri între curse"><${Table} caption="Goluri între curse" rowKey=${(g) => g.afterCourseId + g.beforeCourseId} rows=${r.gaps.slice(0, 100)} columns=${[
      { key: 't', header: 'Camion', render: (g) => truckLabel(tm.get(g.truckId)) }, { key: 'f', header: 'De la', render: (g) => fmtDate(g.from) }, { key: 'to', header: 'Până la', render: (g) => fmtDate(g.to) },
      { key: 'e', header: 'Km pe gol', align: 'r', render: (g) => fmtKm(g.emptyM, 1) }, { key: 'm', header: 'Mod', render: (g) => html`<${Badge} kind=${g.mode === 'trips' ? 'ok' : 'neutral'}>${g.mode === 'trips' ? 'din călătorii' : 'pe zile'}<//>${g.mixedDays && g.mixedDays.length ? html` <${Badge} kind="warn">${g.mixedDays.length} zile mixte<//>` : null}` }]} /><//>` : null}
    <${Card} title="Calitatea datelor">${(r.issues || []).length ? html`<ul class="alerts">${r.issues.slice(0, 40).map((i) => html`<li><span class="tx"><${Badge} kind=${i.severity === 'error' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}>${i.code}<//> ${i.message}</span></li>`)}</ul>` : html`<p class="muted">Nicio problemă detectată.</p>`}<//></div>`;
}
export const screen = { id: 'emptykm', route: '/km-pe-gol', title: () => t.nav.emptykm, nav: { label: t.nav.emptykm, icon: 'empty', order: 7, group: 'gps' }, component: EmptyKmScreen };
