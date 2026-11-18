// domain/financing.js: finanțare per camion și amortizare de management (plan 5.4, D14).
//
// Reguli:
//  - 'operational' (leasing operațional): rata întreagă este cost; NU există amortizare.
//  - 'financial' (leasing financiar) | 'credit' | 'cash' (cumpărare): amortizare liniară lunară
//    (valueMinor − residualMinor) / usefulLifeMonths, CALCULATĂ (nu stocată), înghețată în Closure la închidere.
//  - Principalul ratei NU intră în profit (costClass 'cashOnly', generat de recurring.js); dobânda și comisioanele da.
//  - Prima lună de amortizare = luna lui `startDate` (lună întreagă); după `usefulLifeMonths` luni amortizarea este 0.
//  - Împărțirea este exactă: restul de bani (valoare mod luni) cade pe ULTIMA lună, deci Σ lunilor = valoarea amortizabilă.
// Sumele sunt în moneda financiării (`f.currency`); pentru RON vezi `depreciationRonForMonth`.

import { addMonths, eachMonth, monthKey } from '../core/dates.js';
import { convert } from '../core/money.js';

export const FINANCING_TYPES = ['operational', 'financial', 'credit', 'cash'];

/** Tipurile care se amortizează. */
export const DEPRECIATING_TYPES = new Set(['financial', 'credit', 'cash']);

const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const isInt = (n) => Number.isSafeInteger(n);

