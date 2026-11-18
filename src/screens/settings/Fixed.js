import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton } from '../../ui/hooks.js';
import { Card, Button, Table, Drawer, TextInput, Select, DateInput, MoneyInput, Checkbox, Note, Badge, Modal, EmptyState } from '../../ui/components/index.js';
import { call, tryCall, api } from '../../ui/api.js';
import { useToday } from '../../ui/screen-utils.js';
import { truckLabel, nameMap, monthLabel, coll } from '../../ui/selectors.js';
import { newId, detId, fmtDate, fmtMoney, monthKey, fmtPct } from '../../core/index.js';

const FREQ = [{ value: 'monthly', label: 'Lunar' }, { value: 'quarterly', label: 'Trimestrial' }, { value: 'yearly', label: 'Anual' }];
const TARGETS = [{ value: 'truck', label: 'Un camion' }, { value: 'trucks', label: 'Mai multe camioane (sumă per camion)' }, { value: 'fleet', label: 'Toată flota, împărțit egal' }, { value: 'company', label: 'Cost comun (firmă)' }, { value: 'trailer', label: 'O remorcă' }];
const MODELS = [['Leasing', 'Leasing / rate'], ['RCA', 'RCA'], ['CASCO', 'CASCO'], ['ITP', 'ITP'], ['Rovinietă', 'Rovinietă / taxă de drum'], ['Tahograf', 'Abonament tahograf'], ['GPS', 'Abonament GPS'], ['Contabil', 'Contabil'], ['Chirie', 'Chirie sediu']];

function currentVersion(events, tplId, period) {
  const vs = tryCall('versionsOf', [events, tplId], []);
  let cur = null;
  for (const v of vs) if (v.period <= period) cur = v;
  return cur || vs[0] || null;
}

