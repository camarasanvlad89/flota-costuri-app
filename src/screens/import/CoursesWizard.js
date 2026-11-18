import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton } from '../../ui/hooks.js';
import { Card, Button, Wizard, Table, Select, Note, Badge, Checkbox, TextInput, Icon } from '../../ui/components/index.js';
import { call, tryCall, api, COURSE_FIELD_LABELS } from '../../ui/api.js';
import { saveBytes } from '../../ui/actions.js';
import { normalizePlate, displayPlate, newId, fmtMoney, fmtDate } from '../../core/index.js';

const STEPS = ['Fișier', 'Foi și mapare', 'Valută + TVA', 'Previzualizare', 'Rezumat'];
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

async function readFileRows(file) {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = call('decodeText', await file.arrayBuffer());
    const r = call('readCsv', text);
    return { file: file.name, sheets: [{ name: 'csv', plate: null, year: null, rows: r.rows, rowCount: r.rows.length, defaultSelected: true }] };
  }
  return call('readWorkbook', file);
}

export function CoursesWizard() {
  const ctx = useCtx();
  const trucks = useCollection('trucks');
  const existing = useCollection('courses');
  const company = useSingleton('company');
  const [step, setStep] = useState(0);
  const [wb, setWb] = useState(null);
  const [err, setErr] = useState(null);
  const [sheets, setSheets] = useState([]); // { name, rows, on, plate, year, mapping, confidence }
  const [currency, setCurrency] = useState('RON');
  const [treat, setTreat] = useState('taxed');
  const [confirmed, setConfirmed] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [result, setResult] = useState(null);
  const [done, setDone] = useState(null);
  const [createTrucks, setCreateTrucks] = useState(true);

  async function onFile(file) {
    setErr(null);
    if (!file) return;
    try {
      const w = await readFileRows(file);
      setWb(w);
      setSheets(w.sheets.map((s) => {
        const det = call('detectCourseMapping', s.rows);
        return { name: s.name, rows: s.rows, on: !!s.defaultSelected, plate: s.plate || '', year: s.year, mapping: det.mapping, confidence: det.confidence, rowCount: s.rowCount };
      }));
      setStep(1);
    } catch (e) { setErr(e.apiName ? t.errors.missingApi(e.apiName) : e.message === 'SheetJS nu este încărcat (vendor/xlsx.full.min.js)' ? e.message : 'Fișier necitibil: ' + e.message); }
  }
  const upd = (i, p) => setSheets((a) => a.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const sel = sheets.filter((s) => s.on);

  // parsare (se refăcută la schimbarea valutei/TVA/mapării) – nimic nu se scrie în store înainte de „Importă”
  const parsed = useMemo(() => {
    if (step < 2) return null;
    try {
      const out = sel.map((s) => ({ s, ...call('parseCourseRows', s.rows, s.mapping, { plate: s.plate, year: s.year, currency, company, file: wb && wb.file, sheet: s.name, vatTreatment: treat }) }));
      const drafts = out.flatMap((o) => o.drafts);
      const issues = out.flatMap((o) => o.issues.map((i) => ({ ...i, sheet: o.s.name })));
      return { out, drafts, issues };
    } catch (e) { return { error: e }; }
  }, [step >= 2, JSON.stringify(sel.map((s) => [s.name, s.plate, s.mapping && s.mapping.cols])), currency, treat, existing.length]);
  const plan = useMemo(() => (parsed && parsed.drafts ? call('planCourseImport', parsed.drafts, existing) : null), [parsed, existing]);
  const sample = useMemo(() => (parsed && parsed.drafts ? tryCall('currencySample', [parsed.drafts, currency, 5], null) : null), [parsed, currency]);
  const missingTrucks = useMemo(() => {
    if (!parsed || !parsed.drafts) return [];
    const have = new Set(trucks.map((x) => normalizePlate(x.plate)));
    return [...new Set(parsed.drafts.map((d) => d.plate).filter((p) => p && !have.has(normalizePlate(p))))];
  }, [parsed, trucks]);

  async function apply() {
    const now = new Date().toISOString();
    const importId = newId('imp');
    const byPlate = new Map(trucks.map((x) => [normalizePlate(x.plate), x]));
    const newTrucks = [];
    if (createTrucks) for (const p of missingTrucks) { const tr = { id: newId('trk'), plate: normalizePlate(p), plateDisplay: displayPlate(p), activeFrom: null, activeTo: null, notes: '', createdAt: now, updatedAt: now, createdBy: 'admin' }; newTrucks.push(tr); byPlate.set(tr.plate, tr); }
    const drivers = ctx.store.state().collections.drivers;
    const known = new Set(drivers.map((d) => d.name.toUpperCase()));
    const newDrivers = [];
    const rec = (d) => ({ ...d, truckId: (byPlate.get(normalizePlate(d.plate)) || {}).id || null, importId, createdAt: d.createdAt || now, updatedAt: now, createdBy: 'admin' });
    const adds = plan.add.map(rec).filter((c) => c.truckId);
    const skipped = plan.add.length - adds.length;
    for (const c of adds) { const n = (c.driverRaw || '').trim(); if (n && !known.has(n.toUpperCase())) { known.add(n.toUpperCase()); newDrivers.push({ id: newId('drv'), name: n, aliases: [], active: true, createdAt: now, updatedAt: now, createdBy: 'admin' }); } }
    const updates = plan.update.map((u) => ({ ...u.existing, ...u.patch, importId: u.existing.importId || importId, updatedAt: now }));
    const prev = plan.update.map((u) => u.existing);
    const log = { id: importId, kind: 'courses', file: wb.file, at: now, added: adds.map((c) => c.id), updated: updates.map((c) => c.id), prev, trucks: newTrucks.map((x) => x.id), drivers: newDrivers.map((x) => x.id), counts: { add: adds.length, update: updates.length, unchanged: plan.unchanged.length, skipped }, currency };
    try {
      const r = await ctx.store.batch('Import curse', (tx) => {
        for (const x of newTrucks) tx.put('trucks', x);
        for (const x of newDrivers) tx.put('drivers', x);
        for (const c of adds) tx.put('courses', c);
        for (const c of updates) tx.put('courses', c);
        tx.put('importLogs', log);
        const mp = sel.filter((s) => s.mapping && s.mapping.signature).reduce((a, s) => ({ ...a, [s.mapping.signature]: { cols: s.mapping.cols, headerRow: s.mapping.headerRow, signature: s.mapping.signature, currency, vatTreatment: treat } }), {});
        tx.setSingleton('importMappings', { courses: { ...((ctx.store.state().singletons.importMappings || {}).courses || {}), ...mp } });
      });
      setDone({ log, undo: r.undo });
      setStep(4);
    } catch (e) { setErr(e.code === 'CLOSED_MONTH' || /închis/i.test(e.message) ? 'Unele curse sunt în luni închise: ' + e.message : e.message); }
  }

  function errorsCsv() {
    const head = ['foaie', 'rând', 'severitate', 'cod', 'mesaj'];
    const rows = parsed.issues.map((i) => [i.sheet, i.row, i.severity, i.code, i.message]);
    const buildCsv = api('buildCsv');
    const text = buildCsv ? buildCsv([head, ...rows]) : [head, ...rows].map((r) => r.join(';')).join('\n');
    saveBytes(new TextEncoder().encode(text), 'erori-import-curse.csv', 'text/csv;charset=utf-8');
  }
  const issueByRow = useMemo(() => { const m = new Map(); (parsed && parsed.issues || []).forEach((i) => { const k = i.sheet + ':' + i.row; (m.get(k) || m.set(k, []).get(k)).push(i); }); return m; }, [parsed]);
  const rowsView = useMemo(() => {
    if (!parsed || !parsed.drafts) return [];
    const list = parsed.drafts.map((d) => {
      const st = tryCall('draftPreviewState', [d, plan && plan.states[d.id], issueByRow.get((d.sheet && d.sheet.name) + ':' + (d.sheet && d.sheet.row)) || []], plan && plan.states[d.id]);
      return { d, st };
    });
    return onlyProblems ? list.filter((x) => ['fără preț', 'eroare', 'derivat'].includes(x.st)) : list;
  }, [parsed, plan, onlyProblems]);

  const canNext = step === 0 ? false : step === 1 ? sel.length > 0 && sel.every((s) => s.mapping && !s.mapping.needsUser && (s.plate || s.mapping.cols.plates != null)) : step === 2 ? confirmed : step === 3 ? !!plan && (plan.add.length + plan.update.length > 0) : false;
  return html`<div class="stack">
    <${Wizard} steps=${STEPS} current=${step} onBack=${() => { setStep(step - 1); if (step === 3) setConfirmed(false); }} backDisabled=${step === 0 || step === 4}
      onNext=${() => (step === 3 ? apply() : setStep(step + 1))} nextLabel=${step === 3 ? 'Importă' : t.common.next} nextDisabled=${!canNext || step === 4}>
      ${err ? html`<${Note} kind="warn">${err}<//>` : null}
      ${step === 0 ? html`<div class="dropzone"><p><${Icon} name="upload" size="lg" /></p><p>Alege registrul de curse (.xlsx, o foaie pe camion pe an) sau un CSV.</p>
        <label class="btn" style="cursor:pointer">Alege fișier<input class="vh" type="file" accept=".xlsx,.xls,.csv,.txt" onChange=${(e) => onFile(e.currentTarget.files[0])} /></label></div>` : null}
      ${step === 1 ? html`<div class="stack">${sheets.map((s, i) => html`<${Card} title=${s.name} right=${html`<span class="muted sm">${s.rowCount} rânduri</span>`}>
          <div class="toolbar"><${Checkbox} label="Importă această foaie" checked=${s.on} onChange=${(v) => upd(i, { on: v })} />
            <${TextInput} label="Plăcuță" value=${s.plate} onInput=${(v) => upd(i, { plate: v })} placeholder="ex. XX00DEM" hint=${s.plate ? displayPlate(s.plate) : s.mapping.cols.plates != null ? 'Se ia din coloana ' + colLetter(s.mapping.cols.plates) + ' (Nr camion / Nr remorcă), rând cu rând' : 'Foaia nu are plăcuță în nume: alege coloana cu plăcuțe sau scrie plăcuța'} /></div>
          ${s.on ? html`${s.mapping.headerRow == null ? html`<${Note} kind="warn">Antetul nu a fost găsit după nume. Alege coloanele manual: nu se ghicește.<//>` : html`<p class="sm muted">Antet găsit pe rândul ${s.mapping.headerRow + 1} · încredere ${Math.round((s.confidence || 0) * 100)}%${s.mapping.strayCols && s.mapping.strayCols.length ? ' · coloane fără antet ignorate: ' + s.mapping.strayCols.map(colLetter).join(', ') : ''}</p>`}
            ${s.mapping.ambiguities && s.mapping.ambiguities.length ? html`<${Note} kind="warn">Două coloane arată la fel (${s.mapping.ambiguities.map((a) => a.fields.join('/')).join('; ')}): alege tu.<//>` : null}
            <div class="form-grid">${Object.entries(COURSE_FIELD_LABELS).map(([field, label]) => {
              const width = Math.max(...s.rows.slice(0, 400).map((r) => (r ? r.length : 0)), 0);
              const hdr = s.mapping.headerRow != null ? s.rows[s.mapping.headerRow] || [] : [];
              const cur = s.mapping.cols[field];
              return html`<${Select} label=${label} value=${cur == null ? '' : String(cur)} onChange=${(v) => { const cols = { ...s.mapping.cols }; if (v === '') delete cols[field]; else cols[field] = Number(v); const miss = ['loadDate', 'unloadDate', 'route'].filter((f) => !(f in cols)); upd(i, { mapping: { ...s.mapping, cols, missing: miss, needsUser: miss.length > 0, ambiguities: [] } }); }}
                options=${[{ value: '', label: '— fără —' }, ...Array.from({ length: width }, (_, c) => ({ value: String(c), label: colLetter(c) + (hdr[c] ? ': ' + String(hdr[c]).slice(0, 24) : '') }))]} />`; })}</div>
            ${s.mapping.needsUser ? html`<${Note} kind="warn">Lipsesc coloane obligatorii: ${(s.mapping.missing || []).map((f) => COURSE_FIELD_LABELS[f]).join(', ')}.<//>` : null}` : null}<//>`)}</div>` : null}
      ${step === 2 ? html`<div class="stack"><${Note} kind="warn"><b>Pas obligatoriu:</b> tabelul nu spune în ce valută sunt sumele. Alege valuta și verifică eșantionul. Fără confirmare, importul nu poate continua.<//>
        <div class="form-grid"><${Select} label="Valuta sumelor din foaie" value=${currency} onChange=${(v) => { setCurrency(v); setConfirmed(false); }} options=${['RON', 'EUR', 'HUF', 'PLN', 'CZK']} />
          <${Select} label="Tratament TVA" value=${treat} onChange=${(v) => { setTreat(v); setConfirmed(false); }} options=${[{ value: 'taxed', label: 'Cu TVA (cota României, 21%)' }, { value: 'zero', label: '0% / scutit (client străin)' }, { value: 'reverse', label: 'Taxare inversă' }]} /></div>
        ${parsed && parsed.error ? html`<${Note} kind="warn">${parsed.error.apiName ? t.errors.missingApi(parsed.error.apiName) : parsed.error.message}<//>` : null}
        ${sample ? html`<${Card} title="Eșantion (5 rânduri)"><ul>${sample.sample.map((x) => html`<li>rând ${x.row}: ${x.text}</li>`)}</ul>
          <p><b>Total foaie:</b> net ${fmtMoney(sample.totals.net, currency)} · TVA ${fmtMoney(sample.totals.vat, currency)} · total ${fmtMoney(sample.totals.gross, currency)} (${sample.totals.count} curse cu preț, ${sample.totals.missing} fără preț)</p><//>` : null}
        <${Checkbox} label=${`Am verificat: sumele de mai sus sunt în ${currency} și TVA-ul este cel corect.`} checked=${confirmed} onChange=${setConfirmed} /></div>` : null}
      ${step === 3 && plan ? html`<div class="stack">
        <div class="sumcards"><div class="sc ok"><b>${plan.add.length}</b>noi</div><div class="sc"><b>${plan.update.length}</b>actualizate</div><div class="sc"><b>${plan.unchanged.length}</b>neschimbate</div><div class="sc todo"><b>${parsed.issues.filter((i) => i.severity !== 'info').length}</b>avertizări / erori</div></div>
        ${missingTrucks.length ? html`<${Note} kind="warn">Camioane inexistente: ${missingTrucks.map(displayPlate).join(', ')}. <${Checkbox} label="Creează-le la import" checked=${createTrucks} onChange=${setCreateTrucks} /><//>` : null}
        ${plan.orphaned.length ? html`<${Note}>${plan.orphaned.length} curse existente nu mai apar în fișier (se păstrează, nu se șterg).<//>` : null}
        <div class="toolbar"><${Checkbox} label="Doar probleme" checked=${onlyProblems} onChange=${setOnlyProblems} /><${Button} sm kind="ghost" icon="download" onClick=${errorsCsv}>Descarcă lista de erori (CSV)<//></div>
        <${Table} caption="Previzualizare import" rows=${rowsView.slice(0, 300)} rowKey=${(x) => x.d.id + x.d.sheet.row} columns=${[
          { key: 'r', header: 'Rând', render: (x) => (x.d.sheet && x.d.sheet.row) || '' }, { key: 'd', header: 'Date', render: (x) => fmtDate(x.d.loadDate) + ' → ' + fmtDate(x.d.unloadDate) }, { key: 'p', header: 'Camion', render: (x) => displayPlate(x.d.plate || '') },
          { key: 'ro', header: 'Rută', render: (x) => x.d.routeRaw }, { key: 'n', header: 'Net', align: 'r', render: (x) => (x.d.net == null ? '—' : fmtMoney(x.d.net, currency)) },
          { key: 's', header: 'Stare', render: (x) => html`<${Badge} kind=${x.st === 'eroare' ? 'bad' : x.st === 'fără preț' ? 'warn' : x.st === 'derivat' ? 'derived' : x.st === 'nou' ? 'ok' : 'neutral'}>${x.st}<//>` }]} />
        ${rowsView.length > 300 ? html`<p class="muted sm">Se afișează primele 300 de ${rowsView.length} rânduri.</p>` : null}
        <${Note}>Nimic nu s-a scris încă. Apasă „Importă” pentru a salva.<//></div>` : null}
      ${step === 4 && done ? html`<div class="stack"><div class="check"><${Icon} name="check" /> Import încheiat: ${done.log.counts.add} adăugate, ${done.log.counts.update} actualizate, ${done.log.counts.unchanged} neschimbate${done.log.counts.skipped ? ', ' + done.log.counts.skipped + ' omise (camion lipsă)' : ''}.</div>
        <div class="toolbar"><${Button} kind="sec" onClick=${async () => { await done.undo(); ctx.toast({ kind: 'ok', text: 'Importul a fost anulat.' }); setStep(0); setDone(null); }}>Anulează importul<//><${Button} onClick=${() => ctx.nav('/curse')}>Vezi cursele<//></div></div>` : null}
    <//></div>`;
}
