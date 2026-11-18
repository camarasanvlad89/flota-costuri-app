// Mai multe file pe același dispozitiv (4.2): lacăt de lider + BroadcastChannel.

export function newTabId() {
  return 'tab' + Math.random().toString(36).slice(2, 8);
}

/** `flota:<db>`; `factory` = BroadcastChannel (sau un fals pentru teste). Fără BroadcastChannel ⇒ canal nul (o singură filă). */
export function openChannel(dbName, factory = globalThis.BroadcastChannel) {
  if (factory) { try { return new factory(`flota:${dbName}`); } catch { /* cade pe canal nul */ } }
  return nullChannel();
}

export function nullChannel() {
  return { postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {}, onmessage: null, isNull: true };
}

/** Abonare la mesaje (suportă addEventListener și onmessage). @returns {()=>void} */
export function listen(channel, fn) {
  if (!channel) return () => {};
  const h = (e) => fn(e && 'data' in e ? e.data : e);
  if (channel.addEventListener) { channel.addEventListener('message', h); return () => channel.removeEventListener('message', h); }
  const prev = channel.onmessage;
  channel.onmessage = (e) => { if (prev) prev(e); h(e); };
  return () => { channel.onmessage = prev; };
}

/**
 * Liderul de sincronizare = fila care deține lacătul exclusiv pe toată viața ei (4.2 pct. 1).
 * Fără `locks` (browser vechi / teste simple) fila e considerată lider.
 * @returns {{ isLeader():boolean, whenLeader():Promise<void>, release():void }}
 */
export function acquireLeadership(name, { locks = globalThis.navigator && globalThis.navigator.locks, onLead } = {}) {
  let leader = false;
  let releaseFn = null;
  let resolveLead;
  const whenLeader = new Promise((r) => { resolveLead = r; });
  if (!locks || !locks.request) {
    leader = true; resolveLead();
    if (onLead) Promise.resolve().then(() => onLead());
    return { isLeader: () => leader, whenLeader: () => whenLeader, release() { leader = false; } };
  }
  const held = new Promise((r) => { releaseFn = r; });
  locks.request(name, { mode: 'exclusive' }, () => {
    leader = true; resolveLead();
    if (onLead) { try { onLead(); } catch { /* nu rupe lacătul */ } }
    return held; // ținut până la închiderea filei sau release()
  }).catch(() => {});
  return { isLeader: () => leader, whenLeader: () => whenLeader, release() { leader = false; if (releaseFn) releaseFn(); } };
}

// ---------- falsuri pentru teste (două file în același proces) ----------

/** Hub în memorie: `hub.channel(name)` ⇒ obiecte ca BroadcastChannel (nu primesc propriile mesaje); `hub.locks()` ⇒ navigator.locks fals. */
export function createFakeHub() {
  const chans = new Map(); // name -> Set(channel)
  const queues = new Map(); // lock name -> { holder, waiters }
  return {
    channel(name) {
      if (!chans.has(name)) chans.set(name, new Set());
      const set = chans.get(name);
      const listeners = new Set();
      const ch = {
        onmessage: null,
        postMessage(data) {
          const copy = JSON.parse(JSON.stringify(data));
          for (const other of set) if (other !== ch) queueMicrotask(() => other._deliver(copy));
        },
        _deliver(data) {
          const ev = { data };
          for (const l of listeners) l(ev);
          if (ch.onmessage) ch.onmessage(ev);
        },
        addEventListener(_t, fn) { listeners.add(fn); },
        removeEventListener(_t, fn) { listeners.delete(fn); },
        close() { set.delete(ch); },
      };
      set.add(ch);
      return ch;
    },
    locks() {
      return {
        request(name, _opts, cb) {
          return new Promise((resolve, reject) => {
            const q = queues.get(name) || { held: false, waiters: [] };
            queues.set(name, q);
            const run = () => {
              q.held = true;
              Promise.resolve().then(() => cb()).then(resolve, reject).finally(() => {
                q.held = false;
                const next = q.waiters.shift();
                if (next) next();
              });
            };
            if (q.held) q.waiters.push(run); else run();
          });
        },
      };
    },
  };
}