/** Verifică o înregistrare Financing; întoarce [{ field, code, message }] (gol = valid). */
export function validateFinancing(f) {
  const errs = [];
  const add = (field, code, message) => errs.push({ field, code, message });
  if (!f || typeof f !== 'object') return [{ field: '', code: 'EMPTY', message: 'Finanțare lipsă.' }];
  if (!f.truckId) add('truckId', 'REQUIRED', 'Alege camionul.');
  if (!FINANCING_TYPES.includes(f.type)) add('type', 'TYPE', 'Tip de finanțare necunoscut.');
  if (!isInt(f.valueMinor) || f.valueMinor < 0) add('valueMinor', 'VALUE', 'Valoarea trebuie să fie un număr întreg ≥ 0.');
  if (f.residualMinor != null && (!isInt(f.residualMinor) || f.residualMinor < 0)) add('residualMinor', 'RESIDUAL', 'Valoarea reziduală trebuie să fie ≥ 0.');
  if (isInt(f.valueMinor) && isInt(f.residualMinor ?? 0) && (f.residualMinor ?? 0) > f.valueMinor) {
    add('residualMinor', 'RESIDUAL_GT_VALUE', 'Valoarea reziduală nu poate depăși valoarea.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate || '')) add('startDate', 'START', 'Data de start lipsește.');
  if (f.endDate && f.startDate && f.endDate < f.startDate) add('endDate', 'END_BEFORE_START', 'Data de final e înaintea startului.');
  if (DEPRECIATING_TYPES.has(f.type)) {
    if (!Number.isInteger(f.usefulLifeMonths) || f.usefulLifeMonths < 1) add('usefulLifeMonths', 'LIFE', 'Durata de viață utilă (luni) trebuie să fie ≥ 1.');
  }
  return errs;
}

/** Valoarea amortizabilă = valoare − reziduală (≥ 0). */
export function depreciableBase(f) {
  if (!f || !DEPRECIATING_TYPES.has(f.type)) return 0;
  return Math.max(0, (f.valueMinor || 0) - (f.residualMinor || 0));
}

/**
 * Amortizarea unei luni (în moneda financiării). Liniară; restul pe ultima lună; 0 înainte de start,
 * după durata utilă sau pentru leasing operațional. Pur și determinist.
 */
export function depreciationForMonth(f, month) {
  if (!f || f.deletedAt || !isMonth(month)) return 0;
  if (!DEPRECIATING_TYPES.has(f.type)) return 0;
  const life = f.usefulLifeMonths;
  if (!Number.isInteger(life) || life < 1 || !f.startDate) return 0;
  const startMonth = monthKey(f.startDate);
  const k = eachMonth(startMonth, month).length - 1; // 0-based; negativ ⇒ înainte de start
  if (month < startMonth || k < 0 || k >= life) return 0;
  const base = depreciableBase(f);
  const r = base % life;                  // exact pentru întregi sigure
  const q = (base - r) / life;
  return k === life - 1 ? q + r : q;
}

/** Amortizarea lunii în RON (valoarea înghețată a cursului de la start: `f.fx.ronPerUnit`). `null` dacă lipsește cursul. */
export function depreciationRonForMonth(f, month) {
  const d = depreciationForMonth(f, month);
  const cur = f?.currency || 'RON';
  if (cur === 'RON' || d === 0) return d;
  const rate = f.fx?.ronPerUnit ?? f.ronPerUnit;
  if (!rate) return null;
  return convert(d, cur, 'RON', rate);
}

/** Amortizarea cumulată între două luni inclusiv (în moneda financiării). */
export function depreciationForRange(f, fromMonth, toMonth) {
  let t = 0;
  for (const m of eachMonth(fromMonth, toMonth)) t += depreciationForMonth(f, m);
  return t;
}

/** Valoarea contabilă de management la SFÂRȘITUL lunii: valoare − amortizarea cumulată până la lună inclusiv. */
export function bookValueAtMonthEnd(f, month) {
  if (!f || !isMonth(month)) return 0;
  const start = monthKey(f.startDate || '0000-01-01');
  if (month < start) return f.valueMinor || 0;
  return (f.valueMinor || 0) - depreciationForRange(f, start, month);
}

/** Primele și ultima lună de amortizare (sau null pentru leasing operațional). */
export function depreciationSpan(f) {
  if (!f || !DEPRECIATING_TYPES.has(f.type) || !f.startDate || !Number.isInteger(f.usefulLifeMonths) || f.usefulLifeMonths < 1) return null;
  const from = monthKey(f.startDate);
  return { from, to: monthKey(addMonths(`${from}-01`, f.usefulLifeMonths - 1)) };
}

/** Financiările active într-o lună (după startDate/endDate) pentru un camion (sau toate). */
export function activeFinancings(financings, month, truckId) {
  return (financings || []).filter((f) => !f.deletedAt
    && (!truckId || f.truckId === truckId)
    && (!f.startDate || monthKey(f.startDate) <= month)
    && (!f.endDate || monthKey(f.endDate) >= month));
}

/**
 * Amortizarea pe camion într-o lună, în RON: { [truckId]: Minor }. Financiările în valută fără curs sunt
 * raportate în `missingRate` (nu se presupune niciun curs).
 */
export function depreciationByTruck(financings, month) {
  const byTruck = {};
  const missingRate = [];
  for (const f of financings || []) {
    if (f.deletedAt) continue;
    const d = depreciationRonForMonth(f, month);
    if (d === null) { missingRate.push(f.id); continue; }
    if (d === 0) continue;
    byTruck[f.truckId] = (byTruck[f.truckId] || 0) + d;
  }
  return { byTruck, total: Object.values(byTruck).reduce((a, b) => a + b, 0), missingRate };
}

/**
 * Plan complet de amortizare (pentru ecranul Setări / Camion): [{ month, depreciation, bookValueEnd }].
 */
export function depreciationSchedule(f) {
  const span = depreciationSpan(f);
  if (!span) return [];
  let book = f.valueMinor || 0;
  return eachMonth(span.from, span.to).map((month) => {
    const depreciation = depreciationForMonth(f, month);
    book -= depreciation;
    return { month, depreciation, bookValueEnd: book };
  });
}

/**
 * Sinteză pe o finanțare din intrările generate de șabloanele legate (source 'recurring', cu `financingId`
 * pe șablon): principal plătit (cashOnly), dobândă + comisioane (cost). Valorile în RON.
 */
export function financingSummary(f, templates, entries) {
  const tplIds = new Set((templates || []).filter((t) => t.financingId === f.id && !t.deletedAt).map((t) => t.id));
  let principal = 0, interestAndFees = 0, count = 0;
  for (const e of entries || []) {
    if (e.deletedAt || e.source !== 'recurring' || !tplIds.has(e.recurring?.templateId)) continue;
    count++;
    if (e.costClass === 'cashOnly') principal += e.ron?.gross ?? 0;
    else interestAndFees += e.ron?.cost ?? e.ron?.gross ?? 0;
  }
  return { principalPaidRon: principal, interestAndFeesRon: interestAndFees, entries: count };
}
