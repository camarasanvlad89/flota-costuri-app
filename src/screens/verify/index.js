import { html, useState, useMemo, useEffect } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useStore, useCollection, useMonth, useHotkeys } from '../../ui/hooks.js';
import { Card, PageHeader, Button, Badge, EmptyState, EntryEditor, MoneyInput, Modal, Note, Icon, Select, TextInput } from '../../ui/components/index.js';
import { verifyQueue, truckLabel, nameMap, amountPair, monthLabel, shiftMonth, companyOf, coll } from '../../ui/selectors.js';
import { confirmEntries, confirmAllAuto, deleteEntries, repriceCourse } from '../../ui/actions.js';
import { api, tryCall } from '../../ui/api.js';
import { fmtDate, fmtMoney, convert } from '../../core/index.js';

const SOURCES = [['', 'Toate'], ['recurenta', 'Recurentă'], ['import', 'Import'], ['manual', 'Manual'], ['curse', 'Curse']];

function buildItems(q, source) {
  const items = [];
  for (const e of q.entries) items.push({ key: 'e:' + e.id, type: 'entry', rec: e, src: e.source === 'recurring' ? 'recurenta' : e.source === 'import' ? 'import' : 'manual' });
  for (const c of q.courses) items.push({ key: 'c:' + c.id, type: 'course', rec: c, src: 'curse' });
  for (const e of q.staleFx) items.push({ key: 'f:' + e.id, type: 'fx', rec: e, src: 'manual' });
  return source ? items.filter((i) => i.src === source) : items;
}

function EntryDetail({ e, onEdit }) {
  const ctx = useCtx();
  const [upd, setUpd] = useState(null);
  const tm = nameMap(ctx.store.state(), 'trucks'), cm = nameMap(ctx.store.state(), 'categories');
  async function applyAmount() {
    if (upd == null) return;
    const company = companyOf(ctx.store.state());
    const next = tryCall('changeAmounts', [e, { entered: 'gross', minor: upd }, { company, categories: coll(ctx.store.state(), 'categories') }], null);
    if (!next) { ctx.toast({ kind: 'error', text: t.errors.missingApi('changeAmounts') }); return; }
    const now = new Date().toISOString();
    await ctx.store.put('audit', { id: 'aud_' + e.id + '_' + Date.parse(now), at: now, type: 'amountUpdate', entryId: e.id, before: e.orig, after: next.orig });
    const r = await ctx.store.put('entries', { ...next, status: 'confirmed', recurring: e.recurring ? { ...e.recurring, edited: true } : null, updatedAt: now });
    ctx.toast({ kind: 'ok', text: 'Suma a fost actualizată după factură și intrarea confirmată.', actionLabel: t.common.undo, onAction: () => r.undo() });
  }
  return html`<div class="stack" style="gap:12px">
    <div class="toolbar">${e.recurring ? html`<${Badge} kind="recurring" />` : null}${e.status === 'auto_pending' ? html`<${Badge} kind="provisional">${t.status.auto_pending}<//>` : null}${e.documentation === 'none' ? html`<${Badge} kind="nodoc" />` : null}</div>
    <dl class="kv"><dt>Data</dt><dd>${fmtDate(e.date)}</dd><dt>Camion</dt><dd>${e.target && e.target.truckId ? truckLabel(tm.get(e.target.truckId)) : 'Cost comun'}</dd>
      <dt>Categorie</dt><dd>${(cm.get(e.categoryId) || {}).name || '—'}</dd><dt>Furnizor</dt><dd>${e.supplier || '—'}</dd><dt>Sumă</dt><dd>${amountPair(e, 'RON')}</dd>
      <dt>TVA</dt><dd>${t.vat[e.vat && e.vat.treatment] || '—'} · ${e.countryCode || ''}</dd></dl>
    ${e.status === 'auto_pending' ? html`<div class="hint"><${Icon} name="info" size="sm" /><span>Estimare automată. Dacă factura a venit cu altă sumă, actualizeaz-o:</span></div>
      <${MoneyInput} label="Suma brută după factură" value=${upd} currency=${e.currency || 'RON'} onChange=${setUpd} hint=${upd != null && e.orig ? 'Diferență: ' + fmtMoney(upd - e.orig.gross, e.currency || 'RON', { sign: true }) : ''} />
      <${Button} sm kind="sec" disabled=${upd == null} onClick=${applyAmount}>Actualizează suma și confirmă<//>` : null}
    <div class="actions"><${Button} onClick=${() => confirmEntries(ctx, [e.id])}>${t.common.confirm} <span class="kbd">Enter</span><//>
      <${Button} kind="sec" onClick=${onEdit}>${t.common.edit} <span class="kbd">E</span><//>
      <${Button} kind="ghost" onClick=${() => deleteEntries(ctx, [e.id])}>${t.common.delete} <span class="kbd">Del</span><//></div></div>`;
}

