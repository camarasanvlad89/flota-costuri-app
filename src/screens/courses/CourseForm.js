import { html, useState } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton } from '../../ui/hooks.js';
import { Drawer, Button, DateInput, Select, TextInput, MoneyInput, Combobox, Note } from '../../ui/components/index.js';
import { tryCall, call } from '../../ui/api.js';
import { truckLabel, validateKm } from '../../ui/selectors.js';
import { convert, normalizePlate, todayLocal } from '../../core/index.js';

/** Construiește înregistrarea cursei din formular (preț prin `priceFromColumns`, curs prin `fx`). */
async function buildCourse(ctx, f, existing, truck) {
  const company = ctx.store.state().singletons.company;
  const dests = f.destinations.split('+').map((s) => s.trim()).filter(Boolean);
  const routeRaw = f.origin.trim() + (dests.length ? ' - ' + dests.join(' + ') : f.countryDest ? ' - ' + f.countryDest : '');
  const price = call('priceFromColumns', { net: f.mode === 'net' ? f.amount : null, gross: f.mode === 'gross' ? f.amount : null, date: f.invoiceDate || f.loadDate, company, vatTreatment: f.vatTreatment });
  const route = tryCall('parseRoute', [routeRaw], { origin: f.origin.trim(), destinations: dests, countryOnly: false, destCountry: null });
  let rate = null;
  if (price.net != null) {
    try { rate = await ctx.fx.getRate(f.currency, f.invoiceDate || f.unloadDate); } catch { /* fără curs */ }
    if (!rate && f.currency !== 'RON') throw new Error('Fără curs pentru ' + f.currency + ': introdu cursul în Setări › Valute');
  }
  // preț net introdus de administrator: nu e „derivat” (derivat = defalcare TVA necunoscută, ex. doar Total la import)
  if (f.mode === 'net' && price.priceStatus === 'derived' && price.net != null) { price.vatDerived = false; price.priceStatus = 'ok'; }
  const conv = (v, cur, key) => (v == null ? null : cur === 'RON' && key === 'ron' ? v : rate ? convert(v, cur, key === 'ron' ? 'RON' : 'EUR', key === 'ron' ? rate.ronPerUnit : rate.eurPerUnit) : null);
  const plate = normalizePlate(truck.plate);
  const id = existing ? existing.id : call('courseId', { plate, loadDate: f.loadDate, unloadDate: f.unloadDate, route: routeRaw });
  const now = new Date().toISOString();
  const km = f.km !== '' && f.km != null ? Math.round(Number(String(f.km).replace(',', '.')) * 1000) : null;
  const driver = ctx.store.state().collections.drivers.find((d) => d.name.toLowerCase() === f.driver.trim().toLowerCase());
  const manual = new Set(existing ? existing.manualFields || [] : []);
  if (km != null) manual.add('loadedKm');
  return {
    ...(existing || { createdAt: now, createdBy: 'admin', importId: null, sheet: null, strayValues: [] }),
    id, truckId: truck.id, trailerPlate: f.trailer.trim() || null, driverRaw: f.driver.trim(), driverId: driver ? driver.id : null,
    loadDate: f.loadDate, unloadDate: f.unloadDate, invoiceDate: f.invoiceDate || null, routeRaw, origin: route.origin, destinations: route.destinations,
    destCountry: route.destCountry || null, currency: f.currency, vatTreatment: price.vatTreatment, net: price.net, vat: price.vat, gross: price.gross, vatBp: price.vatBp, vatDerived: price.vatDerived,
    priceStatus: price.priceStatus, fx: rate || (existing && existing.fx) || null,
    ron: { net: conv(price.net, f.currency, 'ron'), vat: conv(price.vat, f.currency, 'ron'), gross: conv(price.gross, f.currency, 'ron') },
    eur: { net: conv(price.net, f.currency, 'eur'), vat: conv(price.vat, f.currency, 'eur'), gross: conv(price.gross, f.currency, 'eur') },
    loadedKm: km != null ? { meters: km, source: 'manual', confidence: 'high', at: now } : (existing && existing.loadedKm) || { meters: null, source: null, confidence: 'low', at: now },
    uit: f.uit.trim() ? { code: f.uit.trim(), issuedAt: (existing && existing.uit && existing.uit.issuedAt) || undefined } : null,
    note: f.note, status: price.priceStatus === 'missing' ? 'review' : 'ok', manualFields: [...manual], clientName: f.client || null, invoiceNo: f.invoiceNo || null, updatedAt: now,
  };
}

