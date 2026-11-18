// Pornirea aplicației: ctx (store, fx, sync, auth, routing, ...), IDB per cont, shell. Mod local (demo) fără Client ID Google.
import { render, html } from './ui/dom.js';
import { createBus, todayLocal, registerCurrency } from './core/index.js';
import { openDeviceDb, getOrCreateDeviceId, openDbOrMemory, dbNameFor } from './store/idb.js';
import { createStore } from './store/store.js';
import { openChannel, newTabId } from './store/crosstab.js';
import { createSync } from './store/sync.js';
import { createDriveDriver } from './store/drivers/drive.js';
import { createNoneDriver } from './store/drivers/none.js';
import { createAuth } from './auth/google.js';
import { createFxService } from './domain/fx.js';
import { createRouting } from './domain/routing.js';
import { ensureDefaults } from './store/backup.js';
import { runCatchUp } from './domain/recurring.js';
import { createKeyboard } from './ui/keyboard.js';
import { createHost } from './ui/host.js';
import { App } from './ui/shell.js';
import { Login, AccountMismatch } from './ui/Login.js';
import { navigate } from './ui/router.js';
import { downloadBackupFile } from './ui/actions.js';
import { t } from './ui/strings.js';
import { sharedOriginState } from './ui/selectors.js';

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* mod privat */ } },
};

function applyStoredTheme() {
  const th = LS.get('flota:theme');
  if (th) document.documentElement.setAttribute('data-theme', th);
}
function mountPoint() {
  let el = document.getElementById('app');
  if (!el) { el = document.createElement('div'); el.id = 'app'; document.body.appendChild(el); }
  return el;
}
function fatal(root, e) {
  console.error('[boot]', e);
  render(html`<main class="stage" role="alert" style="max-width:640px;margin:48px auto"><div class="card"><div class="empty"><b>${t.errors.title}</b>
    <div>${t.errors.body}</div><div class="muted sm mono">${String((e && e.message) || e)}</div><button class="btn" onClick=${() => location.reload()}>${t.errors.reload}</button></div></div></main>`, root);
}

async function chooseAccount(root, config, auth) {
  const saved = LS.get('flota:lastSub');
  if (LS.get('flota:mode') === 'local') return { mode: 'local', sub: null };
  // cont memorat + indiciu de conectare (e-mail) = redeschidere fără ecran de login (reconectarea se face la primul gest)
  if (saved && auth.hintEmail) { try { const o = JSON.parse(saved); if (o && o.sub) return { mode: 'google', sub: o.sub }; } catch { /* ignorat */ } }
  const pre = await Promise.race([auth.preload(), new Promise((r) => setTimeout(() => r('timeout'), 4000))]).catch(() => 'unavailable');
  return new Promise((resolve) => {
    render(html`<${Login} auth=${auth} preloadState=${pre === 'ready' ? 'ready' : 'unavailable'}
      onUser=${(u) => { LS.set('flota:lastSub', JSON.stringify({ sub: u.sub, email: u.email })); resolve({ mode: 'google', sub: u.sub }); }}
      onLocal=${() => { LS.set('flota:mode', 'local'); resolve({ mode: 'local', sub: null }); }} />`, root);
  });
}

