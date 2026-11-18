// domain/closing.js: închiderea lunii (plan 5.9, D13).
//
// Stare: `company.closedThrough` (Month) + o `Closure` per lună închisă (id = Month). O lună închisă are totaluri,
// mod de recunoaștere și baza de alocare (zile în flotă pe camion) ÎNGHEȚATE, plus un `snapshotHash` al datelor
// financiare ale lunii; dacă recalcularea diferă, `verifyClosure` semnalează „luna închisă s-a schimbat”.
// Garduri: `guardClosedRecord` / `redirectToOpenMonth` sunt folosite de entry/import/generator (store.guardClosed).
//
// Straturi: importă doar `core` și `./financing.js`. Starea se primește ca argument; scrierile se fac prin `store`.
// `closeMonth` poate primi `o.compute(state, month, {recognition, basis})` de la `profit.js` pentru ca totalurile
// înghețate să fie EXACT cele ale rapoartelor; implicit folosește calculul de aici (aceleași reguli 5.4/5.5).

import { addMonths, eachMonth, isIsoDate, monthKey, monthRange, overlapDays, eachDay } from '../core/dates.js';
import { allocate, allocateFair } from '../core/money.js';
import { fnv1a64Hex } from '../core/hash.js';
import { newId } from '../core/ids.js';
import { foldKey } from '../core/text.js';
import { depreciationByTruck } from './financing.js';

// ---------------------------------------------------------------------------------------------
// Accesori
// ---------------------------------------------------------------------------------------------

function colOf(state, name) {
  const c = state?.collections?.[name] ?? state?.[name];
  if (!c) return [];
  if (Array.isArray(c)) return c;
  if (c instanceof Map) return [...c.values()];
  return Object.values(c);
}
const live = (arr) => arr.filter((r) => r && !r.deletedAt);
const companyOf = (state) => state?.singletons?.company ?? state?.company ?? {};
const accrualOf = (e) => e.accrualMonth ?? (e.date ? monthKey(e.date) : '');
const prevMonth = (m) => monthKey(addMonths(`${m}-01`, -1));
const nextMonth = (m) => monthKey(addMonths(`${m}-01`, 1));
const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const closureActive = (c) => c && !c.deletedAt && c.status !== 'reopened';

// ---------------------------------------------------------------------------------------------
// Garduri pentru luni închise
// ---------------------------------------------------------------------------------------------

/** `month` ≤ `company.closedThrough`? */
export function isMonthClosed(company, month) {
  return !!(company && company.closedThrough && month && month <= company.closedThrough);
}

/** Prima lună deschisă (după `closedThrough`), sau `fallback` când nu există nicio lună închisă. */
export function firstOpenMonth(company, fallback = null) {
  return company?.closedThrough ? nextMonth(company.closedThrough) : fallback;
}

/** null dacă înregistrarea se poate scrie; altfel `{ code:'CLOSED_MONTH', month }`. Câmpurile de metadate nu sunt vizate aici. */
export function guardClosedRecord(company, rec) {
  const m = accrualOf(rec);
  return isMonthClosed(company, m) ? { code: 'CLOSED_MONTH', month: m } : null;
}

/** „Înregistrează în luna curentă, aferent lunii X”: accrualMonth = prima lună deschisă, relatesTo = X. */
export function redirectToOpenMonth(rec, company) {
  const m = accrualOf(rec);
  if (!isMonthClosed(company, m)) return rec;
  return { ...rec, accrualMonth: firstOpenMonth(company), relatesTo: m };
}

// ---------------------------------------------------------------------------------------------
// Venitul lunar al unei curse (5.4)
// ---------------------------------------------------------------------------------------------

/**
 * Luni și sume în care o cursă își recunoaște venitul net (RON): [{ month, minor }].
 * `prorata`: ponderi egale pe zilele [loadDate, unloadDate], restul pe ultima zi; `unload` / `load`: toată cursa într-o lună.
 */
