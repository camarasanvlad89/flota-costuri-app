import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveDriver, gzipBytes, gunzipToText, errorFromResponse } from '../../../src/store/drivers/drive.js';
import { md5, md5OfString } from '../../../src/store/drivers/md5.js';
import { DriverError } from '../../../src/store/drivers/driver-error.js';

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('md5: vectori cunoscuți', () => {
  assert.equal(md5OfString(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5OfString('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5OfString('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
});

test('gzip round-trip', async () => {
  const b = await gzipBytes('{"a":"ăîșț"}');
  assert.equal(b[0], 0x1f);
  assert.equal(await gunzipToText(b), '{"a":"ăîșț"}');
});

test('traducerea erorilor 401/403/404/429/5xx', async () => {
  const e = (s, reason) => errorFromResponse(json({ error: { errors: [{ reason }], message: 'm' } }, s));
  assert.equal((await e(401, '')).code, 'auth');
  assert.equal((await e(403, 'insufficientPermissions')).code, 'insufficientPermissions');
  assert.equal((await e(403, 'storageQuotaExceeded')).code, 'quota');
  assert.equal((await e(403, 'userRateLimitExceeded')).code, 'rate');
  assert.equal((await e(404, '')).code, 'notFound');
  assert.equal((await e(429, '')).code, 'rate');
  assert.equal((await e(503, '')).code, 'server');
});

test('fără token => auth; offline (fetch aruncă) => offline', async () => {
  const d = createDriveDriver({ getToken: () => null, fetch: async () => json({}) });
  await assert.rejects(d.list(), { code: 'auth' });
  const d2 = createDriveDriver({ getToken: () => 't', fetch: async () => { throw new TypeError('x'); } });
  await assert.rejects(d2.list(), { code: 'offline' });
});

test('list: appDataFolder, paginare, antet Authorization', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return url.includes('pageToken') ? json({ files: [{ id: '2', name: 'b' }] }) : json({ files: [{ id: '1', name: 'a' }], nextPageToken: 'P' });
  };
  const d = createDriveDriver({ getToken: () => 'TOK', fetch: fetchFn });
  const files = await d.list();
  assert.deepEqual(files.map((f) => f.id), ['1', '2']);
  assert.ok(calls[0].url.includes('spaces=appDataFolder'));
  assert.equal(calls[0].init.headers.Authorization, 'Bearer TOK');
});

test('create multipart: metadate cu parents appDataFolder; verificare md5; update media', async () => {
  let created, updated;
  const fetchFn = async (url, init) => {
    if (url.includes('uploadType=multipart')) {
      const body = new Uint8Array(init.body);
      created = body;
      const text = new TextDecoder('latin1').decode(body);
      assert.ok(text.includes('"parents":["appDataFolder"]'));
      assert.ok(init.headers['Content-Type'].startsWith('multipart/related'));
      // extrage corpul gzip între antetele multipart și ultimul boundary
      const marker = 'Content-Type: application/gzip\r\n\r\n';
      const start = text.indexOf(marker) + marker.length;
      const end = text.lastIndexOf('\r\n--');
      return json({ id: 'F1', name: 'x', version: '1', md5Checksum: md5(body.slice(start, end)) });
    }
    if (init.method === 'PATCH') { updated = new Uint8Array(init.body); return json({ id: 'F1', version: '2', md5Checksum: md5(updated) }); }
    throw new Error('neașteptat ' + url);
  };
  const d = createDriveDriver({ getToken: () => 't', fetch: fetchFn });
  const meta = await d.create('x', { hello: 'lume' });
  assert.equal(meta.id, 'F1');
  assert.ok(created.length > 0);
  const m2 = await d.update('F1', { hello: 'again' });
  assert.equal(m2.version, '2');
  assert.equal(await gunzipToText(updated), '{"hello":"again"}');
  const bad = createDriveDriver({ getToken: () => 't', fetch: async () => json({ id: 'F', md5Checksum: 'deadbeef' }) });
  await assert.rejects(bad.update('F', {}), { code: 'integrity' });
});

test('backoff pe 429/5xx și oprire după încercări; 401 nu se reîncearcă', async () => {
  let n = 0;
  const sleeps = [];
  const fetchFn = async () => { n++; return n < 3 ? json({ error: {} }, 503) : json({ files: [] }); };
  const d = createDriveDriver({ getToken: () => 't', fetch: fetchFn, sleep: async (ms) => { sleeps.push(ms); } });
  await d.list();
  assert.deepEqual(sleeps, [1000, 2000]);
  let k = 0;
  const always = createDriveDriver({ getToken: () => 't', fetch: async () => { k++; return json({ error: {} }, 429); }, sleep: async () => {} });
  await assert.rejects(always.list(), { code: 'rate' });
  assert.equal(k, 6);
  let u = 0;
  const unauth = createDriveDriver({ getToken: () => 't', fetch: async () => { u++; return json({ error: {} }, 401); }, sleep: async () => {} });
  await assert.rejects(unauth.list(), DriverError);
  assert.equal(u, 1);
});

test('resumabil peste 4 MB: POST inițial cu Location, apoi PUT', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push(`${init.method} ${url.includes('resumable') ? 'start' : 'put'}`);
    if (url.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { Location: 'https://upload.example/session1' } });
    return json({ id: 'BIG', version: '1', md5Checksum: md5(new Uint8Array(init.body)) });
  };
  const d = createDriveDriver({ getToken: () => 't', fetch: fetchFn });
  // date greu de comprimat
  const big = { x: Array.from({ length: 700000 }, () => Math.random().toString(36).slice(2)) };
  const meta = await d.create('big', big);
  assert.equal(meta.id, 'BIG');
  assert.deepEqual(seen, ['POST start', 'PUT put']);
});
