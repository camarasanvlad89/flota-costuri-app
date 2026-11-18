import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryStatus, expiryAlerts, expiryList, renewExpiry, buildIcs, currentExpiries, EXPIRY_KINDS } from '../../../src/domain/expiry.js';
import { truck, state } from './helpers.js';

const TODAY = '2026-11-18';
const addD = (n) => { const d = new Date('2026-11-18T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const X = (id, kind, days, over = {}) => ({ id, subjectType: 'truck', subjectId: 't1', kind, dueDate: addD(days), ...over });

test('limitele 30/15/7/0 și depășit', () => {
  const lv = (n) => expiryStatus(addD(n), TODAY).level;
  assert.deepEqual([31, 30, 16, 15, 8, 7, 1, 0, -1].map(lv), ['ok', 'd30', 'd30', 'd15', 'd15', 'd7', 'd7', 'today', 'overdue']);
  assert.equal(expiryStatus(addD(-3), TODAY).daysLeft, -3);
});

test('ITP peste 20 de zile apare „în 30 de zile” și dispare după reînnoire', () => {
  const rec = X('itp1', 'ITP', 20);
  const s = state({ trucks: [truck('t1')], expiries: [rec] });
  const a = expiryAlerts(s, TODAY);
  assert.equal(a.length, 1); assert.equal(a[0].level, 'd30'); assert.equal(a[0].text, 'în 20 zile'); assert.equal(a[0].subjectName, 'T1'); assert.equal(a[0].label, 'ITP');
  const { old, next } = renewExpiry(rec, addD(385), '2026-11-18T10:00:00.000Z', { id: 'itp2' });
  const s2 = state({ trucks: [truck('t1')], expiries: [old, next] });
  assert.equal(expiryAlerts(s2, TODAY).length, 0);
  assert.equal(expiryList(s2, TODAY).length, 1);
  assert.throws(() => renewExpiry(rec, addD(10), 'x'));
});

test('alerte sortate după urgență; expirate primele; peste 30 de zile nu apar', () => {
  const s = state({ trucks: [truck('t1')], expiries: [X('a', 'RCA', 25), X('b', 'ITP', -5), X('c', 'CASCO', 3), X('d', 'ROVINIETA', 90), X('e', 'ITP', 10, { active: false })] });
  assert.deepEqual(expiryAlerts(s, TODAY).map((x) => x.id), ['b', 'c', 'a']);
  assert.equal(expiryAlerts(s, TODAY)[0].text, 'expirat de 5 zile');
});

test('din grupul (subiect, tip) contează doar cea mai târzie scadență nereînnoită', () => {
  const s = state({ expiries: [X('a', 'ITP', 5), X('b', 'ITP', 300)] });
  assert.deepEqual(currentExpiries(s).map((x) => x.id), ['b']);
});

test('.ics: eveniment pe zi întreagă, memento 30/15/7, CRLF, escapare, linii ≤ 75 octeți', () => {
  const long = 'Notă cu virgulă, punct și virgulă; ' + 'ă'.repeat(60);
  const s = state({ trucks: [truck('t1')], expiries: [X('itp1', 'ITP', 20, { note: long }), X('rca1', 'RCA', 40)] });
  const ics = buildIcs(s, { nowIso: '2026-11-18T10:00:00.000Z' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261208'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261209'));
  assert.ok(ics.includes('DTSTAMP:20261118T100000Z'));
  for (const d of ['30', '15', '7']) assert.ok(ics.includes(`TRIGGER:-P${d}D`), d);
  assert.ok(ics.includes('UID:itp1@flota-costuri'));
  assert.ok(ics.includes('\\,') && ics.includes('\;'));
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, line);
  assert.ok(!/[^\r]\n/.test(ics), 'doar CRLF');
});

test('tipurile din cerință sunt toate prezente', () => {
  for (const k of ['ITP', 'RCA', 'CASCO', 'TAHO_CAL', 'ROVINIETA', 'PERMIS', 'CARD_TAHO']) assert.ok(EXPIRY_KINDS[k], k);
});