export function revenueByMonth(course, mode = 'prorata') {
  const net = course?.ron?.net ?? 0;
  const load = course?.loadDate || course?.unloadDate;
  const unload = course?.unloadDate || course?.loadDate;
  if (!net || !load) return [];
  if (mode === 'unload') return [{ month: monthKey(unload), minor: net }];
  if (mode === 'load') return [{ month: monthKey(load), minor: net }];
  const to = unload < load ? load : unload;
  const days = eachDay(load, to);
  const parts = allocate(net, days.map(() => 1));
  const acc = new Map();
  days.forEach((d, i) => acc.set(monthKey(d), (acc.get(monthKey(d)) || 0) + parts[i]));
  return [...acc].map(([month, minor]) => ({ month, minor }));
}

/** Venitul net al cursei alocat lunii `month` (RON, minor). Test de aur: 28.10–02.11, 6.000,01 ⇒ oct 4.000,00 / nov 2.000,01. */
export function monthlyRevenue(course, mode, month) {
  const hit = revenueByMonth(course, mode).find((x) => x.month === month);
  return hit ? hit.minor : 0;
}

// ---------------------------------------------------------------------------------------------
// Totaluri lunare (aceleași reguli ca în 5.4 / 5.5), folosite pentru Closure
// ---------------------------------------------------------------------------------------------

/** Zile active în flotă ale fiecărui camion în `month`: { [truckId]: zile } (doar > 0). */
export function fleetDaysBasis(trucks, month) {
  const range = monthRange(month);
  const basis = {};
  for (const t of live(trucks)) {
    const from = t.activeFrom && t.activeFrom > range.from ? t.activeFrom : range.from;
    const to = t.activeTo && t.activeTo < range.to ? t.activeTo : range.to;
    const n = overlapDays({ from, to }, range);
    if (n > 0) basis[t.id] = n;
  }
  return basis;
}

/** Cota lunii `month` dintr-o intrare cu `spread` (Month..Month) sau întreaga valoare dacă `accrualMonth` = lună. */
function shareForMonth(e, value, month) {
  if (e.spread && e.spread.from && e.spread.to) {
    const months = eachMonth(e.spread.from, e.spread.to);
    const idx = months.indexOf(month);
    if (idx < 0) return 0;
    return allocate(value, months.map(() => 1))[idx];
  }
  return accrualOf(e) === month ? value : 0;
}

/** Camionul căruia îi aparține intrarea (trailer ⇒ camionul atribuit la dată; altfel null = cost comun). */
function truckOfEntry(e, assignments) {
  const t = e.target || {};
  if (t.type === 'truck' && t.truckId) return t.truckId;
  if (t.type === 'trailer' && t.trailerId) {
    const a = assignments.find((x) => x.trailerId === t.trailerId && !x.deletedAt && x.from <= e.date && (!x.to || x.to >= e.date));
    return a ? a.truckId : null;
  }
  return null;
}

/**
 * Totalurile lunii: { totals:{ fleet:{revenue,cost,profit,...}, byTruck:{...} }, allocationBasis, fxSources,
 * provisionalCount, recognition, lines }. `lines` = liniile canonice pentru hash.
 */
