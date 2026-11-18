import { html, useState, useMemo, useEffect } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useStore, useCollection, useUiPref, useDisplayCurrency, useMonth } from '../../ui/hooks.js';
import { Table, Pager, Card, PageHeader, Button, Badge, EmptyState, EntryForm, EntryEditor, Select, TextInput, Checkbox, Icon, Note } from '../../ui/components/index.js';
import { filterEntries, sortRows, paginate, sumEntries, entryAmount, amountPair, truckLabel, nameMap, lastEntry, entryToForm, coll, monthLabel, monthOfEntry, monthOptions } from '../../ui/selectors.js';
import { deleteEntries, confirmEntries } from '../../ui/actions.js';
import { tryCall } from '../../ui/api.js';
import { fmtDate, fmtMoney, todayLocal, newId, monthRange } from '../../core/index.js';
import { useDomain, ledgerLink } from '../../ui/screen-utils.js';

const DEFAULT_FILTERS = { month: '', truckId: '', categoryId: '', country: '', currency: '', status: '', text: '', noDoc: false, recurring: false, manualFx: false, kind: '' };

function EntryBadges({ e }) {
  return html`<span class="toolbar" style="gap:4px">
    ${e.recurring ? html`<${Badge} kind="recurring" />` : null}${e.documentation === 'none' ? html`<${Badge} kind="nodoc" />` : null}
    ${e.currency && e.currency !== 'RON' && e.fx && e.fx.manual ? html`<${Badge} kind="manual-fx" />` : e.currency && e.currency !== 'RON' && e.fx && e.fx.stale ? html`<${Badge} kind="stale-fx" />` : null}
    ${e.status === 'auto_pending' ? html`<${Badge} kind="provisional">${t.status.auto_pending}<//>` : e.status === 'pending' ? html`<${Badge} kind="warn">${t.status.pending}<//>` : null}</span>`;
}

