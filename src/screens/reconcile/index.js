import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useMonth, useCompany } from '../../ui/hooks.js';
import { Card, PageHeader, Button, Table, Badge, Select, TextInput, EmptyState, Note, Kpi, ErrorState } from '../../ui/components/index.js';
import { call, api, tryCall } from '../../ui/api.js';
import { saveBytes } from '../../ui/actions.js';
import { truckLabel, nameMap, monthLabel, coll } from '../../ui/selectors.js';
import { fmtDate, fmtKm, monthRange } from '../../core/index.js';

const SEV = { high: ['bad', 'mare'], medium: ['warn', 'medie'], info: ['info', 'info'] };
const SUPPORT = { supported: ['ok', 'cu suport GPS'], unsupported: ['bad', 'fără suport'], noGps: ['neutral', 'fără date GPS'], none: ['neutral', '—'] };

function FlagRow({ f, onChange }) {
  const [note, setNote] = useState(f.note || '');
  const [sev, label] = SEV[f.severity] || SEV.info;
  return html`<tr><td><${Badge} kind=${sev}>${label}<//></td><td class="wrap">${f.message}</td><td>${fmtDate(f.date || '')}</td>
    <td><select class="sel" aria-label="Stare steag" value=${f.status} onChange=${(e) => onChange({ ...f, status: e.currentTarget.value })}>${['neconfirmat', 'explicat', 'ignorat'].map((s) => html`<option value=${s} selected=${s === f.status}>${s}</option>`)}</select></td>
    <td class="wrap"><input class="inp" aria-label="Notă steag" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} onBlur=${() => note !== (f.note || '') && onChange({ ...f, note })} placeholder="notă" /></td></tr>`;
}

