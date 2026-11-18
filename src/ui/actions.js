// Acțiuni de scriere reutilizate de ecrane (ștergere cu Anulează, confirmări, backup).
import { api, tryCall } from './api.js';
import { coll, companyOf } from './selectors.js';
import { convert } from '../core/index.js';
import { t } from './strings.js';

function undoToast(ctx, text, undo) {
  ctx.toast({ kind: 'ok', text, actionLabel: t.common.undo, onAction: () => { Promise.resolve(undo()).catch((e) => ctx.toast({ kind: 'error', text: e.message })); } });
}

/** Șterge intrări (logic). Cele recurente trec prin registrul de ocurențe. Toast „Anulează” 15 s. */
export async function deleteEntries(ctx, ids) {
  const list = coll(ctx.store.state(), 'entries').filter((e) => ids.includes(e.id));
  const undos = [];
  const delRec = api('deleteRecurringEntry');
  for (const e of list) {
    if (e.source === 'recurring' && delRec) {
      const r = delRec(ctx.store, e.id);
      await r.done;
      undos.push(() => r.undo());
    } else {
      const r = await ctx.store.remove('entries', e.id);
      undos.push(() => r.undo());
    }
  }
  undoToast(ctx, list.length === 1 ? 'Intrarea a fost ștearsă.' : `${list.length} intrări șterse.`, async () => { for (const u of undos.reverse()) await u(); });
  return list.length;
}

/** Confirmă intrările (status → confirmed) într-o singură tranzacție. */
export async function confirmEntries(ctx, ids) {
  const set = new Set(ids);
  const list = coll(ctx.store.state(), 'entries').filter((e) => set.has(e.id));
  if (!list.length) return 0;
  const now = new Date().toISOString();
  const res = await ctx.store.putMany('entries', list.map((e) => ({ ...e, status: 'confirmed', updatedAt: now })));
  undoToast(ctx, `${list.length} ${list.length === 1 ? 'intrare confirmată' : 'intrări confirmate'}.`, () => res.undo());
  return list.length;
}

/** „Confirmă toate automatele”: o tranzacție, cu Anulează. */
export async function confirmAllAuto(ctx, filter) {
  const fn = api('confirmAllPending');
  if (fn) {
    const r = fn(ctx.store, filter);
    await r.done;
    undoToast(ctx, `${r.count} intrări automate confirmate.`, () => r.undo());
    return r.count;
  }
  const ids = coll(ctx.store.state(), 'entries').filter((e) => e.status === 'auto_pending' && (!filter || filter(e))).map((e) => e.id);
  return confirmEntries(ctx, ids);
}

export async function downloadBackupFile(ctx) {
  const exp = api('exportBackup');
  if (!exp) { ctx.toast({ kind: 'error', text: t.errors.missingApi('exportBackup') }); return; }
  const { filename, json } = exp(ctx.store.exportDoc());
  const dl = api('downloadBytes');
  const bytes = new TextEncoder().encode(json);
  if (dl) dl(bytes, filename, 'application/json');
  else {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  await ctx.store.setSingleton('ui', { lastBackupAt: new Date().toISOString() });
}
export function saveBytes(bytes, filename, mime) {
  const dl = api('downloadBytes');
  if (dl) { dl(bytes, filename, mime); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const stamp = (rec, deviceId) => ({ ...rec, updatedAt: new Date().toISOString(), updatedBy: deviceId });

/** Introducerea prețului unei curse fără preț, direct din coadă. */
export async function repriceCourse(ctx, course, { net, gross }) {
  const company = companyOf(ctx.store.state());
  const p = tryCall('priceFromColumns', [{ net, gross, date: course.invoiceDate || course.loadDate, company }], null);
  if (!p || p.net == null) throw new Error('Preț invalid');
  const cur = course.currency || 'RON';
  let rate = null;
  try { rate = course.fx && course.fx.ronPerUnit ? course.fx : await ctx.fx.getRate(cur, course.invoiceDate || course.unloadDate || course.loadDate); } catch { /* fără curs */ }
  const toRon = (v) => (cur === 'RON' ? v : rate ? convert(v, cur, 'RON', rate.ronPerUnit) : v);
  const toEur = (v) => (rate && rate.eurPerUnit ? convert(v, cur, 'EUR', rate.eurPerUnit) : null);
  const next = { ...course, net: p.net, vat: p.vat, gross: p.gross, vatBp: p.vatBp, vatDerived: p.vatDerived, priceStatus: p.priceStatus, status: 'ok', fx: rate || course.fx,
    ron: { net: toRon(p.net), vat: toRon(p.vat), gross: toRon(p.gross) }, eur: { net: toEur(p.net), vat: toEur(p.vat), gross: toEur(p.gross) },
    manualFields: [...new Set([...(course.manualFields || []), 'net', 'vat', 'gross'])], updatedAt: new Date().toISOString() };
  const r = await ctx.store.put('courses', next);
  ctx.toast({ kind: 'ok', text: 'Prețul a fost salvat.', actionLabel: t.common.undo, onAction: () => r.undo() });
}

