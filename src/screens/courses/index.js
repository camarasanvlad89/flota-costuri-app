import { html, useState, useMemo, useEffect } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useUiPref, useMonth } from '../../ui/hooks.js';
import { HelpLink, Card, PageHeader, Button, Table, Pager, Badge, EmptyState, Select, TextInput, Modal, Note, Icon, ProgressBar } from '../../ui/components/index.js';
import { CourseForm } from './CourseForm.js';
import { tryCall } from '../../ui/api.js';
import { useToday } from '../../ui/screen-utils.js';
import { truckLabel, nameMap, paginate, sortRows, monthLabel, coll, monthOptions } from '../../ui/selectors.js';
import { fmtDate, fmtMoney, fmtKm } from '../../core/index.js';

const KM_SRC = { column: 'coloană', 'gps-trips': 'GPS', route: 'rută', 'gps-window': 'orientativ', manual: 'manual' };

function KmCell({ c }) {
  const k = c.loadedKm;
  if (!k || k.meters == null) return html`<span class="muted" title="Necesită km manual sau calcul">—</span>`;
  const approx = k.confidence !== 'high';
  return html`${approx ? '≈ ' : ''}${fmtKm(k.meters, 0)} <span class=${'chip ' + (k.source === 'gps-window' ? 'c-caution' : k.source === 'manual' ? 'c-accent' : 'c-neutral')}>${KM_SRC[k.source] || k.source}</span>`;
}

function PlacesQueue({ courses }) {
  const ctx = useCtx();
  const places = useCollection('places');
  const queue = useMemo(() => tryCall('unresolvedPlaces', [courses, places], []), [courses, places]);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null); // { name, candidates }
  if (!queue.length) return null;
  async function resolveAll() {
    setBusy(true);
    let done = 0;
    for (const q of queue.slice(0, 25)) {
      try {
        const r = await ctx.routing.resolvePlace(q.name, {});
        if (r && r.candidates && r.candidates.length) { setPick({ name: q.name, candidates: r.candidates }); break; }
        if (r && r.id) { await ctx.routing.confirmPlace(q.name, r); }
      } catch (e) { ctx.toast({ kind: 'warn', text: `${q.name}: ${e.message}` }); }
      done++; ctx.progress.set({ label: 'Locuri rezolvate', done, total: Math.min(25, queue.length) });
    }
    ctx.progress.set(null); setBusy(false);
  }
  return html`<${Card} title=${`Locuri de rezolvat (${queue.length})`} right=${html`<${Button} sm onClick=${resolveAll} disabled=${busy}>${busy ? 'Se caută…' : 'Caută și confirmă în bloc'}<//>`}>
    <p class="muted sm">Sortate după frecvență. Căutarea folosește Nominatim (1 cerere/s) și trimite doar numele locurilor.</p>
    <${Table} caption="Locuri de rezolvat" rowKey=${(q) => q.key} rows=${queue.slice(0, 50)} columns=${[{ key: 'n', header: 'Loc', render: (q) => q.name }, { key: 'c', header: 'Curse', align: 'r', render: (q) => q.count },
      { key: 'a', header: '', render: (q) => html`<${Button} sm kind="ghost" onClick=${async () => { const r = await ctx.routing.resolvePlace(q.name, {}).catch((e) => ({ err: e })); if (r && r.candidates) setPick({ name: q.name, candidates: r.candidates }); else if (r && r.id) ctx.routing.confirmPlace(q.name, r); else if (r && r.err) ctx.toast({ kind: 'warn', text: r.err.message }); }}>Rezolvă<//>` }]} />
    ${pick ? html`<${Modal} title=${'Alege locul pentru „' + pick.name + '”'} onClose=${() => setPick(null)}>${pick.candidates.length === 0 ? html`<p>Niciun candidat. Adaugă manual în Setări › Alias-uri locuri.</p>` : html`<ul class="alerts">${pick.candidates.map((c) => html`<li><button type="button" onClick=${async () => { await ctx.routing.confirmPlace(pick.name, c); setPick(null); }}><span class="tx"><b>${c.display}</b><br /><span class="muted sm">${c.fullName}</span></span><${Icon} name="check" size="sm" /></button></li>`)}</ul>`}<//>` : null}<//>`;
}

