const BUILD = '__BUILD_ID__'; const PRECACHE = __PRECACHE__;
self.addEventListener('install', (e) => e.waitUntil(caches.open('flota-' + BUILD).then((c) => c.addAll(PRECACHE))));
