// domain/recurring.js: cheltuieli fixe / recurente (plan 5.6, 10.5).
//
// Principii: șablonul se definește o dată; intrările se generează automat, idempotent (id determinist),
// iar REGISTRUL DE OCURENȚE (`occurrences`) este sursa adevărului pentru „tratat” (generat / sărit / șters),
// nu prezența intrării. Editarea sau încheierea unui șablon nu modifică niciodată intrările din trecut.
//
// Straturi: importă doar `core` și `./entry.js` (TVA/curs). Nu importă `store`: primește store-ul ca argument.
// Mutațiile se fac prin `store.batch(label, tx => tx.put(col, rec), {source:'generator'})`
// (cu rezervă pe `store.put`), deci o singură tranzacție și un singur `store:changed`.

import { detId } from '../core/ids.js';
import { addMonths, clampDay, diffDays, eachMonth, isIsoDate, monthKey } from '../core/dates.js';
import { allocate, allocateFair, sum } from '../core/money.js';
import { buildEntry } from './entry.js';

/** Câte perioade lipsă acceptă un șablon într-o singură rulare fără confirmare (4.7 pct. 6). */
export const MAX_PERIODS_PER_RUN = 6;
/** Peste atâtea zile de la ultima sincronizare, un dispozitiv nu generează fără un pull reușit. */
export const STALE_DEVICE_DAYS = 90;
/** Toleranța ceasului față de data de referință (server / Drive), în zile. */
export const CLOCK_TOLERANCE_DAYS = 1;

const STEP = { monthly: 1, quarterly: 3, yearly: 12 };
const SPREAD_DEFAULT = { monthly: null, quarterly: 3, yearly: 12 };
const TREATED = new Set(['generated', 'skipped', 'deleted']);

// ---------------------------------------------------------------------------------------------
// Accesori de stare (toleranți la forma DbState: { collections:{..}, singletons:{..} } sau plată)
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
const nowIso = (o) => (o && o.now) || new Date().toISOString();

function stamp(rec, now, deviceId) {
  return {
    createdBy: 'admin',
    createdAt: now,
    updatedBy: deviceId ?? 'local',
    ...rec,
    updatedAt: now,
  };
}

function getRec(store, state, col, id) {
  const fromStore = typeof store.get === 'function' ? store.get(col, id) : null;
  if (fromStore) return fromStore;
  return colOf(state, col).find((r) => r.id === id) ?? null;
}

/** Scrie o listă de operații `{col, rec}` într-o singură tranzacție (rezervă: put secvențial). */
function commit(store, label, ops, o = {}) {
  if (!ops.length) return Promise.resolve();
  const opts = { source: 'generator', ...(o.storeOpts || {}) };
  if (typeof store.batch === 'function') {
    return Promise.resolve(
      store.batch(label, (tx) => {
        for (const { col, rec } of ops) {
          // `put` șterge `deletedAt` (reînvie înregistrarea): pietrele de mormânt trec prin `remove`, iar registrul de ocurențe
          // este scris explicit de apelant (noOccurrence), nu dedus de magazin
          if (rec.deletedAt && tx && typeof tx.remove === 'function') tx.remove(col, rec.id, { noOccurrence: true });
          else if (tx && typeof tx.put === 'function') tx.put(col, rec);
          else store.put(col, rec, opts);
        }
      }, opts),
    );
  }
  return (async () => {
    for (const { col, rec } of ops) await store.put(col, rec, opts);
  })();
}

/** Construiește {undo, done} dintr-o listă de operații; `before` = starea anterioară per înregistrare. */
function mutation(store, label, ops, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  const before = ops.map(({ col, rec }) => ({ col, id: rec.id, prev: getRec(store, state, col, rec.id) }));
  const done = commit(store, label, ops, o);
  done.catch(() => {}); // nu lăsa respingerea nepreluată; apelantul poate `await`-a `done`
  let undone = null;
  return {
    done,
    undo() {
      if (undone) return undone;
      const restore = before.map(({ col, id, prev }) => ({
        col,
        rec: prev ? { ...prev, updatedAt: nowIso({ now: o.undoNow ?? now }) }
          : { id, deletedAt: now, updatedAt: now },
      }));
      undone = done.then(() => commit(store, `${label} (anulare)`, restore, { ...o, storeOpts: { source: 'undo' } }));
      undone.catch(() => {});
      return undone;
    },
  };
}

const tombstone = (rec, now) => ({ ...rec, deletedAt: now, updatedAt: now });

// ---------------------------------------------------------------------------------------------
// Evenimente de șablon: versiuni, sărituri, încheiere
// ---------------------------------------------------------------------------------------------