function CoursesScreen({ query }) {
  const ctx = useCtx();
  const courses = useCollection('courses');
  const trucks = useCollection('trucks');
  const drivers = useCollection('drivers');
  const [month] = useMonth();
  const today = useToday();
  const [f, setF] = useState({ truckId: query.get('camion') || '', month: query.get('luna') || '', driver: '', status: '', text: '' });
  const [sort, setSort] = useState({ key: 'loadDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(query.get('nou') ? {} : null);
  const tm = useMemo(() => nameMap(ctx.store.state(), 'trucks'), [trucks]);
  useEffect(() => setPage(1), [JSON.stringify(f)]);
  const rows = useMemo(() => sortRows(courses.filter((c) => {
    if (f.truckId && c.truckId !== f.truckId) return false;
    if (f.month && !((c.loadDate || '').slice(0, 7) <= f.month && (c.unloadDate || c.loadDate || '').slice(0, 7) >= f.month)) return false;
    if (f.driver && (c.driverRaw || '') !== f.driver) return false;
    if (f.status === 'review' && c.status !== 'review' && c.priceStatus !== 'missing') return false;
    if (f.status === 'nokm' && c.loadedKm && c.loadedKm.meters != null) return false;
    if (f.text && !(String(c.routeRaw || '') + ' ' + String(c.note || '')).toLowerCase().includes(f.text.toLowerCase())) return false;
    return true;
  }), sort.key, sort.dir, { truck: (c) => truckLabel(tm.get(c.truckId)), net: (c) => c.net }), [courses, JSON.stringify(f), sort]);
  const pg = paginate(rows, page, 100);
  const noPrice = courses.filter((c) => c.priceStatus === 'missing').length;
  const [calc, setCalc] = useState(false);

  async function calcKm() {
    const todo = courses.filter((c) => !(c.loadedKm && c.loadedKm.meters != null));
    const q = ctx.routing.queue; q.add(todo);
    if (!q.pending) { ctx.toast({ kind: 'info', text: 'Toate cursele au deja km.' }); return; }
    setCalc(true);
    const label = 'Calcul km (rută)';
    try { await q.run((done, total) => ctx.progress.set({ label, done, total, onPause: () => q.abort() })); }
    catch (e) { ctx.toast({ kind: 'error', text: e.message }); }
    ctx.progress.set(null); setCalc(false);
  }
  const cols = [
    { key: 'loadDate', header: 'Date', sortable: true, card: 'meta', render: (c) => fmtDate(c.loadDate) + ' → ' + fmtDate(c.unloadDate) },
    { key: 'truck', header: 'Camion', sortable: true, card: 'meta', render: (c) => truckLabel(tm.get(c.truckId)) },
    { key: 'driver', header: 'Șofer', card: 'meta', render: (c) => c.driverRaw || '' },
    { key: 'routeRaw', header: 'Rută', sortable: true, card: 'title', render: (c) => c.routeRaw },
    { key: 'net', header: 'Net', sortable: true, align: 'r', card: 'amount', render: (c) => (c.net == null ? html`<${Badge} kind="bad">fără preț<//>` : html`${fmtMoney(c.net, c.currency || 'RON')} ${c.priceStatus === 'derived' ? html`<${Badge} kind="derived" />` : null}`) },
    { key: 'km', header: 'Km', align: 'r', card: 'meta', render: (c) => html`<${KmCell} c=${c} />` },
    { key: 'st', header: 'Stare', card: 'badges', render: (c) => html`<span class="toolbar" style="gap:4px">${c.status === 'review' ? html`<${Badge} kind="warn">de verificat<//>` : null}${tryCall('uitStatus', [c, today], { state: 'ok' }).state === 'missing' ? html`<${Badge} kind="neutral">lipsă UIT<//>` : null}</span>` },
  ];
  return html`<div class="stack"><${PageHeader} title=${t.nav.courses} sub=${rows.length + ' curse'}>
      <${HelpLink} id="ecran-curse" /><${Button} sm kind="sec" icon="route" onClick=${calcKm} disabled=${calc}>Calculează km<//><${Button} sm kind="sec" icon="upload" onClick=${() => ctx.nav('/import')}>Import<//><${Button} sm icon="plus" onClick=${() => setEdit({})}>Cursă nouă<//><//>
    ${noPrice ? html`<${Note} kind="warn">${noPrice} curse fără preț (apar și în De verificat).<//>` : null}
    <${Card}><div class="form-grid" role="search">
      <${Select} label="Camion" value=${f.truckId} onChange=${(v) => setF({ ...f, truckId: v })} options=${[{ value: '', label: 'Toate' }, ...trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))]} />
      <${Select} label="Luna" value=${f.month} onChange=${(v) => setF({ ...f, month: v })} options=${monthOptions(courses.flatMap((c) => [(c.loadDate || '').slice(0, 7), (c.unloadDate || '').slice(0, 7)]), [month, f.month])} />
      <${Select} label="Șofer" value=${f.driver} onChange=${(v) => setF({ ...f, driver: v })} options=${[{ value: '', label: 'Toți' }, ...[...new Set(courses.map((c) => c.driverRaw).filter(Boolean))]]} />
      <${Select} label="Stare" value=${f.status} onChange=${(v) => setF({ ...f, status: v })} options=${[{ value: '', label: 'Toate' }, { value: 'review', label: 'De verificat / fără preț' }, { value: 'nokm', label: 'Fără km' }]} />
      <${TextInput} label="Caută în rută" value=${f.text} onInput=${(v) => setF({ ...f, text: v })} /></div><//>
    <${Card}>${courses.length === 0 ? html`<${EmptyState} icon="route" title=${t.states.noCourses} action=${html`<div class="toolbar"><${Button} onClick=${() => ctx.nav('/import')}>Importă tabelul<//><${Button} kind="sec" onClick=${() => setEdit({})}>Adaugă o cursă<//></div>`} />` : html`
      <${Table} cards caption="Curse" columns=${cols} rows=${pg.rows} sort=${sort} onSort=${setSort} onRowClick=${(c) => setEdit(c)} emptyText="Nicio cursă nu se potrivește filtrelor." /><${Pager} ...${pg} onPage=${setPage} />`}<//>
    <${PlacesQueue} courses=${courses} />
    ${edit ? html`<${CourseForm} course=${edit.id ? edit : null} onClose=${() => setEdit(null)} />` : null}</div>`;
}
export const screen = {
  id: 'courses', route: '/curse', title: () => t.nav.courses,
  nav: { label: t.nav.courses, icon: 'route', order: 4, group: 'work' }, component: CoursesScreen,
};