export function CourseForm({ course, onClose }) {
  const ctx = useCtx();
  const trucks = useCollection('trucks');
  const drivers = useCollection('drivers');
  const company = useSingleton('company');
  const today = todayLocal(ctx.clock);
  const [f, setF] = useState(() => ({
    truckId: course ? course.truckId : (trucks[0] && trucks[0].id) || '', trailer: (course && course.trailerPlate) || '', driver: (course && course.driverRaw) || '',
    loadDate: (course && course.loadDate) || today, unloadDate: (course && course.unloadDate) || today, invoiceDate: (course && course.invoiceDate) || '',
    origin: (course && course.origin) || '', destinations: course ? (course.destinations || []).join(' + ') : '', countryDest: course && course.destCountry && !(course.destinations || []).length ? course.destCountry : '',
    mode: 'net', amount: course ? (course.net != null ? course.net : null) : null, currency: (course && course.currency) || 'RON', vatTreatment: (course && course.vatTreatment) || 'taxed',
    km: course && course.loadedKm && course.loadedKm.meters != null ? String(course.loadedKm.meters / 1000).replace('.', ',') : '', uit: (course && course.uit && course.uit.code) || '',
    note: (course && course.note) || '', client: (course && course.clientName) || '', invoiceNo: (course && course.invoiceNo) || '',
  }));
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const [err, setErr] = useState(null);
  const [kmErr, setKmErr] = useState(null);
  async function save() {
    setErr(null); setKmErr(null);
    const truck = trucks.find((x) => x.id === f.truckId);
    if (!truck) return setErr('Alege camionul.');
    if (!f.loadDate || !f.unloadDate || f.unloadDate < f.loadDate) return setErr('Datele sunt invalide (descărcarea nu poate fi înaintea încărcării).');
    if (!f.origin.trim()) return setErr('Originea este obligatorie.');
    const ke = validateKm(f.km);
    if (ke) { setKmErr(ke); return; }
    try {
      const rec = await buildCourse(ctx, f, course, truck);
      const r = await ctx.store.put('courses', rec);
      ctx.toast({ kind: 'ok', text: 'Cursa a fost salvată.', actionLabel: t.common.undo, onAction: () => r.undo() });
      onClose(true);
    } catch (e) { setErr(e.apiName ? t.errors.missingApi(e.apiName) : e.message); }
  }
  async function remove() {
    const ok = await ctx.confirm({ title: 'Ștergi cursa?', body: `${course.routeRaw || 'Cursa'} · ${course.loadDate}. Poți anula în 15 secunde.`, confirmLabel: t.common.delete, danger: true });
    if (!ok) return;
    try {
      const r = await ctx.store.remove('courses', course.id);
      ctx.toast({ kind: 'ok', text: 'Cursa a fost ștearsă.', actionLabel: t.common.undo, onAction: () => r.undo() });
      onClose(true);
    } catch (e) { setErr(e.message); }
  }
  return html`<${Drawer} title=${course ? 'Editează cursa' : 'Cursă nouă'} onClose=${() => onClose(false)} footer=${html`${course ? html`<${Button} class="danger" onClick=${remove}>${t.common.delete}<//>` : null}<${Button} kind="ghost" onClick=${() => onClose(false)}>${t.common.cancel}<//><${Button} onClick=${save}>${t.common.save}<//>`}>
    <div class="form-grid"><${Select} label="Camion" value=${f.truckId} onChange=${(v) => set({ truckId: v })} options=${trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))} />
      <${TextInput} label="Remorcă" value=${f.trailer} onInput=${(v) => set({ trailer: v })} /><${Combobox} label="Șofer" value=${f.driver} onChange=${(v) => set({ driver: v })} options=${drivers.map((d) => d.name)} /></div>
    <div class="form-grid"><${DateInput} label="Data încărcare" value=${f.loadDate} onChange=${(v) => set({ loadDate: v })} /><${DateInput} label="Data descărcare" value=${f.unloadDate} onChange=${(v) => set({ unloadDate: v })} />
      <${DateInput} label="Data facturii (opțional)" value=${f.invoiceDate} onChange=${(v) => set({ invoiceDate: v || '' })} hint="Cota TVA și cursul se iau la această dată." /></div>
    <div class="form-grid"><${TextInput} label="Origine" value=${f.origin} onInput=${(v) => set({ origin: v })} /><${TextInput} label="Destinații (separate prin +)" value=${f.destinations} onInput=${(v) => set({ destinations: v })} />
      <${TextInput} label="Doar țară (dacă nu știi locul)" value=${f.countryDest} onInput=${(v) => set({ countryDest: v })} hint="Cursele cu destinație doar țară cer km manuali." /></div>
    <div class="form-grid"><${Select} label="Introduci" value=${f.mode} onChange=${(v) => set({ mode: v })} options=${[{ value: 'net', label: 'Preț net (fără TVA)' }, { value: 'gross', label: 'Total cu TVA' }]} />
      <${MoneyInput} label="Sumă" value=${f.amount} currency=${f.currency} currencies=${['RON', 'EUR', 'HUF', 'PLN', 'CZK']} onChange=${(v) => set({ amount: v })} onCurrencyChange=${(c) => set({ currency: c })} />
      <${Select} label="TVA" value=${f.vatTreatment} onChange=${(v) => set({ vatTreatment: v })} options=${[{ value: 'taxed', label: 'Cu TVA (cota României)' }, { value: 'zero', label: '0% / scutit' }, { value: 'reverse', label: 'Taxare inversă' }]} /></div>
    <div class="form-grid"><${TextInput} label="Km încărcați (manual)" inputMode="decimal" value=${f.km} onInput=${(v) => { set({ km: v }); setKmErr(null); }} error=${kmErr} hint="Protejat la reimport (sursă: manual)." /><${TextInput} label="Cod UIT (e-Transport, doar evidență)" value=${f.uit} onInput=${(v) => set({ uit: v })} />
      <${TextInput} label="Client" value=${f.client} onInput=${(v) => set({ client: v })} /><${TextInput} label="Nr. factură" value=${f.invoiceNo} onInput=${(v) => set({ invoiceNo: v })} /></div>
    <${TextInput} label="Observații" value=${f.note} onInput=${(v) => set({ note: v })} />
    ${err ? html`<div class="note-box warn" role="alert">${err}</div>` : null}<//>`;
}
