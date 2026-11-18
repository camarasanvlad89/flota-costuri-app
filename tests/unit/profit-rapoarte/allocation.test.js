import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateOverhead, daysInFleet, fleetDaysBasis } from '../../../src/domain/allocation.js';
import { truck } from './helpers.js';

const range = { from: '2026-10-01', to: '2026-10-31' };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('zile în flotă: camion intrat la mijloc de lună și vândut înainte de sfârșit', () => {
  assert.equal(daysInFleet(truck('a'), range), 31);
  assert.equal(daysInFleet(truck('a', { activeFrom: '2026-10-16' }), range), 16);
  assert.equal(daysInFleet(truck('a', { activeTo: '2026-10-10' }), range), 10);
  assert.equal(daysInFleet(truck('a', { activeFrom: '2026-11-02' }), range), 0);
  assert.deepEqual(fleetDaysBasis([truck('a'), truck('b', { activeFrom: '2026-10-16' })], range), { a: 31, b: 16 });
});

test('suma părților = costul comun, pe orice mod', () => {
  const trucks = [truck('a'), truck('b'), truck('c', { activeFrom: '2026-10-20' })];
  for (const mode of ['daysInFleet', 'km', 'equal']) {
    const r = allocateOverhead({ overheadMinor: 100001, trucks, range, mode, kmByTruck: { a: 5000000, b: 1000000, c: 10 }, seedKey: 's' });
    assert.equal(sum(r), 100001, mode);
  }
});

test('km: un camion care stă primește 0; dacă toți au 0 km revine la zile', () => {
  const trucks = [truck('a'), truck('b')];
  const r = allocateOverhead({ overheadMinor: 1000, trucks, range, mode: 'km', kmByTruck: { a: 100000 }, seedKey: 's' });
  assert.deepEqual(r, { a: 1000, b: 0 });
  const r0 = allocateOverhead({ overheadMinor: 1000, trucks, range, mode: 'km', kmByTruck: {}, seedKey: 's' });
  assert.equal(sum(r0), 1000);
  assert.equal(r0.a, 500);
});

test('aceeași chirie dă același rezultat indiferent de ordinea listei (fleet = company)', () => {
  const a = allocateOverhead({ overheadMinor: 100003, trucks: [truck('a'), truck('b'), truck('c')], range, seedKey: 'x' });
  const b = allocateOverhead({ overheadMinor: 100003, trucks: [truck('c'), truck('a'), truck('b')], range, seedKey: 'x' });
  assert.deepEqual(a, b);
});

test('allocateFair: niciun camion nu absoarbe sistematic restul pe 200 de luni', () => {
  const trucks = [truck('a'), truck('b'), truck('c')];
  const extra = { a: 0, b: 0, c: 0 };
  for (let m = 0; m < 200; m++) {
    const r = allocateOverhead({ overheadMinor: 100, trucks, range, mode: 'equal', seedKey: 'm' + m });
    for (const k of Object.keys(r)) extra[k] += r[k] - 33;
  }
  for (const v of Object.values(extra)) assert.ok(v > 20 && v < 110, 'rest distribuit: ' + JSON.stringify(extra));
});

test('fără camioane eligibile: rezultat gol (costul rămâne nerepartizat); bază înghețată', () => {
  assert.deepEqual(allocateOverhead({ overheadMinor: 500, trucks: [truck('a', { activeFrom: '2030-01-01' })], range, seedKey: 's' }), {});
  const r = allocateOverhead({ overheadMinor: 900, trucks: [truck('a'), truck('b')], range, seedKey: 's', basis: { a: 20, b: 10 } });
  assert.deepEqual(r, { a: 600, b: 300 });
  assert.deepEqual(allocateOverhead({ overheadMinor: 0, trucks: [truck('a')], range, seedKey: 's' }), { a: 0 });
});
