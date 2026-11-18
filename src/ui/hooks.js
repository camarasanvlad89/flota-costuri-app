import { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from './dom.js';
import { coll, singleton } from './selectors.js';

export const CtxContext = createContext(null);
export function useCtx() {
  const c = useContext(CtxContext);
  if (!c) throw new Error('useCtx: lipsește <CtxContext.Provider>');
  return c;
}

/** Abonare la starea magazinului; recalculează `selector(state)` la fiecare `store:changed`. */
export function useStore(selector, deps = []) {
  const { store, bus } = useCtx();
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const off = bus.on('store:changed', () => setRev((r) => r + 1));
    return off;
  }, [bus]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(store.state()), [rev, store, ...deps]);
}
export const useCollection = (name) => useStore((s) => coll(s, name), [name]);
export const useSingleton = (key) => useStore((s) => singleton(s, key), [key]);

export function useSyncStatus() {
  const { sync, bus } = useCtx();
  const [st, setSt] = useState(() => (sync && sync.status ? sync.status() : { state: 'local', dirty: 0, lastSyncedAt: null }));
  useEffect(() => bus.on('sync:status', setSt), [bus]);
  return st;
}

/** Taste rapide pe durata vieții componentei (vezi keyboard.js pentru reguli). */
export function useHotkeys(map, deps = []) {
  const { keyboard } = useCtx();
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!keyboard) return undefined;
    const proxy = {};
    for (const k of Object.keys(ref.current)) proxy[k] = (e) => ref.current[k] && ref.current[k](e);
    return keyboard.register(proxy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboard, Object.keys(map).join('|'), ...deps]);
}

/** Preferință de interfață persistată în `singletons.ui` (filtre, comutatoare). */
export function useUiPref(key, def) {
  const { store } = useCtx();
  const ui = useSingleton('ui');
  const val = ui && ui[key] !== undefined ? ui[key] : def;
  const set = useCallback((v) => {
    const next = typeof v === 'function' ? v(val) : v;
    return store.setSingleton('ui', { [key]: next });
  }, [store, key, val]);
  return [val, set];
}
export function useDisplayCurrency() {
  const [c, set] = useUiPref('displayCurrency', 'RON');
  return [c === 'EUR' ? 'EUR' : 'RON', set];
}
export function useMonth() {
  const { clock } = useCtx();
  const initial = (clock && clock.todayMonth && clock.todayMonth()) || new Date().toISOString().slice(0, 7);
  const [m, set] = useUiPref('month', initial);
  return [m, set];
}
export function useCompany() { return useSingleton('company'); }

/** Valoare asincronă simplă: { data, error, loading, reload }. */
export function useAsync(fn, deps = []) {
  const [st, setSt] = useState({ data: undefined, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => alive && setSt({ data, error: null, loading: false }),
      (error) => alive && setSt({ data: undefined, error, loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, ...deps]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

/** true sub 768 px (telefon, 8.0.3); în afara browserului (teste) = false. */
export function useIsPhone() {
  const q = '(max-width: 767px)';
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
  const [v, setV] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setV(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);
  return v;
}
