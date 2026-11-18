import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton } from '../../ui/hooks.js';
import { Card, Button, Table, Select, Note, Badge, Checkbox, TextInput, Icon } from '../../ui/components/index.js';
import { call, tryCall } from '../../ui/api.js';
import { readFileRows, colLetter } from './readFile.js';
import { newId, fmtMoney, fmtDate } from '../../core/index.js';

// categoria implicită pentru fiecare tip de linie de extras (se poate schimba în pasul de mapare)
const LINE_KIND = { fuel: 'Combustibil', toll: 'Taxă de drum', parking: 'Parcare', other: 'Altele' };
const DEFAULT_CAT = { fuel: 'cat_fuel', toll: 'cat_toll_other', parking: 'cat_parking', other: 'cat_other' };

/** Import extras card combustibil / taxe de drum (CSV sau XLSX): mapare generică salvată per furnizor, detectare dubluri, legare la factură. */
export function ExpensesImport() {
  const ctx = useCtx();
  const trucks = useCollection('trucks');
  const entries = useCollection('entries');
  const cats = useCollection('categories').filter((c) => c.kind === 'expense' && !c.archived);
  const countries = useCollection('countries');
  const roVatRates = useCollection('roVatRates');
  const company = useSingleton('company');
  const mappings = useSingleton('importMappings');
  const [provider, setProvider] = useState('');
  const [wb, setWb] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState(null);
  const [currency, setCurrency] = useState('RON');
  const [country, setCountry] = useState('RO');
  const [treat, setTreat] = useState('taxed');
  const [catBy, setCatBy] = useState(DEFAULT_CAT);
  const [linkInvoices, setLinkInvoices] = useState(true);
  const [include, setInclude] = useState({});
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const sheet = wb && wb.sheets[sheetIdx];

  async function onFile(file) {
    setErr(null); setDone(null);
    if (!file) return;
    try {
      const w = await readFileRows(file);
      setWb(w); setSheetIdx(0); setInclude({});
      const first = w.sheets[0];
      const det = call('detectExpenseMapping', first.rows);
      const sig = det.mapping.signature;
      const saved = sig && ((mappings.expenses || {})[sig] || null);
      setMapping(saved ? { ...det.mapping, ...saved } : det.mapping);
      if (saved && saved.provider && !provider) setProvider(saved.provider);
    } catch (e) { setErr(e.apiName ? t.errors.missingApi(e.apiName) : 'Fișier necitibil: ' + e.message); }
  }
  function pickSheet(i) {
    setSheetIdx(i); setInclude({});
    const det = call('detectExpenseMapping', wb.sheets[i].rows);
    setMapping(det.mapping);
  }

  const parsed = useMemo(() => {
    if (!sheet || !mapping || !mapping.cols || mapping.cols.date == null || mapping.cols.amount == null) return null;
    try {
      const defaults = { currency, countryCode: country, provider: provider.trim() || 'GENERIC', documentation: 'invoice', payment: 'fuelcard',
        vat: { treatment: treat, rateBp: null, deductiblePct: 100 } };
      const r = call('parseExpenseCsv', sheet.rows, mapping, defaults);
      const drafts = r.drafts.map((d) => ({ ...d, categoryId: catBy[d.lineKind] || catBy.other }));
      const plan = call('planExpenseImport', drafts, entries, trucks);
      return { ...r, drafts, plan };
    } catch (e) { return { error: e }; }
  }, [sheet, JSON.stringify(mapping && mapping.cols), mapping && mapping.headerRow, currency, country, treat, JSON.stringify(catBy), provider, entries.length]);

  const rows = parsed && parsed.plan ? [...parsed.plan.add, ...parsed.plan.duplicates] : [];
  const isOn = (d) => (include[d.importKey] !== undefined ? include[d.importKey] : d.include !== false);
  const chosen = rows.filter(isOn);

  async function saveMapping() {
    if (!mapping || !mapping.signature) return;
    await ctx.store.setSingleton('importMappings', { expenses: { ...(mappings.expenses || {}), [mapping.signature]: { cols: mapping.cols, headerRow: mapping.headerRow, signature: mapping.signature, provider: provider.trim() } } });
    ctx.toast({ kind: 'ok', text: 'Maparea a fost salvată pentru acest format.' });
  }

  async function apply() {
    setBusy(true); setErr(null);
    try {
      const now = new Date().toISOString();
      const importId = newId('imp');
      const st = ctx.store.state();
      const list = [];
      const failed = [];
      for (const d of chosen) {
        let rate;
        try { rate = await ctx.fx.getRate(d.currency, d.date); } catch { failed.push(d); continue; }
        const input = { ...d, docDate: d.docDate || d.date, truckId: d.truckId || null, targetType: d.truckId ? 'truck' : 'company', categoryId: d.categoryId, status: 'pending', source: 'import', importId };
        try {
          const e = call('buildEntry', input, { company, countries, categories: st.collections.categories, roVatRates, rate, now, id: undefined });
          if (linkInvoices) {
            const sug = tryCall('suggestParentInvoice', [d, entries], [])[0];
            if (sug && sug.score >= 1) e.parentDocId = sug.entry.id;
          }
          list.push(e);
        } catch { failed.push(d); }
      }
      if (!list.length) { setErr('Nicio linie nu a putut fi importată' + (failed.length ? ` (${failed.length} fără curs de schimb sau invalide)` : '') + '.'); setBusy(false); return; }
      const log = { id: importId, kind: 'expenses', file: wb.file, at: now, added: list.map((e) => e.id), prev: [], counts: { add: list.length, skipped: failed.length } };
      const r = await ctx.store.batch('Import cheltuieli', (tx) => { for (const e of list) tx.put('entries', e); tx.put('importLogs', log); });
      setDone({ log, undo: r.undo, linked: list.filter((e) => e.parentDocId).length });
    } catch (e) { setErr(e.code === 'CLOSED_MONTH' || /închis/i.test(e.message) ? 'Unele linii sunt în luni închise: ' + e.message : e.message); }
    setBusy(false);
  }

  const width = sheet ? Math.max(...sheet.rows.slice(0, 400).map((r) => (r ? r.length : 0)), 0) : 0;
  const hdr = sheet && mapping && mapping.headerRow != null ? sheet.rows[mapping.headerRow] || [] : [];
  const FIELDS = tryCall('expenseFieldLabels', [], null) || {};
  const fieldLabels = Object.keys(FIELDS).length ? FIELDS : { date: 'Data', supplier: 'Furnizor / stație', amount: 'Sumă (brut)', net: 'Sumă fără TVA', vatAmount: 'TVA', currency: 'Valută', plate: 'Nr. înmatriculare', category: 'Produs / categorie', note: 'Observații', docNo: 'Nr. document', country: 'Țară', liters: 'Cantitate (litri)' };
  const catOpts = cats.map((c) => ({ value: c.id, label: c.name }));
  return html`<div class="stack">
    <${Note}>Import generic de extrase (DKV, E100, Eurowag, UTA, bancă): CSV sau XLSX. Formatele exacte ale furnizorilor nu sunt cunoscute, de aceea coloanele se mapează o dată și maparea se salvează pentru formatul respectiv. Taxele de drum se încadrează pe categorii (HU-GO, RO, DE, HR…). Nimic nu se scrie până nu apeși „Importă”.<//>
    <div class="dropzone"><p><${Icon} name="upload" size="lg" /></p><p>Alege extrasul (.csv, .xlsx).</p>
      <label class="btn" style="cursor:pointer">Alege fișier<input class="vh" type="file" accept=".xlsx,.xls,.csv,.txt" onChange=${(e) => onFile(e.currentTarget.files[0])} /></label></div>
    ${err ? html`<${Note} kind="warn">${err}<//>` : null}
    ${wb ? html`<${Card} title=${'Mapare · ' + wb.file}>
      <div class="form-grid"><${TextInput} label="Furnizor (card)" value=${provider} onInput=${setProvider} placeholder="ex. DKV, E100, Eurowag" />
        ${wb.sheets.length > 1 ? html`<${Select} label="Foaie" value=${String(sheetIdx)} onChange=${(v) => pickSheet(Number(v))} options=${wb.sheets.map((s, i) => ({ value: String(i), label: `${s.name} (${s.rowCount} rânduri)` }))} />` : null}
        <${Select} label="Valuta sumelor" value=${currency} onChange=${setCurrency} options=${['RON', 'EUR', 'HUF', 'PLN', 'CZK', 'BGN', 'USD', 'GBP', 'CHF']} />
        <${Select} label="Țara implicită" value=${country} onChange=${setCountry} options=${countries.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
        <${Select} label="TVA" value=${treat} onChange=${setTreat} options=${[{ value: 'taxed', label: 'Cu TVA (cota țării)' }, { value: 'none', label: t.vat.none }, { value: 'zero', label: t.vat.zero }, { value: 'nondeductible', label: t.vat.nondeductible }]} /></div>
      ${mapping && mapping.headerRow == null ? html`<${Note} kind="warn">Antetul nu a fost recunoscut după nume (se caută „Data” și „Sumă”). Alege coloanele manual.<//>` : html`<p class="sm muted">Antet pe rândul ${mapping && mapping.headerRow != null ? mapping.headerRow + 1 : '?'}.</p>`}
      <div class="form-grid">${Object.entries(fieldLabels).map(([field, label]) => html`<${Select} label=${label + (field === 'date' || field === 'amount' ? ' *' : '')} value=${mapping && mapping.cols[field] != null ? String(mapping.cols[field]) : ''}
        onChange=${(v) => { const cols = { ...(mapping ? mapping.cols : {}) }; if (v === '') delete cols[field]; else cols[field] = Number(v); setMapping({ ...(mapping || { headerRow: null, signature: null }), cols, headerRow: mapping && mapping.headerRow != null ? mapping.headerRow : 0 }); }}
        options=${[{ value: '', label: '— fără —' }, ...Array.from({ length: width }, (_, c) => ({ value: String(c), label: colLetter(c) + (hdr[c] ? ': ' + String(hdr[c]).slice(0, 24) : '') }))]} />`)}</div>
      <div class="form-grid">${Object.entries(LINE_KIND).map(([k, label]) => html`<${Select} label=${'Categorie pentru: ' + label} value=${catBy[k]} onChange=${(v) => setCatBy({ ...catBy, [k]: v })} options=${catOpts} />`)}</div>
      <div class="toolbar"><${Button} sm kind="sec" onClick=${saveMapping} disabled=${!mapping || !mapping.signature}>Salvează maparea pentru acest format<//></div><//>` : null}
    ${parsed && parsed.error ? html`<${Note} kind="warn">${parsed.error.apiName ? t.errors.missingApi(parsed.error.apiName) : parsed.error.message}<//>` : null}
    ${wb && mapping && (mapping.cols.date == null || mapping.cols.amount == null) ? html`<${Note} kind="warn">Alege cel puțin coloanele Data și Sumă.<//>` : null}
    ${parsed && parsed.plan ? html`<${Card} title=${`Previzualizare: ${parsed.plan.add.length} noi, ${parsed.plan.duplicates.length} posibile dubluri`}>
      <div class="toolbar"><${Checkbox} label="Leagă tranzacțiile de factura cu același număr (nu se numără de două ori)" checked=${linkInvoices} onChange=${setLinkInvoices} />
        ${parsed.issues.length ? html`<span class="muted sm">${parsed.issues.filter((i) => i.severity !== 'info').length} avertizări</span>` : null}</div>
      <${Table} caption="Previzualizare extras" rowKey=${(d) => d.importKey} rows=${rows.slice(0, 300)} columns=${[
        { key: 'inc', header: '', render: (d) => html`<input type="checkbox" aria-label="Include rândul" checked=${isOn(d)} onChange=${(e) => setInclude({ ...include, [d.importKey]: e.currentTarget.checked })} />` },
        { key: 'r', header: 'Rând', render: (d) => d.importRow }, { key: 'd', header: 'Data', render: (d) => fmtDate(d.date) }, { key: 's', header: 'Furnizor', render: (d) => d.supplier },
        { key: 'k', header: 'Tip', render: (d) => LINE_KIND[d.lineKind] || d.lineKind }, { key: 'p', header: 'Camion', render: (d) => d.plate || '—' },
        { key: 'a', header: 'Sumă', align: 'r', render: (d) => fmtMoney(d.minor, d.currency) },
        { key: 'st', header: 'Stare', render: (d) => (d.possibleDuplicate ? html`<${Badge} kind="warn">posibilă dublură<//>` : html`<${Badge} kind="ok">nou<//>`) }]} />
      ${rows.length > 300 ? html`<p class="muted sm">Se afișează primele 300 de ${rows.length}.</p>` : null}
      <div class="toolbar"><${Button} onClick=${apply} disabled=${busy || !chosen.length || !!done}>${`Importă ${chosen.length} linii`}<//></div><//>` : null}
    ${done ? html`<div class="stack"><div class="check"><${Icon} name="check" /> Import încheiat: ${done.log.counts.add} adăugate${done.linked ? ', ' + done.linked + ' legate de facturi' : ''}${done.log.counts.skipped ? ', ' + done.log.counts.skipped + ' omise (fără curs de schimb)' : ''}. Apar în „De verificat”.</div>
      <div class="toolbar"><${Button} kind="sec" onClick=${async () => { await done.undo(); ctx.toast({ kind: 'ok', text: 'Importul a fost anulat.' }); setDone(null); }}>Anulează importul<//><${Button} onClick=${() => ctx.nav('/verificare')}>Vezi „De verificat”<//></div></div>` : null}
  </div>`;
}
