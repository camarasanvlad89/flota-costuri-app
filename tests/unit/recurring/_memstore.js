// Store în memorie pentru testele de domeniu (aceeași formă ca store.js din plan 10.8, fără IDB).
export function createMemStore(seed = {}) {
  const cols = new Map();
  const singletons = { company: { closedThrough: null, ...(seed.company || {}) } };
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  for (const [n, recs] of Object.entries(seed.collections || {})) for (const r of recs) col(n).set(r.id, r);
  const store = {
    calls: [],
    state() {
      const collections = {};
      for (const [n, m] of cols) collections[n] = [...m.values()];
      return { collections, singletons: { ...singletons } };
    },
    get(c, id) { const r = col(c).get(id); return r && !r.deletedAt ? r : null; },
    list(c, pred) { return [...col(c).values()].filter((r) => !r.deletedAt && (!pred || pred(r))); },
    async put(c, rec) { col(c).set(rec.id, rec); return { undo: async () => {} }; },
    async batch(label, fn, o) { store.calls.push({ label, o }); fn({ put: (c, rec) => col(c).set(rec.id, rec) }); },
    async setSingleton(k, patch) { singletons[k] = { ...(singletons[k] || {}), ...patch }; },
    raw(c, id) { return col(c).get(id); },
    all(c) { return [...col(c).values()]; },
  };
  return store;
}

/** fx fals: curs fix per monedă, cu variație pe lună ca să se vadă cursul per apariție. */
export function createFakeFx(table = {}) {
  const base = { RON: '1', EUR: '5.3442', HUF: '0.01468', ...table };
  return {
    async getRate(cur, date) {
      const r = typeof base[cur] === 'function' ? base[cur](date) : base[cur];
      if (r == null) throw new Error(`fără curs pentru ${cur}`);
      return { ronPerUnit: r, eurPerUnit: String(Number(r) / 5.3442), rateDate: date, source: cur === 'RON' ? 'ron' : 'bnr', manual: false, stale: false };
    },
  };
}

export const NONE_VAT = { treatment: 'none', rateBp: null, deductiblePct: 0 };
export const mkTruck = (id, extra = {}) => ({ id, plate: id, activeFrom: '2020-01-01', activeTo: null, ...extra });
export function mkTemplate(over = {}) {
  return {
    id: 'tpl_a', name: 'Leasing', categoryId: 'cat_leasing', supplier: 'Banca', documentation: 'invoice', payment: 'bank',
    moneySource: 'company', financingId: null, target: { type: 'truck', truckIds: ['t1'] }, frequency: 'monthly', dayOfMonth: 5,
    startDate: '2026-01-01', backfillFrom: '2026-01', active: true, spreadMonths: null, totalMinor: null, ...over,
  };
}
export const versionEvent = (templateId, period, payload, over = {}) => ({
  id: `tev_${templateId}_v_${period}`, templateId, type: 'version', period, updatedAt: `${period}-01T00:00:00.000Z`,
  payload: { currency: 'RON', entered: 'gross', minor: 100000, vat: NONE_VAT, countryCode: 'RO', perTruck: null, components: null, ...payload }, ...over,
});