function TemplateForm({ tpl, version, onClose }) {
  const ctx = useCtx();
  const trucks = useCollection('trucks'), trailers = useCollection('trailers');
  const cats = useCollection('categories').filter((c) => c.kind === 'expense' && !c.archived);
  const countries = useCollection('countries');
  const today = useToday();
  const v = (version && version.payload) || {};
  const [f, setF] = useState(() => ({
    name: tpl ? tpl.name : '', categoryId: tpl ? tpl.categoryId : (cats[0] && cats[0].id) || '', supplier: tpl ? tpl.supplier || '' : '', documentation: tpl ? tpl.documentation || 'invoice' : 'invoice', payment: tpl ? tpl.payment || 'bank' : 'bank',
    targetType: tpl ? tpl.target.type : 'truck', truckIds: tpl ? tpl.target.truckIds || [] : [], trailerId: tpl ? tpl.target.trailerId || '' : '', frequency: tpl ? tpl.frequency : 'monthly', dayOfMonth: tpl ? String(tpl.dayOfMonth) : '1',
    startDate: tpl ? tpl.startDate : today, backfillFrom: tpl ? tpl.backfillFrom : monthKey(today), active: tpl ? tpl.active !== false : true, endDate: (tpl && tpl.endDate) || '',
    currency: v.currency || 'RON', minor: v.minor ?? null, entered: v.entered || 'gross', countryCode: v.countryCode || 'RO', treatment: (v.vat && v.vat.treatment) || 'taxed', rateBp: (v.vat && v.vat.rateBp) ?? 2100, deductiblePct: (v.vat && v.vat.deductiblePct) ?? 100,
    perTruck: Object.fromEntries(trucks.map((x) => [x.id, v.perTruck && v.perTruck[x.id] != null ? v.perTruck[x.id] : null])),
  }));
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const [err, setErr] = useState(null);
  const country = countries.find((c) => c.code === f.countryCode);
  const rates = country ? [country.standardBp, ...(country.reducedBp || [])] : [2100];

  async function save() {
    setErr(null);
    if (!f.name.trim()) return setErr('Numele este obligatoriu.');
    if (f.minor == null && f.targetType !== 'trucks') return setErr('Introdu suma.');
    const day = Number(f.dayOfMonth);
    if (!(day >= 1 && day <= 31)) return setErr('Ziua din lună trebuie să fie între 1 și 31 (31 se ajustează la sfârșitul lunii).');
    if (['truck', 'trucks'].includes(f.targetType) && !f.truckIds.length) return setErr('Alege cel puțin un camion.');
    if (f.targetType === 'trailer' && !f.trailerId) return setErr('Alege remorca.');
    if (f.targetType === 'trucks' && f.truckIds.some((id) => f.perTruck[id] == null)) return setErr('Completează suma pentru fiecare camion ales.');
    const now = new Date().toISOString();
    const id = tpl ? tpl.id : newId('tpl');
    const record = {
      ...(tpl || { createdAt: now, createdBy: 'admin' }), id, name: f.name.trim(), categoryId: f.categoryId, supplier: f.supplier, documentation: f.documentation, payment: f.payment, moneySource: f.documentation === 'none' ? 'company' : 'company', financingId: (tpl && tpl.financingId) || null,
      target: { type: f.targetType, truckIds: f.targetType === 'truck' ? f.truckIds.slice(0, 1) : f.targetType === 'trucks' ? f.truckIds : [], trailerId: f.targetType === 'trailer' ? f.trailerId : undefined },
      frequency: f.frequency, dayOfMonth: day, startDate: f.startDate, backfillFrom: f.backfillFrom, active: f.active, endDate: f.endDate || null,
      spreadMonths: f.frequency === 'monthly' ? null : f.frequency === 'quarterly' ? 3 : 12, totalMinor: tpl ? tpl.totalMinor : null, updatedAt: now,
    };
    const payload = { currency: f.currency, entered: f.entered, minor: f.targetType === 'trucks' ? Object.values(f.perTruck).find((x) => x != null) ?? 0 : f.minor, countryCode: f.countryCode,
      vat: { treatment: f.documentation === 'none' ? 'none' : f.treatment, rateBp: ['taxed', 'reverse'].includes(f.treatment) ? Number(f.rateBp) : null, deductiblePct: Number(f.deductiblePct) },
      perTruck: f.targetType === 'trucks' ? Object.fromEntries(f.truckIds.map((i) => [i, f.perTruck[i]])) : null, components: (v && v.components) || null };
    try {
      let undo;
      if (!tpl) {
        const period = monthKey(f.startDate);
        const ev = { id: detId('tev', id, 'version', period), templateId: id, type: 'version', period, payload, createdAt: now, updatedAt: now, createdBy: 'admin' };
        const r = await ctx.store.batch('Șablon cheltuială fixă', (tx) => { tx.put('templates', record); tx.put('templateEvents', ev); });
        undo = r.undo;
        // „Generează și lunile trecute”: catch-up imediat
        const res = await tryCall('runCatchUp', [{ store: ctx.store, fx: ctx.fx, today, now, deviceId: ctx.store.deviceId, offline: false }], Promise.resolve(null));
        const out = await res;
        if (out && out.created && out.created.length) ctx.toast({ kind: 'ok', text: `${out.created.length} cheltuieli generate automat (de confirmat).`, actionLabel: t.common.undo, onAction: () => undo() });
        else ctx.toast({ kind: 'ok', text: 'Șablonul a fost salvat.' });
      } else {
        await ctx.store.put('templates', record);
        ctx.toast({ kind: 'ok', text: 'Șablonul a fost salvat. Apariițiile trecute nu se modifică.' });
      }
      onClose(true);
    } catch (e) { setErr(e.message); }
  }
  const toggle = (id) => set({ truckIds: f.truckIds.includes(id) ? f.truckIds.filter((x) => x !== id) : f.targetType === 'truck' ? [id] : [...f.truckIds, id] });
  return html`<${Drawer} title=${tpl ? 'Editează șablonul' : 'Cheltuială fixă nouă'} onClose=${() => onClose(false)} footer=${html`<${Button} kind="ghost" onClick=${() => onClose(false)}>${t.common.cancel}<//><${Button} onClick=${save}>${t.common.save}<//>`}>
    ${!tpl ? html`<div class="opts" role="group" aria-label="Modele">${MODELS.map(([n, l]) => html`<button type="button" class="opt" onClick=${() => set({ name: n })}>${l}</button>`)}</div>` : null}
    <div class="form-grid"><${TextInput} label="Nume" value=${f.name} onInput=${(v2) => set({ name: v2 })} /><${Select} label="Categorie" value=${f.categoryId} onChange=${(v2) => set({ categoryId: v2 })} options=${cats.map((c) => ({ value: c.id, label: c.name }))} />
      <${TextInput} label="Furnizor" value=${f.supplier} onInput=${(v2) => set({ supplier: v2 })} /></div>
    <div class="form-grid"><${Select} label="Țintă" value=${f.targetType} onChange=${(v2) => set({ targetType: v2, truckIds: v2 === 'truck' ? f.truckIds.slice(0, 1) : f.truckIds })} options=${TARGETS} />
      <${Select} label="Frecvență" value=${f.frequency} onChange=${(v2) => set({ frequency: v2 })} options=${FREQ} /><${TextInput} label="Ziua din lună (1–31)" inputMode="numeric" value=${f.dayOfMonth} onInput=${(v2) => set({ dayOfMonth: v2 })} hint="31 se ajustează la 28/29/30 în lunile scurte." /></div>
    ${['truck', 'trucks'].includes(f.targetType) ? html`<div class="field"><span class="lbl">Camioane</span><div class="opts">${trucks.map((x) => html`<button type="button" class="opt" aria-pressed=${f.truckIds.includes(x.id)} onClick=${() => toggle(x.id)}>${truckLabel(x)}</button>`)}</div></div>` : null}
    ${f.targetType === 'trailer' ? html`<${Select} label="Remorcă" value=${f.trailerId} onChange=${(v2) => set({ trailerId: v2 })} options=${trailers.map((x) => ({ value: x.id, label: x.plateDisplay || x.plate }))} placeholder="Alege…" />` : null}
    <div class="form-grid"><${DateInput} label="Data de start" value=${f.startDate} onChange=${(v2) => set({ startDate: v2 })} /><${DateInput} label="Data de final (opțional)" value=${f.endDate} onChange=${(v2) => set({ endDate: v2 || '' })} />
      ${!tpl ? html`<${TextInput} label="Generează și lunile trecute de la (AAAA-LL)" value=${f.backfillFrom} onInput=${(v2) => set({ backfillFrom: v2 })} />` : null}</div>
    ${f.targetType === 'trucks' ? html`<div class="stack">${f.truckIds.map((id) => html`<${MoneyInput} label=${'Suma pentru ' + truckLabel(trucks.find((x) => x.id === id))} value=${f.perTruck[id]} currency=${f.currency} onChange=${(m) => set({ perTruck: { ...f.perTruck, [id]: m } })} />`)}</div>`
      : html`<${MoneyInput} label=${'Suma ' + ({ gross: 'brută', net: 'netă' }[f.entered] || '')} value=${f.minor} currency=${f.currency} currencies=${['RON', 'EUR', 'HUF', 'PLN', 'CZK']} onChange=${(m) => set({ minor: m })} onCurrencyChange=${(c) => set({ currency: c })} />`}
    <div class="form-grid"><${Select} label="Documentare" value=${f.documentation} onChange=${(v2) => set({ documentation: v2 })} options=${[{ value: 'invoice', label: t.docs.invoice }, { value: 'receipt', label: t.docs.receipt }, { value: 'none', label: t.docs.none }]} />
      <${Select} label="Țara" value=${f.countryCode} onChange=${(v2) => set({ countryCode: v2 })} options=${countries.map((c) => ({ value: c.code, label: c.code }))} />
      <${Select} label="TVA" value=${f.documentation === 'none' ? 'none' : f.treatment} onChange=${(v2) => set({ treatment: v2 })} options=${Object.entries(t.vat).map(([value, label]) => ({ value, label }))} disabled=${f.documentation === 'none'} />
      ${['taxed', 'reverse'].includes(f.treatment) && f.documentation !== 'none' ? html`<${Select} label="Cota TVA" value=${String(f.rateBp)} onChange=${(v2) => set({ rateBp: Number(v2) })} options=${rates.map((r) => ({ value: String(r), label: fmtPct(r / 10000, r % 100 ? 1 : 0) }))} />` : null}
      <${Select} label="Introduci" value=${f.entered} onChange=${(v2) => set({ entered: v2 })} options=${[{ value: 'gross', label: 'Suma brută' }, { value: 'net', label: 'Suma netă' }]} /></div>
    <${Checkbox} label="Activ" checked=${f.active} onChange=${(v2) => set({ active: v2 })} />
    <p class="muted sm">Aplicația generează automat apariițiile (la deschidere, inclusiv lunile în care nu a fost deschisă), o singură dată, marcate „Recurentă”, „automat, de confirmat”. Editarea sau încheierea șablonului nu modifică apariițiile trecute.</p>
    ${err ? html`<div class="note-box warn" role="alert">${err}</div>` : null}<//>`;
}