function LedgerScreen({ query }) {
  const ctx = useCtx();
  const [saved, setSaved] = useUiPref('ledgerFilters', DEFAULT_FILTERS);
  const [month] = useMonth();
  const [cur] = useDisplayCurrency();
  // parametrii din URL (drill-down de pe Acasă) au prioritate față de filtrele salvate
  const fromUrl = useMemo(() => {
    const o = {};
    if (query.get('luna')) o.month = query.get('luna');
    if (query.get('camion')) o.truckId = query.get('camion');
    if (query.get('categorie')) o.categoryId = query.get('categorie');
    if (query.get('cursManual')) o.manualFx = true;
    return o;
  }, [query.toString()]);
  const f = { ...DEFAULT_FILTERS, ...saved, ...fromUrl };
  const setF = (p) => setSaved({ ...DEFAULT_FILTERS, ...saved, ...p });
  const entries = useCollection('entries');
  const trucks = useCollection('trucks');
  const cats = useCollection('categories');
  const countries = useCollection('countries');
  const state = ctx.store.state();
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const tm = useMemo(() => nameMap(state, 'trucks'), [trucks]);
  const cm = useMemo(() => nameMap(state, 'categories'), [cats]);
  useEffect(() => { setPage(1); }, [JSON.stringify(f)]);

  // drill-down de pe Acasă (camion + lună): același calcul ca pe Acasă, ca lista să explice suma
  const explain = f.truckId && f.truckId !== '__common' && f.month;
  const pnl = useDomain('truckPnl', (s) => [s, f.truckId, monthRange(f.month), { currency: cur }], [f.truckId, f.month, cur], !!explain);
  const p = explain && pnl.data ? pnl.data : null;
  // partea din lună a fiecărei intrări (cele eșalonate contează doar parțial), din aceleași linii ca pe Acasă
  const monthParts = useMemo(() => {
    if (!explain || !p) return null;
    const lines = tryCall('ledgerLines', [state], null);
    if (!lines) return null;
    const m = new Map();
    for (const l of lines) if (l.truckId === f.truckId && l.month === f.month && (l.kind === 'cost' || l.kind === 'recovery')) m.set(l.entryId, (m.get(l.entryId) || 0) + l.v[cur]);
    return m;
  }, [entries, p, cur]);
  const rows = useMemo(() => {
    let base = filterEntries(entries, { ...f, month: f.month || undefined }, state);
    if (p && p.refs) { // intrări eșalonate (spread) care contribuie la lună, deși data lor e în altă lună
      const have = new Set(base.map((e) => e.id));
      const extra = new Set(p.refs.entryIds.filter((id) => !have.has(id)));
      if (extra.size) base = base.concat(filterEntries(entries, { ...f, month: undefined }, state).filter((e) => extra.has(e.id)));
    }
    return sortRows(base, sort.key, sort.dir, {
      amount: (e) => entryAmount(e, cur), truck: (e) => truckLabel(tm.get(e.target && e.target.truckId)), category: (e) => (cm.get(e.categoryId) || {}).name,
    });
  }, [entries, JSON.stringify(f), sort, cur, p]);
  const totals = useMemo(() => ({ ron: sumEntries(rows, 'RON'), eur: sumEntries(rows, 'EUR'), eurMissing: rows.filter((e) => !(e.eur && (e.eur.cost != null || e.eur.net != null))).length }), [rows]);
  const pg = paginate(rows, page, 100);
  const last = lastEntry(entries);

  const columns = [
    { key: 'date', header: 'Data', sortable: true, card: 'meta', render: (e) => fmtDate(e.date) },
    { key: 'truck', header: 'Camion', sortable: true, card: 'meta', render: (e) => (e.target && e.target.truckId ? truckLabel(tm.get(e.target.truckId)) : html`<span class="muted">comun</span>`) },
    { key: 'category', header: 'Categorie', sortable: true, card: 'title', render: (e) => (cm.get(e.categoryId) || {}).name || '—' },
    { key: 'supplier', header: 'Furnizor', sortable: true, wrap: true, card: 'meta', render: (e) => html`${e.supplier || ''}${e.countryCode ? html` <span class="muted sm">${e.countryCode}</span>` : null}` },
    { key: 'amount', header: 'Sumă', sortable: true, align: 'r', wrap: true, card: 'amount', render: (e) => html`<span class=${e.kind === 'income' ? 'pos' : ''}>${e.kind === 'income' ? '+ ' : ''}${amountPair(e, cur)}</span>${monthParts && e.spread && monthParts.has(e.id) ? html`<span class="sub">în lună: ${fmtMoney(monthParts.get(e.id), cur)} (eșalonat)</span>` : ''}` },
    { key: 'badges', header: 'Etichete', wrap: true, card: 'badges', render: (e) => html`<${EntryBadges} e=${e} />` },
  ];

  async function bulkDelete() {
    const ids = [...sel];
    const ok = await ctx.confirm({ title: 'Ștergi ' + ids.length + ' intrări?', body: 'Poți anula în 15 secunde.', confirmLabel: t.common.delete, danger: true });
    if (!ok) return;
    await deleteEntries(ctx, ids); setSel(new Set());
  }
  async function bulkSet(patch) {
    const ids = sel; const now = new Date().toISOString();
    const list = entries.filter((e) => ids.has(e.id)).map((e) => ({ ...e, ...patch(e), updatedAt: now }));
    try { const r = await ctx.store.putMany('entries', list); ctx.toast({ kind: 'ok', text: `${list.length} intrări actualizate.`, actionLabel: t.common.undo, onAction: () => r.undo() }); setSel(new Set()); }
    catch (e) { ctx.toast({ kind: 'error', text: e.message }); }
  }
  async function copyPrev() {
    const drafts = tryCall('copyPreviousMonth', [state, month], null);
    if (!drafts) { ctx.toast({ kind: 'error', text: t.errors.missingApi('copyPreviousMonth') }); return; }
    if (!drafts.length) { ctx.toast({ kind: 'info', text: 'Nu sunt cheltuieli variabile de copiat din luna trecută.' }); return; }
    const ok = await ctx.confirm({ title: `Copiezi ${drafts.length} cheltuieli din luna trecută?`, body: 'Se adaugă ca ciorne „de verificat”, cu data din luna curentă. Verifică sumele în „De verificat”.', confirmLabel: 'Copiază' });
    if (!ok) return;
    const r = await ctx.store.putMany('entries', drafts);
    ctx.toast({ kind: 'ok', text: `${drafts.length} ciorne adăugate.`, actionLabel: t.common.undo, onAction: () => r.undo() });
  }

  const catOpts = cats.map((c) => ({ value: c.id, label: c.name }));
  return html`<div class="stack">
    <${PageHeader} title=${t.nav.ledger} sub=${f.month ? monthLabel(f.month) : 'Toate lunile'}>
      <${Button} sm kind="sec" icon="dup" disabled=${!last} onClick=${() => last && ctx.openEntry(last.kind === 'income' ? 'income' : 'expense', entryToForm(last, todayLocal(ctx.clock)))} title="Alt+Shift+D">Duplică ultima<//>
      <${Button} sm kind="sec" icon="repeat" onClick=${copyPrev}>Copiază luna trecută<//>
      <${Button} sm icon="plus" onClick=${() => ctx.openEntry('expense')}>${t.nav.entry}<//><//>
    <${Card} title="Adaugă rapid"><${EntryForm} kind="expense" compact /><//>
    <${Card}>
      <div class="form-grid" role="search" aria-label="Filtre">
        <${Select} label="Luna" value=${f.month} onChange=${(v) => setF({ month: v })} options=${monthOptions(entries.map(monthOfEntry), [month, f.month])} />
        <${Select} label="Camion" value=${f.truckId} onChange=${(v) => setF({ truckId: v })} options=${[{ value: '', label: 'Toate' }, { value: '__common', label: 'Costuri comune (fără camion)' }, ...trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))]} />
        <${Select} label="Categorie" value=${f.categoryId} onChange=${(v) => setF({ categoryId: v })} options=${[{ value: '', label: 'Toate' }, ...catOpts]} />
        <${Select} label="Țara" value=${f.country} onChange=${(v) => setF({ country: v })} options=${[{ value: '', label: 'Toate' }, ...countries.map((c) => ({ value: c.code, label: c.code }))]} />
        <${Select} label="Valută" value=${f.currency} onChange=${(v) => setF({ currency: v })} options=${[{ value: '', label: 'Toate' }, ...[...new Set(entries.map((e) => e.currency))].filter(Boolean)]} />
        <${Select} label="Status" value=${f.status} onChange=${(v) => setF({ status: v })} options=${[{ value: '', label: 'Toate' }, ...Object.entries(t.status).filter(([k]) => ['confirmed', 'pending', 'auto_pending', 'flagged'].includes(k)).map(([value, label]) => ({ value, label }))]} />
        <${TextInput} label="Caută" value=${f.text} onInput=${(v) => setF({ text: v })} placeholder="furnizor, nr. doc, notă" />
      </div>
      <div class="toolbar"><${Checkbox} label="Fără document" checked=${f.noDoc} onChange=${(v) => setF({ noDoc: v })} /><${Checkbox} label="Recurente" checked=${f.recurring} onChange=${(v) => setF({ recurring: v })} />
        <${Checkbox} label="Curs manual" checked=${f.manualFx} onChange=${(v) => setF({ manualFx: v })} />
        <${Button} kind="ghost" sm onClick=${() => setSaved(DEFAULT_FILTERS)}>Resetează filtrele<//></div><//>
    ${p ? html`<${Note} kind="info"><span data-testid="ledger-explain"><b>Cum se formează costul din Acasă (${fmtMoney(p.costTotal, cur)}):</b>
      cheltuieli directe ${fmtMoney(p.cost, cur)}${monthParts ? html` (suma părților din lună ale intrărilor de mai jos: ${fmtMoney([...monthParts.values()].reduce((a, b) => a + b, 0), cur)})` : ' (lista de mai jos)'}${p.overhead ? html` + costuri comune repartizate ${fmtMoney(p.overhead, cur)} <button type="button" class="cell-link" onClick=${() => ctx.nav(ledgerLink({ luna: f.month, camion: '__common' }))}>vezi costurile comune</button>` : ''}${p.depreciationIncluded && p.depreciation ? ` + amortizare ${fmtMoney(p.depreciation, cur)}` : ''}.
      Intrările eșalonate pe mai multe luni apar cu suma întreagă, dar contribuie doar cu partea lunii.</span><//>` : null}
    ${sel.size ? html`<div class="card toolbar" role="region" aria-label="Acțiuni pe selecție"><b>${sel.size} selectate</b>
      <${Button} sm onClick=${() => confirmEntries(ctx, [...sel]).then(() => setSel(new Set()))}>Confirmă<//>
      <${Select} label="" value="" placeholder="Schimbă categoria…" onChange=${(v) => v && bulkSet(() => ({ categoryId: v }))} options=${catOpts} />
      <${Select} label="" value="" placeholder="Schimbă camionul…" onChange=${(v) => v && bulkSet((e) => ({ target: { ...(e.target || {}), type: 'truck', truckId: v } }))} options=${trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))} />
      <${Button} sm kind="sec" onClick=${bulkDelete}>${t.common.delete}<//></div>` : null}
    <${Card}>
      ${entries.length === 0 ? html`<${EmptyState} icon="receipt" title=${t.states.noEntries} action=${html`<${Button} onClick=${() => ctx.openEntry('expense')}>${t.nav.entry}<//>`} />` : html`
      <p class="sm" data-testid="ledger-totals" aria-live="polite">Total filtrat (${rows.length} rânduri): cheltuieli <b>${fmtMoney(totals.ron.cost, 'RON')}</b> · <b>${totals.eurMissing && totals.eurMissing >= rows.length ? '—' : fmtMoney(totals.eur.cost, 'EUR')}</b>${totals.eurMissing && totals.eurMissing < rows.length ? html` <span class="muted sm">(fără ${totals.eurMissing} intrări fără curs EUR)</span>` : null}${totals.ron.income ? html` · venituri <b>${fmtMoney(totals.ron.income, 'RON')}</b>` : null}</p>
      <${Table} cards caption="Cheltuieli și venituri" columns=${columns} rows=${pg.rows} sort=${sort} onSort=${setSort} selectable selected=${sel} onSelect=${setSel} onRowClick=${(e) => setEdit(e)}
        emptyText="Nicio intrare nu se potrivește filtrelor." />
      <${Pager} ...${pg} onPage=${setPage} />
      <${Note}>Totalul în EUR: ${t.eurNote}<//>`}<//>
    ${edit ? html`<${EntryEditor} entry=${edit} onClose=${() => setEdit(null)} />` : null}
  </div>`;
}
export const screen = {
  id: 'ledger', route: '/tranzactii', title: () => t.nav.ledger,
  nav: { label: t.nav.ledger, icon: 'receipt', order: 2, group: 'work' }, component: LedgerScreen,
};