function CourseDetail({ c }) {
  const ctx = useCtx();
  const [amt, setAmt] = useState(null);
  const [mode, setMode] = useState('net');
  return html`<div class="stack" style="gap:12px">
    <div class="toolbar"><${Badge} kind=${c.priceStatus === 'missing' ? 'bad' : 'derived'}>${c.priceStatus === 'missing' ? 'fără preț' : c.priceStatus === 'derived' ? 'derivat' : 'de verificat'}<//>
      ${c.destCountry && !(c.destinations || []).length ? html`<${Badge} kind="warn">destinație doar țară<//>` : null}</div>
    <dl class="kv"><dt>Rută</dt><dd>${c.routeRaw}</dd><dt>Date</dt><dd>${fmtDate(c.loadDate)} → ${fmtDate(c.unloadDate)}</dd><dt>Șofer</dt><dd>${c.driverRaw || '—'}</dd>
      ${c.strayValues && c.strayValues.length ? html`<dt>Valori rătăcite</dt><dd>${c.strayValues.join(', ')} (posibil preț?)</dd>` : null}</dl>
    ${c.priceStatus === 'missing' ? html`<div class="form-grid"><${Select} label="Introduci" value=${mode} onChange=${setMode} options=${[{ value: 'net', label: 'Preț net (fără TVA)' }, { value: 'gross', label: 'Total cu TVA' }]} />
      <${MoneyInput} label="Sumă" value=${amt} currency=${c.currency || 'RON'} onChange=${setAmt} /></div>
      <${Button} disabled=${amt == null} onClick=${() => repriceCourse(ctx, c, mode === 'net' ? { net: amt } : { gross: amt }).catch((e) => ctx.toast({ kind: 'error', text: e.message }))}>Salvează prețul<//>` : html`
      <${Button} onClick=${() => ctx.store.put('courses', { ...c, status: 'ok', updatedAt: new Date().toISOString() })}>Marchează verificată<//>`}
    <${Button} kind="ghost" onClick=${() => ctx.nav('/curse')}>Deschide în Curse<//></div>`;
}

