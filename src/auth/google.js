// Autentificare Google Identity Services, modelul de token (4.5).
//
// SPUS CLAR (și în UI): NU există reîmprospătare nesupravegheată a tokenului. Modelul de token GIS deschide mereu un popup; fără
// gest al utilizatorului browserul îl blochează (`popup_failed_to_open`). De aceea reînnoirea e legată de următorul gest
// (click/tastă): `armGestureRefresh()`. Un cod-flow cu refresh token cere un secret, deci un server: „ulterior”.
//
// Tokenul trăiește doar în memorie și se partajează între file prin canalul BroadcastChannel; în localStorage se păstrează doar
// `{ email, lastSignIn }` pentru `login_hint`.

/** Abonare la mesaje (addEventListener sau onmessage); local, ca `auth` să depindă doar de core (10.2). */
function listen(channel, fn) {
  if (!channel) return () => {};
  const h = (e) => fn(e && 'data' in e ? e.data : e);
  if (channel.addEventListener) { channel.addEventListener('message', h); return () => channel.removeEventListener('message', h); }
  const prev = channel.onmessage;
  channel.onmessage = (e) => { if (prev) prev(e); h(e); };
  return () => { channel.onmessage = prev; };
}

export const GIS_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email', 'profile'];
const DRIVE_SCOPE = DRIVE_SCOPES[0];
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const STORAGE_KEY = 'flota:auth';
const REFRESH_AFTER_MS = 50 * 60 * 1000;
const EARLY_MS = 60 * 1000;
const RETRY_COOLDOWN_MS = 60 * 1000;

export function defaultLoadScript(src) {
  return new Promise((resolve, reject) => {
    const d = globalThis.document;
    if (!d) { reject(new Error('fără document')); return; }
    const s = d.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script indisponibil'));
    d.head.appendChild(s);
  });
}

function safeStorage(storage) {
  const s = storage ?? (() => { try { return globalThis.localStorage; } catch { return null; } })();
  return {
    read() { try { const t = s && s.getItem(STORAGE_KEY); return t ? JSON.parse(t) : null; } catch { return null; } },
    write(v) { try { if (s) { if (v) s.setItem(STORAGE_KEY, JSON.stringify(v)); else s.removeItem(STORAGE_KEY); } } catch { /* mod privat */ } },
  };
}

/**
 * @param {{ clientId:string, scopes?:string[], loadScript?:(src:string)=>Promise<void>, channel?:any, storage?:any,
 *           fetch?:typeof fetch, clock?:{now():number}, doc?:any, getGoogle?:()=>any, timers?:any }} deps
 * @returns {Auth}
 */
