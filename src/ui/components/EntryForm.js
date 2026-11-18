// Formular în două niveluri pentru cheltuială/venit (8.3). Folosit de ecranul „Cheltuială nouă / Venit nou”,
// de panoul lateral global (n / v / Alt+Shift+D) și de rândul rapid din listă. Calculele sunt în domeniu (vat/entry/fx).
import { html, useState, useEffect, useMemo, useRef } from '../dom.js';
import { t } from '../strings.js';
import { useCtx, useCollection, useSingleton, useStore, useHotkeys } from '../hooks.js';
import { Field, Select, TextInput, DateInput, MoneyInput, Combobox, Checkbox, Segmented } from './forms.js';
import { Button, Badge } from './display.js';
import { Icon } from './icons.js';
import { api, tryCall } from '../api.js';
import { quickDefaults, supplierHints, truckLabel, monthOfEntry, coll, shiftMonth, pickCategories } from '../selectors.js';
import { convert, fmtMoney, fmtRate, todayLocal, monthKey, mulDiv, fmtPct } from '../../core/index.js';

const DEFAULT_CURRENCIES = ['RON', 'EUR', 'HUF', 'PLN', 'CZK', 'BGN', 'USD', 'GBP', 'CHF'];
const TREAT = ['taxed', 'none', 'zero', 'nondeductible', 'reverse'];

/** Starea inițială a formularului, din valori implicite inteligente + `initial`. */
export function initialForm({ kind, state, today, initial }) {
  const company = (state.singletons && state.singletons.company) || state.company || {};
  const entries = coll(state, 'entries');
  const d = quickDefaults(entries, kind);
  const cats = pickCategories(coll(state, 'categories'), kind, kind === 'recovery' ? 'recovery' : 'other');
  const cat = cats.find((c) => c.id === d.categoryId) || cats[0];
  const dv = (cat && cat.defaultVat) || {};
  return {
    date: today, docDate: null, truckId: d.truckId ?? '', categoryId: cat ? cat.id : '', currency: d.currency || company.reportingCurrency || 'RON',
    minor: null, entered: 'gross', countryCode: d.countryCode || company.countryCode || 'RO', documentation: d.documentation || 'invoice',
    treatment: dv.treatment || 'taxed', rateBp: null, deductiblePct: dv.deductiblePct ?? 100, supplier: '', docNo: '', note: '',
    payment: d.payment || 'card', moneySource: 'company', justification: '', liters: '', rateText: '', incomeType: kind === 'recovery' ? 'recovery' : 'other', multi: false, truckIds: [],
    ...(initial || {}),
  };
}

function useFormData() {
  return {
    categories: useCollection('categories'), countries: useCollection('countries'), trucks: useCollection('trucks'),
    currencies: useCollection('currencies'), company: useSingleton('company'), entries: useCollection('entries'),
  };
}