function ClosingCard({ month }) {
  const ctx = useCtx();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const company = useStore(companyOf);
  const state = ctx.store.state();
  const checklist = open ? tryCall('closingChecklist', [state, month, { today: new Date(ctx.clock.now()).toISOString().slice(0, 10) }], null) : null;
  const closedThrough = company.closedThrough;
  const errors = (checklist || []).filter((x) => x.severity === 'error');
  const warns = (checklist || []).filter((x) => x.severity === 'warn');
  async function close() {
    const compute = api('closingCompute') || undefined;
    const r = api('closeMonth')(ctx.store, month, { ackWarnings: true, compute });
    await r.done;
    if (r.ok) ctx.toast({ kind: 'ok', text: `Luna ${monthLabel(month)} a fost închisă.` }); else ctx.toast({ kind: 'warn', text: 'Luna nu a putut fi închisă: ' + (r.reason || '') });
    setOpen(false);
  }
  async function reopen() {
    if (reason.trim().length < 3) { ctx.toast({ kind: 'warn', text: 'Motivul redeschiderii este obligatoriu.' }); return; }
    const r = api('reopenMonth')(ctx.store, closedThrough, reason.trim());
    if (r && r.done) await r.done;
    ctx.toast({ kind: 'ok', text: 'Luna a fost redeschisă și jurnalizată.' }); setReason('');
  }
  return html`<${Card} title="Închiderea lunii" right=${closedThrough ? html`<${Badge} kind="closed">închis până la ${closedThrough}<//>` : null}>
    <p class="muted">După închidere, scrierile în luna ${monthLabel(month)} sunt respinse sau redirecționate („aferent lunii”). Poți redeschide, cu motiv jurnalizat.</p>
    <div class="toolbar"><${Button} sm onClick=${() => setOpen(true)} disabled=${closedThrough && month <= closedThrough}>Închide luna ${monthLabel(month)}<//>
      ${closedThrough ? html`<${TextInput} label="Motiv redeschidere" value=${reason} onInput=${setReason} /><${Button} sm kind="sec" onClick=${reopen}>Redeschide ${closedThrough}<//>` : null}</div>
    ${open ? html`<${Modal} title=${'Închide ' + monthLabel(month)} onClose=${() => setOpen(false)} footer=${html`<${Button} kind="sec" onClick=${() => setOpen(false)}>${t.common.cancel}<//><${Button} disabled=${errors.length > 0 || !checklist} onClick=${close}>${warns.length ? 'Închide cu avertismente confirmate' : 'Închide luna'}<//>`}>
      ${!checklist ? html`<${Note} kind="warn">${t.errors.missingApi('closingChecklist')}<//>` : checklist.length === 0 ? html`<p>Totul este în ordine.</p>` : html`<ul class="checklist">${checklist.map((x) => html`<li><span class=${'st ' + (x.severity === 'error' ? 'c-loss' : x.severity === 'warn' ? 'c-caution' : 'c-info')}><${Icon} name=${x.severity === 'error' ? 'close' : 'alert'} /></span><span class="tx">${x.message}</span></li>`)}</ul>`}<//>` : null}<//>`;
}

function VerifyScreen({ query }) {
  const ctx = useCtx();
  const q = useStore(verifyQueue);
  const [month] = useMonth();
  const [source, setSource] = useState(query.get('sursa') || '');
  const items = useMemo(() => buildItems(q, source), [q, source]);
  const [selKey, setSelKey] = useState(null);
  const [edit, setEdit] = useState(null);
  const idx = Math.max(0, items.findIndex((i) => i.key === selKey));
  const cur = items[idx];
  useEffect(() => { if (items.length && !items.some((i) => i.key === selKey)) setSelKey(items[0].key); }, [items.map((i) => i.key).join('|')]);
  const go = (d) => { const n = items[Math.min(items.length - 1, Math.max(0, idx + d))]; if (n) setSelKey(n.key); };
  const autoCount = q.entries.filter((e) => e.status === 'auto_pending').length;
  useHotkeys({
    ArrowDown: () => go(1), ArrowUp: () => go(-1),
    Enter: () => cur && cur.type === 'entry' && confirmEntries(ctx, [cur.rec.id]),
    e: () => cur && cur.type === 'entry' && setEdit(cur.rec),
    Delete: () => cur && cur.type === 'entry' && deleteEntries(ctx, [cur.rec.id]),
  }, [selKey, items.length]);
  const tm = nameMap(ctx.store.state(), 'trucks');
  return html`<div class="stack"><${PageHeader} title=${t.nav.verify} sub=${q.total + ' de verificat'}>
      ${autoCount ? html`<${Button} onClick=${() => ctx.confirm({ title: `Confirmi ${autoCount} intrări automate?`, body: 'Se confirmă într-o singură tranzacție; poți anula în 15 secunde.', confirmLabel: t.common.confirmAll }).then((ok) => ok && confirmAllAuto(ctx))}>Confirmă toate automatele (${autoCount})<//>` : null}<//>
    <div class="opts" role="group" aria-label="Filtru sursă">${SOURCES.map(([v, l]) => html`<button type="button" class="opt" aria-pressed=${source === v} onClick=${() => setSource(v)}>${l}</button>`)}</div>
    ${items.length === 0 ? html`<${Card}><${EmptyState} icon="check" title=${t.states.queueEmpty} /><//>` : html`
    <div class="md" role="region" aria-label="Coada de verificare">
      <div class="md-l"><div class="toolbar" style="padding:8px 14px"><${Button} sm kind="ghost" onClick=${() => go(-1)} disabled=${idx <= 0}>${t.common.prev}<//><${Button} sm kind="ghost" onClick=${() => go(1)} disabled=${idx >= items.length - 1}>${t.common.next}<//><span class="muted sm">${idx + 1} / ${items.length}</span></div>
        <div role="listbox" aria-label="Elemente de verificat">${items.map((i) => {
          const e = i.rec;
          return html`<button type="button" role="option" class="vrow" aria-selected=${i.key === (cur && cur.key)} onClick=${() => setSelKey(i.key)}>
            <span class="sm muted">${fmtDate(i.type === 'course' ? e.loadDate : e.date)}</span>
            <span><b>${i.type === 'course' ? e.routeRaw : e.supplier || (e.recurring ? 'Recurentă' : 'Intrare')}</b><br /><span class="muted sm">${i.type === 'course' ? 'cursă · ' + (e.priceStatus === 'missing' ? 'fără preț' : 'de verificat') : i.type === 'fx' ? 'curs vechi' : truckLabel(tm.get(e.target && e.target.truckId)) || 'comun'}</span></span>
            <span class="a">${i.type === 'course' ? (e.net != null ? fmtMoney(e.net, e.currency || 'RON') : '—') : amountPair(e, 'RON')}</span></button>`;
        })}</div></div>
      <div class="md-r">${cur ? (cur.type === 'course' ? html`<${CourseDetail} c=${cur.rec} key=${cur.key} />` : html`<${EntryDetail} e=${cur.rec} key=${cur.key} onEdit=${() => setEdit(cur.rec)} />`) : null}</div></div>`}
    <${ClosingCard} month=${shiftMonth(month, 0)} />
    ${edit ? html`<${EntryEditor} entry=${edit} onClose=${() => setEdit(null)} />` : null}</div>`;
}
export const screen = {
  id: 'verify', route: '/verificare', title: () => t.nav.verify,
  nav: { label: t.nav.verify, icon: 'inbox', order: 3, group: 'work' }, component: VerifyScreen,
};
