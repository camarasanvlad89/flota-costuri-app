// Rulare: node --test src/ui/ui.test.js   (doar module pure: selectors, route-match, keyboard, host; fără DOM/Preact)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from './selectors.js';
import { parseHash, matchRoute, compile, buildPath } from './route-match.js';
import { comboOf, normalizeSpec, createKeyboard, isEditable } from './keyboard.js';
import { createHost } from './host.js';
import { createBus } from '../core/index.js';

const ent = (o) => ({
  id: o.id, kind: 'expense', date: '2026-10-05', accrualMonth: '2026-10', categoryId: 'cat_fuel', supplier: 'OMV', countryCode: 'RO', currency: 'RON', status: 'confirmed',
  target: { type: 'truck', truckId: 'trk_a' }, documentation: 'invoice', source: 'manual', costClass: 'cost', ron: { cost: 10000, net: 10000 }, eur: { cost: 2000, net: 2000 }, ...o,
});

test('lună: etichetă și deplasare (an nou, sfârșit de an)', () => {
  assert.equal(S.monthLabel('2026-10'), 'Octombrie 2026');
  assert.equal(S.monthLabel('x'), '—');
  assert.equal(S.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(S.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(S.shiftMonth('2026-03', 0), '2026-03');
});

test('coll/singleton: acceptă DbDoc și starea aplatizată; ignoră înregistrările șterse', () => {
  const a = { collections: { trucks: [{ id: '1' }, { id: '2', deletedAt: 'x' }] }, singletons: { company: { name: 'X' } } };
  const b = { trucks: [{ id: '1' }], company: { name: 'X' } };
  assert.equal(S.coll(a, 'trucks').length, 1);
  assert.equal(S.coll(b, 'trucks').length, 1);
  assert.equal(S.coll(a, 'nimic').length, 0);
  assert.equal(S.companyOf(a).name, 'X');
  assert.equal(S.companyOf(b).name, 'X');
  assert.equal(S.isClosed({ company: { closedThrough: '2026-09' } }, '2026-09'), true);
  assert.equal(S.isClosed({ company: { closedThrough: '2026-09' } }, '2026-10'), false);
  assert.equal(S.isClosed({ company: {} }, '2026-10'), false);
});

test('filtre: totalul filtrului = suma valorilor înghețate ale rândurilor (RON și EUR), fără detalii de document consolidat', () => {
  const rows = [
    ent({ id: 'a', ron: { cost: 10050 }, eur: { cost: 2000 } }),
    ent({ id: 'b', ron: { cost: 333 }, eur: { cost: 66 }, date: '2026-11-02', accrualMonth: '2026-11' }),
    ent({ id: 'c', kind: 'income', incomeType: 'other', ron: { net: 70000 }, eur: { net: 14000 } }),
    ent({ id: 'd', parentDocId: 'a', ron: { cost: 5000 }, eur: { cost: 900 } }), // detaliu: nu se adună
    ent({ id: 'e', costClass: 'cashOnly', ron: { cost: 99999 }, eur: { cost: 1 } }), // principal de rată: în afara profitului
  ];
  const f = S.filterEntries(rows, { month: '2026-10' });
  assert.deepEqual(f.map((x) => x.id), ['a', 'c', 'd', 'e']);
  const tot = S.sumEntries(f, 'RON');
  assert.equal(tot.cost, 10050);
  assert.equal(tot.income, 70000);
  assert.equal(S.sumEntries(f, 'EUR').cost, 2000);
  // identitate: Σ(filtre disjuncte) = Σ(totul)
  const all = S.sumEntries(rows, 'RON').cost;
  const parts = S.sumEntries(S.filterEntries(rows, { month: '2026-10' }), 'RON').cost + S.sumEntries(S.filterEntries(rows, { month: '2026-11' }), 'RON').cost;
  assert.equal(parts, all);
});

test('filtre pe câmpuri: camion, status, fără document, recurente, curs manual, text fără diacritice', () => {
  const rows = [
    ent({ id: '1', supplier: 'Şerban Transport', target: { type: 'truck', truckId: 'trk_b' } }),
    ent({ id: '2', documentation: 'none' }),
    ent({ id: '3', recurring: { templateId: 't' }, status: 'auto_pending' }),
    ent({ id: '4', currency: 'EUR', fx: { manual: true } }),
  ];
  assert.deepEqual(S.filterEntries(rows, { truckId: 'trk_b' }).map((x) => x.id), ['1']);
  assert.deepEqual(S.filterEntries(rows, { noDoc: true }).map((x) => x.id), ['2']);
  assert.deepEqual(S.filterEntries(rows, { recurring: true }).map((x) => x.id), ['3']);
  assert.deepEqual(S.filterEntries(rows, { status: 'auto_pending' }).map((x) => x.id), ['3']);
  assert.deepEqual(S.filterEntries(rows, { manualFx: true }).map((x) => x.id), ['4']);
  assert.deepEqual(S.filterEntries(rows, { text: 'serban' }).map((x) => x.id), ['1']);
  assert.deepEqual(S.filterEntries(rows, { currency: 'EUR' }).map((x) => x.id), ['4']);
});

test('sortare numerică și text (ro), valorile lipsă la coadă; paginare de 100', () => {
  const rows = [{ n: 3, s: 'Ț' }, { n: 1, s: 'a' }, { n: null, s: 'b' }, { n: 2, s: 'z' }];
  assert.deepEqual(S.sortRows(rows, 'n', 'asc').map((r) => r.n), [1, 2, 3, null]);
  assert.deepEqual(S.sortRows(rows, 'n', 'desc').map((r) => r.n), [3, 2, 1, null]);
  assert.deepEqual(S.sortRows(rows, 's', 'asc').map((r) => r.s), ['a', 'b', 'Ț', 'z']);
  const big = Array.from({ length: 250 }, (_, i) => i);
  const p = S.paginate(big, 3, 100);
  assert.equal(p.rows.length, 50); assert.equal(p.pages, 3); assert.equal(p.page, 3);
  assert.equal(S.paginate(big, 99, 100).page, 3);
  assert.equal(S.paginate([], 1, 100).pages, 1);
  assert.equal(S.paginate(big, 1, 100).rows[0], 0);
});

test('sumă afișată: originalul lângă RON pentru valută; HUF fără zecimale', () => {
  const e = ent({ id: 'x', currency: 'EUR', orig: { gross: 8750 }, ron: { cost: 38673, net: 38673 }, eur: { cost: 7231, net: 7231 } });
  assert.equal(S.amountPair(e, 'RON'), '87,50 € (brut) · 386,73 lei (net)');
  const h = ent({ id: 'h', currency: 'HUF', orig: { gross: 123456 }, ron: { cost: 180000 } });
  assert.equal(S.amountPair(h, 'RON'), '123.456 HUF (brut) · 1.800,00 lei (net)');
  assert.equal(S.amountPair(ent({ id: 'r', ron: { cost: 5 } }), 'RON'), '0,05 lei (net)');
});

test('coada „De verificat”: intrări de verificat + curse fără preț + curs vechi; numărul din meniu = coada', () => {
  const st = { collections: {
    entries: [ent({ id: '1', status: 'auto_pending' }), ent({ id: '2' }), ent({ id: '3', status: 'pending' }), ent({ id: '4', currency: 'EUR', fx: { stale: true } }), ent({ id: '5', fx: { stale: true } })],
    courses: [{ id: 'c1', priceStatus: 'missing' }, { id: 'c2', status: 'review', priceStatus: 'ok' }, { id: 'c3', status: 'ok', priceStatus: 'ok' }],
  } };
  const q = S.verifyQueue(st);
  assert.equal(q.entries.length, 2); assert.equal(q.courses.length, 2); assert.equal(q.staleFx.length, 1);
  assert.equal(S.verifyCount(st), 5);
  assert.equal(S.verifyCount({ collections: {} }), 0);
});

test('valori implicite inteligente și duplicarea ultimei intrări', () => {
  const rows = [
    ent({ id: 'old', createdAt: '2026-10-01T10:00:00Z', categoryId: 'cat_toll', payment: 'card', currency: 'HUF' }),
    ent({ id: 'new', createdAt: '2026-10-09T10:00:00Z', categoryId: 'cat_fuel', payment: 'fuelcard', currency: 'EUR', countryCode: 'DE' }),
    ent({ id: 'rec', createdAt: '2026-10-20T10:00:00Z', source: 'recurring', categoryId: 'cat_rent' }), // recurentele nu influențează implicitele
    ent({ id: 'inc', createdAt: '2026-10-21T10:00:00Z', kind: 'income', categoryId: 'cat_inc' }),
  ];
  const d = S.quickDefaults(rows, 'expense');
  assert.equal(d.categoryId, 'cat_fuel'); assert.equal(d.currency, 'EUR'); assert.equal(d.countryCode, 'DE'); assert.equal(d.payment, 'fuelcard');
  assert.equal(S.quickDefaults(rows, 'income').categoryId, 'cat_inc');
  assert.deepEqual(S.quickDefaults([], 'expense'), {});
  assert.equal(S.lastEntry(rows).id, 'inc');
  const h = S.supplierHints(rows, 'omv');
  assert.equal(h.categoryId, 'cat_fuel'); // cea mai recentă pentru furnizor
  const f = S.entryToForm(ent({ id: 'z', currency: 'EUR', orig: { gross: 8750 }, vat: { treatment: 'taxed', rateBp: 1900, deductiblePct: 100 }, note: 'x', docNo: 'F1' }), '2026-11-18');
  assert.equal(f.date, '2026-11-18'); assert.equal(f.minor, 8750); assert.equal(f.rateBp, 1900); assert.equal(f.docNo, ''); assert.equal(f.currency, 'EUR');
});

test('prima rulare: lista de pași se bifează pe măsură ce se îndeplinește', () => {
  assert.equal(S.isFirstRun({ collections: { trucks: [] } }), true);
  let steps = S.firstRunSteps({ collections: { trucks: [{ id: 1 }], courses: [], templates: [] } });
  assert.deepEqual(steps.map((s) => s.done), [true, false, false]);
  steps = S.firstRunSteps({ collections: { trucks: [{ id: 1 }], courses: [{ id: 1 }], templates: [{ id: 1 }] } });
  assert.deepEqual(steps.map((s) => s.done), [true, true, true]);
});

test('avertizări: curs ne-BNR, vârsta backup-ului, semn profit', () => {
  const rows = [ent({ id: '1', currency: 'EUR', fx: { source: 'ecb-v1' } }), ent({ id: '2', currency: 'EUR', fx: { source: 'bnr' } }), ent({ id: '3', currency: 'EUR', fx: { source: 'bnr-manual' } }), ent({ id: '4' })];
  assert.equal(S.nonBnrCount(rows), 1);
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(S.backupAgeDays(null, now), null);
  assert.equal(S.backupAgeDays('2026-11-10T12:00:00Z', now), 8);
  assert.equal(S.backupAgeDays('2026-11-18T11:00:00Z', now), 0);
  assert.equal(S.signMark(-5), '▼'); assert.equal(S.signMark(5), '▲'); assert.equal(S.signMark(0), '■');
});

test('router hash: cale, interogare, parametri, parametru opțional', () => {
  assert.deepEqual([parseHash('#/camion/abc?x=1').path, parseHash('#/camion/abc?x=1').query.get('x')], ['/camion/abc', '1']);
  assert.equal(parseHash('').path, '/');
  assert.equal(parseHash('#/acasa/').path, '/acasa');
  const routes = [{ route: '/acasa' }, { route: '/camion/:id?' }, { route: '/nou/:kind' }, { route: '/setari/:sectiune?' }];
  assert.equal(matchRoute(routes, '/acasa').screen.route, '/acasa');
  assert.deepEqual(matchRoute(routes, '/camion/trk_1').params, { id: 'trk_1' });
  assert.deepEqual(matchRoute(routes, '/camion').params, {});
  assert.deepEqual(matchRoute(routes, '/nou/venit').params, { kind: 'venit' });
  assert.deepEqual(matchRoute(routes, '/setari').params, {});
  assert.deepEqual(matchRoute(routes, '/setari/fixe').params, { sectiune: 'fixe' });
  assert.equal(matchRoute(routes, '/nu-exista'), null);
  assert.equal(matchRoute(routes, '/nou'), null);
  assert.deepEqual(matchRoute(routes, '/camion/a%20b').params, { id: 'a b' });
  assert.equal(compile('/a/:b').keys[0], 'b');
  assert.equal(buildPath('/tranzactii', new URLSearchParams({ luna: '2026-10' })), '#/tranzactii?luna=2026-10');
});

const ev = (o) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o, preventDefault() { this.prevented = true; } });

