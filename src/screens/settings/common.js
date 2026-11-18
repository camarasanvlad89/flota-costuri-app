import { html, useState } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection } from '../../ui/hooks.js';
import { Card, Button, Table, Drawer, TextInput, Select, Checkbox, DateInput, Note, Badge, EmptyState } from '../../ui/components/index.js';
import { newId } from '../../core/index.js';

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const out = { ...o };
  let cur = out;
  ks.forEach((k, i) => { if (i === ks.length - 1) cur[k] = v; else { cur[k] = { ...(cur[k] || {}) }; cur = cur[k]; } });
  return out;
}
export const pctText = (bp) => (bp == null ? '' : String(bp / 100).replace('.', ','));
export const pctToBp = (s) => { const n = Number(String(s).replace(',', '.').trim()); return Number.isFinite(n) && String(s).trim() !== '' ? Math.round(n * 100) : null; };

function toForm(rec, fields) {
  let f = { ...rec };
  for (const fd of fields) {
    const v = getPath(rec, fd.key);
    if (fd.type === 'bp') f = setPath(f, fd.key, pctText(v));
    else if (fd.type === 'bplist') f = setPath(f, fd.key, (v || []).map(pctText).join(', '));
    else if (fd.type === 'list') f = setPath(f, fd.key, (v || []).join(', '));
    else if (fd.type === 'number') f = setPath(f, fd.key, v == null ? '' : String(v));
  }
  return f;
}
function fromForm(form, fields) {
  let r = { ...form };
  for (const fd of fields) {
    const v = getPath(form, fd.key);
    if (fd.type === 'bp') r = setPath(r, fd.key, pctToBp(v));
    else if (fd.type === 'bplist') r = setPath(r, fd.key, String(v || '').split(',').map((x) => pctToBp(x)).filter((x) => x != null));
    else if (fd.type === 'list') r = setPath(r, fd.key, String(v || '').split(',').map((x) => x.trim()).filter(Boolean));
    else if (fd.type === 'number') r = setPath(r, fd.key, v === '' || v == null ? null : Number(String(v).replace(',', '.')));
  }
  return r;
}

/**
 * CRUD generic pentru o colecție editabilă din Setări.
 * fields: [{ key, label, type:'text'|'number'|'select'|'checkbox'|'date'|'bp'|'bplist'|'list', options, hint, required }]
 * validate(form, rec, all) -> { [key]: mesaj }; usedBy(rec) -> număr (dacă > 0, „Șterge” = arhivează)
 */
export function Crud({ col, title, help, columns, fields, blank, prep, idPrefix, validate, usedBy, archiveKey = 'archived', normalize, sortBy, addLabel = 'Adaugă', empty, extra }) {
  const ctx = useCtx();
  const all = useCollection(col);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(null);
  const [errs, setErrs] = useState({});
  const rows = sortBy ? [...all].sort(sortBy) : all;
  const open = (rec) => { setEdit(rec); setForm(toForm(prep ? prep(rec) : rec, fields)); setErrs({}); };
  async function save() {
    let rec = fromForm(form, fields);
    if (normalize) rec = normalize(rec, edit);
    const e = validate ? validate(rec, edit, all) : {};
    if (Object.keys(e).length) { setErrs(e); return; }
    const now = new Date().toISOString();
    const isNew = !edit.id;
    rec = { ...rec, id: isNew ? (rec.__id || newId(idPrefix || col.slice(0, 3))) : edit.id, updatedAt: now, ...(isNew ? { createdAt: now, createdBy: 'admin' } : {}) };
    delete rec.__id;
    try {
      const r = await ctx.store.put(col, rec);
      ctx.toast({ kind: 'ok', text: 'Salvat.', actionLabel: t.common.undo, onAction: () => r.undo() });
      setEdit(null);
    } catch (er) { setErrs({ _: er.message }); }
  }
  async function remove(rec) {
    const used = usedBy ? usedBy(rec) : 0;
    if (used > 0) {
      const ok = await ctx.confirm({ title: 'Nu se poate șterge', body: `Este folosit în ${used} înregistrări. Îl arhivezi (nu mai apare la alegere, istoricul rămâne)?`, confirmLabel: 'Arhivează' });
      if (ok) { await ctx.store.put(col, { ...rec, [archiveKey]: true, updatedAt: new Date().toISOString() }); ctx.toast({ kind: 'ok', text: 'Arhivat.' }); }
      return;
    }
    const ok = await ctx.confirm({ title: 'Ștergi?', body: 'Poți anula în 15 secunde.', confirmLabel: t.common.delete, danger: true });
    if (!ok) return;
    const r = await ctx.store.remove(col, rec.id);
    ctx.toast({ kind: 'ok', text: 'Șters.', actionLabel: t.common.undo, onAction: () => r.undo() });
  }
  const setF = (key, v) => setForm((f) => setPath(f, key, v));
  const cols = [...columns, { key: '_a', header: '', render: (r) => html`<span class="toolbar" style="gap:4px"><${Button} sm kind="ghost" onClick=${() => open(r)}>${t.common.edit}<//><${Button} sm kind="ghost" onClick=${() => remove(r)}>${t.common.delete}<//></span>` }];
  return html`<${Card} title=${title} right=${html`<${Button} sm icon="plus" onClick=${() => open(blank())}>${addLabel}<//>`}>
    ${help ? html`<p class="muted sm" style="margin-bottom:8px">${help}</p>` : null}${extra || null}
    ${rows.length === 0 ? html`<${EmptyState} icon="inbox" title=${empty || 'Nicio înregistrare'} />` : html`<${Table} caption=${title} rowKey=${(r) => r.id} rows=${rows} columns=${cols} />`}
    ${edit ? html`<${Drawer} title=${edit.id ? t.common.edit : addLabel} onClose=${() => setEdit(null)} footer=${html`<${Button} kind="ghost" onClick=${() => setEdit(null)}>${t.common.cancel}<//><${Button} onClick=${save}>${t.common.save}<//>`}>
      ${errs._ ? html`<${Note} kind="warn">${errs._}<//>` : null}
      <div class="form-grid">${fields.map((fd) => {
        const v = getPath(form, fd.key);
        const e = errs[fd.key];
        if (fd.type === 'select') return html`<${Select} label=${fd.label} value=${v ?? ''} onChange=${(x) => setF(fd.key, x)} options=${fd.options} error=${e} hint=${fd.hint} />`;
        if (fd.type === 'checkbox') return html`<${Checkbox} label=${fd.label} checked=${!!v} onChange=${(x) => setF(fd.key, x)} />`;
        if (fd.type === 'date') return html`<${DateInput} label=${fd.label} value=${v || ''} onChange=${(x) => setF(fd.key, x || null)} error=${e} hint=${fd.hint} />`;
        return html`<${TextInput} label=${fd.label} value=${v ?? ''} onInput=${(x) => setF(fd.key, x)} error=${e} hint=${fd.hint || (fd.type === 'bp' ? 'în %, ex. 21 sau 5,5' : fd.type === 'bplist' || fd.type === 'list' ? 'separate prin virgulă' : '')} inputMode=${fd.type === 'number' || fd.type === 'bp' ? 'decimal' : null} />`;
      })}</div><//>` : null}<//>`;
}
export { getPath, setPath };
