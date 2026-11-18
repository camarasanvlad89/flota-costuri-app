// Selectori puri peste starea magazinului (fără DOM, fără Preact): testabili cu `node --test`.
// Starea poate veni în forma `{ collections, singletons }` (DbDoc) sau aplatizată `{ trucks, company, ... }`.
import { fmtMoney, fmtDate, monthKey, addMonths, foldKey, displayPlate } from '../core/index.js';

export const MONTHS_RO = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

export function coll(state, name) {
  const raw = (state && ((state.collections && state.collections[name]) || state[name])) || [];
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  return arr.filter((r) => r && !r.deletedAt);
}
export function singleton(state, key) {
  return (state && ((state.singletons && state.singletons[key]) || state[key])) || {};
}
export const companyOf = (s) => singleton(s, 'company');

export function monthLabel(m) {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return '—';
  const [y, mm] = m.split('-');
  const name = MONTHS_RO[Number(mm) - 1];
  return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
}
/** Opțiunile filtrului „Luna”: toate lunile cu date (descrescător), plus luna curentă/selectată. */
export function monthOptions(months, extra = []) {
  const set = new Set([...months, ...extra].filter((m) => /^\d{4}-\d{2}$/.test(m || '')));
  return [{ value: '', label: 'Toate' }, ...[...set].sort().reverse().map((m) => ({ value: m, label: monthLabel(m) }))];
}
export function shiftMonth(m, n) { return monthKey(addMonths(m + '-01', n)); }
export function monthOfEntry(e) { return e.accrualMonth || (e.date ? monthKey(e.date) : ''); }
export function isClosed(state, month) {
  const ct = companyOf(state).closedThrough;
  return !!(ct && month && month <= ct);
}

/** Valoarea afișată a unei înregistrări în moneda de raportare (RON/EUR), din câmpurile înghețate. */
export function sideOf(rec, cur) { return cur === 'EUR' ? rec && rec.eur : rec && rec.ron; }
export function entryAmount(e, cur = 'RON') {
  const s = sideOf(e, cur);
  if (!s) return 0;
  return e.kind === 'income' ? (s.net ?? 0) : (s.cost ?? s.net ?? 0);
}
/** „87,50 € (brut) · 393,25 lei (net)”: originalul brut lângă valoarea netă (fără TVA recuperabil) în moneda de raportare; fără valută: „82,64 lei (net)”. */
export function amountPair(e, cur = 'RON') {
  const rep = fmtMoney(entryAmount(e, cur), cur) + ' (net)';
  if (!e.currency || e.currency === cur) return rep;
  const g = e.orig && (e.orig.gross ?? e.orig.net);
  if (!Number.isSafeInteger(g)) return rep;
  return fmtMoney(g, e.currency) + ' (brut) · ' + rep;
}

export function sortRows(rows, key, dir = 'asc', getters = {}) {
  const get = getters[key] || ((r) => r[key]);
  const m = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
    return String(x).localeCompare(String(y), 'ro') * m;
  });
}
export function paginate(rows, page = 1, size = 100) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length, size };
}