export function createAuth(deps = {}) {
  const { clientId, scopes = DRIVE_SCOPES, loadScript = defaultLoadScript, channel } = deps;
  const clock = deps.clock || { now: () => Date.now() };
  const fetchFn = deps.fetch || (globalThis.fetch && globalThis.fetch.bind(globalThis));
  const getGoogle = deps.getGoogle || (() => globalThis.google);
  const store = safeStorage(deps.storage);
  const timers = deps.timers || globalThis;
  const hint = store.read();

  let tokenClient = null;
  let token = null, expiresAt = 0, issuedAt = 0;
  let user = hint && hint.email ? { email: hint.email, name: hint.name || '', sub: hint.sub || null, fromHint: true } : null;
  let wantAuth = !!(hint && hint.email); // a existat o conectare anterioară: primul gest o reînnoiește
  let pending = null; // { kind:'signin'|'refresh', resolve }
  let refreshing = false;
  let lastFail = 0;
  let expiryTimer = null;
  const listeners = new Set();
  let preloadP = null;

  const now = () => clock.now();
  const tokenValid = () => !!token && now() < expiresAt - EARLY_MS;
  const notify = () => { for (const fn of [...listeners]) { try { fn(snapshot()); } catch { /* ascultător defect */ } } };
  const snapshot = () => ({ status: status(), user: user && !user.fromHint ? user : user });

  function status() {
    if (tokenValid()) return 'ok';
    return wantAuth ? 'authNeeded' : 'signedOut';
  }

  function armExpiry() {
    if (expiryTimer && timers.clearTimeout) timers.clearTimeout(expiryTimer);
    if (!timers.setTimeout || !token) return;
    const ms = Math.max(0, expiresAt - EARLY_MS - now());
    expiryTimer = timers.setTimeout(() => { expiryTimer = null; notify(); }, ms);
    if (expiryTimer && expiryTimer.unref) expiryTimer.unref();
  }

  function broadcast(msg) { try { if (channel) channel.postMessage(msg); } catch { /* canal închis */ } }

  function setToken(t, exp, issued, u) {
    token = t; expiresAt = exp; issuedAt = issued;
    if (u) user = u;
    wantAuth = true;
    armExpiry();
  }

  if (channel) {
    listen(channel, (m) => {
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'auth:token' && m.token && m.expiresAt > expiresAt) {
        setToken(m.token, m.expiresAt, m.issuedAt || now(), m.user || user);
        notify();
      } else if (m.type === 'auth:hello') {
        if (tokenValid()) broadcast({ type: 'auth:token', token, expiresAt, issuedAt, user });
      } else if (m.type === 'auth:signout') {
        token = null; expiresAt = 0; user = null; wantAuth = false; notify();
      }
    });
    broadcast({ type: 'auth:hello' }); // fila nouă cere tokenul de la celelalte
  }

  function finish(result) {
    const p = pending;
    pending = null;
    refreshing = false;
    if (!result.ok) lastFail = now();
    if (p && p.resolve) p.resolve(result);
    notify();
  }

  async function fetchUser(accessToken) {
    const res = await fetchFn(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error('userinfo ' + res.status);
    const j = await res.json();
    return { email: j.email, name: j.name || '', sub: j.sub };
  }

  async function onTokenResponse(resp) {
    if (!resp || resp.error) {
      finish({ ok: false, code: resp && resp.error ? resp.error : 'unknown', message: (resp && (resp.error_description || resp.error)) || 'Conectare eșuată.' });
      return;
    }
    const g = getGoogle();
    let granted = true;
    try { granted = g.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE); } catch { granted = true; }
    if (!granted) {
      token = null; expiresAt = 0;
      finish({ ok: false, code: 'scopes', message: 'Permisiunea pentru Drive nu a fost acordată.' });
      return;
    }
    const at = now();
    const exp = at + Math.max(60, Number(resp.expires_in) || 3600) * 1000;
    // Contul se verifică la FIECARE token: în fereastra Google utilizatorul poate alege alt cont decât cel memorat (login_hint e doar un indiciu).
    let u = user && !user.fromHint ? user : null;
    try { u = await fetchUser(resp.access_token); } catch (e) {
      if (!u) { finish({ ok: false, code: 'userinfo', message: 'Nu s-au putut citi datele contului Google.' }); return; }
    }
    setToken(resp.access_token, exp, at, u);
    store.write({ email: u.email, name: u.name, sub: u.sub, lastSignIn: new Date(at).toISOString() });
    broadcast({ type: 'auth:token', token, expiresAt, issuedAt, user: u });
    finish({ ok: true, user: u });
  }

  function onTokenError(err) {
    const type = (err && err.type) || 'unknown';
    finish({ ok: false, code: type, message: type === 'popup_failed_to_open' ? 'Fereastra Google a fost blocată. Apasă „Reconectează”.' : type === 'popup_closed' ? 'Fereastra Google a fost închisă.' : 'Conectare eșuată.' });
  }

  const api = {
    /** Încarcă GIS DUPĂ pornirea aplicației. Eșecul (offline, blocator de reclame) = 'unavailable' = offline, nu blochează startul. */
    preload() {
      if (!clientId) return Promise.resolve('unavailable');
      if (preloadP) return preloadP;
      preloadP = (async () => {
        try {
          if (!getGoogle() || !getGoogle().accounts) await loadScript(GIS_URL);
          const g = getGoogle();
          if (!g || !g.accounts || !g.accounts.oauth2) { preloadP = null; return 'unavailable'; }
          tokenClient = g.accounts.oauth2.initTokenClient({
            client_id: clientId, scope: scopes.join(' '),
            callback: (r) => { onTokenResponse(r); },
            error_callback: onTokenError,
          });
          return 'ready';
        } catch { preloadP = null; return 'unavailable'; }
      })();
      return preloadP;
    },

    /** true după ce GIS e încărcat și `signIn()` poate deschide fereastra. */
    isReady() { return !!tokenClient; },

    /** Se apelează SINCRON în handler-ul de click (fără await înaintea requestAccessToken), altfel popup-ul e blocat. */
    signIn() {
      return new Promise((resolve) => {
        if (!tokenClient) { resolve({ ok: false, code: 'unavailable', message: 'Google nu este disponibil (offline sau blocat).' }); return; }
        pending = { kind: 'signin', resolve };
        refreshing = true;
        try {
          tokenClient.requestAccessToken({ prompt: user && user.email ? '' : 'select_account', login_hint: user && user.email ? user.email : undefined });
        } catch (e) { finish({ ok: false, code: 'unknown', message: String(e && e.message || e) }); }
      });
    },

    /** Reînnoire legată de gest: dacă tokenul lipsește sau are > 50 min, următorul click/tastă apelează SINCRON requestAccessToken. */
    armGestureRefresh() {
      const d = deps.doc || globalThis.document;
      if (!d || !d.addEventListener) return () => {};
      const handler = () => {
        if (!tokenClient || refreshing || !wantAuth || !user) return;
        const stale = !token || now() - issuedAt > REFRESH_AFTER_MS || !tokenValid();
        if (!stale) return;
        if (now() - lastFail < RETRY_COOLDOWN_MS) return;
        refreshing = true;
        pending = { kind: 'refresh', resolve: null };
        try { tokenClient.requestAccessToken({ prompt: '', login_hint: user.email }); } catch { finish({ ok: false, code: 'unknown', message: 'Reînnoire eșuată.' }); }
      };
      d.addEventListener('click', handler, true);
      d.addEventListener('keydown', handler, true);
      return () => { d.removeEventListener('click', handler, true); d.removeEventListener('keydown', handler, true); };
    },

    /** Drive a răspuns 401: tokenul local e mort. Îl uităm, ca următorul gest (click/tastă) să ceară unul nou. */
    invalidateToken() {
      if (!token) return;
      token = null; expiresAt = 0;
      if (expiryTimer && timers.clearTimeout) timers.clearTimeout(expiryTimer);
      lastFail = 0;
      notify();
    },

    /** Nu deschide niciodată un popup; null ⇒ AuthNeeded. */
    getAccessToken() { return tokenValid() ? token : null; },

    async signOut() {
      const t = token;
      token = null; expiresAt = 0; user = null; wantAuth = false;
      if (expiryTimer && timers.clearTimeout) timers.clearTimeout(expiryTimer);
      store.write(null);
      try { if (t) getGoogle().accounts.oauth2.revoke(t, () => {}); } catch { /* ignorat */ }
      broadcast({ type: 'auth:signout' });
      notify();
    },

    status,
    get user() { return user && !user.fromHint ? user : user ? { email: user.email, name: user.name, sub: user.sub } : null; },
    /** Adresa de e-mail memorată (pentru „Reconectează-te ca …” înainte de primul token). */
    get hintEmail() { return user ? user.email : null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}