test('taste: combinații normalizate (Alt+Shift+D pe Mac dă „∂”, dar codul fizic decide)', () => {
  assert.equal(comboOf(ev({ key: 'n' })), 'n');
  assert.equal(comboOf(ev({ key: 'N', shiftKey: true })), 'n');
  assert.equal(comboOf(ev({ key: '?', shiftKey: true })), '?');
  assert.equal(comboOf(ev({ key: 'Enter', ctrlKey: true })), 'Ctrl+Enter');
  assert.equal(comboOf(ev({ key: 'Enter', metaKey: true })), 'Ctrl+Enter');
  assert.equal(comboOf(ev({ key: '∂', code: 'KeyD', altKey: true, shiftKey: true })), 'Alt+Shift+d');
  assert.equal(normalizeSpec('Alt+Shift+D'), 'Alt+Shift+d');
  assert.equal(normalizeSpec('cmd+Enter'), 'Ctrl+Enter');
  assert.equal(normalizeSpec('g h'), 'g h');
  assert.equal(isEditable({ tagName: 'INPUT' }), true);
  assert.equal(isEditable({ tagName: 'BUTTON' }), false);
});

function fakeTarget() { const fns = []; return { addEventListener: (n, f) => fns.push(f), removeEventListener() {}, fire: (e) => fns.forEach((f) => f(e)) }; }

