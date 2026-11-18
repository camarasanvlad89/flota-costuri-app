import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton } from '../../ui/hooks.js';
import { Card, Button, Table, Select, Note, Badge, Icon } from '../../ui/components/index.js';
import { call, tryCall } from '../../ui/api.js';
import { newId, fmtMoney, fmtDate } from '../../core/index.js';

const FLAG_TEXT = { direction_unknown: 'direcție necunoscută (CUI-ul firmei nu coincide)', multiple_vat_rates: 'mai multe cote de TVA', credit_note: 'notă de credit' };

/** Import manual e-Factura (UBL XML): fișiere încărcate de administrator, fără descărcare automată din SPV. */
export function EInvoiceImport() {
  const ctx = useCtx();
  const entries = useCollection('entries');
  const cats = useCollection('categories');
  const countries = useCollection('countries');
  const roVatRates = useCollection('roVatRates');
  const supplierRules = useCollection('supplierRules');
  const company = useSingleton('company');
  const [files, setFiles] = useState([]); // { name, ok, error, draft, warnings }
  const [catOf, setCatOf] = useState({});
  const [on, setOn] = useState({});
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(fl) {
    setErr(null); setDone(null);
    const out = [];
    for (const f of [...fl]) {
      try {
        const text = await f.text();
        const r = call('parseEinvoiceXml', text);
        if (!r.ok) { out.push({ name: f.name, ok: false, error: r.error }); continue; }
        out.push({ name: f.name, ok: true, draft: call('einvoiceToDraft', r.invoice, { company, supplierRules }), warnings: r.warnings });
      } catch (e) { out.push({ name: f.name, ok: false, error: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
    }
    setFiles(out); setCatOf({}); setOn({});
  }
  const plan = useMemo(() => {
    const drafts = files.filter((x) => x.ok).map((x) => x.draft);
    return drafts.length ? call('planEinvoiceImport', drafts, entries) : null;
  }, [files, entries]);
  const dupKeys = new Set(plan ? plan.duplicates.map((d) => d.draft.importKey) : []);
  const dupReason = new Map(plan ? plan.duplicates.map((d) => [d.draft.importKey, d.reason]) : []);
  const catFor = (d) => catOf[d.importKey] || d.categoryId || (d.kind === 'income' ? 'cat_inc_other' : '');
  const isOn = (d) => (on[d.importKey] !== undefined ? on[d.importKey] : !dupKeys.has(d.importKey));
  const drafts = files.filter((x) => x.ok).map((x) => x.draft);
  const chosen = drafts.filter((d) => isOn(d));
  const missingCat = chosen.filter((d) => !catFor(d));
  const optsFor = (d) => cats.filter((c) => c.kind === (d.kind === 'income' ? 'income' : 'expense') && !c.archived).map((c) => ({ value: c.id, label: c.name }));

  async function apply() {
    setBusy(true); setErr(null);
    try {
      const now = new Date().toISOString();
      const importId = newId('imp');
      const list = [], rules = [], failed = [];
      for (const d of chosen) {
        let rate;
        try { rate = await ctx.fx.getRate(d.currency, d.date); } catch { failed.push(d); continue; }
        try {
          list.push(call('buildEntry', { ...d, categoryId: catFor(d), status: 'pending', source: 'import', importId }, { company, countries, categories: cats, roVatRates, rate, now }));
          if (d.kind === 'expense' && catOf[d.importKey]) rules.push(call('learnSupplierRule', supplierRules, { vatId: d.counterpartyVatId, name: d.supplier }, catOf[d.importKey], now));
        } catch { failed.push(d); }
      }
      if (!list.length) { setErr('Nicio factură nu a putut fi importată' + (failed.length ? ` (${failed.length} fără curs de schimb sau invalide)` : '') + '.'); setBusy(false); return; }
      const log = { id: importId, kind: 'efactura', file: files.map((f) => f.name).join(', '), at: now, added: list.map((e) => e.id), prev: [], counts: { add: list.length, skipped: failed.length } };
      const r = await ctx.store.batch('Import e-Factura', (tx) => { for (const e of list) tx.put('entries', e); for (const x of rules) tx.put('supplierRules', x); tx.put('importLogs', log); });
      setDone({ log, undo: r.undo });
    } catch (e) { setErr(e.code === 'CLOSED_MONTH' || /închis/i.test(e.message) ? 'Unele facturi sunt în luni închise: ' + e.message : e.message); }
    setBusy(false);
  }
  return html`<div class="stack">
    <${Note}>Încarcă manual facturile e-Factura (UBL XML) descărcate de tine din SPV: se acceptă mai multe fișiere. Furnizorul → categoria se învață din confirmări; dublurile se detectează după furnizor (CUI) + număr factură. Fără descărcare automată din SPV. Nimic nu se scrie până nu apeși „Importă”.<//>
    <div class="dropzone"><p><${Icon} name="upload" size="lg" /></p><p>Alege fișierele XML.</p>
      <label class="btn" style="cursor:pointer">Alege fișiere XML<input class="vh" multiple type="file" accept=".xml,text/xml,application/xml" onChange=${(e) => onFiles(e.currentTarget.files)} /></label></div>
    ${err ? html`<${Note} kind="warn">${err}<//>` : null}
    ${files.filter((x) => !x.ok).map((x) => html`<${Note} kind="warn"><b>${x.name}</b>: ${x.error}<//>`)}
    ${drafts.length ? html`<${Card} title=${`Facturi citite: ${drafts.length}`}>
      <${Table} caption="Facturi e-Factura" rowKey=${(d) => d.importKey} rows=${drafts} columns=${[
        { key: 'i', header: '', render: (d) => html`<input type="checkbox" aria-label="Include factura" checked=${isOn(d)} onChange=${(e) => setOn({ ...on, [d.importKey]: e.currentTarget.checked })} />` },
        { key: 'd', header: 'Data', render: (d) => fmtDate(d.date) }, { key: 'n', header: 'Nr.', render: (d) => d.docNo }, { key: 'k', header: 'Tip', render: (d) => (d.kind === 'income' ? 'Venit (emisă)' : 'Cheltuială (primită)') },
        { key: 's', header: 'Furnizor / client', wrap: true, render: (d) => html`${d.supplier}<span class="sub">${d.counterpartyVatId || ''}</span>` },
        { key: 'a', header: 'Total', align: 'r', render: (d) => fmtMoney(d.minor, d.currency) },
        { key: 'c', header: 'Categorie', render: (d) => html`<${Select} label="" value=${catFor(d)} placeholder="Alege categoria…" onChange=${(v) => setCatOf({ ...catOf, [d.importKey]: v })} options=${optsFor(d)} aria-label="Categorie" />${d.categorySuggested && !catOf[d.importKey] ? html` <span class="muted sm">învățată</span>` : null}` },
        { key: 'f', header: 'Stare', wrap: true, render: (d) => html`${dupKeys.has(d.importKey) ? html`<${Badge} kind="warn">dublură (${dupReason.get(d.importKey)})<//>` : html`<${Badge} kind="ok">nouă<//>`} ${(d.flags || []).map((f) => html`<span class="muted sm">${FLAG_TEXT[f] || f}</span> `)}` }]} />
      ${missingCat.length ? html`<${Note} kind="warn">${missingCat.length} facturi nu au categorie: alege-o înainte de import.<//>` : null}
      <div class="toolbar"><${Button} onClick=${apply} disabled=${busy || !chosen.length || missingCat.length > 0 || !!done}>${`Importă ${chosen.length} facturi`}<//></div><//>` : null}
    ${done ? html`<div class="stack"><div class="check"><${Icon} name="check" /> Import încheiat: ${done.log.counts.add} adăugate${done.log.counts.skipped ? ', ' + done.log.counts.skipped + ' omise (fără curs de schimb)' : ''}. Apar în „De verificat”.</div>
      <div class="toolbar"><${Button} kind="sec" onClick=${async () => { await done.undo(); ctx.toast({ kind: 'ok', text: 'Importul a fost anulat.' }); setDone(null); }}>Anulează importul<//><${Button} onClick=${() => ctx.nav('/verificare')}>Vezi „De verificat”<//></div></div>` : null}
  </div>`;
}
