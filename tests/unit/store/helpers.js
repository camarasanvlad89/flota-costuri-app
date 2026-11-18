import { createMemoryDb } from '../../../src/store/idb.js';
import { createStore } from '../../../src/store/store.js';
import { createBus } from './bus.js';

export function fakeClock(start = Date.parse('2026-11-18T10:00:00Z')) {
  let t = start;
  return { now: () => t, set: (v) => { t = v; }, advance: (ms) => { t += ms; } };
}

export async function mkStore({ db = createMemoryDb('t'), deviceId = 'devA', tabId = 'tab1', clock = fakeClock(), channel = null } = {}) {
  const bus = createBus();
  const store = createStore({ db, bus, clock, deviceId, tabId, channel });
  await store.init();
  return { store, bus, db, clock };
}