export function computeMonthTotals(state, month, o = {}) {
  const company = companyOf(state);
  const recognition = o.recognition || company.revenueRecognition || 'prorata';
  const includeDep = company.profitIncludesDepreciation !== false;
  const excludeAuto = !!company.excludeAutoPendingFromProfit;
  const trucks = live(colOf(state, 'trucks'));
  const assignments = colOf(state, 'trailerAssignments');
  const basis = o.basis || fleetDaysBasis(trucks, month);

  const T = {};
  const tr = (id) => (T[id] ??= { revenue: 0, cost: 0, overhead: 0, depreciation: 0, cashOnly: 0, profit: 0 });
  for (const id of Object.keys(basis)) tr(id);
  let commonCost = 0, commonRevenue = 0, commonCash = 0, provisionalCount = 0;
  const fx = new Set();
  const lines = [];

  for (const c of live(colOf(state, 'courses'))) {
    const rev = monthlyRevenue(c, recognition, month);
    if (!rev) continue;
    if (c.truckId) tr(c.truckId).revenue += rev; else commonRevenue += rev;
    lines.push(`c|${c.id}|${c.truckId ?? ''}|${rev}`);
  }

  for (const e of live(colOf(state, 'entries'))) {
    if (e.parentDocId) continue; // detaliile consolidate nu se adună în costuri (5.2)
    if (e.status === 'auto_pending' && excludeAuto) continue;
    const isCash = e.costClass === 'cashOnly';
    if (e.kind === 'expense') {
      const cost = shareForMonth(e, e.ron?.cost ?? 0, month);
      if (!cost && accrualOf(e) !== month) continue;
      if (e.fx?.source) fx.add(e.fx.source);
      if (e.status === 'auto_pending') provisionalCount++;
      const tid = truckOfEntry(e, assignments);
      if (isCash) {
        const cash = shareForMonth(e, e.ron?.gross ?? 0, month);
        if (tid) tr(tid).cashOnly += cash; else commonCash += cash;
        lines.push(`k|${e.id}|${tid ?? ''}|${cash}`);
        continue;
      }
      if (tid) tr(tid).cost += cost; else commonCost += cost;
      lines.push(`e|${e.id}|${tid ?? ''}|${cost}|${e.status}`);
    } else if (e.kind === 'income' && accrualOf(e) === month) {
      const net = e.ron?.net ?? 0;
      const tid = truckOfEntry(e, assignments);
      if (e.fx?.source) fx.add(e.fx.source);
      if (e.incomeType === 'recovery') {
        // recuperările scad costul (nu sunt venit)
        if (tid) tr(tid).cost -= net; else commonCost -= net;
        lines.push(`r|${e.id}|${tid ?? ''}|${net}`);
      } else if (e.incomeType === 'other') {
        if (tid) tr(tid).revenue += net; else commonRevenue += net;
        lines.push(`i|${e.id}|${tid ?? ''}|${net}`);
      }
    }
  }

  // costuri comune ⇒ camioane, o singură regulă (daysInFleet / equal; „km” cere o.kmByTruck)
  let unallocatedOverhead = 0;
  const ids = Object.keys(basis);
  const mode = company.overheadAllocation || 'daysInFleet';
  if (commonCost !== 0) {
    if (!ids.length) unallocatedOverhead = commonCost;
    else {
      let weights = ids.map((id) => basis[id]);
      if (mode === 'equal') weights = ids.map(() => 1);
      else if (mode === 'km' && o.kmByTruck) {
        const w = ids.map((id) => Math.max(0, Math.round(o.kmByTruck[id] || 0))); // money-ok: nu sunt bani (afișare, km, procente sau pondere)
        if (w.some((x) => x > 0)) weights = w;
      }
      const shares = allocateFair(commonCost, weights, `close:${month}`);
      ids.forEach((id, i) => { tr(id).overhead += shares[i]; });
    }
  }

  const dep = depreciationByTruck(live(colOf(state, 'financing')), month);
  if (includeDep) for (const [id, v] of Object.entries(dep.byTruck)) { tr(id).depreciation += v; lines.push(`d|${id}|${v}`); }

  let revenue = commonRevenue, cost = unallocatedOverhead, depreciation = 0, cashOnly = commonCash;
  for (const [id, t] of Object.entries(T)) {
    t.profit = t.revenue - t.cost - t.overhead - t.depreciation;
    revenue += t.revenue; cost += t.cost + t.overhead + t.depreciation; depreciation += t.depreciation; cashOnly += t.cashOnly;
    void id;
  }
  const totals = {
    fleet: { revenue, cost, profit: revenue - cost, depreciation, cashOnly, unallocatedOverhead },
    byTruck: T,
  };
  lines.push(`b|${Object.entries(basis).sort().map(([k, v]) => `${k}:${v}`).join(',')}`);
  return {
    totals,
    allocationBasis: basis,
    fxSources: [...fx].sort(),
    provisionalCount,
    recognition,
    lines: lines.sort(),
  };
}

