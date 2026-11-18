// Ajutoare pentru testele modulului „Profit, rapoarte, extinderi”: stări mici construite de mână (fără buildEntry).
export const truck = (id, over = {}) => ({ id, plate: id.toUpperCase(), plateDisplay: id.toUpperCase(), activeFrom: '2020-01-01', activeTo: null, ...over });

/** Intrare de cheltuială cu valori RON înghețate; EUR = RON / 5 (curs de test 5). `cost` implicit = net. */
export function exp(id, over = {}) {
  const o = { date: '2026-10-10', truckId: 't1', cat: 'cat_fuel', gross: 12100, net: 10000, vat: 2100, cost: undefined, ...over };
  const cost = o.cost ?? o.net + (o.vat - (o.recoverable ?? o.vat));
  const rec = o.recoverable ?? o.vat;
  const div5 = (x) => Math.round(x / 5);
  return {
    id, kind: 'expense', incomeType: null, date: o.date, accrualMonth: o.accrualMonth || o.date.slice(0, 7), docDate: null, spread: o.spread || null,
    target: o.company ? { type: 'company', truckId: null, trailerId: null } : o.trailerId ? { type: 'trailer', truckId: null, trailerId: o.trailerId } : { type: 'truck', truckId: o.truckId, trailerId: null },
    categoryId: o.cat, supplier: o.supplier || 'F', documentation: o.documentation || 'invoice', status: o.status || 'confirmed', costClass: o.costClass || 'cost',
    parentDocId: o.parentDocId || null, countryCode: o.country || 'RO', currency: 'RON', moneySource: 'company',
    vat: { treatment: o.treatment || 'taxed', rateBp: 2100, deductiblePct: 100 }, vatRegime: o.regime || 'domestic', foreignVatStatus: o.foreignVatStatus || null,
    orig: { gross: o.gross, net: o.net, vat: o.vat },
    fx: { ronPerUnit: '1', eurPerUnit: '0.2', rateDate: o.date, source: o.fxSource || 'ron', manual: false, stale: !!o.stale, dateBasis: 'date' },
    ron: { gross: o.gross, net: o.net, vat: o.vat, cost, recoverable: rec, recoverableKind: o.recoverableKind === undefined ? (rec ? 'ro' : null) : o.recoverableKind, selfAssessedVat: 0 },
    eur: { gross: div5(o.gross), net: div5(o.net), vat: div5(o.vat), cost: div5(cost), recoverable: div5(rec) },
    fuel: o.fuel || null, justification: o.justification || null,
  };
}
export function inc(id, over = {}) {
  const o = { date: '2026-10-10', truckId: 't1', net: 5000, incomeType: 'other', cat: 'cat_inc_other', ...over };
  return {
    id, kind: 'income', incomeType: o.incomeType, date: o.date, accrualMonth: o.date.slice(0, 7), target: { type: 'truck', truckId: o.truckId, trailerId: null },
    categoryId: o.cat, documentation: 'invoice', status: 'confirmed', costClass: 'cost', countryCode: 'RO', currency: 'RON',
    vat: { treatment: 'none', rateBp: null, deductiblePct: 0 }, vatRegime: 'outOfScope', fx: { source: 'ron', ronPerUnit: '1' },
    orig: { gross: o.net, net: o.net, vat: 0 }, ron: { gross: o.net, net: o.net, vat: 0, cost: 0, recoverable: 0 }, eur: { gross: Math.round(o.net / 5), net: Math.round(o.net / 5), vat: 0, cost: 0, recoverable: 0 },
  };
}
/** Cursă cu net RON dat (în bani); EUR = net / 5. */
export function course(id, truckId, loadDate, unloadDate, net, over = {}) {
  return {
    id, truckId, loadDate, unloadDate, priceStatus: 'ok', routeRaw: 'A - B', origin: 'A', destinations: ['B'], currency: 'RON',
    net, vat: Math.round(net * 0.21), gross: net + Math.round(net * 0.21), vatTreatment: 'taxed', ron: { net, vat: Math.round(net * 0.21), gross: net + Math.round(net * 0.21) },
    eur: { net: Math.round(net / 5), vat: Math.round(Math.round(net * 0.21) / 5), gross: Math.round((net + Math.round(net * 0.21)) / 5) }, fx: { source: 'ron' }, loadedKm: { meters: null, source: null, confidence: null }, ...over,
  };
}
export function state(parts = {}) {
  const { company = {}, singletons = {}, ...cols } = parts;
  const collections = { trucks: [], trailers: [], trailerAssignments: [], drivers: [], categories: [], entries: [], courses: [], gpsDays: [], gpsTrips: [], financing: [], closures: [], places: [], aliases: [], countries: [], expiries: [], serviceItems: [], ...cols };
  return { singletons: { company: { countryCode: 'RO', ...company }, ...singletons }, collections };
}
export const cats = () => [
  { id: 'cat_fuel', name: 'Combustibil', group: 'fuel', varKm: true, accountCode: '6022' },
  { id: 'cat_rent', name: 'Chirie', group: 'overhead', varKm: false, accountCode: '612' },
  { id: 'cat_service', name: 'Service și reparații', group: 'vehicle', varKm: true },
  { id: 'cat_rec_fuel', name: 'Recuperare combustibil', group: 'income', kind: 'recovery', offsetsCategoryId: 'cat_fuel' },
  { id: 'cat_inc_other', name: 'Alt venit', group: 'income', kind: 'income' },
];
