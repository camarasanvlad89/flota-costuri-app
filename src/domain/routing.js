// domain/routing.js: geocodare (Nominatim) și distanță rutieră (OSRM) pentru estimarea km încărcați (metoda 3, 5.8).
// Precizie: profil auto, de obicei ±3–8% față de km reali ai unui camion; pe rute < 80 km ±15%; geocodare ambiguă
// ⇒ nu se alege pe tăcute (coada „Locuri de rezolvat”). Destinație doar țară ⇒ NU se estimează.
// Nicio dată personală nu pleacă spre servicii: doar numele locului și coordonate. Serial, 1 cerere/s (Nominatim).
// `fetch`, ceasul și `sleep` sunt injectate (testabil fără rețea). `store` = { get(col,id), list(col), put(col,rec) }.

import { detId } from '../core/ids.js';
import { buildPlaceIndex, findPlace, makePlace, parseRoute, placeKey } from './places.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeLimiter(intervalMs, clock, sleep) {
  let chain = Promise.resolve();
  let last = -Infinity;
  return (fn) => {
    const run = chain.then(async () => {
      const wait = last + intervalMs - clock.now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { last = clock.now(); }
    });
    chain = run.catch(() => {});
    return run;
  };
}

const roundCoord = (x) => (Math.round(x * 1e4) / 1e4).toFixed(4);

/** Cheia unei rute în `routeCache`: coordonate rotunjite la 4 zecimale (~11 m), în ordine. */
export function routeKey(places) {
  return places.map((p) => `${roundCoord(p.lat)},${roundCoord(p.lon)}`).join(';');
}

/**
 * @param {{ store:{ get:Function, list:Function, put:Function }, fetchImpl?:typeof fetch, clock?:{now():number},
 *   rateLimitMs?:number, osrmRateLimitMs?:number, sleep?:(ms:number)=>Promise<void>,
 *   nominatimUrl?:string, osrmUrl?:string, onEstimate?:(course:object, loadedKm:object)=>void, nowIso?:()=>string }} deps
 * @returns {{
 *   resolvePlace(name:string, hint?:{country?:string}): Promise<object>,
 *   confirmPlace(name:string, candidate:object): Promise<object>,
 *   distance(waypoints:object[]): Promise<{ meters:number, durationS:number, cached:boolean }>,
 *   estimateCourse(c:object): Promise<object>,
 *   queue: { readonly pending:number, add(courses:object[]):number, run(onProgress?:(done:number,total:number)=>void):Promise<void>, abort():void, results:Map<string,object> },
 *   unresolved: Set<string> }}
 */