export function EntryForm({ kind = 'expense', initial, onSaved, onCancel, compact }) {
  const ctx = useCtx();
  const { store, fx, clock } = ctx;
  const data = useFormData();
  const today = todayLocal(clock);
  const [f, setF] = useState(() => initialForm({ kind, state: store.state(), today, initial }));
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const [rate, setRate] = useState(null); // RateResult
  const [rateErr, setRateErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!compact) { const el = document.getElementById('entry-amount'); if (el) el.focus(); } }, []); // cursorul pe sumă (tastatură întâi)

  const cats = pickCategories(data.categories, kind, f.incomeType);
  const cat = data.categories.find((c) => c.id === f.categoryId);
  const country = data.countries.find((c) => c.code === f.countryCode);
  const curList = (data.currencies.length ? data.currencies.filter((c) => c.enabled !== false).map((c) => c.code) : DEFAULT_CURRENCIES);
  const company = data.company;
  const taxedLike = f.treatment === 'taxed' || f.treatment === 'reverse';

  // cota implicită a țării, la schimbarea țării / datei
  const rates = useMemo(() => {
    if (!country) return [];
    return [country.standardBp, ...(country.reducedBp || [])].filter((x, i, a) => x != null && a.indexOf(x) === i);
  }, [country]);
  useEffect(() => {
    if (!country) return;
    const std = tryCall('defaultRateFor', [f.countryCode, f.date, data.countries, company], null);
    set({ rateBp: std ? std.standardBp : country.standardBp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.countryCode, f.date, country && country.id]);

  // cursul: automat (fx.getRate), manual dacă s-a tastat
  useEffect(() => {
    let alive = true;
    setRateErr(null);
    if (f.rateText && f.currency !== 'RON') {
      try { setRate(fx.fromManual(f.currency, f.docDate || f.date, f.rateText.replace(',', '.'), 'manual')); } catch (e) { setRateErr(e.message); }
      return undefined;
    }
    if (!fx || !fx.getRate) { setRate(null); return undefined; }
    Promise.resolve(fx.getRate(f.currency, f.docDate || f.date)).then(
      (r) => alive && setRate(r),
      (e) => { if (alive) { setRate(null); setRateErr(e && e.message ? e.message : 'Curs indisponibil'); } },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.currency, f.date, f.docDate, f.rateText]);

  // calcul live (net / TVA / brut) – numai prin domeniu; fără el, doar suma introdusă
  const calc = useMemo(() => {
    if (f.minor == null) return null;
    if (!taxedLike || f.rateBp == null) return { gross: f.minor, net: f.minor, vat: 0 };
    return tryCall('splitAmounts', [{ entered: f.entered, minor: f.minor, rateBp: f.rateBp }], { gross: f.minor, net: f.minor, vat: 0 });
  }, [f.minor, f.entered, f.rateBp, taxedLike]);
  const ronEq = useMemo(() => {
    if (!calc || !rate) return null;
    try { return f.currency === 'RON' ? calc.gross : convert(calc.gross, f.currency, 'RON', rate.ronPerUnit); } catch { return null; }
  }, [calc, rate, f.currency]);

  const onCategory = (id) => {
    const c = data.categories.find((x) => x.id === id);
    const dv = (c && c.defaultVat) || {};
    set({ categoryId: id, ...(f.documentation === 'none' ? {} : { treatment: dv.treatment || f.treatment, deductiblePct: dv.deductiblePct ?? f.deductiblePct }) });
  };
  const onIncomeType = (v) => {
    const list = pickCategories(data.categories, 'income', v);
    set({ incomeType: v, categoryId: list.some((c) => c.id === f.categoryId) ? f.categoryId : (list[0] ? list[0].id : '') });
  };
  const onSupplier = (v) => {
    const h = supplierHints(data.entries, v, kind === 'income' ? 'income' : 'expense');
    set({ supplier: v, ...(h && !f.touchedCat ? { categoryId: h.categoryId || f.categoryId, countryCode: h.countryCode || f.countryCode } : {}) });
  };
  const onDocumentation = (d) => set({ documentation: d, ...(d === 'none' ? { treatment: 'none' } : {}) });

  const summary = [f.countryCode, taxedLike && f.rateBp != null ? `TVA ${fmtPct(f.rateBp / 10000, f.rateBp % 100 ? 1 : 0)}` : t.vat[f.treatment], f.currency === 'RON' ? 'lei' : f.currency, t.payments[f.payment] || ''].filter(Boolean).join(' · ');

  async function save(keep) {
    if (busy) return;
    setBusy(true);
    try {
      const errs = {};
      if (f.minor == null || f.minor <= 0) errs.minor = f.minor == null ? t.errors.required : 'Suma trebuie să fie pozitivă';
      if (!f.categoryId) errs.categoryId = t.errors.required;
      if (!f.date) errs.date = t.errors.required;
      if (f.currency !== 'RON' && !rate) errs.rate = 'Fără curs: introdu cursul manual (RON per ' + f.currency + ')';
      if (cat && cat.personnel && f.documentation === 'none') errs.documentation = 'Cheltuielile de personal nu pot fi fără document';
      if (Object.keys(errs).length) { setErrors(errs); if (errs.rate || errs.documentation) setOpen(true); return; }

      const r = rate || { ronPerUnit: '1', eurPerUnit: '1', rateDate: f.date, source: 'ron', manual: false, stale: false };
      const input = {
        kind: kind === 'recovery' ? 'income' : kind, date: f.date, docDate: f.docDate, truckId: f.truckId || null, targetType: f.truckId || f.multi ? 'truck' : 'company',
        categoryId: f.categoryId, supplier: f.supplier.trim(), docNo: f.docNo.trim(), note: f.note.trim(), documentation: f.documentation, countryCode: f.countryCode,
        vat: { treatment: f.documentation === 'none' ? 'none' : f.treatment, rateBp: taxedLike ? f.rateBp : null, deductiblePct: Number(f.deductiblePct) },
        currency: f.currency, entered: f.entered, minor: f.minor, payment: f.payment, moneySource: f.moneySource, justification: f.justification.trim() || null,
        incomeType: kind === 'income' ? f.incomeType : kind === 'recovery' ? 'recovery' : null,
        fuel: f.liters ? { ml: Math.round(Number(String(f.liters).replace(',', '.')) * 1000), odoM: null } : null,
        status: 'confirmed', source: keep ? 'quick' : 'manual',
      };
      const st = store.state();
      const bctx = { company, countries: data.countries, categories: data.categories, rate: r, now: new Date().toISOString() };
      let list;
      if (f.multi && f.truckIds.length > 1) list = call('splitAcrossTrucks', input, f.truckIds, f.truckIds.map(() => 1), bctx);
      else list = [call('buildEntry', input, bctx)];

      // lună închisă ⇒ propunere „în luna curentă, aferent lunii X”
      for (let i = 0; i < list.length; i++) {
        const g = store.guardClosed && store.guardClosed(list[i]);
        if (g) {
          const ok = await ctx.confirm({ title: t.errors.closedMonth, body: `Luna ${g.month} este închisă. Înregistrezi suma în luna curentă, aferentă lunii ${g.month}?`, confirmLabel: 'Înregistrează în luna curentă' });
          if (!ok) return;
          const open1 = shiftMonth(company.closedThrough, 1);
          list = list.map((e) => ({ ...e, relatesTo: monthOfEntry(e), accrualMonth: open1 }));
          break;
        }
      }
      const verr = [];
      for (const e of list) for (const x of tryCall('validateEntry', [e, { company, categories: data.categories }], [])) verr.push(x);
      if (verr.length) {
        const m = {};
        verr.forEach((x) => { m[fieldOf(x.field)] = x.message; });
        setErrors(m); setOpen(true); return;
      }
      const res = await (list.length > 1 ? store.putMany('entries', list) : store.put('entries', list[0]));
      ctx.toast({ kind: 'ok', text: `Salvat: ${fmtMoney(f.minor, f.currency)}${f.currency !== 'RON' && ronEq != null ? ' · ' + fmtMoney(ronEq, 'RON') : ''}`, actionLabel: t.common.undo, onAction: () => res && res.undo && res.undo() });
      setErrors({});
      if (keep) { set({ minor: null, docNo: '', note: '', supplier: '', liters: '', rateText: '' }); setTimeout(() => { const el = document.getElementById('entry-amount'); el && el.focus(); }, 0); }
      else onSaved && onSaved(list);
    } catch (e) {
      ctx.toast({ kind: 'error', text: e && e.apiName ? t.errors.missingApi(e.apiName) : (e && e.message) || 'Eroare la salvare' });
    } finally { setBusy(false); }
  }
  useHotkeys({ 'Ctrl+Enter': () => save(true) }, [f, rate]);

  const trucksOpts = [{ value: '', label: 'Cost comun (firmă)' }, ...data.trucks.map((x) => ({ value: x.id, label: truckLabel(x) }))];
  const catOpts = cats.map((c) => ({ value: c.id, label: c.name, disabled: f.documentation === 'none' && c.personnel }));
  const isIncome = kind === 'income' || kind === 'recovery';

  if (compact) {
    return html`<form class="quick" onSubmit=${(e) => { e.preventDefault(); save(true); }} aria-label="Rând rapid">
      <${DateInput} label="Data" value=${f.date} onChange=${(v) => set({ date: v })} error=${errors.date} />
      <${Select} label="Camion" value=${f.truckId} onChange=${(v) => set({ truckId: v })} options=${trucksOpts} />
      <${Select} label="Categorie" value=${f.categoryId} onChange=${onCategory} options=${catOpts} placeholder="Alege…" error=${errors.categoryId} />
      <${MoneyInput} id="entry-amount" label="Sumă" value=${f.minor} currency=${f.currency} currencies=${curList} onChange=${(v) => set({ minor: v })} onCurrencyChange=${(c) => set({ currency: c })} error=${errors.minor || errors.rate || rateErr} />
      <${Button} type="submit" disabled=${busy} icon="plus">Adaugă<//>
      <div class="hintt" style="grid-column:1/-1">Valori implicite: <b>${summary}</b>${f.currency !== 'RON' && ronEq != null ? ' · ' + fmtMoney(ronEq, 'RON') : ''} · Enter adaugă și păstrează valorile</div></form>`;
  }
  return html`<form class="stack" style="gap:12px" onSubmit=${(e) => { e.preventDefault(); save(false); }} aria-label=${isIncome ? 'Venit nou' : 'Cheltuială nouă'}>
    ${isIncome ? html`<${Field} label="Tip venit"><${Segmented} value=${f.incomeType} onChange=${onIncomeType} options=${[{ value: 'other', label: 'Alt venit' }, { value: 'recovery', label: 'Recuperare' }]} /><//>
      <div class="note-box">Veniturile din transport vin din tabelul de curse. <button type="button" class="cell-link" onClick=${() => ctx.nav('/curse?nou=1')}>Adaugă o cursă</button></div>` : null}
    <div class="form-grid">
      <${DateInput} label="Data" value=${f.date} onChange=${(v) => set({ date: v })} error=${errors.date} />
      <${Select} label="Camion" value=${f.truckId} onChange=${(v) => set({ truckId: v })} options=${trucksOpts} />
      <${Select} label="Categorie" value=${f.categoryId} onChange=${onCategory} options=${catOpts} placeholder="Alege…" error=${errors.categoryId} />
    </div>
    <${MoneyInput} id="entry-amount" label=${'Sumă ' + ({ gross: 'brută', net: 'netă', vat: '(doar TVA)' }[f.entered] || '')} value=${f.minor} currency=${f.currency} currencies=${curList}
      onChange=${(v) => set({ minor: v })} onCurrencyChange=${(c) => set({ currency: c, minor: f.minor, rateText: '' })} error=${errors.minor} autoFocus=${!compact} />
    <div class="live" aria-live="polite" data-testid="live-calc">
      ${calc ? html`<span>net <b>${fmtMoney(calc.net, f.currency)}</b></span><span>TVA <b>${fmtMoney(calc.vat, f.currency)}</b></span><span>brut <b>${fmtMoney(calc.gross, f.currency)}</b></span>` : html`<span>Introdu suma pentru calcul net / TVA / lei.</span>`}
      ${f.currency !== 'RON' ? html`<span>${ronEq != null ? html`<b>${fmtMoney(ronEq, 'RON')}</b> la ${rate ? fmtRate(rate.ronPerUnit) : ''}` : 'fără curs'} ${rate ? html`<${RateBadge} rate=${rate} />` : null}</span>` : null}</div>
    ${errors.rate || rateErr ? html`<div class="note-box warn" role="alert">${errors.rate || rateErr}</div>` : null}

    <button type="button" class="summary-line" aria-expanded=${open} aria-controls="entry-details" onClick=${() => setOpen(!open)}>
      <${Icon} name=${open ? 'chev-down' : 'chev'} size="sm" /><span class="grow"><span class="vh">Detalii (valori implicite aplicate): </span>${summary}</span><span class="sm">${t.common.details}</span></button>
    ${open ? html`<div id="entry-details" class="stack" style="gap:12px">
      <div class="form-grid">
        <${Select} label="Țara" value=${f.countryCode} onChange=${(v) => set({ countryCode: v })} options=${data.countries.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
        <${Select} label="Documentare" value=${f.documentation} onChange=${onDocumentation} error=${errors.documentation}
          options=${[{ value: 'invoice', label: t.docs.invoice }, { value: 'receipt', label: t.docs.receipt }, { value: 'none', label: t.docs.none }]} />
        <${Select} label="TVA" value=${f.documentation === 'none' ? 'none' : f.treatment} onChange=${(v) => set({ treatment: v })} disabled=${f.documentation === 'none'}
          options=${TREAT.map((x) => ({ value: x, label: t.vat[x] }))} />
        ${taxedLike ? html`<${Select} label="Cota TVA" value=${String(f.rateBp ?? '')} onChange=${(v) => set({ rateBp: Number(v) })} options=${rates.map((r) => ({ value: String(r), label: fmtPct(r / 10000, r % 100 ? 1 : 0) }))} />
          <${Select} label="Introduci" value=${f.entered} onChange=${(v) => set({ entered: v })} options=${[{ value: 'gross', label: 'Suma brută' }, { value: 'net', label: 'Suma netă' }, { value: 'vat', label: 'Doar TVA' }]} />
          <${TextInput} label="TVA deductibil %" type="number" inputMode="numeric" value=${f.deductiblePct} onInput=${(v) => set({ deductiblePct: v })} hint="Verifică cu contabilul (ex. combustibil 50% / 100%)." />` : null}
        ${f.currency !== 'RON' ? html`<${TextInput} label=${`Curs (lei per 1 ${f.currency})`} inputMode="decimal" value=${f.rateText} onInput=${(v) => set({ rateText: v })} placeholder="automat" hint=${rate ? `${rate.source} · ${rate.rateDate}` : 'automat sau manual'} />` : null}
        <${DateInput} label="Data documentului" value=${f.docDate || ''} onChange=${(v) => set({ docDate: v })} hint="Cursul se ia la această dată." />
        <${Combobox} label="Furnizor" value=${f.supplier} onChange=${onSupplier} options=${[...new Set(data.entries.map((e) => e.supplier).filter(Boolean))].slice(0, 50)} />
        <${TextInput} label="Nr. document" value=${f.docNo} onInput=${(v) => set({ docNo: v })} />
        <${Select} label="Plată" value=${f.payment} onChange=${(v) => set({ payment: v })} options=${Object.entries(t.payments).map(([value, label]) => ({ value, label }))} />
        ${cat && (cat.varKm || /combustibil/i.test(cat.name)) ? html`<${TextInput} label="Litri" inputMode="decimal" value=${f.liters} onInput=${(v) => set({ liters: v })} />` : null}
      </div>
      ${f.documentation === 'none' ? html`<div class="form-grid"><${Select} label="Sursa banilor" value=${f.moneySource} onChange=${(v) => set({ moneySource: v })}
          options=${[{ value: 'company', label: 'Banii firmei' }, { value: 'driverAdvance', label: 'Avans șofer' }, { value: 'ownerPersonal', label: 'Bani personali' }]} />
        <${TextInput} label="Justificare (obligatorie peste plafon)" value=${f.justification} onInput=${(v) => set({ justification: v })} error=${errors.justification} /></div>` : null}
      <${TextInput} label="Notă" value=${f.note} onInput=${(v) => set({ note: v })} />
      ${!isIncome ? html`<${Checkbox} label="Împarte pe mai multe camioane" checked=${f.multi} onChange=${(v) => set({ multi: v })} />
        ${f.multi ? html`<div class="opts">${data.trucks.map((x) => html`<button type="button" class="opt" aria-pressed=${f.truckIds.includes(x.id)} onClick=${() => set({ truckIds: f.truckIds.includes(x.id) ? f.truckIds.filter((i) => i !== x.id) : [...f.truckIds, x.id] })}>${truckLabel(x)}</button>`)}</div>` : null}` : null}
    </div>` : null}

    <div class="toolbar form-actions">
      <${Button} type="submit" disabled=${busy}>${t.common.save}<//>
      <${Button} kind="sec" class="hide-phone" onClick=${() => save(true)} disabled=${busy} title="Ctrl+Enter">Salvează și rămâi (Ctrl+Enter)<//>
      ${onCancel ? html`<${Button} kind="ghost" onClick=${onCancel}>${t.common.cancel}<//>` : null}
    </div></form>`;
}

function call(name, ...args) {
  const fn = api(name);
  if (!fn) { const e = new Error('MissingApi: ' + name); e.apiName = name; throw e; }
  return fn(...args);
}
function fieldOf(f) {
  return ({ 'orig.gross': 'minor', gross: 'minor', minor: 'minor', categoryId: 'categoryId', justification: 'justification', documentation: 'documentation', accrualMonth: 'date' })[f] || f || 'form';
}
export function RateBadge({ rate }) {
  if (!rate) return null;
  if (rate.manual) return html`<${Badge} kind="manual-fx">${t.badges['manual-fx']}<//>`;
  if (rate.stale) return html`<${Badge} kind="stale-fx">${t.badges['stale-fx']}<//>`;
  if (String(rate.source).startsWith('ecb')) return html`<${Badge} kind="ecb-fx">${t.badges['ecb-fx']}<//>`;
  return null;
}
