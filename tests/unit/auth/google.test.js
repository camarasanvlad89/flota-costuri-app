import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, DRIVE_SCOPES } from '../../../src/auth/google.js';
import { createFakeHub } from '../../../src/store/crosstab.js';

function fakeGoogle({ grant = true } = {}) {
  const g = { calls: [], revoked: [] };
  g.accounts = { oauth2: {
    initTokenClient(cfg) {
      g.cfg = cfg;
      return { requestAccessToken(opts) { g.calls.push(opts); g.last = opts; if (g.auto) g.auto(cfg, opts); } };
    },
    hasGrantedAllScopes: () => grant,
    revoke: (t, cb) => { g.revoked.push(t); cb(); },
  } };
  return g;
}
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const userinfo = async () => ({ ok: true, json: async () => ({ email: 'a@b.ro', name: 'Admin', sub: '123' }) });
const clk = (t = 1_000_000) => { let now = t; return { now: () => now, advance: (ms) => { now += ms; } }; };

async function mk(opts = {}) {
  const google = opts.google || fakeGoogle();
  const clock = opts.clock || clk();
  const auth = createAuth({ clientId: 'cid', loadScript: async () => {}, getGoogle: () => google, storage: opts.storage || memStorage(), fetch: userinfo, clock, channel: opts.channel, doc: opts.doc, timers: { setTimeout: () => null, clearTimeout() {} } });
  return { auth, google, clock };
}

test('fără clientId: unavailable; scope-urile sunt cele nesensibile', async () => {
  const a = createAuth({ clientId: '', storage: memStorage() });
  assert.equal(await a.preload(), 'unavailable');
  assert.deepEqual(DRIVE_SCOPES, ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email', 'profile']);
  assert.equal((await a.signIn()).code, 'unavailable');
});

test('încărcarea scriptului eșuată => unavailable, nu aruncă', async () => {
  const a = createAuth({ clientId: 'c', loadScript: async () => { throw new Error('blocat'); }, getGoogle: () => undefined, storage: memStorage() });
  assert.equal(await a.preload(), 'unavailable');
});

test('signIn: requestAccessToken e apelat sincron; token + utilizator + hint în storage', async () => {
  const { auth, google } = await mk();
  assert.equal(await auth.preload(), 'ready');
  assert.equal(google.cfg.scope, DRIVE_SCOPES.join(' '));
  let p;
  const syncCalls = () => google.calls.length;
  p = auth.signIn();
  assert.equal(syncCalls(), 1, 'apelat sincron în handler');
  google.cfg.callback({ access_token: 'TOK', expires_in: 3600 });
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.user.email, 'a@b.ro');
  assert.equal(auth.getAccessToken(), 'TOK');
  assert.equal(auth.status(), 'ok');
});

test('scope Drive debifat => eroare clară, fără token', async () => {
  const { auth, google } = await mk({ google: fakeGoogle({ grant: false }) });
  await auth.preload();
  const p = auth.signIn();
  google.cfg.callback({ access_token: 'T', expires_in: 3600 });
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.code, 'scopes');
  assert.match(r.message, /Drive/);
  assert.equal(auth.getAccessToken(), null);
});

test('popup_failed_to_open => authNeeded (după o conectare anterioară), fără excepție', async () => {
  const { auth, google, clock } = await mk();
  await auth.preload();
  let p = auth.signIn();
  google.cfg.callback({ access_token: 'T1', expires_in: 3600 });
  await p;
  clock.advance(3_700_000); // tokenul a expirat
  assert.equal(auth.getAccessToken(), null);
  assert.equal(auth.status(), 'authNeeded');
  p = auth.signIn();
  google.cfg.error_callback({ type: 'popup_failed_to_open' });
  const r = await p;
  assert.equal(r.code, 'popup_failed_to_open');
  assert.equal(auth.status(), 'authNeeded');
});

