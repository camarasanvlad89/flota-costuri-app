import { useMemo } from './dom.js';
import { useCtx, useStore, useMonth, useDisplayCurrency } from './hooks.js';
import { api, MissingApi } from './api.js';
import { monthRange, fmtMoney } from '../core/index.js';

/** Rezultatul unei funcții de domeniu, memoizat după revizia stării: { data } | { missing } | { error }. */
export function useDomain(name, build, deps = [], enabled = true) {
  return useStore((state) => {
    if (!enabled) return {};
    const fn = api(name);
    if (!fn) return { missing: name };
    try { return { data: fn(...build(state)) }; } catch (e) { return e instanceof MissingApi ? { missing: name } : { error: e }; }
  }, [...deps, enabled]);
}
export function useRange() {
  const [month] = useMonth();
  return useMemo(() => ({ month, range: monthRange(month) }), [month]);
}
export function useReportCtx() {
  const { month, range } = useRange();
  const [cur] = useDisplayCurrency();
  return { month, range, cur };
}
export const money = (v, cur = 'RON', o) => (v == null ? '—' : fmtMoney(v, cur, o));
export function useToday() { const { clock } = useCtx(); return useMemo(() => new Date(clock.now()).toISOString().slice(0, 10), [clock]); }
/** Linkuri către liste filtrate: `/tranzactii?luna=2026-10&camion=ID` */
export function ledgerLink(params) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); return '/tranzactii?' + q.toString(); }
export function coursesLink(params) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); return '/curse?' + q.toString(); }
