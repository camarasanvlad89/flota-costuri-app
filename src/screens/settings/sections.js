import { html, useState, useEffect } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection, useSingleton, useStore } from '../../ui/hooks.js';
import { Card, Button, TextInput, Select, Checkbox, MoneyInput, Note, Badge, Table, DateInput, Segmented } from '../../ui/components/index.js';
import { Crud, pctText, pctToBp } from './common.js';
import { call, tryCall, api } from '../../ui/api.js';
import { downloadBackupFile, saveBytes } from '../../ui/actions.js';
import { coll, truckLabel, backupAgeDays, monthLabel } from '../../ui/selectors.js';
import { normalizePlate, displayPlate, fmtDate, fmtMoney } from '../../core/index.js';
import { useToday } from '../../ui/screen-utils.js';

/* ---------- Firmă ---------- */
export function CompanySection() {
  const ctx = useCtx();
  const c = useSingleton('company');
  const [f, setF] = useState(null);
  useEffect(() => setF({ ...c }), [JSON.stringify(c)]);
  if (!f) return null;
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function save() {
    const patch = { name: f.name, cui: f.cui, vatPayer: !!f.vatPayer, countryCode: f.countryCode, reportingCurrency: f.reportingCurrency, noDocCeilingMinor: f.noDocCeilingMinor, noDocCeilingMonthlyPerTruckMinor: f.noDocCeilingMonthlyPerTruckMinor,
      overheadAllocation: f.overheadAllocation, profitIncludesDepreciation: !!f.profitIncludesDepreciation, excludeAutoPendingFromProfit: !!f.excludeAutoPendingFromProfit, homeBase: f.homeBase, longStopHours: Number(f.longStopHours) || 6 };
    if (f.revenueRecognition !== c.revenueRecognition) {
      const ok = await ctx.confirm({ title: 'Schimbi modul de recunoaștere a venitului?', body: 'Rapoartele lunilor deschise se vor schimba. Lunile închise rămân cu modul din închidere.', confirmLabel: 'Schimbă' });
      if (!ok) return;
      patch.revenueRecognition = f.revenueRecognition;
    }
    await ctx.store.setSingleton('company', patch);
    ctx.toast({ kind: 'ok', text: 'Setările firmei au fost salvate.' });
  }
  return html`<div class="stack"><${Card} title="Firma" right=${html`<${Button} onClick=${save}>${t.common.save}<//>`}>
    <div class="form-grid"><${TextInput} label="Nume" value=${f.name || ''} onInput=${(v) => set({ name: v })} /><${TextInput} label="CUI" value=${f.cui || ''} onInput=${(v) => set({ cui: v })} />
      <${Select} label="Țara firmei" value=${f.countryCode || 'RO'} onChange=${(v) => set({ countryCode: v })} options=${['RO', 'HU', 'DE', 'AT', 'IT', 'FR', 'ES', 'NL', 'BE', 'PL', 'BG', 'CZ', 'SK']} />
      <${Select} label="Moneda de raportare" value=${f.reportingCurrency || 'RON'} onChange=${(v) => set({ reportingCurrency: v })} options=${['RON', 'EUR']} />
      <${Select} label="Recunoașterea venitului" value=${f.revenueRecognition || 'prorata'} onChange=${(v) => set({ revenueRecognition: v })} options=${[{ value: 'prorata', label: 'Pro-rata pe zile (implicit)' }, { value: 'unload', label: 'La descărcare' }, { value: 'load', label: 'La încărcare' }]} />
      <${Select} label="Repartizarea costurilor comune" value=${f.overheadAllocation || 'daysInFleet'} onChange=${(v) => set({ overheadAllocation: v })} options=${[{ value: 'daysInFleet', label: 'Pe zile în flotă' }, { value: 'km', label: 'Pe km GPS' }, { value: 'equal', label: 'Egal' }]} />
      <${TextInput} label="Baza (depozit)" value=${f.homeBase || ''} onInput=${(v) => set({ homeBase: v })} /><${TextInput} label="Oprire lungă (ore)" inputMode="numeric" value=${f.longStopHours ?? 6} onInput=${(v) => set({ longStopHours: v })} /></div>
    <p class="muted sm">Cu repartizare pe zile, un camion care stă primește costuri comune la fel ca unul care lucrează. Cu repartizare pe km, un camion care stă primește zero.</p>
    <div class="form-grid"><${MoneyInput} label="Plafon „fără document” / tranzacție" value=${f.noDocCeilingMinor ?? null} currency="RON" onChange=${(v) => set({ noDocCeilingMinor: v })} />
      <${MoneyInput} label="Plafon „fără document” / lună / camion" value=${f.noDocCeilingMonthlyPerTruckMinor ?? null} currency="RON" onChange=${(v) => set({ noDocCeilingMonthlyPerTruckMinor: v })} /></div>
    <${Checkbox} label="Firma este plătitoare de TVA" checked=${f.vatPayer !== false} onChange=${(v) => set({ vatPayer: v })} />
    <${Checkbox} label="Profitul include amortizarea de management" checked=${f.profitIncludesDepreciation !== false} onChange=${(v) => set({ profitIncludesDepreciation: v })} />
    <${Checkbox} label="Exclude din profit sumele automate neconfirmate" checked=${!!f.excludeAutoPendingFromProfit} onChange=${(v) => set({ excludeAutoPendingFromProfit: v })} />
    <p class="muted sm">Luna închisă până la: <b>${c.closedThrough ? monthLabel(c.closedThrough) : 'nimic încă'}</b> (se schimbă din De verificat › Închiderea lunii).</p><//>
    <${Crud} col="roVatRates" title="Cota TVA România pe perioade" help="Cota standard se aplică după data de început. 19% → 21% la 01.08.2025." idPrefix="rvr"
      blank=${() => ({ from: '2025-08-01', standardBp: 2100, reducedBp: [1100] })} sortBy=${(a, b) => String(a.from).localeCompare(b.from)}
      columns=${[{ key: 'f', header: 'De la', render: (r) => fmtDate(r.from) }, { key: 's', header: 'Cota standard', align: 'r', render: (r) => pctText(r.standardBp) + '%' }, { key: 'r', header: 'Reduse', render: (r) => (r.reducedBp || []).map(pctText).join(', ') + '%' }]}
      fields=${[{ key: 'from', label: 'De la', type: 'date' }, { key: 'standardBp', label: 'Cota standard', type: 'bp' }, { key: 'reducedBp', label: 'Cote reduse', type: 'bplist' }]}
      validate=${(r) => (r.from && r.standardBp != null ? {} : { from: 'Obligatoriu', standardBp: 'Obligatoriu' })} /></div>`;
}

/* ---------- Camioane, remorci, șoferi ---------- */
export function FleetSection() {
  const entries = useCollection('entries'), courses = useCollection('courses');
  const trucks = useCollection('trucks'), trailers = useCollection('trailers');
  return html`<div class="stack">
    <${Crud} col="trucks" title="Camioane" idPrefix="trk" help="Plăcuța se normalizează: „XX 00 DEM” se salvează ca XX00DEM și se afișează XX 00 DEM. Intrarea în / ieșirea din flotă afectează costurile comune (nu în lunile închise)."
      blank=${() => ({ plate: '', name: '', model: '', year: null, activeFrom: null, activeTo: null, normFuelL100: null, notes: '' })}
      sortBy=${(a, b) => String(a.plate).localeCompare(b.plate)}
      normalize=${(r) => ({ ...r, plate: normalizePlate(r.plate), plateDisplay: displayPlate(normalizePlate(r.plate)) })}
      validate=${(r, orig, all) => { const e = {}; if (!r.plate) e.plate = 'Plăcuța este obligatorie'; else if (all.some((x) => x.id !== (orig && orig.id) && normalizePlate(x.plate) === r.plate)) e.plate = 'Există deja un camion cu această plăcuță'; return e; }}
      usedBy=${(r) => entries.filter((e) => e.target && e.target.truckId === r.id).length + courses.filter((c) => c.truckId === r.id).length} archiveKey="archived"
      columns=${[{ key: 'p', header: 'Camion', render: (r) => html`<span class="plate">${r.plateDisplay || displayPlate(r.plate)}</span>${r.archived ? html` <${Badge}>arhivat<//>` : null}` }, { key: 'm', header: 'Model', render: (r) => r.model || '' }, { key: 'y', header: 'An', render: (r) => r.year || '' },
        { key: 'f', header: 'În flotă', render: (r) => (r.activeFrom ? fmtDate(r.activeFrom) : '—') + (r.activeTo ? ' → ' + fmtDate(r.activeTo) : '') }]}
      fields=${[{ key: 'plate', label: 'Plăcuță', hint: 'ex. XX 00 DEM' }, { key: 'name', label: 'Nume intern' }, { key: 'model', label: 'Model' }, { key: 'year', label: 'An', type: 'number' }, { key: 'activeFrom', label: 'În flotă din', type: 'date' }, { key: 'activeTo', label: 'Ieșit din flotă', type: 'date' }, { key: 'normFuelL100', label: 'Normă consum (L/100 km)', type: 'number' }, { key: 'notes', label: 'Note' }]} />
    <${Crud} col="trailers" title="Remorci" idPrefix="trl" blank=${() => ({ plate: '', type: '', activeFrom: null, activeTo: null })}
      normalize=${(r) => ({ ...r, plate: normalizePlate(r.plate), plateDisplay: displayPlate(normalizePlate(r.plate)) })}
      validate=${(r, o, all) => (!r.plate ? { plate: 'Obligatoriu' } : all.some((x) => x.id !== (o && o.id) && normalizePlate(x.plate) === r.plate) ? { plate: 'Există deja' } : {})}
      columns=${[{ key: 'p', header: 'Remorcă', render: (r) => r.plateDisplay || displayPlate(r.plate) }, { key: 't', header: 'Tip', render: (r) => r.type || '' }]}
      fields=${[{ key: 'plate', label: 'Plăcuță' }, { key: 'type', label: 'Tip' }, { key: 'activeFrom', label: 'Din', type: 'date' }, { key: 'activeTo', label: 'Până la', type: 'date' }]} />
    <${Crud} col="trailerAssignments" title="Atribuiri remorcă → camion" help="Costul remorcii merge la camionul căruia îi este atribuită pe date. Fără atribuire = cost comun." idPrefix="tra"
      blank=${() => ({ trailerId: trailers[0] && trailers[0].id, truckId: trucks[0] && trucks[0].id, from: null, to: null })}
      columns=${[{ key: 'r', header: 'Remorcă', render: (r) => (trailers.find((x) => x.id === r.trailerId) || {}).plateDisplay || '—' }, { key: 't', header: 'Camion', render: (r) => truckLabel(trucks.find((x) => x.id === r.truckId)) }, { key: 'f', header: 'Perioadă', render: (r) => fmtDate(r.from || '') + ' → ' + (r.to ? fmtDate(r.to) : 'prezent') }]}
      fields=${[{ key: 'trailerId', label: 'Remorcă', type: 'select', options: trailers.map((x) => ({ value: x.id, label: x.plateDisplay || x.plate })) }, { key: 'truckId', label: 'Camion', type: 'select', options: trucks.map((x) => ({ value: x.id, label: truckLabel(x) })) }, { key: 'from', label: 'De la', type: 'date' }, { key: 'to', label: 'Până la', type: 'date' }]}
      validate=${(r) => (r.trailerId && r.truckId && r.from ? {} : { from: 'Completează remorca, camionul și data de început' })} />
    <${Crud} col="drivers" title="Șoferi" idPrefix="drv" blank=${() => ({ name: '', aliases: [], active: true })} usedBy=${(r) => courses.filter((c) => c.driverId === r.id).length} archiveKey="archived"
      columns=${[{ key: 'n', header: 'Nume', render: (r) => r.name }, { key: 'a', header: 'Alias-uri', render: (r) => (r.aliases || []).join(', ') }, { key: 'x', header: 'Activ', render: (r) => (r.active === false ? 'nu' : 'da') }]}
      fields=${[{ key: 'name', label: 'Nume (ca în tabelul de curse)' }, { key: 'aliases', label: 'Alias-uri', type: 'list' }, { key: 'active', label: 'Activ', type: 'checkbox' }]} validate=${(r) => (r.name ? {} : { name: 'Obligatoriu' })} />
    <${Crud} col="financing" title="Finanțare (leasing / credit) per camion" idPrefix="fin" help="Leasing operațional: rata întreagă e cost. Leasing financiar / credit / cumpărare: dobânda e cost, principalul rămâne în afara profitului, plus amortizare de management liniară."
      blank=${() => ({ truckId: trucks[0] && trucks[0].id, type: 'operational', valueMinor: null, currency: 'RON', startDate: null, endDate: null, residualMinor: 0, usefulLifeMonths: 60 })}
      columns=${[{ key: 't', header: 'Camion', render: (r) => truckLabel(trucks.find((x) => x.id === r.truckId)) }, { key: 'ty', header: 'Tip', render: (r) => r.type }, { key: 'v', header: 'Valoare', align: 'r', render: (r) => (r.valueMinor == null ? '—' : fmtMoney(r.valueMinor, r.currency || 'RON')) }, { key: 's', header: 'Început', render: (r) => fmtDate(r.startDate || '') }]}
      fields=${[{ key: 'truckId', label: 'Camion', type: 'select', options: trucks.map((x) => ({ value: x.id, label: truckLabel(x) })) }, { key: 'type', label: 'Tip', type: 'select', options: ['operational', 'financial', 'credit', 'cash'] }, { key: 'valueMinor', label: 'Valoare (în unități minore, ex. bani)', type: 'number' }, { key: 'currency', label: 'Valută' },
        { key: 'residualMinor', label: 'Valoare reziduală (minor)', type: 'number' }, { key: 'usefulLifeMonths', label: 'Durată utilizare (luni)', type: 'number' }, { key: 'startDate', label: 'Început', type: 'date' }, { key: 'endDate', label: 'Sfârșit', type: 'date' }]}
      validate=${(r) => { const v = tryCall('validateFinancing', [r], null); return v && v.length ? { truckId: v.map((x) => x.message || x).join(' ') } : {}; }} /></div>`;
}

/* ---------- Categorii ---------- */
export function CategoriesSection() {
  const entries = useCollection('entries');
  return html`<${Crud} col="categories" title="Categorii" idPrefix="cat" help="TVA implicit și deductibilitatea se aplică automat la cheltuielile noi. Deductibilitatea combustibilului (50% / 100%): verifică cu contabilul."
    blank=${() => ({ name: '', group: '', kind: 'expense', varKm: false, personnel: false, accountCode: '', defaultVat: { treatment: 'taxed', deductiblePct: 100 }, order: 99, archived: false })}
    sortBy=${(a, b) => (a.order || 0) - (b.order || 0)} usedBy=${(r) => entries.filter((e) => e.categoryId === r.id).length}
    columns=${[{ key: 'n', header: 'Categorie', render: (r) => html`${r.name}${r.archived ? html` <${Badge}>arhivată<//>` : null}` }, { key: 'k', header: 'Tip', render: (r) => r.kind }, { key: 'v', header: 'Km variabil', render: (r) => (r.varKm ? 'da' : '') },
      { key: 'd', header: 'TVA implicit', render: (r) => `${t.vat[(r.defaultVat || {}).treatment] || '—'}${(r.defaultVat || {}).deductiblePct != null ? ' · ' + r.defaultVat.deductiblePct + '%' : ''}` }, { key: 'a', header: 'Cont', render: (r) => r.accountCode || '' }]}
    fields=${[{ key: 'name', label: 'Nume' }, { key: 'group', label: 'Grupă' }, { key: 'kind', label: 'Tip', type: 'select', options: [{ value: 'expense', label: 'Cheltuială' }, { value: 'income', label: 'Venit' }, { value: 'recovery', label: 'Recuperare' }] },
      { key: 'varKm', label: 'Cost variabil pe km (combustibil, taxe drum…)', type: 'checkbox' }, { key: 'personnel', label: 'Personal (nu admite „fără document”)', type: 'checkbox' }, { key: 'accountCode', label: 'Cont contabil' },
      { key: 'defaultVat.treatment', label: 'TVA implicit', type: 'select', options: Object.entries(t.vat).map(([value, label]) => ({ value, label })) }, { key: 'defaultVat.deductiblePct', label: 'TVA deductibil %', type: 'number' }, { key: 'order', label: 'Ordine', type: 'number' }, { key: 'archived', label: 'Arhivată', type: 'checkbox' }]}
    validate=${(r) => (r.name ? {} : { name: 'Obligatoriu' })} />`;
}

/* ---------- Țări & TVA ---------- */
export function CountriesSection() {
  return html`<div class="stack"><${Note} kind="warn"><b>Verifică cotele.</b> ${t.vatWarn} Schimbarea unei cote nu modifică intrările existente (valorile sunt înghețate).<//>
    <${Crud} col="countries" title="Țări și cote TVA" idPrefix="cty" addLabel="Adaugă țară"
      blank=${() => ({ code: '', name: '', currency: 'EUR', standardBp: 2000, reducedBp: [], nonRefundableGroups: [], refundDeadlineMmDd: '09-30', isEu: true, verifiedAt: null, note: '' })} sortBy=${(a, b) => (a.code === 'RO' ? -1 : b.code === 'RO' ? 1 : a.code.localeCompare(b.code))}
      normalize=${(r) => ({ ...r, code: String(r.code || '').toUpperCase(), __id: String(r.code || '').toUpperCase() })}
      validate=${(r, o, all) => (!r.code ? { code: 'Obligatoriu' } : r.standardBp == null ? { standardBp: 'Obligatoriu' } : !o.id && all.some((x) => x.code === r.code) ? { code: 'Există deja' } : {})}
      columns=${[{ key: 'c', header: 'Țara', render: (r) => `${r.code} · ${r.name}` }, { key: 's', header: 'Standard', align: 'r', render: (r) => pctText(r.standardBp) + '%' }, { key: 'r', header: 'Reduse', render: (r) => (r.reducedBp || []).map(pctText).join(', ') }, { key: 'm', header: 'Valută', render: (r) => r.currency }, { key: 'v', header: 'Verificat la', render: (r) => (r.verifiedAt ? fmtDate(r.verifiedAt) : html`<${Badge} kind="warn">neverificat<//>`) }]}
      fields=${[{ key: 'code', label: 'Cod (ex. DE)' }, { key: 'name', label: 'Nume' }, { key: 'currency', label: 'Valută' }, { key: 'standardBp', label: 'Cota standard', type: 'bp' }, { key: 'reducedBp', label: 'Cote reduse', type: 'bplist' }, { key: 'nonRefundableGroups', label: 'Grupe de cheltuieli nerambursabile', type: 'list', hint: 'ex. combustibil' },
        { key: 'refundDeadlineMmDd', label: 'Termen rambursare (LL-ZZ)' }, { key: 'isEu', label: 'Țară UE', type: 'checkbox' }, { key: 'verifiedAt', label: 'Cotele verificate la', type: 'date' }, { key: 'note', label: 'Notă' }]} /></div>`;
}

/* ---------- Valute ---------- */
export function CurrenciesSection() {
  const ctx = useCtx();
  const [xml, setXml] = useState('');
  const [msg, setMsg] = useState(null);
  const fxCfg = useSingleton('fx');
  async function pasteBnr() {
    try {
      const r = await ctx.fx.importBnrXml(xml);
      setMsg(`Importat: ${r.rates} cursuri pe ${r.days} zile (${r.from} → ${r.to}).`); setXml('');
    } catch (e) { setMsg('XML invalid: ' + e.message); }
  }
  async function checkNow() {
    try { const today = new Date(ctx.clock.now()).toISOString().slice(0, 10); const r = await ctx.fx.getRate('EUR', today); setMsg(`EUR → RON: ${r.ronPerUnit} (${r.source}, ${r.rateDate})${r.stale ? ' · vechi / estimat' : ''}`); }
    catch (e) { setMsg(e.message); }
  }
  return html`<div class="stack"><${Card} title="Cursuri de schimb">
    <p class="muted">Cursul contabil implicit este <b>BNR</b>, introdus prin lipirea fișierului XML BNR (anual, apoi lunar la nevoie). Frankfurter (BCE) este rezervă marcată „indicativ”.</p>
    <${Checkbox} label="Permite interogarea automată Frankfurter (BCE): se trimit doar codul monedei și data" checked=${fxCfg.enabled !== false} onChange=${(v) => ctx.store.setSingleton('fx', { enabled: v })} />
    <div class="field"><label for="bnr-xml">Lipește XML BNR (de ex. fișierul anual)</label><textarea id="bnr-xml" class="inp" rows="4" value=${xml} onInput=${(e) => setXml(e.currentTarget.value)}></textarea></div>
    <div class="toolbar"><${Button} onClick=${pasteBnr} disabled=${!xml.trim()}>Importă cursurile<//><${Button} kind="sec" onClick=${checkNow}>Verifică cursurile acum<//></div>${msg ? html`<${Note}>${msg}<//>` : null}<//>
    <${Crud} col="currencies" title="Valute" idPrefix="cur" blank=${() => ({ code: '', name: '', exp: 2, enabled: true, symbol: '' })} normalize=${(r) => ({ ...r, code: String(r.code || '').toUpperCase(), __id: String(r.code || '').toUpperCase() })}
      columns=${[{ key: 'c', header: 'Cod', render: (r) => r.code }, { key: 'n', header: 'Nume', render: (r) => r.name }, { key: 'e', header: 'Zecimale', align: 'r', render: (r) => r.exp }, { key: 'a', header: 'Activă', render: (r) => (r.enabled === false ? 'nu' : 'da') }]}
      fields=${[{ key: 'code', label: 'Cod ISO' }, { key: 'name', label: 'Nume' }, { key: 'exp', label: 'Zecimale (HUF = 0)', type: 'number' }, { key: 'symbol', label: 'Simbol' }, { key: 'enabled', label: 'Activă', type: 'checkbox' }]} validate=${(r) => (/^[A-Z]{3}$/.test(r.code) ? {} : { code: 'Cod de 3 litere' })} /></div>`;
}

/* ---------- Scadențe (A) ---------- */
export function ExpiriesSection() {
  const ctx = useCtx();
  const today = useToday();
  const trucks = useCollection('trucks'), trailers = useCollection('trailers'), drivers = useCollection('drivers');
  const kinds = tryCall('EXPIRY_KINDS', [], null);
  const list = useStore((s) => tryCall('expiryList', [s, today], []));
  const kindOpts = ['itp', 'rca', 'casco', 'tahograf', 'rovinieta', 'permis', 'card_tahograf', 'other'];
  const subjects = [...trucks.map((x) => ({ value: 'truck:' + x.id, label: 'Camion ' + truckLabel(x) })), ...trailers.map((x) => ({ value: 'trailer:' + x.id, label: 'Remorcă ' + (x.plateDisplay || x.plate) })), ...drivers.map((x) => ({ value: 'driver:' + x.id, label: 'Șofer ' + x.name }))];
  function exportIcs() {
    try { const ics = call('buildIcs', ctx.store.state(), { nowIso: new Date().toISOString(), today }); saveBytes(new TextEncoder().encode(ics), 'scadente-flota.ics', 'text/calendar;charset=utf-8'); }
    catch (e) { ctx.toast({ kind: 'error', text: e.apiName ? t.errors.missingApi(e.apiName) : e.message }); }
  }
  return html`<div class="stack"><${Note}>Alertele apar pe Acasă la 30 / 15 / 7 zile și după scadență. Exportă un calendar <b>.ics</b> pentru mementouri în telefon. Fără e-mail sau notificări push.<//>
    <${Crud} col="expiries" title="Scadențe (ITP, RCA, CASCO, tahograf, rovinietă, permis)" idPrefix="exp" extra=${html`<div class="toolbar"><${Button} sm kind="sec" icon="download" onClick=${exportIcs}>Export calendar (.ics)<//></div>`}
      blank=${() => ({ subject: subjects[0] ? subjects[0].value : '', kind: 'itp', label: '', dueDate: null, note: '', active: true })}
      prep=${(r) => ({ ...r, subject: r.subjectType ? r.subjectType + ':' + r.subjectId : r.subject })}
      normalize=${(r) => { const [subjectType, subjectId] = String(r.subject || '').split(':'); const { subject, ...rest } = r; return { ...rest, subjectType, subjectId }; }}
      validate=${(r) => (!r.dueDate ? { dueDate: 'Obligatorie' } : !r.subjectId ? { subject: 'Alege subiectul' } : {})}
      columns=${[{ key: 's', header: 'Subiect', render: (r) => (subjects.find((x) => x.value === r.subjectType + ':' + r.subjectId) || {}).label || r.subjectId }, { key: 'k', header: 'Tip', render: (r) => (kinds && kinds[r.kind] && kinds[r.kind].label) || r.label || r.kind }, { key: 'd', header: 'Scadență', render: (r) => fmtDate(r.dueDate || '') }, { key: 'x', header: 'Stare', render: (r) => { const x = list.find((y) => y.id === r.id); return x ? html`<${Badge} kind=${x.daysLeft < 0 ? 'bad' : x.daysLeft <= 30 ? 'warn' : 'neutral'}>${x.text}<//>` : r.renewedAt ? 'reînnoită' : ''; } }]}
      fields=${[{ key: 'subject', label: 'Camion / remorcă / șofer', type: 'select', options: subjects }, { key: 'kind', label: 'Tip', type: 'select', options: kindOpts }, { key: 'label', label: 'Denumire (dacă „other”)' }, { key: 'dueDate', label: 'Scadența', type: 'date' }, { key: 'note', label: 'Notă' }]} /></div>`;
}

/* ---------- Alias-uri locuri ---------- */
export function AliasesSection() {
  return html`<${Crud} col="aliases" title="Alias-uri locuri (tabel de curse ↔ adrese GPS)" idPrefix="als" help="Ex. „MEDIESU AURIT” = „Medieșu Aurit”. Potrivirile confirmate din Confruntare se salvează aici."
    blank=${() => ({ name: '', locality: '', countryCode: null, confirmed: true })}
    normalize=${(r) => { const m = api('makeAlias'); if (!m) return r; const a = m({ name: r.name, locality: r.locality, countryCode: r.countryCode || null, now: new Date().toISOString() }); return { ...a, __id: a.id }; }}
    columns=${[{ key: 'n', header: 'Nume din tabel', render: (r) => r.name }, { key: 'l', header: 'Localitate GPS', render: (r) => r.locality }, { key: 'c', header: 'Țara', render: (r) => r.countryCode || '' }]}
    fields=${[{ key: 'name', label: 'Nume în tabelul de curse' }, { key: 'locality', label: 'Localitate în GPS' }, { key: 'countryCode', label: 'Cod țară (opțional)' }]} validate=${(r) => (r.name && r.locality ? {} : { name: 'Completează ambele nume' })} />`;
}

/* ---------- Integrări ---------- */
export function IntegrationsSection() {
  const ctx = useCtx();
  const fxCfg = useSingleton('fx');
  const auth = ctx.auth;
  const blocked = ctx.sharedOrigin && !ctx.sharedOrigin.accepted;
  const hasId = !!(ctx.config && ctx.config.googleClientId);
  async function toGoogle() {
    const ok = await ctx.confirm({ title: 'Treci la Google?', body: 'Datele din modul local nu se unesc automat cu cele din Drive. Descarcă mai întâi un backup JSON dacă vrei să le păstrezi. Aplicația se reîncarcă și îți cere să te conectezi.', confirmLabel: 'Treci la Google' });
    if (ok) ctx.switchToGoogle();
  }
  return html`<div class="stack"><${Card} title="Google (stocare în Drive)">
    ${ctx.mode === 'google' ? html`<p>Cont: <b>${auth && auth.user ? auth.user.email : 'neconectat'}</b></p><p class="muted sm">Datele sunt într-un fișier din folderul ascuns de aplicație din Google Drive. O conectare pe zi este normală: nu există reîmprospătare nesupravegheată. „Delete hidden app data” din Drive șterge datele: fă backup JSON periodic.</p>
      <div class="toolbar">${auth && auth.user ? html`<${Button} kind="sec" onClick=${() => ctx.signOut()}>Deconectare<//>` : html`<${Button} onClick=${() => auth && auth.signIn()}>Conectează Google<//>`}</div>`
      : !hasId ? html`<${Note}>Mod local (demo): nu există Client ID Google în <code>config.js</code>. Pașii pentru crearea lui sunt în <code>docs/GOOGLE-SETUP.md</code>. Datele rămân în acest browser.<//>`
      : blocked ? html`<${Note} kind="warn">Mod local: Client ID Google există în <code>config.js</code>, dar originea <code>${location.hostname}</code> este partajată cu alte site-uri GitHub Pages și Google e oprit până setezi <code>acceptSharedOrigin: true</code> în <code>config.js</code> (vezi <code>docs/GOOGLE-SETUP.md</code>).<//>`
      : html`<${Note}>Ești în mod local (alegerea „Continuă fără Google”). Google este configurat în <code>config.js</code>: datele rămân în acest browser până treci la Google.<//>
        <div class="toolbar"><${Button} onClick=${toGoogle}>Treci la Google<//></div>`}<//>
    <${Card} title="Servicii externe contactate"><ul>
      <li><b>Google</b> (autentificare, Drive): doar în modul Google.</li><li><b>Frankfurter / BCE</b>: se trimit doar codul monedei și data. ${fxCfg.enabled === false ? html`<${Badge} kind="neutral">oprit<//>` : html`<${Badge} kind="ok">pornit<//>`}</li>
      <li><b>OSRM / Nominatim (OpenStreetMap)</b>: se trimit doar numele locurilor, la calculul km pe rută.</li></ul>
      <p class="muted sm">SafeFleet: doar import de exporturi Excel (fără API). Viitor: dacă SafeFleet oferă un API documentat cu CORS, un adaptor se poate adăuga în spatele aceleiași structuri de date.</p><//></div>`;
}

/* ---------- Date ---------- */
export function DataSection() {
  const ctx = useCtx();
  const ui = useSingleton('ui');
  const bench = useSingleton('benchmarks');
  const company = useSingleton('company');
  const [persisted, setPersisted] = useState(null);
  const [bm, setBm] = useState({ avg: bench.avgEmptyPct ?? 20, target: bench.targetEmptyPct ?? 5 });
  const [size, setSize] = useState(null);
  useEffect(() => { try { navigator.storage && navigator.storage.persisted && navigator.storage.persisted().then(setPersisted); navigator.storage && navigator.storage.estimate && navigator.storage.estimate().then((e) => setSize(e.usage)); } catch { /* ignorat */ } }, []);
  const counts = useStore((s) => ({ trucks: coll(s, 'trucks').length, entries: coll(s, 'entries').length, courses: coll(s, 'courses').length, gps: coll(s, 'gpsDays').length }));
  const days = backupAgeDays(ui.lastBackupAt, ctx.clock.now());
  async function restore(file) {
    if (!file) return;
    try {
      const r = call('parseBackup', await file.text());
      if (!r.ok) { ctx.toast({ kind: 'error', text: r.error }); return; }
      const plan = tryCall('planRestore', [ctx.store.exportDoc(), r.doc], null);
      const word = 'RESTAUREAZĂ';
      const typed = window.prompt(`Restaurarea înlocuiește datele curente (${plan ? JSON.stringify(plan.counts.current) : ''}) cu cele din backup (${plan ? JSON.stringify(plan.counts.incoming) : ''}). Se salvează întâi un backup. Scrie ${word} pentru a confirma:`);
      if (typed !== word) return;
      await downloadBackupFile(ctx);
      await ctx.store.replaceDoc(r.doc, { reason: 'restore', newEpoch: true });
      // insigna „date demo” se ia din backup (un backup făcut din date demo rămâne marcat demo)
      const wasDemo = !!((r.doc.meta && r.doc.meta.demo) || (r.doc.singletons && r.doc.singletons.ui && r.doc.singletons.ui.isDemo));
      await ctx.store.setSingleton('ui', { welcomeDone: true, isDemo: wasDemo });
      ctx.toast({ kind: 'ok', text: 'Backup restaurat (epocă nouă).' });
    } catch (e) { ctx.toast({ kind: 'error', text: e.message }); }
  }
  async function resetDemo() {
    const ok = await ctx.confirm({ title: 'Resetezi la datele demo?', body: 'Toate datele curente se înlocuiesc cu seed-ul demo (FICTIV). Se descarcă mai întâi un backup.', confirmLabel: 'Resetează', danger: true });
    if (!ok) return;
    await downloadBackupFile(ctx);
    await ctx.store.replaceDoc(call('buildDemoDb'), { reason: 'demo-reset', newEpoch: true });
    await ctx.store.setSingleton('ui', { welcomeDone: true, isDemo: true });
  }
  async function clearDemo() {
    const ok = await ctx.confirm({ title: 'Începi cu date reale (gol)?', body: 'Datele demo se șterg. Se descarcă mai întâi un backup.', confirmLabel: 'Golește', danger: true });
    if (!ok) return;
    await downloadBackupFile(ctx);
    try {
      await ctx.store.replaceDoc(call('buildEmptyDb'), { reason: 'clear', newEpoch: true });
    } catch (e) { ctx.toast({ kind: 'error', text: 'Nu s-au putut goli datele: ' + e.message }); return; }
    // insigna dispare numai după ce datele au fost înlocuite
    await ctx.store.setSingleton('ui', { welcomeDone: true, isDemo: false });
    ctx.toast({ kind: 'ok', text: 'Datele demo au fost șterse.' });
  }
  const sync = ctx.sync && ctx.sync.status ? ctx.sync.status() : null;
  return html`<div class="stack">
    <${Card} title="Backup JSON"><p class=${days == null || days > 7 ? 'neg' : ''}>${t.banners.backupAge(days)}</p>
      <div class="toolbar"><${Button} icon="download" onClick=${() => downloadBackupFile(ctx)}>Descarcă backup<//><label class="btn sec" style="cursor:pointer">Restaurează din backup<input class="vh" type="file" accept=".json,application/json" onChange=${(e) => restore(e.currentTarget.files[0])} /></label></div>
      <p class="muted sm">Restaurarea cere confirmare tastată și creează o epocă nouă: o restaurare dintr-un backup vechi rămâne restaurată.</p><//>
    <${Card} title="Stocare"><div class="kvgrid"><div><span>Mod</span><span>${ctx.mode === 'google' ? 'Google Drive' : 'Local (demo)'}</span></div><div><span>Stocare persistentă</span><span>${persisted == null ? '—' : persisted ? 'da' : 'nu'}</span></div>
      <div><span>Spațiu folosit</span><span>${size == null ? '—' : (size / 1048576).toFixed(1).replace('.', ',') + ' MB'}</span></div><div><span>Camioane / intrări / curse / zile GPS</span><span>${counts.trucks} / ${counts.entries} / ${counts.courses} / ${counts.gps}</span></div>
      <div><span>Dispozitiv</span><span>${ctx.store.deviceId}</span></div><div><span>Versiune aplicație</span><span>${ctx.config.appVersion || 'dev'}</span></div>${sync ? html`<div><span>Sincronizare</span><span>${sync.state}${sync.dirty ? ' · ' + sync.dirty + ' nesincronizate' : ''}</span></div>` : null}</div>
      ${ctx.store.db && ctx.store.db.volatile ? html`<${Note} kind="warn">${t.banners.memoryOnly}<//>` : null}<//>
    <${Card} title="Repere km pe gol" right=${html`<${Button} sm onClick=${() => ctx.store.setSingleton('benchmarks', { avgEmptyPct: Number(String(bm.avg).replace(',', '.')), targetEmptyPct: Number(String(bm.target).replace(',', '.')), label: 'orientativ, sursă comercială' }).then(() => ctx.toast({ kind: 'ok', text: 'Reperele au fost salvate.' }))}>${t.common.save}<//>`}>
      <div class="form-grid"><${TextInput} label="Medie (%)" inputMode="decimal" value=${bm.avg} onInput=${(v) => setBm({ ...bm, avg: v })} /><${TextInput} label="Țintă (%)" inputMode="decimal" value=${bm.target} onInput=${(v) => setBm({ ...bm, target: v })} /></div>
      <p class="muted sm">Etichetate mereu „orientativ, sursă comercială”.</p><//>
    <${Card} title="Accesibilitate"><${Checkbox} label="Taste rapide dintr-o singură tastă (n, v, E, Del)" checked=${ui.hotkeys !== false} onChange=${(v) => ctx.store.setSingleton('ui', { hotkeys: v })} /><p class="muted sm">Dezactivează-le dacă folosești tastatura pentru dictare sau un cititor de ecran.</p><//>
    <${Card} title="Date demo">${ui.isDemo ? html`<p><span class="demo-badge">${t.demoBadge}</span> Datele curente sunt fictive.</p>` : null}
      <div class="toolbar"><${Button} kind="sec" onClick=${resetDemo}>Resetează demo<//><${Button} kind="sec" onClick=${clearDemo}>Începe gol<//></div><//></div>`;
}
