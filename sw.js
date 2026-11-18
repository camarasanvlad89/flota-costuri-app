// Service worker minimal: cache la instalare, rețea întâi pentru navigare. Build 1.0.0 (1.0.0)
const CACHE = 'flota-1.0.0';
const PRECACHE = ["./","index.html","app.ad034f1eea.js","app.6c30d89991.css","config.js","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","manifest.webmanifest"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('./'))));
});