export function FixedSection() {
  const ctx = useCtx();
  const templates = useCollection('templates');
  const events = useCollection('templateEvents');
  const entries = useCollection('entries');
  const today = useToday();
  const tm = useMemo(() => nameMap(ctx.store.state(), 'trucks'), [useCollection('trucks')]);
  const cm = useMemo(() => nameMap(ctx.store.state(), 'categories'), [useCollection('categories')]);
  const [edit, setEdit] = useState(null);
  const [panel, setPanel] = useState(null); // { kind:'amount'|'end'|'skip'|'occ', tpl }
  const [amt, setAmt] = useState(null), [from, setFrom] = useState(''), [endD, setEndD] = useState(''), [skipM, setSkipM] = useState('');
  const month = today.slice(0, 7);
  const summary = tryCall('summaryForMonth', [ctx.store.state(), month], null);

  async function runNow() {
    const out = await tryCall('runCatchUp', [{ store: ctx.store, fx: ctx.fx, today, now: new Date().toISOString(), deviceId: ctx.store.deviceId }], Promise.resolve(null));
    if (out && out.pendingConfirmation && out.pendingConfirmation.length) {
      const ok = await ctx.confirm({ title: 'Multe luni de generat', body: 'Unele șabloane au mai mult de 6 perioade lipsă. Le generezi pe toate?', confirmLabel: 'Generează' });
      if (ok) { const o2 = await call('runCatchUp', { store: ctx.store, fx: ctx.fx, today, now: new Date().toISOString(), deviceId: ctx.store.deviceId, confirmOver: true }); ctx.toast({ kind: 'ok', text: `${o2.created.length} cheltuieli generate.` }); }
      return;
    }
    ctx.toast({ kind: out && out.created && out.created.length ? 'ok' : 'info', text: out && out.blocked ? 'Generarea este blocată: ' + (out.blocked.message || out.blocked.reason || '') : `${out ? out.created.length : 0} cheltuieli noi (${out ? out.existing : 0} existau deja).` });
  }
  async function applyPanel() {
    const tpl = panel.tpl;
    try {
      if (panel.kind === 'amount') {
        const cur = currentVersion(events, tpl.id, from || month);
        const payload = { ...(cur ? cur.payload : { currency: 'RON', entered: 'gross', vat: { treatment: 'taxed', rateBp: 2100, deductiblePct: 100 }, countryCode: 'RO' }), minor: amt };
        const r = call('changeAmountFrom', ctx.store, tpl.id, from, payload);
        await r.done;
        ctx.toast({ kind: 'ok', text: `Suma se schimbă de la ${monthLabel(from)}; lunile anterioare rămân neschimbate.`, actionLabel: t.common.undo, onAction: () => r.undo() });
      } else if (panel.kind === 'end') {
        const r = call('endTemplate', ctx.store, tpl.id, endD || null); await r.done;
        ctx.toast({ kind: 'ok', text: endD ? 'Șablonul se încheie la ' + fmtDate(endD) + '.' : 'Șablonul a fost reactivat.', actionLabel: t.common.undo, onAction: () => r.undo() });
      } else if (panel.kind === 'skip') {
        const r = call('skipPeriod', ctx.store, tpl.id, skipM); await r.done;
        ctx.toast({ kind: 'ok', text: `Luna ${monthLabel(skipM)} este sărită și nu se mai regenerează.`, actionLabel: t.common.undo, onAction: () => r.undo() });
      }
      setPanel(null);
    } catch (e) { ctx.toast({ kind: 'error', text: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
  }
  const rows = templates.map((tp) => {
    const ver = currentVersion(events, tp.id, month);
    const mine = entries.filter((e) => e.recurring && e.recurring.templateId === tp.id).sort((a, b) => b.date.localeCompare(a.date));
    const endDate = tryCall('effectiveEndDate', [tp, events], tp.endDate || null);
    return { tp, ver, last: mine.slice(0, 3), next: tryCall('nextOccurrenceDate', [tp, today, events], null), ended: !!endDate && endDate < today, endDate };
  });
  const targetLabel = (tp) => ({ truck: truckLabel(tm.get((tp.target.truckIds || [])[0])), trucks: (tp.target.truckIds || []).map((i) => truckLabel(tm.get(i))).join(', '), fleet: 'Toată flota (egal)', company: 'Cost comun', trailer: 'Remorcă' })[tp.target.type];
  return html`<div class="stack">
    <${Card} title="Cheltuieli fixe (recurente)" right=${html`<div class="toolbar"><${Button} sm kind="sec" onClick=${runNow}>Generează acum<//><${Button} sm icon="plus" onClick=${() => setEdit({})}>Șablon nou<//></div>`}>
      <p class="muted">Definești o dată leasing, RCA, ITP, rovinietă, tahograf, GPS, contabil, chirie. Aplicația generează automat intrările lipsă la fiecare deschidere (idempotent), le marchează „Recurentă” și „automat, de confirmat”, iar tu le confirmi dintr-un click în De verificat.</p>
      ${rows.length === 0 ? html`<${EmptyState} icon="repeat" title="Nicio cheltuială fixă definită" action=${html`<${Button} onClick=${() => setEdit({})}>Adaugă prima cheltuială fixă<//>`} />` : html`
      <${Table} caption="Cheltuieli fixe" rowKey=${(r) => r.tp.id} rows=${rows} columns=${[
        { key: 'n', header: 'Nume', render: (r) => html`<b>${r.tp.name}</b><span class="sub">${(cm.get(r.tp.categoryId) || {}).name || ''}</span>` }, { key: 't', header: 'Țintă', render: (r) => targetLabel(r.tp) },
        { key: 'a', header: 'Suma curentă', align: 'r', render: (r) => (r.ver ? (r.ver.payload.perTruck ? 'per camion' : fmtMoney(r.ver.payload.minor, r.ver.payload.currency)) : '—') },
        { key: 'f', header: 'Frecvență', render: (r) => (FREQ.find((x) => x.value === r.tp.frequency) || {}).label + ' · ziua ' + r.tp.dayOfMonth }, { key: 'x', header: 'Următoarea', render: (r) => (r.next ? fmtDate(r.next) : '—') },
        { key: 's', header: 'Stare', render: (r) => (r.tp.active === false ? html`<${Badge}>inactiv<//>` : r.ended ? html`<${Badge} kind="neutral">încheiat ${fmtDate(r.endDate)}<//>` : html`<${Badge} kind="ok">activ<//>`) },
        { key: 'l', header: 'Ultimele 3', render: (r) => (r.last.length ? r.last.map((e) => fmtDate(e.date).slice(0, 5)).join(', ') : '—') },
        { key: 'u', header: '', render: (r) => html`<span class="toolbar" style="gap:4px"><${Button} sm kind="ghost" onClick=${() => setEdit(r.tp)}>${t.common.edit}<//><${Button} sm kind="ghost" onClick=${() => { setAmt(r.ver ? r.ver.payload.minor : null); setFrom(month); setPanel({ kind: 'amount', tpl: r.tp }); }}>Schimbă suma<//>
          <${Button} sm kind="ghost" onClick=${() => { setEndD(today); setPanel({ kind: 'end', tpl: r.tp }); }}>Încheie<//><${Button} sm kind="ghost" onClick=${() => { setSkipM(month); setPanel({ kind: 'skip', tpl: r.tp }); }}>Sari luna<//><${Button} sm kind="ghost" onClick=${() => setPanel({ kind: 'occ', tpl: r.tp })}>Apariții<//></span>` }]} />`}<//>
    <${Card} title=${'Luna asta: ce s-a adăugat automat (' + monthLabel(month) + ')'}>${summary && summary.byTemplate.length ? html`<${Table} rowKey=${(x) => x.templateId} rows=${summary.byTemplate} columns=${[{ key: 'n', header: 'Șablon', render: (x) => x.name }, { key: 'c', header: 'Apariții', align: 'r', render: (x) => x.count }, { key: 'p', header: 'De confirmat', align: 'r', render: (x) => x.pending }, { key: 't', header: 'Total (RON)', align: 'r', render: (x) => fmtMoney(x.totalRon, 'RON') }]} />
      <div class="toolbar"><${Button} sm onClick=${() => ctx.nav('/verificare?sursa=recurenta')}>Mergi la De verificat<//></div>` : html`<p class="muted">Nimic generat în luna curentă.</p>`}<//>
    ${edit ? html`<${TemplateForm} tpl=${edit.id ? edit : null} version=${edit.id ? currentVersion(events, edit.id, month) : null} onClose=${() => setEdit(null)} />` : null}
    ${panel && panel.kind !== 'occ' ? html`<${Modal} title=${{ amount: 'Schimbă suma de la o lună', end: 'Încheie șablonul', skip: 'Sari peste o lună' }[panel.kind] + ' · ' + panel.tpl.name} onClose=${() => setPanel(null)} footer=${html`<${Button} kind="ghost" onClick=${() => setPanel(null)}>${t.common.cancel}<//><${Button} onClick=${applyPanel}>Aplică<//>`}>
      ${panel.kind === 'amount' ? html`<${TextInput} label="De la luna (AAAA-LL)" value=${from} onInput=${setFrom} /><${MoneyInput} label="Suma nouă" value=${amt} currency=${(currentVersion(events, panel.tpl.id, month) || { payload: { currency: 'RON' } }).payload.currency} onChange=${setAmt} /><p class="muted sm">Istoricul nu se rescrie: lunile dinainte rămân cu suma veche.</p>` : null}
      ${panel.kind === 'end' ? html`<${DateInput} label="Încheie la (gol = reactivează)" value=${endD} onChange=${(v) => setEndD(v || '')} /><p class="muted sm">Apariițiile anterioare rămân.</p>` : null}
      ${panel.kind === 'skip' ? html`<${TextInput} label="Luna de sărit (AAAA-LL)" value=${skipM} onInput=${setSkipM} /><p class="muted sm">Dacă există deja o intrare în acea lună, se șterge și nu se mai recreează.</p>` : null}<//>` : null}
    ${panel && panel.kind === 'occ' ? html`<${Modal} wide title=${'Apariții · ' + panel.tpl.name} onClose=${() => setPanel(null)}><${Table} rowKey=${(e) => e.id} rows=${entries.filter((e) => e.recurring && e.recurring.templateId === panel.tpl.id).sort((a, b) => b.date.localeCompare(a.date))} columns=${[
      { key: 'd', header: 'Data', render: (e) => fmtDate(e.date) }, { key: 'p', header: 'Perioadă', render: (e) => e.recurring.period }, { key: 'a', header: 'Sumă', align: 'r', render: (e) => fmtMoney(e.orig.gross, e.currency) },
      { key: 's', header: 'Stare', render: (e) => (e.status === 'auto_pending' ? html`<${Badge} kind="provisional">automat, de confirmat<//>` : e.status) }, { key: 'e', header: '', render: (e) => (e.recurring.edited ? html`<${Badge} kind="info">editată<//>` : '') }]} emptyText="Nicio apariție încă." /><//>` : null}</div>`;
}
