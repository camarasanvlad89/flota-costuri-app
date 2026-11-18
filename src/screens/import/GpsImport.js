import { html, useState, useMemo } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton } from '../../ui/hooks.js';
import { Card, Button, Table, Note, Badge, Icon, Select, ProgressBar } from '../../ui/components/index.js';
import { call } from '../../ui/api.js';
import { truckLabel } from '../../ui/selectors.js';
import { newId, fmtKm, displayPlate, normalizePlate, fmtDate } from '../../core/index.js';

const KIND = { daily: 'Foaie de activitate zilnică', trips: 'Călătorii (cu adrese)' };

export function GpsImport() {
  const ctx = useCtx();
  const trucks = useCollection('trucks');
  const days = useCollection('gpsDays');
  const trips = useCollection('gpsTrips');
  const mappings = useSingleton('importMappings');
  const [files, setFiles] = useState([]);
  const [res, setRes] = useState(null);
  const [plates, setPlates] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  async function parse(list, overrides) {
    setBusy(true); setErr(null);
    try { setRes(await call('parseGpsFiles', list, { plates: overrides, savedMappings: mappings.gps })); }
    catch (e) { setErr(e.apiName ? t.errors.missingApi(e.apiName) : e.message); }
    setBusy(false);
  }
  const onFiles = (fl) => { const list = [...fl]; setFiles(list); setDone(null); setPlates({}); parse(list, {}); };
  const plan = useMemo(() => (res ? call('planGpsImport', res.dataset, days, trucks, trips) : null), [res, days, trucks, trips]);

  async function assignTruck(plate, truckId) {
    const tr = trucks.find((x) => x.id === truckId);
    if (!tr) return;
    await ctx.store.put('trucks', { ...tr, gpsPlates: [...new Set([...(tr.gpsPlates || []), plate])], updatedAt: new Date().toISOString() });
  }
  async function apply() {
    const now = new Date().toISOString();
    const importId = newId('imp');
    const stampRec = (r) => ({ ...r, importId, createdAt: r.createdAt || now, updatedAt: now, createdBy: 'admin' });
    const addD = plan.add.map(stampRec), repD = plan.replace.map(stampRec), addT = plan.trips.add.map(stampRec), repT = plan.trips.replace.map(stampRec);
    const prevD = repD.map((r) => days.find((d) => d.id === r.id)).filter(Boolean), prevT = repT.map((r) => trips.find((d) => d.id === r.id)).filter(Boolean);
    const log = { id: importId, kind: 'gps', file: files.map((f) => f.name).join(', '), at: now, added: [...addD.map((d) => d.id)], addedTrips: addT.map((d) => d.id), prev: prevD, prevTrips: prevT,
      counts: { days: addD.length + repD.length, replaced: repD.length, trips: addT.length + repT.length, unchanged: plan.unchanged.length + plan.trips.unchanged.length } };
    try {
      const r = await ctx.store.batch('Import GPS', (tx) => {
        for (const d of [...addD, ...repD]) tx.put('gpsDays', d);
        for (const d of [...addT, ...repT]) tx.put('gpsTrips', d);
        tx.put('importLogs', log);
      });
      setDone({ log, undo: r.undo });
    } catch (e) { setErr(e.message); }
  }
  const totalKm = (res ? res.dataset.checks : []).reduce((a, c) => a + (c.tripsKmM || c.dailyKmM || 0), 0);
  return html`<div class="stack">
    <${Note}>Importă exporturile Excel SafeFleet: <b>Călătorii</b> (sursa primară, cu adrese) și <b>Foaia de activitate zilnică</b> (rezervă și verificare). Poți alege mai multe fișiere deodată (câte unul pe camion / perioadă); plăcuța se ia din subsol. Perioada nu se presupune.<//>
    <div class="dropzone"><p><${Icon} name="gps" size="lg" /></p><label class="btn" style="cursor:pointer">Alege fișiere GPS<input class="vh" multiple type="file" accept=".xlsx,.xls,.csv" onChange=${(e) => onFiles(e.currentTarget.files)} /></label></div>
    ${busy ? html`<${ProgressBar} value=${50} label="Se citesc fișierele" />` : null}
    ${err ? html`<${Note} kind="warn">${err}<//>` : null}
    ${res ? html`<div class="stack">
      ${res.files.map((f) => html`<${Card} title=${f.file + (f.sheet && f.sheet !== 'csv' ? ' · ' + f.sheet : '')} right=${f.kind ? html`<${Badge} kind="info">${KIND[f.kind] || f.kind}<//>` : html`<${Badge} kind="bad">nerecunoscut<//>`}>
        ${f.error ? html`<${Note} kind="warn">${f.error}<//>` : html`<div class="kvgrid"><div><span>Plăcuță</span><span>${f.plate ? displayPlate(f.plate) : '—'}</span></div><div><span>Zile</span><span>${(f.days || []).length}</span></div><div><span>Călătorii</span><span>${(f.trips || []).length}</span></div>
          ${f.odometerCheck ? html`<div><span>Odometru</span><span>${f.odometerCheck.withinTolerance ? 'în toleranță' : 'diferență > 0,5%'}</span></div>` : null}</div>`}
        ${f.needsPlate || (f.issues || []).some((i) => i.code === 'plate_missing') ? html`<div class="toolbar"><${Select} label="Alege camionul pentru acest fișier" value=${plates[f.file] || ''} placeholder="Alege…" options=${trucks.map((x) => ({ value: x.plate, label: truckLabel(x) }))} onChange=${(v) => { const p = { ...plates, [f.file]: v }; setPlates(p); parse(files, p); }} /></div>` : null}
        ${(f.issues || []).filter((i) => i.severity !== 'info').slice(0, 8).map((i) => html`<p class="sm"><${Badge} kind=${i.severity === 'error' ? 'bad' : 'warn'}>${i.severity === 'error' ? 'eroare' : 'avertizare'}<//> ${i.row ? 'rând ' + i.row + ': ' : ''}${i.message}</p>`)}<//>`)}
      ${res.dataset.checks.length ? html`<${Card} title="Verificări încrucișate"><${Table} rowKey=${(c) => c.plate} rows=${res.dataset.checks} columns=${[
        { key: 'p', header: 'Camion', render: (c) => displayPlate(c.plate) }, { key: 't', header: 'Km din călătorii', align: 'r', render: (c) => (c.tripsKmM ? fmtKm(c.tripsKmM, 1) : '—') }, { key: 'd', header: 'Km zilnic', align: 'r', render: (c) => (c.dailyKmM ? fmtKm(c.dailyKmM, 1) : '—') },
        { key: 'o', header: 'Diferență odometru', align: 'r', render: (c) => (c.odoDeltaM ? fmtKm(c.odoDeltaM, 1) : '—') },
        { key: 'ok', header: 'Stare', render: (c) => (c.tripsVsDailyOk === false || c.tripsVsOdoOk === false ? html`<${Badge} kind="warn">verifică<//>` : html`<${Badge} kind="ok">în toleranță<//>`) }]} /><//>` : null}
      ${plan && plan.unmatchedPlates.length ? html`<${Card} title="Plăcuțe fără camion"><p class="muted sm">Alege camionul căruia îi aparține fiecare plăcuță; potrivirea se salvează.</p>
        ${plan.unmatchedPlates.map((p) => html`<div class="toolbar"><b>${displayPlate(p)}</b><${Select} label="" value="" placeholder="Camion…" options=${trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))} onChange=${(v) => assignTruck(p, v)} /></div>`)}<//>` : null}
      ${plan ? html`<div class="sumcards"><div class="sc ok"><b>${plan.add.length + plan.trips.add.length}</b>adăugate</div><div class="sc"><b>${plan.replace.length + plan.trips.replace.length}</b>înlocuite</div><div class="sc"><b>${plan.unchanged.length + plan.trips.unchanged.length}</b>neschimbate</div><div class="sc"><b>${fmtKm(totalKm, 1)}</b>km total</div></div>
        ${!done ? html`<${Button} onClick=${apply} disabled=${plan.add.length + plan.replace.length + plan.trips.add.length + plan.trips.replace.length === 0}>Importă datele GPS<//>` : html`<div class="check"><${Icon} name="check" /> Import încheiat. <${Button} sm kind="sec" onClick=${async () => { await done.undo(); ctx.toast({ kind: 'ok', text: 'Importul GPS a fost anulat.' }); setDone(null); }}>Anulează importul<//></div>`}` : null}</div>` : null}</div>`;
}
