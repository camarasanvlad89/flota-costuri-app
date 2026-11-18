// bus minimal local pentru teste (core/events.js aparține altui modul)
export function createBus() {
  const m = new Map();
  return {
    on(n, fn) { if (!m.has(n)) m.set(n, new Set()); m.get(n).add(fn); return () => m.get(n).delete(fn); },
    emit(n, p) { for (const fn of [...(m.get(n) || [])]) fn(p); },
    events: [],
  };
}
