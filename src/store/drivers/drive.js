// Driver Google Drive (4.6): REST direct cu `fetch`, doar `appDataFolder`, corp gzip, încărcare resumabilă peste 4 MB.
// Interfața: { kind:'drive', list(), read(id), create(name,obj), update(id,obj), remove(id) } (vezi fake-drive.js).
// NOTĂ: comportamentul real (version monoton, resumabil pe 6–8 MB, două dispozitive) este de verificat în spike-ul Faza 0.
import { DriverError } from './driver-error.js';
import { md5 } from './md5.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,version,md5Checksum,createdTime,modifiedTime,size';
export const RESUMABLE_THRESHOLD = 4 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

async function streamToBytes(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipBytes(text) {
  const bytes = enc.encode(text);
  if (typeof CompressionStream === 'undefined') return bytes; // citirea detectează magic-ul 1f8b
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return streamToBytes(cs.readable);
}

export async function gunzipToText(bytes) {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new DriverError('unknown', 'Browserul nu poate decomprima fișierul.');
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return dec.decode(await streamToBytes(ds.readable));
  }
  return dec.decode(bytes);
}

/** Traduce un răspuns HTTP de eroare în DriverError (4.5: 403 distincte). */
export async function errorFromResponse(res) {
  let reason = '', message = '';
  try {
    const j = await res.json();
    reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
    message = j?.error?.message || '';
  } catch { /* corp ne-JSON */ }
  const s = res.status;
  if (s === 401) return new DriverError('auth', message || 'Sesiune Google expirată.', s);
  if (s === 403) {
    if (/insufficient|scope/i.test(reason)) return new DriverError('insufficientPermissions', message || 'Permisiunea pentru Drive lipsește.', s);
    if (/storageQuotaExceeded/i.test(reason)) return new DriverError('quota', message || 'Spațiul din Drive este plin.', s);
    if (/rateLimit|userRateLimit|quotaExceeded|dailyLimit/i.test(reason)) return new DriverError('rate', message || 'Prea multe cereri.', s);
    return new DriverError('insufficientPermissions', message || 'Acces refuzat.', s);
  }
  if (s === 404) return new DriverError('notFound', message || 'Fișierul nu există.', s);
  if (s === 429) return new DriverError('rate', message || 'Prea multe cereri.', s);
  if (s >= 500) return new DriverError('server', message || 'Eroare Drive.', s);
  return new DriverError('unknown', message || `HTTP ${s}`, s);
}

const RETRYABLE = new Set(['rate', 'server']);

/**
 * @param {{ getToken:()=>string|null, fetch?:typeof fetch, sleep?:(ms:number)=>Promise<void>, online?:()=>boolean, maxAttempts?:number }} deps
 */
export function createDriveDriver({ getToken, fetch: fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), online = () => (globalThis.navigator ? globalThis.navigator.onLine !== false : true), maxAttempts = 6, onUnauthorized } = {}) {
  async function raw(url, init = {}) {
    const token = getToken();
    if (!token) throw new DriverError('auth', 'Nu ești conectat la Google.');
    if (!online()) throw new DriverError('offline', 'Fără rețea.');
    let res;
    try {
      res = await fetchFn(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (e) {
      throw new DriverError('offline', 'Cererea către Google a eșuat (rețea).');
    }
    if (!res.ok) {
      if (res.status === 401 && onUnauthorized) { try { onUnauthorized(); } catch { /* ignorat */ } }
      throw await errorFromResponse(res);
    }
    return res;
  }

  /** backoff 1, 2, 4… max 60 s, 6 încercări, doar pentru 429/5xx/rate */
  async function call(url, init) {
    let delay = 1000;
    for (let attempt = 1; ; attempt++) {
      try { return await raw(url, typeof init === 'function' ? init() : init); } catch (e) {
        if (!(e instanceof DriverError) || !RETRYABLE.has(e.code) || attempt >= maxAttempts) throw e;
        await sleep(delay);
        delay = Math.min(delay * 2, 60000);
      }
    }
  }

  async function checkMd5(meta, bytes) {
    if (meta && meta.md5Checksum) {
      const mine = md5(bytes);
      if (mine !== meta.md5Checksum) throw new DriverError('integrity', 'Suma de control MD5 nu corespunde după încărcare.');
    }
    return meta;
  }

  function multipartBody(metadata, bytes) {
    const boundary = 'flota' + Math.random().toString(36).slice(2);
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  }

  async function resumable(method, url, metadata, bytes) {
    const start = await call(url, () => ({
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/gzip', 'X-Upload-Content-Length': String(bytes.length) },
      body: JSON.stringify(metadata || {}),
    }));
    const loc = start.headers.get('Location');
    if (!loc) throw new DriverError('unknown', 'Drive nu a returnat adresa de încărcare resumabilă.');
    const res = await call(loc, () => ({ method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: bytes }));
    return res.json();
  }

  return {
    kind: 'drive',

    async list() {
      const files = [];
      let pageToken = '';
      do {
        const q = `spaces=appDataFolder&pageSize=100&orderBy=createdTime&fields=${encodeURIComponent(`nextPageToken,files(${FIELDS})`)}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const res = await call(`${API}/files?${q}`);
        const j = await res.json();
        for (const f of j.files || []) files.push(f);
        pageToken = j.nextPageToken || '';
      } while (pageToken);
      return files;
    },

    async read(id) {
      const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      try { return JSON.parse(await gunzipToText(bytes)); } catch (e) {
        if (e instanceof DriverError) throw e;
        throw new DriverError('integrity', 'Fișier Drive corupt (JSON invalid).');
      }
    },

    async create(name, obj) {
      const bytes = await gzipBytes(JSON.stringify(obj));
      const metadata = { name, parents: ['appDataFolder'], mimeType: 'application/gzip' };
      let meta;
      if (bytes.length > RESUMABLE_THRESHOLD) {
        meta = await resumable('POST', `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, metadata, bytes);
      } else {
        const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, () => {
          const { body, contentType } = multipartBody(metadata, bytes);
          return { method: 'POST', headers: { 'Content-Type': contentType }, body };
        });
        meta = await res.json();
      }
      return checkMd5(meta, bytes);
    },

    async update(id, obj) {
      const bytes = await gzipBytes(JSON.stringify(obj));
      let meta;
      if (bytes.length > RESUMABLE_THRESHOLD) {
        meta = await resumable('PATCH', `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=resumable&fields=${FIELDS}`, {}, bytes);
      } else {
        const res = await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, { method: 'PATCH', headers: { 'Content-Type': 'application/gzip' }, body: bytes });
        meta = await res.json();
      }
      return checkMd5(meta, bytes);
    },

    async remove(id) {
      await call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