function ReconcileScreen() {
  const ctx = useCtx();
  const [month] = useMonth();
  const trucks = useCollection('trucks');
  const [truckId, setTruckId] = useState('');
  const courses = useCollection('courses'), gpsDays = useCollection('gpsDays'), gpsTrips = useCollection('gpsTrips'), aliases = useCollection('aliases'), flags = useCollection('flags');
  const company = useCompany();
  const range = monthRange(month);
  const res = useMemo(() => {
    try {
      return { data: call('reconcile', { truckIds: truckId ? [truckId] : trucks.map((x) => x.id), courses, gpsDays, gpsTrips, aliases, existingFlags: flags, range, now: new Date().toISOString() }) };
    } catch (e) { return { error: e }; }
  }, [month, truckId, courses, gpsDays, gpsTrips, aliases, flags, trucks]);
  if (res.error) return res.error.apiName ? html`<${Note} kind="warn">${t.errors.missingApi(res.error.apiName)}<//>` : html`<${ErrorState} error=${res.error} />`;
  const r = res.data;
  const tm = nameMap(ctx.store.state(), 'trucks');
  const sum = r.monthly.filter((m) => m.month === month);
  const total = sum.reduce((a, m) => ({ courses: a.courses + m.courses, withSupport: a.withSupport + m.withSupport, withoutSupport: a.withoutSupport + m.withoutSupport + m.noGps, unc: a.unc + m.uncoveredActiveDays, km: a.km + m.kmTotalM, kin: a.kin + m.kmInInvoicedWindowsM, kout: a.kout + m.kmOutsideM }), { courses: 0, withSupport: 0, withoutSupport: 0, unc: 0, km: 0, kin: 0, kout: 0 });

  async function saveFlag(f) {
    const next = { ...(tryCall('setFlagStatus', [f, { status: f.status, note: f.note }, new Date().toISOString()], f)), updatedAt: new Date().toISOString() };
    await ctx.store.put('flags', next);
  }
  async function persistAll() { // fixează steagurile calculate (starea și nota se păstrează la reanalizare)
    const known = new Set(flags.map((x) => x.id));
    const fresh = r.flags.filter((f) => !known.has(f.id));
    if (fresh.length) await ctx.store.putMany('flags', fresh);
  }
  async function confirmMatch(m) {
    const mk = api('makeAlias');
    if (!mk) return;
    const items = [];
    const crs = courses.find((c) => c.id === m.courseId);
    const now = new Date().toISOString();
    if (m.load && crs && crs.origin) items.push(mk({ name: crs.origin, locality: m.load.locality, now }));
    if (m.unload && crs && (crs.destinations || [])[0]) items.push(mk({ name: crs.destinations[0], locality: m.unload.locality, now }));
    if (items.length) { await ctx.store.putMany('aliases', items); ctx.toast({ kind: 'ok', text: 'Potrivirea a fost confirmată și salvată.' }); }
  }
  async function exportXlsx() {
    try {
      const bytes = await call('buildWorkbook', ctx.store.state(), { range, currency: 'RON', sheets: ['reconcile'], locale: 'ro-RO', generatedAt: new Date().toISOString() });
      saveBytes(bytes, `confruntare-gps-${month}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) { ctx.toast({ kind: 'error', text: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
  }
  const evCols = [
    { key: 'd', header: 'Cursă facturată', card: 'title', render: (e) => html`${fmtDate(e.loadDate)} → ${fmtDate(e.unloadDate)}<span class="sub">${e.route || ''}</span>` },
    { key: 't', header: 'Camion', card: 'meta', render: (e) => truckLabel(tm.get(e.truckId)) },
    { key: 'k', header: 'Km GPS', align: 'r', card: 'amount', render: (e) => (e.noDataDays === e.days.length ? html`<span class="muted">fără date GPS</span>` : fmtKm(e.gpsKmM, 0)) },
    { key: 'a', header: 'Zile active / inactive', align: 'r', card: 'meta', render: (e) => `${e.activeDays} / ${e.idleDays}${e.noDataDays ? ' (+' + e.noDataDays + ' fără date)' : ''}` },
    { key: 'p', header: 'Opriri la locuri', card: 'badges', render: (e) => (e.anchor ? (e.anchor.ok ? html`<${Badge} kind=${e.anchor.needsConfirm ? 'warn' : 'ok'}>${e.anchor.needsConfirm ? 'de confirmat' : 'găsite'}<//>` : html`<${Badge} kind="warn">${e.anchor.reason === 'LOAD_NOT_VISITED' ? 'încărcare nevizitată' : e.anchor.reason === 'UNLOAD_NOT_VISITED' ? 'descărcare nevizitată' : e.anchor.reason || 'negăsite'}<//>`) : '—') },
    { key: 's', header: 'Suport', card: 'badges', render: (e) => { const [k, l] = SUPPORT[e.support] || SUPPORT.none; return html`<${Badge} kind=${k}>${l}<//>`; } },
  ];
  return html`<div class="stack"><${PageHeader} title=${t.nav.reconcile} sub=${monthLabel(month) + ' · ce arată GPS-ul față de ce s-a facturat'}>
      <${Button} sm kind="sec" icon="download" onClick=${exportXlsx}>Export Excel<//><${Button} sm kind="sec" onClick=${persistAll} title="Salvează steagurile curente ca să le poți marca">Fixează steagurile<//><//>
    <${Card}><div class="form-grid"><${Select} label="Camion" value=${truckId} onChange=${setTruckId} options=${[{ value: '', label: 'Toate' }, ...trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))]} /></div><//>
    ${total.courses === 0 && r.uncoveredPeriods.length === 0 ? html`<${EmptyState} icon="gps" title="Nimic de confruntat în această lună" action=${html`<${Button} onClick=${() => ctx.nav('/import')}>Importă curse și GPS<//>`}>Importă tabelul de curse și exporturile SafeFleet.<//>` : html`
    <div class="kpis"><${Kpi} label="Curse facturate" value=${total.courses} /><${Kpi} label="Cu suport GPS" value=${total.withSupport} tone="pos" /><${Kpi} label="Fără suport / fără GPS" value=${total.withoutSupport} tone=${total.withoutSupport ? 'neg' : ''} />
      <${Kpi} label="Zile active neacoperite" value=${total.unc} /><${Kpi} label="Km total / în curse / în afară" value=${fmtKm(total.km, 0)} delta=${`${fmtKm(total.kin, 0)} în ferestre facturate · ${fmtKm(total.kout, 0)} în afară`} /></div>
    <${Card} title="Curse facturate și dovada GPS"><${Table} cards caption="Curse facturate și dovada GPS" rowKey=${(e) => e.courseId} rows=${r.evidence} columns=${evCols} emptyText="Nicio cursă facturată în această lună." /><//>
    <${Card} title="Perioade fără factură (zile active GPS neacoperite)">${r.uncoveredPeriods.length ? html`<${Table} rowKey=${(p) => p.truckId + p.from} rows=${r.uncoveredPeriods} columns=${[{ key: 't', header: 'Camion', render: (p) => truckLabel(tm.get(p.truckId)) },
      { key: 'p', header: 'Perioadă', render: (p) => fmtDate(p.from) + (p.to !== p.from ? ' → ' + fmtDate(p.to) : '') }, { key: 'd', header: 'Zile', align: 'r', render: (p) => p.days }, { key: 'k', header: 'Km', align: 'r', render: (p) => fmtKm(p.kmM, 0) }]} />` : html`<p class="muted">Nicio perioadă activă fără cursă.</p>`}<//>
    ${r.matchesToConfirm.length ? html`<${Card} title="Potriviri de locuri de confirmat"><${Table} rowKey=${(m) => m.courseId} rows=${r.matchesToConfirm} columns=${[{ key: 'c', header: 'Cursă', render: (m) => (courses.find((c) => c.id === m.courseId) || {}).routeRaw },
      { key: 'l', header: 'Încărcare', render: (m) => (m.load ? `${m.load.locality} (${Math.round(m.load.score * 100)}%)` : '—') }, { key: 'u', header: 'Descărcare', render: (m) => (m.unload ? `${m.unload.locality} (${Math.round(m.unload.score * 100)}%)` : '—') },
      { key: 'a', header: '', render: (m) => html`<${Button} sm onClick=${() => confirmMatch(m)}>Confirmă<//>` }]} /><//>` : null}
    <${Card} title=${`Steaguri (${r.flags.length})`}>${r.flags.length ? html`<div class="tw" tabindex="0" role="region" aria-label="Steaguri"><table class="tbl"><caption class="vh">Steaguri</caption><thead><tr><th scope="col">Severitate</th><th scope="col">Mesaj</th><th scope="col">Data</th><th scope="col">Stare</th><th scope="col">Notă</th></tr></thead>
      <tbody>${r.flags.map((f) => html`<${FlagRow} key=${f.id + f.status} f=${f} onChange=${saveFlag} />`)}</tbody></table></div>` : html`<p class="muted">Niciun steag. Cursele facturate sunt susținute de GPS.</p>`}<//>`}</div>`;
}
export const screen = { id: 'reconcile', route: '/confruntare', title: () => t.nav.reconcile, nav: { label: t.nav.reconcile, icon: 'gps', order: 6, group: 'gps' }, component: ReconcileScreen };