test('taste: o singură tastă doar în afara câmpurilor și când sunt activate; Ctrl+Enter merge și în câmp; secvențe „g h”', () => {
  const tgt = fakeTarget();
  let enabled = true;
  const k = createKeyboard({ enabled: () => enabled, target: tgt });
  const log = [];
  k.register({ n: () => log.push('n'), 'Ctrl+Enter': () => log.push('save'), 'g h': () => log.push('home'), 'Alt+Shift+D': () => log.push('dup'), Enter: () => log.push('enter') });
  tgt.fire(ev({ key: 'n', target: { tagName: 'BODY' } }));
  tgt.fire(ev({ key: 'n', target: { tagName: 'INPUT' } }));          // în câmp: ignorat (WCAG 2.1.4)
  tgt.fire(ev({ key: 'Enter', target: { tagName: 'INPUT' } }));      // Enter în câmp: ignorat
  tgt.fire(ev({ key: 'Enter', ctrlKey: true, target: { tagName: 'INPUT' } }));
  tgt.fire(ev({ key: '∂', code: 'KeyD', altKey: true, shiftKey: true, target: { tagName: 'INPUT' } }));
  tgt.fire(ev({ key: 'g', target: { tagName: 'BODY' } }));
  tgt.fire(ev({ key: 'h', target: { tagName: 'BODY' } }));
  enabled = false;                                                    // dezactivate din Setări
  tgt.fire(ev({ key: 'n', target: { tagName: 'BODY' } }));
  tgt.fire(ev({ key: 'Enter', ctrlKey: true, target: { tagName: 'BODY' } })); // combinațiile cu modificatori rămân
  assert.deepEqual(log, ['n', 'save', 'dup', 'home', 'save']);
});

