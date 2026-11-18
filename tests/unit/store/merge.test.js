import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecord, mergeDocs } from '../../../src/store/merge.js';

const rec = (o) => ({ id: 'e1', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'A', ...o });

test('secvențial: doar o parte s-a schimbat => 0 conflicte', () => {
  const B = rec({ amount: 1 });
  const R = rec({ amount: 2, updatedAt: '2026-01-02T00:00:00.000Z', updatedBy: 'B' });
  assert.deepEqual(mergeRecord(B, R, B, { collection: 'entries' }), { rec: R, conflict: null });
  assert.deepEqual(mergeRecord(R, B, B, { collection: 'entries' }), { rec: R, conflict: null });
});

test('concurent pe câmpuri diferite: 0 conflicte, ambele păstrate', () => {
  const B = rec({ amount: 1, status: 'pending' });
  const L = rec({ amount: 5, status: 'pending', updatedAt: '2026-01-02T00:00:00.000Z', updatedBy: 'A' });
  const R = rec({ amount: 1, status: 'confirmed', updatedAt: '2026-01-03T00:00:00.000Z', updatedBy: 'B' });
  const m = mergeRecord(L, R, B, { collection: 'entries', deviceId: 'A' });
  assert.equal(m.conflict, null);
  assert.equal(m.rec.amount, 5);
  assert.equal(m.rec.status, 'confirmed');
  assert.equal(m.rec.updatedAt, '2026-01-03T00:00:00.000Z');
  assert.equal(m.rec.updatedBy, 'A'); // trebuie împins din acest dispozitiv
});

test('concurent pe același câmp: 1 conflict, câștigă updatedAt mai mare', () => {
  const B = rec({ amount: 1 });
  const L = rec({ amount: 5, updatedAt: '2026-01-02T00:00:00.000Z' });
  const R = rec({ amount: 7, updatedAt: '2026-01-03T00:00:00.000Z', updatedBy: 'B' });
  const m = mergeRecord(L, R, B, { collection: 'entries' });
  assert.deepEqual(m.conflict, { fields: ['amount'], kept: 'remote' });
  assert.equal(m.rec.amount, 7);
});

test('egalitate updatedAt: versionFrom, fx.stale, updatedBy', () => {
  const t = '2026-01-02T00:00:00.000Z';
  const B = rec({ v: 0 });
  let m = mergeRecord(rec({ v: 1, updatedAt: t, recurring: { versionFrom: '2026-02' } }), rec({ v: 2, updatedAt: t, updatedBy: 'B', recurring: { versionFrom: '2026-03' } }), B, { collection: 'entries' });
  assert.equal(m.rec.v, 2);
  m = mergeRecord(rec({ v: 1, updatedAt: t, fx: { stale: true } }), rec({ v: 2, updatedAt: t, updatedBy: 'B', fx: { stale: false } }), B, { collection: 'entries' });
  assert.equal(m.rec.v, 2);
  m = mergeRecord(rec({ v: 1, updatedAt: t, updatedBy: 'A' }), rec({ v: 2, updatedAt: t, updatedBy: 'B' }), B, { collection: 'drivers' });
  assert.equal(m.rec.v, 2);
});

test('editat vs șters: ștergerea câștigă dacă e mai nouă; altfel înviere logată', () => {
  const B = rec({ amount: 1 });
  const del = { id: 'e1', deletedAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z', updatedBy: 'B' };
  const edit = rec({ amount: 9, updatedAt: '2026-01-03T00:00:00.000Z' });
  let m = mergeRecord(edit, del, B, { collection: 'entries' });
  assert.equal(m.rec.deletedAt, del.deletedAt);
  const edit2 = rec({ amount: 9, updatedAt: '2026-01-09T00:00:00.000Z' });
  m = mergeRecord(edit2, del, B, { collection: 'entries' });
  assert.equal(m.rec.deletedAt, undefined);
  assert.equal(m.rec.amount, 9);
  assert.deepEqual(m.conflict.fields, ['deletedAt']);
});

test('dispozitiv vechi (bază veche) nu învie un șters', () => {
  const B = rec({ amount: 1 });
  const stale = rec({ amount: 1 }); // dispozitiv neatins de luni
  const del = { id: 'e1', deletedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', updatedBy: 'B' };
  const m = mergeRecord(stale, del, B, { collection: 'entries' });
  assert.ok(m.rec.deletedAt);
  // și fără bază
  const m2 = mergeRecord(stale, del, undefined, { collection: 'entries' });
  assert.ok(m2.rec.deletedAt);
});

test('ocurențe: skipped/deleted cu auto=false bate generated indiferent de ceas', () => {
  const gen = { id: 'o', state: 'generated', auto: true, updatedAt: '2026-03-01T00:00:00.000Z', updatedBy: 'A' };
  const skip = { id: 'o', state: 'skipped', auto: false, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'B' };
  const B = { id: 'o', state: 'open', updatedAt: '2025-01-01T00:00:00.000Z' };
  assert.equal(mergeRecord(gen, skip, B, { collection: 'occurrences' }).rec.state, 'skipped');
  assert.equal(mergeRecord(skip, gen, B, { collection: 'occurrences' }).rec.state, 'skipped');
});

test('mergeDocs: colecții + singletons', () => {
  const mk = (amount, at) => ({ singletons: { company: { name: 'X', updatedAt: at } }, collections: { entries: [rec({ amount, updatedAt: at })] } });
  const base = mk(1, '2026-01-01T00:00:00.000Z');
  const local = mk(2, '2026-01-02T00:00:00.000Z');
  const remote = mk(1, '2026-01-01T00:00:00.000Z');
  const { doc, conflicts } = mergeDocs(local, remote, base);
  assert.equal(doc.collections.entries[0].amount, 2);
  assert.equal(conflicts.length, 0);
});