export async function boot() {
  const root = mountPoint();
  applyStoredTheme();
  try {
    const config = { appName: 'Flota Costuri', ...(window.FLOTA_CONFIG || {}) };
    const bus = createBus();
    const clock = { now: () => Date.now(), todayMonth: () => todayLocal({ now: () => Date.now() }).slice(0, 7) };
    // D21: pe https://<utilizator>.github.io originea e partajată cu alte site-uri Pages ale contului; Google pornește doar cu acceptSharedOrigin:true
    const sharedOrigin = sharedOriginState(location.hostname, config);
    const wantGoogle = !!config.googleClientId && !(sharedOrigin && !sharedOrigin.accepted) && LS.get('flota:mode') !== 'local';
    const auth = wantGoogle ? createAuth({ clientId: config.googleClientId, channel: openChannel('auth') }) : null; // canal comun tuturor filelor: token și deconectare partajate (4.2/4.5)
    const choice = wantGoogle ? await chooseAccount(root, config, auth) : { mode: 'local', sub: null };
    const mode = choice.mode;

    const deviceDb = await openDeviceDb();
    const deviceId = await getOrCreateDeviceId(deviceDb);
    const dbName = dbNameFor(choice.sub);
    const db = await openDbOrMemory(dbName);
    const channel = openChannel(dbName);
    const store = createStore({ db, bus, clock, deviceId, tabId: newTabId(), channel, appVersion: config.appVersion || 'dev' });
    await store.init();
    try { const ui0 = store.state().singletons.ui || {}; if (ui0.welcomeDone) await ensureDefaults(store); } catch (e) { console.warn('[defaults]', e); }

    // exponentul (zecimalele) din Setări > Valute se aplică în calcule, parsare, afișare și export
    const applyCurrencies = () => {
      for (const c of (store.state().collections?.currencies || [])) {
        const e = Number(c && c.exp);
        if (c && c.code && Number.isInteger(e) && e >= 0 && e <= 6) { try { registerCurrency(c.code, e); } catch { /* ignorat */ } }
      }
    };
    applyCurrencies();
    bus.on('store:changed', (p) => { if (!p || !p.collections || p.collections.includes('currencies')) applyCurrencies(); });

    const fx = createFxService({
      store, fetchImpl: (...a) => fetch(...a), clock, isOnline: () => navigator.onLine !== false,
      get enabled() { const s = store.state(); return !(s.singletons && s.singletons.fx && s.singletons.fx.enabled === false); },
    });
    const routing = createRouting({
      store, clock, fetchImpl: (...a) => fetch(...a),
      onEstimate: (c, lk) => { if (lk && lk.meters != null) store.put('courses', { ...c, loadedKm: lk, updatedAt: new Date().toISOString() }).catch(() => {}); },
    });
    // Contul Google activ trebuie să fie cel al bazei locale (flota:<sub>). Altfel nimic nu se trimite și nu se unește (4.4).
    const accountMismatch = () => { const u = auth && auth.user; return !!(mode === 'google' && choice.sub && u && u.sub && u.sub !== choice.sub); };
    const guardedAuth = auth ? { getAccessToken: () => (accountMismatch() ? null : auth.getAccessToken()), onChange: (fn) => auth.onChange(fn) } : null;
    const driver = mode === 'google' ? createDriveDriver({ getToken: () => guardedAuth.getAccessToken(), onUnauthorized: () => auth.invalidateToken() }) : createNoneDriver();
    const syncEnv = {
      on: (name, fn) => { window.addEventListener(name, fn); return () => window.removeEventListener(name, fn); },
      visible: () => document.visibilityState !== 'hidden',
    };
    const sync = createSync({ store, driver, auth: guardedAuth, bus, clock, env: syncEnv, online: () => navigator.onLine !== false, locks: navigator.locks, channel });

    const host = createHost({ bus });
    let progress = null;
    const keyboard = createKeyboard({ enabled: () => { const s = store.state(); return !(s.singletons && s.singletons.ui && s.singletons.ui.hotkeys === false); } });
    const ctx = {
      store, fx, sync, auth, routing, clock, bus, config, mode, keyboard, host, deviceId, sharedOrigin,
      nav: navigate, toast: host.toast, confirm: host.confirm, openEntry: host.openEntry,
      progress: { get: () => progress, set: (p) => { progress = p; bus.emit('progress', p); } },
      memoryOnly: !!(db && db.volatile), clockBad: false,
      downloadBackup: () => downloadBackupFile(ctx),
      googleAvailable: !!config.googleClientId && !(sharedOrigin && !sharedOrigin.accepted),
    };
    window.__FLOTA__ = ctx;

    let leaving = false;
    const forgetAccount = () => { LS.set('flota:lastSub', null); LS.set('flota:mode', null); };
    const reloadSoon = () => { leaving = true; setTimeout(() => location.reload(), 50); };
    /** Eliberează baza locală a contului (închide conexiunea, o șterge) fără a atinge baza dispozitivului. */
    async function wipeLocal() {
      try { sync.stop(); } catch { /* ignorat */ }
      try { await Promise.race([db.destroy(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* ignorat */ }
    }
    /** Deconectare: golește coada (dacă se poate), avertizează la modificări nesincronizate, oferă ștergerea datelor locale, apoi ecranul de login. */
    ctx.signOut = async () => {
      if (mode !== 'google' || !auth) return;
      if (store.outbox().count > 0 && navigator.onLine !== false && auth.getAccessToken()) { try { await sync.flush(); } catch { /* ignorat */ } }
      const dirty = store.outbox().count;
      if (dirty > 0) {
        const ok = await host.confirm({ title: `${dirty} modificări nesincronizate`, body: 'Ele nu au ajuns în Google Drive și rămân doar în acest browser. Se descarcă acum un backup JSON; dacă te reconectezi cu același cont, modificările se trimit.', confirmLabel: 'Deconectează oricum', danger: true });
        if (!ok) return;
        try { await downloadBackupFile(ctx); } catch { /* ignorat */ }
      }
      const wipe = await host.confirm({ title: 'Ștergi și datele locale de pe acest dispozitiv?', body: dirty > 0 ? `Atenție: ${dirty} modificări nesincronizate se pierd definitiv (rămâne doar backup-ul descărcat). Datele sincronizate rămân în Google Drive.` : 'Datele rămân în Google Drive; la următoarea conectare se descarcă din nou. Recomandat pe un calculator sau telefon folosit și de alții.', confirmLabel: 'Șterge datele locale', cancelLabel: 'Păstrează local', danger: true });
      leaving = true;
      try { sync.stop(); } catch { /* ignorat */ }
      await auth.signOut();
      forgetAccount();
      if (wipe) await wipeLocal();
      reloadSoon();
    };
    ctx.switchToGoogle = () => { LS.set('flota:mode', null); reloadSoon(); };
    ctx.accountMismatch = accountMismatch;

    // sincronizare + generarea cheltuielilor fixe (catch-up), doar după un pull reușit în mod Google
    let caught = false;
    async function catchUp() {
      if (caught) return;
      const gate = sync.canGenerate();
      ctx.clockBad = gate && gate.ok === false && gate.reason === 'clock';
      if (!gate.ok) return;
      caught = true;
      const run = async () => {
        const today = todayLocal(clock);
        const res = await runCatchUp({ store, fx, today, now: new Date().toISOString(), deviceId, requirePull: mode === 'google', pulledOk: mode === 'google' ? !gate.provisional : true, offline: !!gate.provisional });
        if (res.created.length) { bus.emit('recurring:generated', { created: res.created.length, month: today.slice(0, 7) }); host.toast({ kind: 'info', text: `${res.created.length} cheltuieli fixe adăugate automat (de confirmat).`, actionLabel: 'De verificat', ttl: 7000, onAction: () => navigate('/verificare?sursa=recurenta') }); }
        if (res.pendingConfirmation && res.pendingConfirmation.length) host.toast({ kind: 'warn', text: 'Unele cheltuieli fixe au multe luni lipsă: confirmă din Setări › Cheltuieli fixe › Generează acum.' });
      };
      if (navigator.locks) await navigator.locks.request('flota-catchup:' + dbName, { ifAvailable: true }, (lock) => (lock ? run() : null));
      else await run();
    }
    ctx.catchUp = () => { caught = false; return catchUp(); };
    bus.on('sync:status', (st) => { if (st && (st.state === 'idle' || st.state === 'offline' || st.state === 'local')) catchUp().catch((e) => console.warn('[catchUp]', e)); });
    bus.on('sync:epoch', (p) => { if (p && p.backup) host.toast({ kind: 'warn', text: 'Datele au fost înlocuite de o versiune mai nouă. Poți descărca copia locală dinainte.', actionLabel: 'Descarcă', onAction: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([p.backup.json], { type: 'application/json' })); a.download = p.backup.filename; a.click(); } }); });
    if (mode === 'google') { try { auth.armGestureRefresh(); auth.preload(); } catch (e) { console.warn('[auth]', e); } }
    sync.start();
    setTimeout(() => catchUp().catch(() => {}), mode === 'local' ? 0 : 6000);

    window.addEventListener('beforeunload', (e) => { if (mode === 'google' && store.outbox().count > 0) { e.preventDefault(); e.returnValue = ''; } });
    if (!location.hash || location.hash === '#') location.hash = '#/acasa';
    if (mode === 'google' && auth) {
      let mismatchShown = false;
      const showMismatch = () => {
        if (mismatchShown || !accountMismatch()) return false;
        mismatchShown = true;
        try { sync.stop(); } catch { /* ignorat */ }
        let local = null; try { local = JSON.parse(LS.get('flota:lastSub') || 'null'); } catch { /* ignorat */ }
        render(html`<${AccountMismatch} localEmail=${local && local.email} newUser=${auth.user} dirty=${store.outbox().count}
          onBackup=${() => downloadBackupFile(ctx)}
          onBack=${async () => { leaving = true; await auth.signOut(); forgetAccount(); reloadSoon(); }}
          onWipe=${async () => { leaving = true; const u = auth.user; await wipeLocal(); LS.set('flota:lastSub', JSON.stringify({ sub: u.sub, email: u.email })); LS.set('flota:mode', null); reloadSoon(); }} />`, root);
        return true;
      };
      const hadUser = !!auth.user;
      auth.onChange((snap) => {
        if (leaving) return;
        if (showMismatch()) return;
        if (hadUser && snap.status === 'signedOut') { leaving = true; location.reload(); } // deconectare într-o altă filă (canal partajat)
      });
      window.addEventListener('online', () => { auth.preload(); });
      if (showMismatch()) return ctx;
    }
    render(html`<${App} ctx=${ctx} mode=${mode} />`, root);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && config.serviceWorker !== false) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* fără SW în dev */ });
    }
    return ctx;
  } catch (e) { fatal(root, e); return null; }
}

if (typeof document !== 'undefined' && !window.__FLOTA_NO_BOOT__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