/** Hash al datelor financiare ale lunii (nu include note / metadate editabile în lună închisă). */
export function snapshotHashFor(state, month, o = {}) {
  const r = computeMonthTotals(state, month, o);
  return fnv1a64Hex([`m|${month}`, `r|${r.recognition}`, ...r.lines].join('\n'));
}

// ---------------------------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------------------------

const ref = (type, id) => ({ type, id });

/**
 * Lista de verificare la închidere. [{ code, severity:'info'|'warn'|'error', refs, count, message }].
 * `o.today` (IsoDate) activează verificarea „luna nu s-a încheiat”.
 * Erorile blochează închiderea; avertismentele se pot confirma explicit.
 */
export function closingChecklist(state, month, o = {}) {
  const out = [];
  const add = (code, severity, message, refs = []) => out.push({ code, severity, message, refs, count: refs.length || 1 });
  const company = companyOf(state);
  if (!isMonth(month)) { add('BAD_MONTH', 'error', 'Lună invalidă.'); return out; }

  if (company.closedThrough) {
    if (month <= company.closedThrough) add('ALREADY_CLOSED', 'error', `Luna ${month} este deja închisă.`);
    else if (month !== nextMonth(company.closedThrough)) add('NOT_SEQUENTIAL', 'error', `Închide mai întâi luna ${nextMonth(company.closedThrough)}.`);
  }
  if (o.today && isIsoDate(o.today) && monthRange(month).to >= o.today) {
    add('MONTH_NOT_ENDED', 'error', `Luna ${month} nu s-a încheiat încă.`);
  }

  const entries = live(colOf(state, 'entries')).filter((e) => accrualOf(e) === month);
  const pend = entries.filter((e) => e.status === 'pending');
  const auto = entries.filter((e) => e.status === 'auto_pending');
  const flagged = entries.filter((e) => e.status === 'flagged');
  if (pend.length) add('PENDING_ENTRIES', 'warn', `${pend.length} intrări de verificat.`, pend.map((e) => ref('entry', e.id)));
  if (auto.length) add('AUTO_PENDING_ENTRIES', 'warn', `${auto.length} intrări automate neconfirmate.`, auto.map((e) => ref('entry', e.id)));
  if (flagged.length) add('FLAGGED_ENTRIES', 'warn', `${flagged.length} intrări semnalate.`, flagged.map((e) => ref('entry', e.id)));

  const stale = entries.filter((e) => e.fx && (e.fx.stale || e.fx.source === 'last-known'));
  if (stale.length) add('STALE_FX', 'warn', `${stale.length} sume cu curs vechi / estimat.`, stale.map((e) => ref('entry', e.id)));

  // „fără document”: peste plafon ⇒ justificare obligatorie (5.4)
  const perTx = company.noDocCeilingMinor, perTruck = company.noDocCeilingMonthlyPerTruckMinor;
  const nodoc = entries.filter((e) => e.kind === 'expense' && e.documentation === 'none');
  const bad = new Set();
  if (perTx != null) for (const e of nodoc) if ((e.ron?.gross ?? 0) > perTx && !e.justification) bad.add(e.id);
  if (perTruck != null) {
    const sums = new Map();
    for (const e of nodoc) { const k = e.target?.truckId ?? ''; sums.set(k, (sums.get(k) || 0) + (e.ron?.gross ?? 0)); }
    for (const e of nodoc) if (sums.get(e.target?.truckId ?? '') > perTruck && !e.justification) bad.add(e.id);
  }
  if (bad.size) add('NODOC_NO_JUSTIFICATION', 'error', `${bad.size} cheltuieli fără document peste plafon, fără justificare.`, [...bad].map((id) => ref('entry', id)));

  // curse
  const courses = live(colOf(state, 'courses'));
  const inMonth = courses.filter((c) => revenueByMonth(c, company.revenueRecognition || 'prorata').some((x) => x.month === month)
    || (c.unloadDate && monthKey(c.unloadDate) === month));
  const noPrice = inMonth.filter((c) => c.priceStatus === 'missing');
  if (noPrice.length) add('COURSE_PRICE_MISSING', 'warn', `${noPrice.length} curse fără preț.`, noPrice.map((c) => ref('course', c.id)));
  const noInvoice = inMonth.filter((c) => c.priceStatus !== 'missing' && !c.invoiceNo);
  if (noInvoice.length) add('COURSES_NO_INVOICE', 'info', `${noInvoice.length} curse fără număr de factură.`, noInvoice.map((c) => ref('course', c.id)));

  // locuri nerezolvate folosite de cursele lunii
  const used = new Set();
  for (const c of inMonth) for (const p of [c.origin, ...(c.destinations || [])]) if (p) used.add(foldKey(p));
  const unresolved = live(colOf(state, 'places')).filter((p) => p.confirmed === false
    && [p.key, ...(p.aliases || [])].some((k) => k && used.has(foldKey(k))));
  if (unresolved.length) add('PLACES_UNRESOLVED', 'warn', `${unresolved.length} locuri nerezolvate.`, unresolved.map((p) => ref('place', p.id)));

  // camioane active fără GPS în lună (doar dacă există date GPS în sistem)
  const gps = live(colOf(state, 'gpsDays'));
  if (gps.length) {
    const withGps = new Set(gps.filter((g) => g.date && monthKey(g.date) === month).map((g) => g.truckId));
    const basis = fleetDaysBasis(colOf(state, 'trucks'), month);
    const missing = Object.keys(basis).filter((id) => !withGps.has(id));
    if (missing.length) add('TRUCK_NO_GPS', 'warn', `${missing.length} camioane fără date GPS în lună.`, missing.map((id) => ref('truck', id)));
  }

  if (!out.some((x) => x.severity !== 'info')) add('OK', 'info', 'Nicio problemă găsită.');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scrieri
// ---------------------------------------------------------------------------------------------

function writeBatch(store, label, ops, source = 'generator') {
  if (typeof store.batch === 'function') {
    return Promise.resolve(store.batch(label, (tx) => {
      for (const { col, rec } of ops) {
        if (tx && typeof tx.put === 'function') tx.put(col, rec); else store.put(col, rec, { source });
      }
    }, { source }));
  }
  return (async () => { for (const { col, rec } of ops) await store.put(col, rec, { source }); })();
}

const getClosure = (state, month) => colOf(state, 'closures').find((c) => c.id === month) ?? null;

/**
 * Închide luna. `o = { ackWarnings, today?, now?, deviceId?, compute? }`.
 * Întoarce sincron { ok, closure?, reason?, checklist }; scrierea e în `done` (Promise).
 * reason: 'errors' (erori blochează) | 'needs-ack' (avertismente neconfirmate).
 */
export function closeMonth(store, month, o = {}) {
  const state = store.state();
  const checklist = closingChecklist(state, month, o);
  if (checklist.some((x) => x.severity === 'error')) return { ok: false, reason: 'errors', checklist, done: Promise.resolve() };
  if (checklist.some((x) => x.severity === 'warn') && !o.ackWarnings) {
    return { ok: false, reason: 'needs-ack', checklist, done: Promise.resolve() };
  }
  const now = o.now ?? new Date().toISOString();
  const company = companyOf(state);
  const calc = o.compute
    ? o.compute(state, month, { recognition: company.revenueRecognition || 'prorata', basis: fleetDaysBasis(colOf(state, 'trucks'), month) })
    : computeMonthTotals(state, month);
  const base = computeMonthTotals(state, month, { recognition: calc.recognition, basis: calc.allocationBasis });
  const prev = getClosure(state, month);
  const closure = {
    id: month,
    month,
    closedAt: now,
    status: 'closed',
    recognition: calc.recognition ?? base.recognition,
    fxSources: calc.fxSources ?? base.fxSources,
    allocationBasis: calc.allocationBasis ?? base.allocationBasis,
    totals: calc.totals ?? base.totals,
    snapshotHash: fnv1a64Hex([`m|${month}`, `r|${base.recognition}`, ...base.lines].join('\n')),
    provisionalCount: base.provisionalCount,
    checklist: checklist.map((x) => ({ code: x.code, severity: x.severity, count: x.count })),
    reopened: prev?.reopened ?? [],
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: o.deviceId ?? 'local',
    createdBy: 'admin',
  };
  const audit = {
    id: newId('aud'), createdAt: now, updatedAt: now, updatedBy: o.deviceId ?? 'local', createdBy: 'admin',
    type: 'month-close', month, warnings: checklist.filter((x) => x.severity === 'warn').map((x) => x.code),
  };
  const done = (async () => {
    await writeBatch(store, 'Închide luna', [{ col: 'closures', rec: closure }, { col: 'audit', rec: audit }]);
    if (typeof store.setSingleton === 'function') await store.setSingleton('company', { closedThrough: month, updatedAt: now });
  })();
  done.catch(() => {});
  return { ok: true, closure, checklist, done };
}

/**
 * Redeschide luna (și toate cele de după ea): motiv obligatoriu (≥ 3 caractere), `closedThrough` scade,
 * `Closure.reopened` se completează, intrare în `audit`. Închiderile redeschise rămân ca istoric (status 'reopened').
 */
export function reopenMonth(store, month, reason, o = {}) {
  const state = store.state();
  const company = companyOf(state);
  const why = String(reason ?? '').trim();
  if (why.length < 3) return { ok: false, reason: 'reason-required', done: Promise.resolve() };
  if (!isMonthClosed(company, month)) return { ok: false, reason: 'not-closed', done: Promise.resolve() };
  const now = o.now ?? new Date().toISOString();
  const affected = colOf(state, 'closures').filter((c) => closureActive(c) && c.id >= month);
  const ops = affected.map((c) => ({
    col: 'closures',
    rec: { ...c, status: 'reopened', reopened: [...(c.reopened || []), { at: now, reason: why, from: month }], updatedAt: now, updatedBy: o.deviceId ?? 'local' },
  }));
  ops.push({ col: 'audit', rec: {
    id: newId('aud'), createdAt: now, updatedAt: now, updatedBy: o.deviceId ?? 'local', createdBy: 'admin',
    type: 'month-reopen', month, reason: why, reopenedMonths: affected.map((c) => c.id),
  } });
  const p = prevMonth(month);
  const prevClosed = colOf(state, 'closures').some((c) => c.id === p && closureActive(c) && c.id < month);
  const closedThrough = prevClosed ? p : null;
  const done = (async () => {
    await writeBatch(store, 'Redeschide luna', ops);
    if (typeof store.setSingleton === 'function') await store.setSingleton('company', { closedThrough, updatedAt: now });
  })();
  done.catch(() => {});
  return { ok: true, closedThrough, reopenedMonths: affected.map((c) => c.id), done };
}

/**
 * Verifică o lună închisă: recalculează hash-ul cu `recognition` și baza din `Closure`.
 * { ok, closed, expected, actual } — `ok:false` ⇒ semnal „luna închisă s-a schimbat” în calitatea datelor.
 */
export function verifyClosure(state, month) {
  const c = getClosure(state, month);
  if (!closureActive(c)) return { ok: true, closed: false, expected: null, actual: null };
  const actual = snapshotHashFor(state, month, { recognition: c.recognition, basis: c.allocationBasis });
  return { ok: actual === c.snapshotHash, closed: true, expected: c.snapshotHash, actual };
}

/** Totalurile înghețate ale unei luni închise (sau null dacă luna nu e închisă). */
export function closedTotals(state, month) {
  const c = getClosure(state, month);
  return closureActive(c) ? c.totals : null;
}

/** Anul se poate închide (doar-citire, mutat în fișierul anual, 3.5) când toate cele 12 luni sunt închise. */
export function yearClosable(company, year) {
  return !!company?.closedThrough && company.closedThrough >= `${year}-12`;
}