test('taste: stratul cel mai nou are prioritate; dezînregistrarea funcționează', () => {
  const tgt = fakeTarget();
  const k = createKeyboard({ target: tgt });
  const log = [];
  const off1 = k.register({ e: () => log.push('global') });
  const off2 = k.register({ e: () => log.push('ecran') });
  tgt.fire(ev({ key: 'e', target: { tagName: 'BODY' } }));
  off2();
  tgt.fire(ev({ key: 'e', target: { tagName: 'BODY' } }));
  off1();
  tgt.fire(ev({ key: 'e', target: { tagName: 'BODY' } }));
  assert.deepEqual(log, ['ecran', 'global']);
});

test('host: toast cu „Anulează” (15 s), „Anulează ultima acțiune”, confirmare', async () => {
  const timers = [];
  const bus = createBus();
  const seen = [];
  bus.on('toast', (t) => seen.push(t.text));
  const host = createHost({ bus, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  let undone = 0;
  host.toast({ kind: 'ok', text: 'Șters', actionLabel: 'Anulează', onAction: () => { undone++; } });
  host.toast({ kind: 'info', text: 'Simplu' });
  assert.equal(host.toasts.length, 2);
  assert.equal(timers[0].ms, 15000);   // fereastra de anulare
  assert.equal(timers[1].ms, 6000);
  assert.equal(host.hasUndo(), true);
  assert.equal(host.undoLast(), true);
  assert.equal(undone, 1);
  assert.equal(host.hasUndo(), false);
  assert.equal(host.toasts.length, 1);  // toast-ul de anulare dispare după folosire
  timers[1].fn();
  assert.equal(host.toasts.length, 0);
  assert.deepEqual(seen, ['Șters', 'Simplu']);
  assert.equal(await host.confirm({ title: 'x' }), false); // fără interfață: refuză prudent
  host.setConfirmHandler(async () => true);
  assert.equal(await host.confirm({ title: 'x' }), true);
  const opened = [];
  host.setEntryHandler((k, i) => opened.push([k, i]));
  host.openEntry('income', { a: 1 });
  assert.deepEqual(opened, [['income', { a: 1 }]]);
});

test('host: maxim 4 toast-uri simultane', () => {
  const host = createHost({ bus: null, setTimer: () => 0, clearTimer: () => {} });
  for (let i = 0; i < 6; i++) host.toast('t' + i);
  assert.equal(host.toasts.length, 4);
  assert.equal(host.toasts[0].text, 't2');
});

// ---- regresii QA ----
test('filtrul „Luna”: toate lunile cu date, descrescător, plus luna curentă', () => {
  const o = S.monthOptions(['2026-03', '2026-11', '2026-03', '', undefined, '2026-07'], ['2026-11', 'x']);
  assert.deepEqual(o.map((x) => x.value), ['', '2026-11', '2026-07', '2026-03']);
  assert.equal(o[0].label, 'Toate');
});
test('filtru camion „__common”: doar costurile fără camion', () => {
  const a = ent({ id: 'a' }), b = ent({ id: 'b', target: { type: 'company' } });
  assert.deepEqual(S.filterEntries([a, b], { truckId: '__common' }).map((e) => e.id), ['b']);
  assert.deepEqual(S.filterEntries([a, b], { truckId: 'trk_a' }).map((e) => e.id), ['a']);
});
test('Venit nou: „Transport marfă” nu se oferă (venitul vine din curse); Recuperare folosește categoriile recovery', () => {
  const cats = [{ id: 'cat_inc_freight', kind: 'income' }, { id: 'cat_inc_other', kind: 'income' }, { id: 'cat_rec_fuel', kind: 'recovery' }, { id: 'cat_fuel', kind: 'expense' }];
  assert.deepEqual(S.pickCategories(cats, 'income', 'other').map((c) => c.id), ['cat_inc_other']);
  assert.deepEqual(S.pickCategories(cats, 'income', 'recovery').map((c) => c.id), ['cat_rec_fuel']);
  assert.deepEqual(S.pickCategories(cats, 'expense').map((c) => c.id), ['cat_fuel']);
});
test('Km încărcați: validare', () => {
  assert.equal(S.validateKm(''), null);
  assert.equal(S.validateKm('412,5'), null);
  assert.equal(S.validateKm('412.5'), null);
  assert.match(S.validateKm('abc'), /număr de km valid/);
  assert.match(S.validateKm('-5'), /număr de km valid/);
  assert.match(S.validateKm('1e9'), /număr de km valid/);
});
test('origine partajată (D21): doar *.github.io cu Client ID; Google cere acceptSharedOrigin:true', () => {
  assert.deepEqual(S.sharedOriginState('firma.github.io', { googleClientId: 'x' }), { accepted: false });
  assert.deepEqual(S.sharedOriginState('firma.github.io', { googleClientId: 'x', acceptSharedOrigin: true }), { accepted: true });
  assert.equal(S.sharedOriginState('firma.github.io', { googleClientId: '' }), null);
  assert.equal(S.sharedOriginState('flota.firma-ta.ro', { googleClientId: 'x' }), null);
  assert.equal(S.sharedOriginState('localhost', { googleClientId: 'x' }), null);
  assert.equal(S.sharedOriginState('evilgithub.io', { googleClientId: 'x' }), null);
});
