/** Bus de evenimente simplu, sincron. Erorile unui ascultător nu opresc ceilalți. */
export function createBus() {
  /** @type {Map<string, Set<Function>>} */
  const map = new Map();
  function on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.on: fn trebuie să fie funcție');
    let set = map.get(name);
    if (!set) map.set(name, (set = new Set()));
    set.add(fn);
    return () => { set.delete(fn); };
  }
  function once(name, fn) {
    const off = on(name, (p) => { off(); fn(p); });
    return off;
  }
  function emit(name, payload) {
    const set = map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { if (typeof console !== 'undefined') console.error(`[bus] ascultător pentru "${name}":`, e); }
    }
  }
  return { on, once, emit };
}