const byUpdated = (a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function eventsOf(events, templateId) {
  return live(events || []).filter((e) => !templateId || !e.templateId || e.templateId === templateId);
}

/** Versiunile vii ale șablonului, sortate după perioadă (un singur eveniment per perioadă: ultimul). */
export function versionsOf(events, templateId) {
  const m = new Map();
  for (const e of eventsOf(events, templateId).filter((x) => x.type === 'version').sort(byUpdated)) m.set(e.period, e);
  return [...m.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

/** Data de final efectivă: ultimul eveniment `end` după updatedAt (endDate null = reactivare), altfel tpl.endDate. */
export function effectiveEndDate(tpl, events) {
  const ends = eventsOf(events, tpl.id).filter((x) => x.type === 'end').sort(byUpdated);
  if (ends.length) return ends[ends.length - 1].payload?.endDate ?? null;
  return tpl.endDate ?? null;
}

const skipPeriodsOf = (events, templateId) =>
  new Set(eventsOf(events, templateId).filter((x) => x.type === 'skip').map((x) => x.period));

/** Cheile de țintă (targetKey) ale unui șablon: câte o ocurență în registru per cheie. */
export function targetKeysFor(tpl) {
  const t = tpl.target || {};
  switch (t.type) {
    case 'truck': return t.truckIds?.length ? [t.truckIds[0]] : [];
    case 'trucks': return [...(t.truckIds || [])];
    case 'trailer': return t.trailerId ? [t.trailerId] : [];
    case 'fleet': return ['fleet'];
    case 'company': return ['company'];
    default: return [];
  }
}

export const occurrenceId = (tpl, period, targetKey) => detId('rec', tpl.id ?? tpl, period, targetKey);
export const occurrenceRecordId = (templateId, period, targetKey) => detId('occ', templateId, period, targetKey);

// ---------------------------------------------------------------------------------------------
// Planificare (pură)
// ---------------------------------------------------------------------------------------------

/**
 * Perioadele de generat până la `today` (inclusiv). Pur.
 * `events` = evenimentele șablonului (version / skip / end); implicit `tpl.events`.
 * Fiecare element: { period, date, versionIndex (-1 dacă nu există versiune), version (payload), versionFrom, skipped }.
 */
export function planOccurrences(tpl, today, events) {
  if (!tpl || tpl.active === false) return [];
  if (!isIsoDate(tpl.startDate) || !isIsoDate(today)) return [];
  const evs = events ?? tpl.events ?? [];
  const step = STEP[tpl.frequency] ?? 1;
  const startMonth = monthKey(tpl.startDate);
  const day = Number(tpl.dayOfMonth) || Number(tpl.startDate.slice(8, 10));
  const lower = [startMonth, tpl.backfillFrom, tpl.activatedMonth].filter(Boolean).reduce((a, b) => (a > b ? a : b));
  const end = effectiveEndDate(tpl, evs);
  const versions = versionsOf(evs, tpl.id);
  const skips = skipPeriodsOf(evs, tpl.id);
  const out = [];
  if (monthKey(today) < startMonth) return out;
  const months = eachMonth(startMonth, monthKey(today));
  for (let i = 0; i < months.length; i += step) {
    const period = months[i];
    if (period < lower) continue;
    const [y, m] = period.split('-').map(Number);
    const date = clampDay(y, m, day);
    if (date < tpl.startDate || date > today) continue;
    if (end && date > end) continue;
    let versionIndex = -1;
    for (let k = 0; k < versions.length; k++) if (versions[k].period <= period) versionIndex = k;
    const ver = versionIndex >= 0 ? versions[versionIndex] : null;
    out.push({
      period,
      date,
      versionIndex,
      version: ver ? ver.payload : null,
      versionFrom: ver ? ver.period : null,
      skipped: skips.has(period),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Materializare (pură): ocurență → intrări
// ---------------------------------------------------------------------------------------------

function activeOn(truck, date) {
  if (truck.deletedAt) return false;
  if (truck.activeFrom && truck.activeFrom > date) return false;
  if (truck.activeTo && truck.activeTo < date) return false;
  return true;
}

function spreadFor(tpl, period) {
  const months = tpl.spreadMonths ?? SPREAD_DEFAULT[tpl.frequency] ?? null;
  if (!months || months < 2) return null;
  const last = monthKey(addMonths(`${period}-01`, months - 1));
  return { from: period, to: last };
}

/**
 * Transformă o ocurență planificată în intrări (fără efecte). Pur.
 * `occ` = element din planOccurrences (+ opțional `targetKey` ca să se genereze doar o cheie).
 * ctx = { trucks, company, countries, categories, rateFor(cur,date)->RateResult, now, financing?, provisional?, deviceId? }
 */
export function materialize(tpl, occ, ctx) {
  const v = occ.version ?? ctx.version;
  if (!v) throw new Error(`Șablonul „${tpl.name}” nu are nicio versiune aplicabilă pentru ${occ.period}.`);
  const keys = occ.targetKey ? [occ.targetKey] : targetKeysFor(tpl);
  const fin = tpl.financingId ? (ctx.financing || []).find((f) => f.id === tpl.financingId) : null;
  const useComponents = Array.isArray(v.components) && v.components.length > 0 && !(fin && fin.type === 'operational');
  const rate = ctx.rateFor(v.currency, occ.date);
  const entries = [];

  for (const key of keys) {
    // 1) Părțile (țintele) acestei chei și suma fiecăreia
    let parts;
    const tt = tpl.target?.type;
    if (tt === 'fleet') {
      const trucks = (ctx.trucks || []).filter((t) => activeOn(t, occ.date)).sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!trucks.length) throw new Error(`Nu există camioane active la ${occ.date} pentru „${tpl.name}”.`);
      const shares = allocateFair(v.minor, trucks.map(() => 1), detId('fleet', tpl.id, occ.period));
      parts = trucks.map((t, i) => ({ entryKey: `fleet:${t.id}`, truckId: t.id, targetType: 'truck', minor: shares[i] }));
    } else if (tt === 'company') {
      parts = [{ entryKey: 'company', truckId: null, targetType: 'company', minor: v.minor }];
    } else if (tt === 'trailer') {
      parts = [{ entryKey: key, truckId: null, trailerId: key, targetType: 'trailer', minor: v.minor }];
    } else {
      // truck / trucks: suma per camion (perTruck) sau suma versiunii pentru fiecare camion
      const m = v.perTruck && v.perTruck[key] != null ? v.perTruck[key] : v.minor;
      parts = [{ entryKey: key, truckId: key, targetType: 'truck', minor: m }];
    }

    // 2) Subintrări: componente (principal / dobândă / comisioane) sau una singură
    const subs = [];
    for (const p of parts) {
      if (useComponents) {
        const split = allocate(p.minor, v.components.map((c) => c.minor));
        v.components.forEach((c, i) => subs.push({ ...p, kind: c.kind, minor: split[i], vat: c.vat ?? v.vat, suffix: c.kind }));
      } else {
        subs.push({ ...p, kind: null, vat: v.vat, suffix: null });
      }
    }
    const multi = subs.length > 1;
    for (const s of subs) {
      const id = occurrenceId(tpl, occ.period, s.suffix ? `${s.entryKey}:${s.suffix}` : s.entryKey);
      const input = {
        kind: 'expense',
        date: occ.date,
        truckId: s.truckId,
        targetType: s.targetType,
        categoryId: tpl.categoryId,
        supplier: tpl.supplier || '',
        docNo: '',
        note: s.kind ? `${tpl.name} (${LABEL[s.kind] || s.kind})` : tpl.name,
        documentation: tpl.documentation || 'invoice',
        countryCode: v.countryCode,
        vat: s.vat,
        currency: v.currency,
        entered: v.entered || 'gross',
        minor: s.minor,
        payment: tpl.payment ?? null,
        status: 'auto_pending',
        groupId: multi ? detId('grp', tpl.id, occ.period, key) : null,
        spread: spreadFor(tpl, occ.period),
        source: 'recurring',
        recurring: {
          templateId: tpl.id,
          period: occ.period,
          edited: false,
          versionFrom: occ.versionFrom ?? v.versionFrom ?? occ.period,
          provisional: !!ctx.provisional,
          targetKey: key,
        },
      };
      const e = buildEntry(input, {
        company: ctx.company,
        countries: ctx.countries,
        categories: ctx.categories,
        rate,
        now: ctx.now,
        id,
      });
      // câmpuri pe care EntryInput nu le acoperă
      e.moneySource = tpl.moneySource || 'company';
      e.costClass = s.kind === 'principal' ? 'cashOnly' : 'cost';
      if (s.targetType === 'trailer') e.target = { ...(e.target || {}), type: 'trailer', trailerId: s.trailerId, truckId: null };
      if (!e.recurring) e.recurring = input.recurring;
      else e.recurring = { ...input.recurring, ...e.recurring, targetKey: key };
      e.source = 'recurring';
      e.status = 'auto_pending';
      if (!e.spread && input.spread) e.spread = input.spread;
      entries.push(e);
    }
  }
  return entries;
}

const LABEL = { principal: 'principal', interest: 'dobândă', fees: 'comisioane' };

// ---------------------------------------------------------------------------------------------
// Catch-up (cu garduri de siguranță)
// ---------------------------------------------------------------------------------------------

const firstOpenMonth = (closedThrough) => monthKey(addMonths(`${closedThrough}-01`, 1));

function checkGates(deps, state, today, now) {
  if (!isIsoDate(today) || today < '2000-01-01' || today > '2100-12-31') return 'clock';
  if (deps.referenceDate && Math.abs(diffDays(deps.referenceDate, today)) > CLOCK_TOLERANCE_DAYS) return 'clock';
  // ceas dat înapoi față de ce a scris deja acest dispozitiv / cont
  let high = '';
  for (const r of colOf(state, 'occurrences')) if (r.updatedAt && r.updatedAt > high) high = r.updatedAt;
  for (const r of colOf(state, 'entries')) if (r.updatedAt && r.updatedAt > high) high = r.updatedAt;
  if (high && diffDays(today, high.slice(0, 10)) > CLOCK_TOLERANCE_DAYS) return 'clock';
  if (deps.requirePull && !deps.pulledOk) return 'no-pull';
  if (deps.deviceLastSyncedAt && !deps.pulledOk
    && diffDays(deps.deviceLastSyncedAt.slice(0, 10), today) > STALE_DEVICE_DAYS) return 'stale-device';
  return null;
}

async function rateMapFor(fx, cur, date, cache) {
  const k = `${cur}|${date}`;
  if (!cache.has(k)) cache.set(k, await fx.getRate(cur, date));
  return cache.get(k);
}

async function buildFor(deps, state, tpl, plan, targetKey, opts, cache) {
  const v = plan.version;
  if (!v) throw new Error(`Șablonul „${tpl.name}” nu are versiune pentru ${plan.period}.`);
  if (tpl.target?.type === 'trucks' && v.perTruck && tpl.totalMinor != null) {
    const total = sum(Object.values(v.perTruck));
    if (total !== tpl.totalMinor) {
      throw new Error(`Suma pe camioane (${total}) nu bate cu totalul facturii (${tpl.totalMinor}).`);
    }
  }
  const rate = await rateMapFor(deps.fx, v.currency, plan.date, cache);
  return materialize(tpl, { ...plan, targetKey }, {
    trucks: live(colOf(state, 'trucks')),
    company: companyOf(state),
    countries: live(colOf(state, 'countries')),
    categories: live(colOf(state, 'categories')),
    financing: live(colOf(state, 'financing')),
    rateFor: () => rate,
    now: opts.now,
    provisional: opts.provisional,
  });
}

/**
 * Rulează catch-up-ul: creează doar ce lipsește din registrul de ocurențe, până la `today`.
 * deps = { store, fx, today, now, bus?, deviceId?,
 *   requirePull?:boolean, pulledOk?:boolean,          // mod Google: doar după un pull reușit în sesiune (4.7 pct. 6)
 *   offline?:boolean,                                  // intrările create se marchează `provisional`
 *   referenceDate?:IsoDate,                            // data serverului / Drive; ceas diferit cu > 1 zi ⇒ refuz
 *   deviceLastSyncedAt?:IsoDateTime,                   // > 90 zile și fără pull ⇒ refuz
 *   confirmOver?: boolean | string[] }                 // confirmă > 6 perioade (toate sau pe șabloane)
 * Rezultat: { created, existing, skippedPeriods, errors, pendingConfirmation, blocked, redirected, refreshed }
 */
export async function runCatchUp(deps) {
  const { store, today } = deps;
  const now = deps.now ?? new Date().toISOString();
  const result = {
    created: [], existing: 0, skippedPeriods: 0, errors: [],
    pendingConfirmation: [], blocked: null, redirected: 0, refreshed: 0,
  };
  const state = store.state();
  const gate = checkGates(deps, state, today, now);
  if (gate) { result.blocked = gate; return result; }

  const company = companyOf(state);
  const closedThrough = company.closedThrough || null;
  const events = live(colOf(state, 'templateEvents'));
  const occByRid = new Map(colOf(state, 'occurrences').map((o) => [o.id, o]));
  const entryById = new Map(colOf(state, 'entries').map((e) => [e.id, e]));
  const rateCache = new Map();
  const ops = [];
  const stampRec = (rec) => stamp(rec, now, deps.deviceId);
  const putOcc = (tpl, plan, targetKey, state_, entries, extra = {}) => {
    const rid = occurrenceRecordId(tpl.id, plan.period, targetKey);
    const prev = occByRid.get(rid);
    const rec = stampRec({
      ...(prev || {}),
      id: rid, templateId: tpl.id, period: plan.period, targetKey,
      entryId: entries[0]?.id ?? prev?.entryId ?? null,
      entryIds: entries.map((e) => e.id),
      state: state_, versionFrom: plan.versionFrom ?? null, auto: true, date: plan.date,
      ...extra,
    });
    ops.push({ col: 'occurrences', rec });
    occByRid.set(rid, rec);
  };

  // 1) Reîmprospătează intrările `provisional` (generate offline) după un pull reușit
  if (!deps.offline && (deps.pulledOk || !deps.requirePull)) {
    const provisional = live(colOf(state, 'entries')).filter((e) =>
      e.source === 'recurring' && e.recurring?.provisional && !e.recurring.edited && e.status === 'auto_pending');
    const groups = new Map();
    for (const e of provisional) {
      const k = `${e.recurring.templateId}|${e.recurring.period}|${e.recurring.targetKey ?? ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    for (const olds of groups.values()) {
      const r0 = olds[0].recurring;
      const tpl = live(colOf(state, 'templates')).find((t) => t.id === r0.templateId);
      if (!tpl || !r0.targetKey) continue;
      try {
        const plan = planOccurrences(tpl, today, events).find((p) => p.period === r0.period);
        if (!plan || plan.skipped) continue;
        const fresh = await buildFor(deps, state, tpl, plan, r0.targetKey, { now, provisional: false }, rateCache);
        for (const f of fresh) {
          const old = entryById.get(f.id);
          ops.push({ col: 'entries', rec: stampRec({ ...f, createdAt: old?.createdAt ?? f.createdAt, accrualMonth: old?.accrualMonth ?? f.accrualMonth, relatesTo: old?.relatesTo ?? f.relatesTo }) });
        }
        for (const o of olds) if (!fresh.some((f) => f.id === o.id)) ops.push({ col: 'entries', rec: tombstone(o, now) });
        result.refreshed += olds.length;
      } catch (err) {
        result.errors.push({ templateId: r0.templateId, period: r0.period, message: String(err.message || err) });
      }
    }
  }

  // 2) Perioadele lipsă pe fiecare șablon
  const confirmOver = deps.confirmOver;
  for (const tpl of live(colOf(state, 'templates'))) {
    if (tpl.active === false) continue;
    const keys = targetKeysFor(tpl);
    if (!keys.length) {
      result.errors.push({ templateId: tpl.id, period: null, message: `Șablonul „${tpl.name}” nu are nicio țintă.` });
      continue;
    }
    const plans = planOccurrences(tpl, today, events);
    // determină ce lipsește
    const todo = []; // { plan, key }
    for (const plan of plans) {
      for (const key of keys) {
        const rid = occurrenceRecordId(tpl.id, plan.period, key);
        const occ = occByRid.get(rid);
        if (occ && !occ.deletedAt && TREATED.has(occ.state)) {
          result.existing++;
          if (occ.state !== 'generated') result.skippedPeriods++;
          continue;
        }
        if (plan.skipped) {
          putOcc(tpl, plan, key, 'skipped', []);
          result.skippedPeriods++;
          continue;
        }
        // registru pierdut, dar intrarea există (chiar și ca piatră de mormânt): repară registrul, nu regenera
        const probe = occurrenceId(tpl, plan.period, key);
        const probeIds = [probe, occurrenceId(tpl, plan.period, `fleet:${key}`)];
        const found = probeIds.map((id) => entryById.get(id)).find(Boolean)
          ?? (key === 'fleet' ? [...entryById.values()].find((e) => e.recurring?.templateId === tpl.id
            && e.recurring?.period === plan.period && e.recurring?.targetKey === 'fleet') : null);
        if (found) {
          putOcc(tpl, plan, key, found.deletedAt ? 'deleted' : 'generated', [found]);
          result.existing++;
          continue;
        }
        todo.push({ plan, key });
      }
    }
    const missingPeriods = new Set(todo.map((t) => t.plan.period)).size;
    const allowed = confirmOver === true || (Array.isArray(confirmOver) && confirmOver.includes(tpl.id));
    if (missingPeriods > MAX_PERIODS_PER_RUN && !allowed) {
      result.pendingConfirmation.push({ templateId: tpl.id, name: tpl.name, missing: missingPeriods });
      continue;
    }
    for (const { plan, key } of todo) {
      try {
        if (!plan.version) throw new Error(`Șablonul „${tpl.name}” nu are versiune pentru ${plan.period}.`);
        let entries = await buildFor(deps, state, tpl, plan, key, { now, provisional: !!deps.offline }, rateCache);
        if (closedThrough && plan.period <= closedThrough) {
          // lună închisă: nu se scrie silențios în trecut, se propune „în luna curentă, aferent lunii X”
          const open = firstOpenMonth(closedThrough);
          entries = entries.map((e) => ({
            ...e,
            accrualMonth: open,
            relatesTo: plan.period,
            note: `${e.note || ''} [aferent lunii ${plan.period}, lună închisă]`.trim(),
          }));
          result.redirected += entries.length;
        }
        for (const e of entries) {
          const rec = stampRec(e);
          ops.push({ col: 'entries', rec });
          entryById.set(rec.id, rec);
          result.created.push(rec);
        }
        putOcc(tpl, plan, key, 'generated', entries);
      } catch (err) {
        result.errors.push({ templateId: tpl.id, period: plan.period, message: String(err.message || err) });
      }
    }
  }

  if (ops.length) await commit(store, 'Cheltuieli fixe: generare automată', ops, { storeOpts: { source: 'generator' } });
  if (deps.bus && result.created.length) {
    deps.bus.emit('recurring:generated', { created: result.created.length, month: monthKey(today) });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Acțiuni ale administratorului
// ---------------------------------------------------------------------------------------------

/** Sare o lună: eveniment `skip` + ocurențe `skipped`; șterge logic intrarea dacă exista deja. Nu se recreează. */
export function skipPeriod(store, templateId, period, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  const tpl = getRec(store, state, 'templates', templateId);
  if (!tpl) throw new Error(`Șablon necunoscut: ${templateId}`);
  const ops = [];
  ops.push({ col: 'templateEvents', rec: stamp({
    id: detId('tev', templateId, 'skip', period), templateId, type: 'skip', period, payload: {}, deletedAt: undefined,
  }, now, o.deviceId) });
  const entries = colOf(state, 'entries');
  for (const key of targetKeysFor(tpl)) {
    const rid = occurrenceRecordId(templateId, period, key);
    const prev = getRec(store, state, 'occurrences', rid);
    const mine = entries.filter((e) => !e.deletedAt && e.recurring?.templateId === templateId
      && e.recurring?.period === period && (e.recurring.targetKey ?? key) === key);
    for (const e of mine) ops.push({ col: 'entries', rec: tombstone(e, now) });
    ops.push({ col: 'occurrences', rec: stamp({
      ...(prev || {}), id: rid, templateId, period, targetKey: key, entryId: prev?.entryId ?? null,
      entryIds: prev?.entryIds ?? [], state: 'skipped', versionFrom: prev?.versionFrom ?? null, auto: false, deletedAt: undefined,
    }, now, o.deviceId) });
  }
  return mutation(store, 'Sari luna', ops, o);
}

/**
 * Orice ștergere a unei intrări cu source:'recurring' trece pe aici: scrie piatra de mormânt a intrării
 * și starea `deleted` în registru, ca să nu fie regenerată. Pentru alte surse, doar ștergere logică.
 */
export function deleteRecurringEntry(store, entryId, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  const entry = getRec(store, state, 'entries', entryId);
  if (!entry) throw new Error(`Intrare necunoscută: ${entryId}`);
  const ops = [{ col: 'entries', rec: tombstone(entry, now) }];
  if (entry.source === 'recurring' && entry.recurring?.templateId) {
    const r = entry.recurring;
    const occs = colOf(state, 'occurrences').filter((x) => x.templateId === r.templateId && x.period === r.period
      && (x.entryId === entryId || (x.entryIds || []).includes(entryId)));
    const siblings = colOf(state, 'entries');
    for (const occ of occs) {
      const ids = new Set([...(occ.entryIds || []), occ.entryId].filter(Boolean));
      const stillLive = siblings.some((e) => ids.has(e.id) && e.id !== entryId && !e.deletedAt);
      if (!stillLive) ops.push({ col: 'occurrences', rec: stamp({ ...occ, state: 'deleted', auto: false }, now, o.deviceId) });
    }
    if (!occs.length && r.targetKey) {
      // registru lipsă: scrie o ocurență `deleted` ca să nu se regenereze
      ops.push({ col: 'occurrences', rec: stamp({
        id: occurrenceRecordId(r.templateId, r.period, r.targetKey), templateId: r.templateId, period: r.period,
        targetKey: r.targetKey, entryId, entryIds: [entryId], state: 'deleted', versionFrom: r.versionFrom ?? null, auto: false,
      }, now, o.deviceId) });
    }
  }
  return mutation(store, 'Șterge intrare recurentă', ops, o);
}

/**
 * „Schimbă suma de la luna X”: adaugă un eveniment `version`; istoricul nu se rescrie.
 * Întoarce și `affected` = intrări deja generate, neconfirmate și needitate, de la luna X încolo
 * (nu sunt modificate aici; vezi `regenerateUnconfirmed`).
 */
export function changeAmountFrom(store, templateId, fromPeriod, version, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  if (!getRec(store, state, 'templates', templateId)) throw new Error(`Șablon necunoscut: ${templateId}`);
  const ev = stamp({
    id: detId('tev', templateId, 'version', fromPeriod), templateId, type: 'version', period: fromPeriod,
    payload: { ...version }, deletedAt: undefined,
  }, now, o.deviceId);
  const m = mutation(store, 'Schimbă suma de la lună', [{ col: 'templateEvents', rec: ev }], o);
  m.affected = live(colOf(state, 'entries')).filter((e) => e.source === 'recurring'
    && e.recurring?.templateId === templateId && e.recurring.period >= fromPeriod
    && e.status === 'auto_pending' && !e.recurring.edited).map((e) => e.id);
  return m;
}

/** „Încheie la…”: eveniment `end`. `endDate=null` reactivează (ultimul eveniment după updatedAt câștigă). */
export function endTemplate(store, templateId, endDate, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  if (!getRec(store, state, 'templates', templateId)) throw new Error(`Șablon necunoscut: ${templateId}`);
  const period = monthKey(endDate ?? now.slice(0, 10));
  const ev = stamp({
    id: detId('tev', templateId, 'end', period), templateId, type: 'end', period,
    payload: { endDate: endDate ?? null }, deletedAt: undefined,
  }, now, o.deviceId);
  return mutation(store, 'Încheie șablonul', [{ col: 'templateEvents', rec: ev }], o);
}

/** Dezactivează / reactivează un șablon; la activare generarea pornește de la luna activării (5.6). */
export function setTemplateActive(store, templateId, active, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  const tpl = getRec(store, state, 'templates', templateId);
  if (!tpl) throw new Error(`Șablon necunoscut: ${templateId}`);
  const rec = stamp({ ...tpl, active: !!active, activatedMonth: active && tpl.active === false ? now.slice(0, 7) : tpl.activatedMonth }, now, o.deviceId);
  return mutation(store, active ? 'Activează șablonul' : 'Dezactivează șablonul', [{ col: 'templates', rec }], o);
}

/**
 * Regenerează intrările neconfirmate și needitate de la `fromPeriod` încolo cu versiunea curentă
 * (după `changeAmountFrom`). Nu atinge intrări confirmate sau editate și nici lunile închise.
 */
export async function regenerateUnconfirmed(deps, templateId, fromPeriod) {
  const { store, today } = deps;
  const now = deps.now ?? new Date().toISOString();
  const state = store.state();
  const tpl = live(colOf(state, 'templates')).find((t) => t.id === templateId);
  if (!tpl) throw new Error(`Șablon necunoscut: ${templateId}`);
  const closedThrough = companyOf(state).closedThrough || null;
  const events = live(colOf(state, 'templateEvents'));
  const plans = planOccurrences(tpl, today, events);
  const cache = new Map();
  const ops = [];
  const out = { replaced: 0, errors: [] };
  const olds = live(colOf(state, 'entries')).filter((e) => e.source === 'recurring' && e.recurring?.templateId === templateId
    && e.recurring.period >= fromPeriod && e.status === 'auto_pending' && !e.recurring.edited
    && !(closedThrough && e.accrualMonth && e.accrualMonth <= closedThrough));
  const groups = new Map();
  for (const e of olds) {
    const k = `${e.recurring.period}|${e.recurring.targetKey ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [k, list] of groups) {
    const [period, key] = k.split('|');
    const plan = plans.find((p) => p.period === period);
    if (!plan || !key) continue;
    try {
      const fresh = await buildFor(deps, state, tpl, plan, key, { now, provisional: !!deps.offline }, cache);
      for (const f of fresh) {
        const old = list.find((x) => x.id === f.id);
        ops.push({ col: 'entries', rec: stamp({ ...f, createdAt: old?.createdAt ?? f.createdAt, accrualMonth: old?.accrualMonth ?? f.accrualMonth, relatesTo: old?.relatesTo ?? f.relatesTo }, now, deps.deviceId) });
      }
      for (const o of list) if (!fresh.some((f) => f.id === o.id)) ops.push({ col: 'entries', rec: tombstone(o, now) });
      out.replaced += list.length;
    } catch (err) {
      out.errors.push({ templateId, period, message: String(err.message || err) });
    }
  }
  await commit(store, 'Regenerează intrările neconfirmate', ops, { storeOpts: { source: 'generator' } });
  return out;
}

/** Confirmă dintr-un click intrările `auto_pending` (implicit). Sare lunile închise. */
export function confirmAllPending(store, filter, o = {}) {
  const state = store.state();
  const now = nowIso(o);
  const closedThrough = companyOf(state).closedThrough || null;
  const pred = filter || ((e) => e.status === 'auto_pending');
  const targets = live(colOf(state, 'entries')).filter((e) => pred(e)
    && !(closedThrough && (e.accrualMonth ?? monthKey(e.date)) <= closedThrough));
  const ops = targets.map((e) => ({ col: 'entries', rec: stamp({ ...e, status: 'confirmed' }, now, o.deviceId) }));
  const m = mutation(store, 'Confirmă toate intrările automate', ops, o);
  m.count = targets.length;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Rezumat lunar și „Copiază luna trecută”
// ---------------------------------------------------------------------------------------------

/** „Luna asta: ce s-a adăugat automat”. Sumele în RON (brut) din valorile înghețate. */
export function summaryForMonth(state, month) {
  const templates = new Map(colOf(state, 'templates').map((t) => [t.id, t]));
  const rows = new Map();
  let pendingCount = 0;
  let totalRon = 0;
  for (const e of live(colOf(state, 'entries'))) {
    if (e.source !== 'recurring' || !e.recurring) continue;
    if ((e.accrualMonth ?? monthKey(e.date)) !== month) continue;
    const id = e.recurring.templateId;
    const r = rows.get(id) ?? { templateId: id, name: templates.get(id)?.name ?? '(șablon șters)', count: 0, totalRon: 0, pending: 0 };
    const g = e.ron?.gross ?? 0;
    r.count++; r.totalRon += g; totalRon += g;
    if (e.status === 'auto_pending') { r.pending++; pendingCount++; }
    rows.set(id, r);
  }
  const skipped = colOf(state, 'occurrences').filter((o) => !o.deletedAt && o.state === 'skipped' && o.period === month)
    .map((o) => ({ templateId: o.templateId, name: templates.get(o.templateId)?.name ?? '' }));
  return {
    byTemplate: [...rows.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    pendingCount,
    totalRon,
    skipped,
  };
}

/**
 * „Copiază luna trecută” pentru cheltuielile variabile: ciorne `pending` (source 'copy') din luna dinaintea
 * lui `target`, fără intrările recurente. Nu scrie nimic; ecranul aplică ciornele.
 */
export function copyPreviousMonth(state, target, o = {}) {
  const prev = monthKey(addMonths(`${target}-01`, -1));
  const [ty, tm] = target.split('-').map(Number);
  const cats = o.categories && o.categories.length ? new Set(o.categories) : null;
  const existing = live(colOf(state, 'entries')).filter((e) => (e.accrualMonth ?? monthKey(e.date)) === target);
  const dupKey = (e) => [e.categoryId, e.target?.truckId ?? e.target?.trailerId ?? '', e.supplier || ''].join('|');
  const have = new Set(existing.filter((e) => e.source === 'copy').map(dupKey));
  const drafts = [];
  for (const e of live(colOf(state, 'entries'))) {
    if (e.kind !== 'expense') continue;
    if ((e.accrualMonth ?? monthKey(e.date)) !== prev) continue;
    if (e.source === 'recurring' || e.parentDocId || e.status === 'flagged') continue;
    if (e.recurring) continue;
    if (cats && !cats.has(e.categoryId)) continue;
    if (have.has(dupKey(e))) continue;
    drafts.push({
      kind: 'expense',
      date: clampDay(ty, tm, Number(e.date.slice(8, 10))),
      truckId: e.target?.truckId ?? null,
      targetType: e.target?.type ?? 'truck',
      trailerId: e.target?.trailerId ?? null,
      categoryId: e.categoryId,
      supplier: e.supplier || '',
      docNo: '',
      note: e.note || '',
      documentation: e.documentation,
      countryCode: e.countryCode,
      vat: e.vat,
      currency: e.currency,
      entered: 'gross',
      minor: e.orig?.gross ?? 0,
      payment: e.payment ?? null,
      status: 'pending',
      source: 'copy',
      copiedFromId: e.id,
    });
  }
  return drafts;
}

// utilitar exportat pentru UI (cheia „data următoarei apariții”)
export function nextOccurrenceDate(tpl, today, events) {
  if (!tpl || tpl.active === false) return null;
  const end = effectiveEndDate(tpl, events ?? tpl.events ?? []);
  const step = STEP[tpl.frequency] ?? 1;
  const day = Number(tpl.dayOfMonth) || Number(tpl.startDate.slice(8, 10));
  const sm = monthKey(tpl.startDate);
  let probe = monthKey(today);
  for (let guard = 0; guard < 30; guard++) {
    const idx = eachMonth(sm, probe).length - 1;
    if (idx >= 0 && idx % step === 0) {
      const [y, m] = probe.split('-').map(Number);
      const d = clampDay(y, m, day);
      if (d > today && d >= tpl.startDate) return end && d > end ? null : d;
    }
    probe = monthKey(addMonths(`${probe}-01`, 1));
  }
  return null;
}
