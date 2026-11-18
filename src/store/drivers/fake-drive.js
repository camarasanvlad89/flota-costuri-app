// Drive fals, în memorie, pentru teste: un „nor” partajat și câte un driver pentru fiecare dispozitiv.
// Interfața driverelor: { kind, list(), read(id), create(name,obj), update(id,obj), remove(id) }.
// FileMeta = { id, name, version, md5Checksum, createdTime, modifiedTime, size }.
import { DriverError } from './driver-error.js';
import { md5OfString } from './md5.js';

export function createFakeCloud({ clock = { now: () => Date.now() }, quotaBytes = Infinity } = {}) {
  const files = new Map(); // id -> { meta, text }
  let seq = 0;
  const nowIso = () => new Date(clock.now()).toISOString();
  const cloud = {
    files,
    calls: { list: 0, read: 0, create: 0, update: 0, remove: 0 },
    /** Simulează o cursă: același nume creat de două ori. */
    injectDuplicate(name, obj, createdOffsetMs = 1) {
      const id = `f${++seq}`;
      const text = JSON.stringify(obj);
      files.set(id, { meta: { id, name, version: '1', md5Checksum: md5OfString(text), createdTime: new Date(clock.now() + createdOffsetMs).toISOString(), modifiedTime: nowIso(), size: String(text.length) }, text });
      return id;
    },
    driver({ label = 'dev' } = {}) {
      const state = { offline: false, failNext: null, listFail: false, clockSkewMs: 0 };
      const guard = () => {
        if (state.offline) throw new DriverError('offline', 'Fără rețea (fals).');
        if (state.failNext) { const f = state.failNext; state.failNext = null; throw new DriverError(f.code, f.message || f.code, f.status); }
      };
      const total = () => [...files.values()].reduce((a, f) => a + f.text.length, 0);
      return {
        kind: 'fake', label, state,
        setOffline(v) { state.offline = v; },
        failNext(code, status) { state.failNext = { code, status }; },
        async list() {
          cloud.calls.list++; guard();
          if (state.listFail) throw new DriverError('server', 'list eșuat (fals)', 500);
          return [...files.values()].map((f) => ({ ...f.meta }));
        },
        async read(id) {
          cloud.calls.read++; guard();
          const f = files.get(id);
          if (!f) throw new DriverError('notFound', 'Fișier lipsă', 404);
          return JSON.parse(f.text);
        },
        async create(name, obj) {
          cloud.calls.create++; guard();
          const text = JSON.stringify(obj);
          if (total() + text.length > quotaBytes) throw new DriverError('quota', 'Drive plin', 403);
          const id = `f${++seq}`;
          const t = new Date(clock.now() + state.clockSkewMs).toISOString();
          const meta = { id, name, version: '1', md5Checksum: md5OfString(text), createdTime: t, modifiedTime: t, size: String(text.length) };
          files.set(id, { meta, text });
          return { ...meta };
        },
        async update(id, obj) {
          cloud.calls.update++; guard();
          const f = files.get(id);
          if (!f) throw new DriverError('notFound', 'Fișier lipsă', 404);
          const text = JSON.stringify(obj);
          f.text = text;
          f.meta = { ...f.meta, version: String(Number(f.meta.version) + 1), md5Checksum: md5OfString(text), modifiedTime: new Date(clock.now() + state.clockSkewMs).toISOString(), size: String(text.length) };
          return { ...f.meta };
        },
        async remove(id) {
          cloud.calls.remove++; guard();
          files.delete(id);
        },
      };
    },
  };
  return cloud;
}
