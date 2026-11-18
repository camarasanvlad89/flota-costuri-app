import { html, useState } from '../dom.js';
import { t } from '../strings.js';
import { useCtx, useCollection } from '../hooks.js';
import { DateInput, Select, TextInput, MoneyInput } from './forms.js';
import { Button, Badge, Note } from './display.js';
import { Drawer } from './overlay.js';
import { RateBadge } from './EntryForm.js';
import { tryCall } from '../api.js';
import { deleteEntries } from '../actions.js';
import { truckLabel, monthOfEntry, isClosed } from '../selectors.js';
import { fmtMoney, fmtDate, fmtPct } from '../../core/index.js';

const TREAT = ['taxed', 'none', 'zero', 'nondeductible', 'reverse'];

/** Editare completă a unei intrări existente (țară, TVA, documentare, plată, curs). Editarea unei apariții recurente nu modifică șablonul; o marchează `edited`. */
export function EntryEditor({ entry, onClose }) {
  const ctx = useCtx();
  const trucks = useCollection('trucks');
  const cats = useCollection('categories');
  const countries = useCollection('countries');
  const company = ctx.store.state().singletons ? ctx.store.state().singletons.company : {};
  const vat0 = entry.vat || {};
  const [f, setF] = useState({
    date: entry.date, docDate: entry.docDate || '', truckId: (entry.target && entry.target.truckId) || '', categoryId: entry.categoryId, supplier: entry.supplier || '', docNo: entry.docNo || '',
    note: entry.note || '', minor: entry.orig ? entry.orig.gross : null, entered: 'gross', countryCode: entry.countryCode || company.countryCode || 'RO',
    documentation: entry.documentation || 'invoice', treatment: vat0.treatment || 'taxed', rateBp: vat0.rateBp ?? null, deductiblePct: vat0.deductiblePct ?? 100,
    payment: entry.payment || '', moneySource: entry.moneySource || 'company', justification: entry.justification || '', rateText: '',
  });
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const [err, setErr] = useState(null);
  const closed = isClosed(ctx.store.state(), monthOfEntry(entry));
  const cur = entry.currency || 'RON';
  const country = countries.find((c) => c.code === f.countryCode);
  const rates = country ? [country.standardBp, ...(country.reducedBp || [])].filter((x, i, a) => x != null && a.indexOf(x) === i) : [];
  if (f.rateBp != null && !rates.includes(f.rateBp)) rates.push(f.rateBp);
  const taxedLike = f.treatment === 'taxed' || f.treatment === 'reverse' || f.treatment === 'nondeductible';

  async function save() {
    try {
      let next = {
        ...entry, date: f.date, docDate: f.docDate || null, categoryId: f.categoryId, supplier: f.supplier.trim(), docNo: f.docNo.trim(), note: f.note,
        countryCode: f.countryCode, documentation: f.documentation, payment: f.payment || entry.payment || null, moneySource: f.moneySource,
        justification: f.justification.trim() || null,
        target: { ...(entry.target || {}), type: f.truckId ? 'truck' : (entry.target && entry.target.type === 'trailer' ? 'trailer' : 'company'), truckId: f.truckId || null },
      };
      const treatment = f.documentation === 'none' ? 'none' : f.treatment;
      const vatPatch = { treatment, rateBp: taxedLike && f.documentation !== 'none' ? f.rateBp : null, deductiblePct: Number(f.deductiblePct) };
      const vatChanged = treatment !== vat0.treatment || (vatPatch.rateBp ?? null) !== (vat0.rateBp ?? null) || vatPatch.deductiblePct !== (vat0.deductiblePct ?? 100);
      const amountChanged = f.minor != null && (f.entered !== 'gross' ? f.minor !== (entry.orig || {})[f.entered] : f.minor !== (entry.orig && entry.orig.gross));
      const fxChanged = !!f.rateText && cur !== 'RON';
      if (f.minor == null) { setErr(t.errors.required + ': suma'); return; }
      if (amountChanged || vatChanged || fxChanged || f.documentation !== entry.documentation || f.countryCode !== entry.countryCode) {
        const patch = { vat: vatPatch };
        if (amountChanged) { patch.entered = f.entered; patch.minor = f.minor; }
        if (fxChanged) patch.rate = ctx.fx.fromManual(cur, f.docDate || f.date, f.rateText.replace(',', '.'), 'manual');
        next = tryCall('changeAmounts', [next, patch, { company, categories: cats, countries, now: new Date().toISOString() }], null);
        if (!next) { setErr(t.errors.missingApi('changeAmounts')); return; }
      }
      if (entry.recurring) next = { ...next, recurring: { ...entry.recurring, edited: true } };
      const errors = tryCall('validateEntry', [next, { company, categories: cats }], []);
      if (errors.length) { setErr(errors.map((e) => e.message).join(' ')); return; }
      const res = await ctx.store.put('entries', { ...next, updatedAt: new Date().toISOString() });
      ctx.toast({ kind: 'ok', text: 'Modificările au fost salvate.', actionLabel: t.common.undo, onAction: () => res.undo() });
      onClose(true);
    } catch (e) {
      setErr(e.code === 'CLOSED_MONTH' || /închis/i.test(e.message) ? t.errors.closedMonth + ' Sumele nu se pot modifica; poți edita doar nota.' : e.message);
    }
  }
  async function remove() {
    const ok = await ctx.confirm({ title: 'Ștergi intrarea?', body: entry.recurring ? 'Este o apariție recurentă: luna se adaugă la cele sărite și nu se mai regenerează. Poți anula în 15 secunde.' : 'Poți anula în 15 secunde.', confirmLabel: t.common.delete, danger: true });
    if (!ok) return;
    try { await deleteEntries(ctx, [entry.id]); onClose(true); } catch (e) { setErr(e.message); }
  }
  const catOpts = cats.filter((c) => c.kind === (entry.kind === 'income' ? 'income' : 'expense') || c.id === entry.categoryId).map((c) => ({ value: c.id, label: c.name }));
  return html`<${Drawer} title=${(entry.kind === 'income' ? 'Venit' : 'Cheltuială') + ' · ' + fmtDate(entry.date)} onClose=${() => onClose(false)}
    footer=${html`<${Button} class="danger" onClick=${remove}>${t.common.delete}<//><${Button} kind="ghost" onClick=${() => onClose(false)}>${t.common.cancel}<//><${Button} onClick=${save}>${t.common.save}<//>`}>
    <div class="toolbar">${entry.recurring ? html`<${Badge} kind="recurring" />` : null}${entry.documentation === 'none' ? html`<${Badge} kind="nodoc" />` : null}${closed ? html`<${Badge} kind="closed">${t.badges.closed}<//>` : null}
      ${cur !== 'RON' ? html`<${RateBadge} rate=${entry.fx} />` : null}</div>
    ${cur !== 'RON' ? html`<p class="muted sm">Original: ${fmtMoney(entry.orig.gross, cur)} · valoarea în RON este înghețată la ${entry.fx ? entry.fx.rateDate : ''}. Moneda nu se poate schimba aici (șterge și reintrodu intrarea).</p>` : null}
    ${closed ? html`<${Note} kind="warn">${t.errors.closedMonth} Doar nota și justificarea se pot modifica.<//>` : null}
    <div class="form-grid"><${DateInput} label="Data" value=${f.date} onChange=${(v) => set({ date: v })} />
      <${Select} label="Camion" value=${f.truckId} onChange=${(v) => set({ truckId: v })} options=${[{ value: '', label: 'Cost comun (firmă)' }, ...trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))]} />
      <${Select} label="Categorie" value=${f.categoryId} onChange=${(v) => set({ categoryId: v })} options=${catOpts} /></div>
    <${MoneyInput} label=${'Sumă ' + ({ gross: 'brută', net: 'netă', vat: '(doar TVA)' }[f.entered])} value=${f.minor} currency=${cur} onChange=${(v) => set({ minor: v })} />
    <div class="form-grid">
      <${Select} label="Țara" value=${f.countryCode} onChange=${(v) => set({ countryCode: v })} options=${countries.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
      <${Select} label="Documentare" value=${f.documentation} onChange=${(v) => set({ documentation: v, ...(v === 'none' ? { treatment: 'none' } : {}) })}
        options=${[{ value: 'invoice', label: t.docs.invoice }, { value: 'receipt', label: t.docs.receipt }, { value: 'none', label: t.docs.none }]} />
      <${Select} label="TVA" value=${f.documentation === 'none' ? 'none' : f.treatment} onChange=${(v) => set({ treatment: v })} disabled=${f.documentation === 'none'} options=${TREAT.map((x) => ({ value: x, label: t.vat[x] }))} />
      ${taxedLike && f.documentation !== 'none' ? html`<${Select} label="Cota TVA" value=${String(f.rateBp ?? '')} onChange=${(v) => set({ rateBp: Number(v) })} options=${rates.map((r) => ({ value: String(r), label: fmtPct(r / 10000, r % 100 ? 1 : 0) }))} />
        <${Select} label="Suma introdusă este" value=${f.entered} onChange=${(v) => set({ entered: v, minor: (entry.orig || {})[v] ?? f.minor })} options=${[{ value: 'gross', label: 'Brută' }, { value: 'net', label: 'Netă' }, { value: 'vat', label: 'Doar TVA' }]} />
        <${TextInput} label="TVA deductibil %" type="number" inputMode="numeric" value=${f.deductiblePct} onInput=${(v) => set({ deductiblePct: v })} hint="Verifică cu contabilul." />` : null}
      ${cur !== 'RON' ? html`<${TextInput} label=${`Curs manual (lei per 1 ${cur})`} inputMode="decimal" value=${f.rateText} onInput=${(v) => set({ rateText: v })} placeholder="neschimbat" hint=${entry.fx ? `${entry.fx.source} · ${entry.fx.rateDate}` : ''} />` : null}
      <${DateInput} label="Data documentului" value=${f.docDate} onChange=${(v) => set({ docDate: v || '' })} />
      <${Select} label="Plată" value=${f.payment} onChange=${(v) => set({ payment: v })} options=${[{ value: '', label: '—' }, ...Object.entries(t.payments).map(([value, label]) => ({ value, label }))]} />
    </div>
    ${f.documentation === 'none' ? html`<div class="form-grid"><${Select} label="Sursa banilor" value=${f.moneySource} onChange=${(v) => set({ moneySource: v })}
        options=${[{ value: 'company', label: 'Banii firmei' }, { value: 'driverAdvance', label: 'Avans șofer' }, { value: 'ownerPersonal', label: 'Bani personali' }]} />
      <${TextInput} label="Justificare (obligatorie peste plafon)" value=${f.justification} onInput=${(v) => set({ justification: v })} /></div>` : null}
    <div class="form-grid"><${TextInput} label="Furnizor" value=${f.supplier} onInput=${(v) => set({ supplier: v })} /><${TextInput} label="Nr. document" value=${f.docNo} onInput=${(v) => set({ docNo: v })} /></div>
    <${TextInput} label="Notă" value=${f.note} onInput=${(v) => set({ note: v })} />
    ${err ? html`<div class="note-box warn" role="alert">${err}</div>` : null}<//>`;
}