/** Filtre pentru lista unificată. `f` e serializabil (se păstrează în `settings.ui`). */
export function filterEntries(entries, f = {}, state) {
  const text = f.text ? foldKey(f.text) : '';
  const cats = f.text && state ? new Map(coll(state, 'categories').map((c) => [c.id, foldKey(c.name)])) : null;
  return entries.filter((e) => {
    if (f.kind && e.kind !== f.kind) return false;
    if (f.month && monthOfEntry(e) !== f.month) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.truckId === '__common') { if (e.target && e.target.truckId) return false; }
    else if (f.truckId && (!e.target || e.target.truckId !== f.truckId)) return false;
    if (f.categoryId && e.categoryId !== f.categoryId) return false;
    if (f.country && e.countryCode !== f.country) return false;
    if (f.currency && e.currency !== f.currency) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.noDoc && e.documentation !== 'none') return false;
    if (f.recurring && !e.recurring) return false;
    if (f.manualFx && !(e.fx && e.fx.manual)) return false;
    if (text) {
      const hay = foldKey([e.supplier, e.docNo, e.note, cats && cats.get(e.categoryId)].filter(Boolean).join(' '));
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
/** Totalul filtrului = suma valorilor înghețate ale rândurilor (identitate testată). */
export function sumEntries(entries, cur = 'RON') {
  let cost = 0, income = 0;
  for (const e of entries) {
    if (e.parentDocId) continue; // detaliile unui document consolidat nu se adună
    if (e.kind === 'income') income += entryAmount(e, cur);
    else if (e.costClass !== 'cashOnly') cost += entryAmount(e, cur);
  }
  return { cost, income, count: entries.length };
}

export function trucksOf(state) {
  return coll(state, 'trucks').sort((a, b) => String(a.plate).localeCompare(String(b.plate)));
}
export const truckLabel = (t) => (t ? t.plateDisplay || displayPlate(t.plate) : '—');
export function nameMap(state, col) { return new Map(coll(state, col).map((r) => [r.id, r])); }

/** Coada „De verificat”. */
export function verifyQueue(state) {
  const entries = coll(state, 'entries').filter((e) => ['pending', 'auto_pending', 'flagged'].includes(e.status));
  const courses = coll(state, 'courses').filter((c) => c.status === 'review' || c.priceStatus === 'missing');
  const staleFx = coll(state, 'entries').filter((e) => e.fx && e.fx.stale && e.currency && e.currency !== 'RON' && e.status === 'confirmed'); // intrările RON nu au curs de schimb propriu
  const noUit = coll(state, 'courses').filter((c) => c.uit === undefined && false);
  return { entries, courses, staleFx, noUit, total: entries.length + courses.length + staleFx.length };
}
export const verifyCount = (state) => verifyQueue(state).total;

/** Valori implicite inteligente: ultimele categorie/camion/plată/țară/monedă folosite pentru acest tip. */
export function quickDefaults(entries, kind = 'expense') {
  const list = entries.filter((e) => e.kind === kind && !e.deletedAt && e.source !== 'recurring')
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  const last = list[0];
  if (!last) return {};
  return {
    categoryId: last.categoryId, truckId: last.target && last.target.truckId, payment: last.payment,
    countryCode: last.countryCode, currency: last.currency, documentation: last.documentation,
  };
}
/** Furnizor ⇒ categorie și țară, din istoric. */
export function supplierHints(entries, supplier, kind = 'expense') {
  const k = foldKey(supplier || '');
  if (!k) return null;
  const hit = entries.filter((e) => !e.deletedAt && e.kind === kind && e.source !== 'recurring' && foldKey(e.supplier || '') === k)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
  return hit ? { categoryId: hit.categoryId, countryCode: hit.countryCode, currency: hit.currency } : null;
}
export function lastEntry(entries) {
  return [...entries].filter((e) => !e.deletedAt)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0] || null;
}

/** Lista de prim contact (8.0.1) */
export function firstRunSteps(state) {
  return [
    { id: 'trucks', done: coll(state, 'trucks').length > 0, route: '/setari/camioane' },
    { id: 'courses', done: coll(state, 'courses').length > 0, route: '/import' },
    { id: 'templates', done: coll(state, 'templates').length > 0, route: '/setari/fixe' },
  ];
}
export const isFirstRun = (state) => coll(state, 'trucks').length === 0;

export function nonBnrCount(entries) {
  return entries.filter((e) => e.currency && e.currency !== 'RON' && e.fx && !['bnr', 'bnr-manual', 'ron'].includes(e.fx.source)).length;
}
export function backupAgeDays(lastBackupAt, nowMs) {
  if (!lastBackupAt) return null;
  const t = Date.parse(lastBackupAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}
export function dateRangeLabel(from, to) { return fmtDate(from) + ' – ' + fmtDate(to); }

/** Profit cu semn + pictogramă (nu doar culoare). */
export function signMark(v) { return v < 0 ? '▼' : v > 0 ? '▲' : '■'; }
export const profitClass = (v) => (v < 0 ? 'neg' : 'pos');

export function csvEscape(v) { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

/** Valorile formularului pentru „Duplică ultima” (data = azi, fără sumă ștearsă). */
export function entryToForm(e, today) {
  const vat = e.vat || {};
  return {
    date: today, docDate: null, truckId: (e.target && e.target.truckId) || '', categoryId: e.categoryId, currency: e.currency || 'RON',
    minor: e.orig && Number.isSafeInteger(e.orig.gross) ? e.orig.gross : null, entered: 'gross', countryCode: e.countryCode,
    documentation: e.documentation || 'invoice', treatment: vat.treatment || 'taxed', rateBp: vat.rateBp ?? null, deductiblePct: vat.deductiblePct ?? 100,
    supplier: e.supplier || '', docNo: '', note: e.note || '', payment: e.payment || 'card', moneySource: e.moneySource || 'company',
    justification: '', incomeType: e.incomeType || 'other',
  };
}

/** Km încărcați: gol (= necunoscut) sau număr pozitiv cu virgulă/punct (ex. 412,5). Altfel mesaj de eroare. */
export function validateKm(text) {
  const raw = String(text ?? '').trim().replace(/\s/g, '');
  if (raw === '') return null;
  if (!/^\d+([.,]\d+)?$/.test(raw)) return 'Introdu un număr de km valid (ex. 412,5).';
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n > 100000) return 'Introdu un număr de km valid (ex. 412,5).';
  return null;
}

/** Categoriile permise: venitul din transport vine doar din curse (D12), deci „Transport marfă” nu se oferă la venit manual;
 *  „Recuperare” folosește categoriile kind=recovery (compensează costul). */
export function pickCategories(all, kind, incomeType) {
  const k = kind === 'income' || kind === 'recovery' ? (kind === 'recovery' || incomeType === 'recovery' ? 'recovery' : 'income') : 'expense';
  return all.filter((c) => c.kind === k && !c.archived && c.id !== 'cat_inc_freight').sort((a, b) => (a.order || 0) - (b.order || 0));
}


/** D21: pe *.github.io originea e partajată; Google pornește doar cu acceptSharedOrigin:true. null = nu e cazul. */
export function sharedOriginState(hostname, config) {
  if (!/(^|\.)github\.io$/i.test(hostname || '') || !config || !config.googleClientId) return null;
  return { accepted: config.acceptSharedOrigin === true };
}