test('reînnoire la gest: click după 50 de minute apelează sincron requestAccessToken cu prompt gol; nu înainte', async () => {
  const listeners = {};
  const doc = { addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  const { auth, google, clock } = await mk({ doc });
  await auth.preload();
  const p = auth.signIn();
  google.cfg.callback({ access_token: 'T1', expires_in: 3600 });
  await p;
  auth.armGestureRefresh();
  google.calls.length = 0;
  listeners.click();
  assert.equal(google.calls.length, 0, 'token încă proaspăt');
  clock.advance(51 * 60 * 1000);
  listeners.click();
  assert.equal(google.calls.length, 1);
  assert.equal(google.last.prompt, '');
  assert.equal(google.last.login_hint, 'a@b.ro');
  listeners.keydown();
  assert.equal(google.calls.length, 1, 'o singură reînnoire în desfășurare');
  google.cfg.callback({ access_token: 'T2', expires_in: 3600 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(auth.getAccessToken(), 'T2');
});

test('reînnoire eșuată: cooldown, apoi se reîncearcă la un gest ulterior', async () => {
  const listeners = {};
  const doc = { addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  const { auth, google, clock } = await mk({ doc });
  await auth.preload();
  const p = auth.signIn();
  google.cfg.callback({ access_token: 'T1', expires_in: 3600 });
  await p;
  auth.armGestureRefresh();
  clock.advance(51 * 60 * 1000);
  google.calls.length = 0;
  listeners.click();
  google.cfg.error_callback({ type: 'popup_failed_to_open' });
  listeners.click();
  assert.equal(google.calls.length, 1, 'cooldown');
  clock.advance(61 * 1000);
  listeners.click();
  assert.equal(google.calls.length, 2);
});

test('token partajat între file prin canal; filă nouă îl cere; signOut se propagă', async () => {
  const hub = createFakeHub();
  const a = await mk({ channel: hub.channel('c') });
  await a.auth.preload();
  const p = a.auth.signIn();
  a.google.cfg.callback({ access_token: 'SHARED', expires_in: 3600 });
  await p;
  await new Promise((r) => setTimeout(r, 5));
  const b = await mk({ channel: hub.channel('c'), clock: a.clock });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(b.auth.getAccessToken(), 'SHARED');
  let changed = 0;
  b.auth.onChange(() => changed++);
  await a.auth.signOut();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(b.auth.getAccessToken(), null);
  assert.ok(changed >= 1);
  assert.deepEqual(a.google.revoked, ['SHARED']);
});

test('hint din storage: primul gest reconectează (o conectare pe zi)', async () => {
  const storage = memStorage();
  storage.setItem('flota:auth', JSON.stringify({ email: 'a@b.ro', lastSignIn: 'x' }));
  const listeners = {};
  const doc = { addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  const { auth, google } = await mk({ storage, doc });
  assert.equal(auth.status(), 'authNeeded');
  await auth.preload();
  auth.armGestureRefresh();
  listeners.click();
  assert.equal(google.calls.length, 1);
  assert.equal(google.last.login_hint, 'a@b.ro');
});

// ---------- regresie QA ----------
test('invalidateToken (401 de la Drive): tokenul mort dispare, statusul devine authNeeded, următorul click reînnoiește', async () => {
  const listeners = {};
  const doc = { addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener() {} };
  const { auth, google } = await mk({ doc });
  await auth.preload();
  const p = auth.signIn();
  google.cfg.callback({ access_token: 'DEAD', expires_in: 3600 });
  await p;
  auth.armGestureRefresh();
  google.calls.length = 0;
  listeners.click();
  assert.equal(google.calls.length, 0, 'token valabil: niciun popup');
  auth.invalidateToken();
  assert.equal(auth.getAccessToken(), null);
  assert.equal(auth.status(), 'authNeeded');
  listeners.click();
  assert.equal(google.calls.length, 1, 'gestul următor cere un token nou');
});

test('reînnoire: contul se verifică la fiecare token (utilizatorul poate alege alt cont în fereastra Google)', async () => {
  const google = fakeGoogle();
  let who = { email: 'a@b.ro', name: 'A', sub: 'A' };
  const auth = createAuth({ clientId: 'cid', loadScript: async () => {}, getGoogle: () => google, storage: memStorage(), fetch: async () => ({ ok: true, json: async () => who }), clock: clk(), timers: { setTimeout: () => null, clearTimeout() {} } });
  await auth.preload();
  let p = auth.signIn();
  google.cfg.callback({ access_token: 'T1', expires_in: 3600 });
  await p;
  assert.equal(auth.user.sub, 'A');
  who = { email: 'b@b.ro', name: 'B', sub: 'B' };
  p = auth.signIn();
  google.cfg.callback({ access_token: 'T2', expires_in: 3600 });
  await p;
  assert.equal(auth.user.sub, 'B');
});

test('preload() se reîncearcă după un eșec (rețea revenită): isReady devine true', async () => {
  const google = fakeGoogle();
  let fail = true;
  const auth = createAuth({ clientId: 'cid', loadScript: async () => { if (fail) throw new Error('offline'); }, getGoogle: () => (fail ? undefined : google), storage: memStorage(), fetch: userinfo });
  assert.equal(await auth.preload(), 'unavailable');
  assert.equal(auth.isReady(), false);
  fail = false;
  assert.equal(await auth.preload(), 'ready');
  assert.equal(auth.isReady(), true);
});
