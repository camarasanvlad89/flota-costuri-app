// Gazda efectelor de interfață (toast, confirmare, panou de intrare, „Anulează ultima acțiune”), independentă de Preact.
export function createHost({ bus, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) }) {
  let seq = 0;
  let confirmHandler = null, entryHandler = null;
  let lastUndo = null;
  const timers = new Map();
  const listeners = new Set();
  let toasts = [];
  const emit = () => listeners.forEach((fn) => fn(toasts));
  function dismiss(id) {
    toasts = toasts.filter((x) => x.id !== id);
    if (timers.has(id)) { clearTimer(timers.get(id)); timers.delete(id); }
    emit();
  }
  function toast(opts) {
    const o = typeof opts === 'string' ? { text: opts } : opts;
    const id = ++seq;
    const item = { id, kind: o.kind || 'info', text: o.text, actionLabel: o.actionLabel, onAction: o.onAction };
    if (o.actionLabel && o.onAction && /anulează/i.test(o.actionLabel)) lastUndo = { fn: o.onAction, id };
    toasts = [...toasts, item].slice(-4);
    emit();
    timers.set(id, setTimer(() => dismiss(id), o.ttl || (o.actionLabel ? 15000 : 6000))); // fereastra de anulare: 15 s (8.0.2)
    bus && bus.emit('toast', item);
    return id;
  }
  return {
    toast, dismiss,
    subscribeToasts(fn) { listeners.add(fn); fn(toasts); return () => listeners.delete(fn); },
    confirm(opts) { return confirmHandler ? confirmHandler(opts) : Promise.resolve(false); },
    setConfirmHandler(fn) { confirmHandler = fn; },
    openEntry(kind, initial) { entryHandler && entryHandler(kind, initial); },
    setEntryHandler(fn) { entryHandler = fn; },
    hasUndo() { return !!lastUndo; },
    undoLast() { const u = lastUndo; if (!u) return false; lastUndo = null; dismiss(u.id); u.fn(); return true; },
    registerUndo(fn) { lastUndo = { fn, id: -1 }; },
    get toasts() { return toasts; },
  };
}