export function createRouting(deps) {
  const store = deps.store;
  const clock = deps.clock || { now: () => Date.now() };
  const sleep = deps.sleep || defaultSleep;
  const fetchImpl = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const nominatim = deps.nominatimUrl || NOMINATIM;
  const osrm = deps.osrmUrl || OSRM;
  const nowIso = deps.nowIso || (() => new Date(clock.now()).toISOString());
  const geoLimit = makeLimiter(deps.rateLimitMs ?? 1100, clock, sleep);
  const routeLimit = makeLimiter(deps.osrmRateLimitMs ?? 400, clock, sleep);
  const unresolved = new Set();

  async function getJson(url, headers) {
    if (!fetchImpl) throw new Error('fără rețea (fetch indisponibil)');
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function resolvePlace(name, hint = {}) {
    const index = buildPlaceIndex(store.list('places'));
    const known = findPlace(index, name);
    if (known && known.lat != null && known.lon != null) return known;

    const params = new URLSearchParams({ format: 'jsonv2', limit: '5', addressdetails: '1', 'accept-language': 'ro', q: String(name) });
    if (hint.country) params.set('countrycodes', String(hint.country).toLowerCase());
    const data = await geoLimit(() => getJson(`${nominatim}?${params}`, { 'Accept-Language': 'ro' }));
    let cands = (Array.isArray(data) ? data : []).map((r) => ({
      display: r.name || String(r.display_name || '').split(',')[0] || name,
      fullName: r.display_name || '',
      lat: Number(r.lat), lon: Number(r.lon),
      countryCode: r.address?.country_code ? String(r.address.country_code).toUpperCase() : null,
      importance: Number(r.importance ?? 0), osmId: r.osm_id ?? null,
    })).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
    if (hint.country) {
      const only = cands.filter((c) => c.countryCode === String(hint.country).toUpperCase());
      if (only.length) cands = only;
    }
    cands.sort((a, b) => b.importance - a.importance);
    if (!cands.length) return { candidates: [] };
    const top = cands[0];
    const unambiguous = cands.length === 1 || top.importance - cands[1].importance >= 0.15;
    if (!unambiguous) return { candidates: cands };
    const place = makePlace({
      display: String(name).trim(), lat: top.lat, lon: top.lon, countryCode: top.countryCode,
      source: 'nominatim', confirmed: false, now: nowIso(),
    });
    await store.put('places', known ? { ...known, lat: place.lat, lon: place.lon, countryCode: place.countryCode, updatedAt: place.updatedAt } : place);
    return place;
  }

  async function confirmPlace(name, candidate) {
    const index = buildPlaceIndex(store.list('places'));
    const known = findPlace(index, name);
    const base = makePlace({
      display: known?.display || String(name).trim(), lat: candidate.lat, lon: candidate.lon,
      countryCode: candidate.countryCode ?? null, source: candidate.source === 'manual' ? 'manual' : 'nominatim',
      confirmed: true, aliases: known?.aliases || [], now: nowIso(),
    });
    await store.put('places', known ? { ...base, id: known.id } : base);
    unresolved.delete(placeKey(name));
    return known ? { ...base, id: known.id } : base;
  }

  async function distance(waypoints) {
    if (!waypoints || waypoints.length < 2) throw new Error('sunt necesare cel puțin două puncte');
    const key = routeKey(waypoints);
    const id = detId('rtc', key);
    const hit = store.get('routeCache', id);
    if (hit && hit.meters != null) return { meters: hit.meters, durationS: hit.durationS ?? 0, cached: true };
    const coords = waypoints.map((p) => `${p.lon},${p.lat}`).join(';');
    const data = await routeLimit(() => getJson(`${osrm}/${coords}?overview=false`));
    const r = data?.routes?.[0];
    if (data?.code !== 'Ok' || !r) throw new Error('rută negăsită');
    const rec = { id, key, meters: Math.round(r.distance), durationS: Math.round(r.duration || 0), at: nowIso() };
    await store.put('routeCache', rec);
    return { meters: rec.meters, durationS: rec.durationS, cached: false };
  }

  async function estimateCourse(c) {
    const at = nowIso();
    const none = (detail) => ({ meters: null, source: null, confidence: 'low', at, detail });
    if (c.loadedKm && (c.loadedKm.source === 'column' || c.loadedKm.source === 'manual') && c.loadedKm.meters != null) return c.loadedKm;
    let origin = c.origin, dests = c.destinations, extras = c.extras || [], destCountry = c.destCountry, originCountry = c.originCountry;
    if (!origin && c.routeRaw) {
      const r = parseRoute(c.routeRaw);
      origin = r.origin; dests = r.destinations; extras = r.extras; destCountry = r.destCountry; originCountry = r.originCountry;
    }
    if (!origin) return none({ reason: 'NO_ORIGIN', message: 'originea lipsește; necesită km manual' });
    if (!dests || !dests.length) {
      return none({ reason: destCountry ? 'COUNTRY_ONLY' : 'NO_DESTINATION', message: 'destinație doar țară sau lipsă; necesită km manual' });
    }
    const names = [origin, ...extras, ...dests];
    try {
      const places = [], missing = [], unconfirmed = [];
      for (let i = 0; i < names.length; i++) {
        const hint = {};
        const cc = i === 0 ? originCountry : (i === names.length - 1 ? destCountry : null);
        if (cc) hint.country = cc;
        const p = await resolvePlace(names[i], hint);
        if (p.candidates) { missing.push(names[i]); unresolved.add(placeKey(names[i])); } else {
          places.push(p);
          if (!p.confirmed) unconfirmed.push(names[i]);
        }
      }
      if (missing.length) return none({ reason: 'UNRESOLVED_PLACES', unresolved: missing, message: 'locuri de confirmat' });
      const d = await distance(places);
      return {
        meters: d.meters, source: 'route', confidence: 'medium', at,
        detail: { waypoints: names, durationS: d.durationS, cached: d.cached, unconfirmed, accuracy: d.meters < 80000 ? '±15%' : '±3–8%' },
      };
    } catch (e) {
      return none({ reason: 'NETWORK', message: String(e && e.message || e) });
    }
  }

  // coada „Calculează km” (batch cu progres)
  const tasks = [];
  const results = new Map();
  let done = 0, aborted = false;
  const queue = {
    get pending() { return Math.max(0, tasks.length - done); },
    results,
    add(courses) {
      for (const c of courses || []) {
        if (!c || c.deletedAt) continue;
        if (c.loadedKm && (c.loadedKm.source === 'column' || c.loadedKm.source === 'manual') && c.loadedKm.meters != null) continue;
        if (tasks.some((t) => t.id === c.id)) continue;
        tasks.push(c);
      }
      return queue.pending;
    },
    abort() { aborted = true; },
    async run(onProgress) {
      aborted = false;
      while (done < tasks.length && !aborted) {
        const c = tasks[done];
        const lk = await estimateCourse(c);
        results.set(c.id, lk);
        done++;
        if (deps.onEstimate) deps.onEstimate(c, lk);
        if (onProgress) onProgress(done, tasks.length);
      }
      if (done >= tasks.length) { tasks.length = 0; done = 0; }
    },
  };

  return { resolvePlace, confirmPlace, distance, estimateCourse, queue, unresolved };
}
