// A – Alerte de expirare (17.3): ITP, RCA, CASCO, calibrare tahograf, rovinietă, permis, card tahograf, pe camion / remorcă / șofer.
// Doar în aplicație + export .ics (calendar). Fără e-mail, fără push. Calcul pur; ceasul (`today`) se injectează.
//
// Colecția `expiries`: Expiry = {
//   id, subjectType:'truck'|'trailer'|'driver', subjectId, kind: cheie din EXPIRY_KINDS (sau 'other'), label?: string (pentru 'other'),
//   dueDate: IsoDate, note?: string, renewedAt?: string|null (ISO), active?: boolean (implicit true), createdAt, updatedAt, ... }
// Reînnoire: se adaugă o înregistrare nouă cu `dueDate` mai târziu (sau `renewExpiry`); cea veche primește `renewedAt`.
// Din fiecare grup (subiect, tip) contează doar cea mai târzie scadență nereînnoită.
import { addDays, diffDays, fmtDate } from '../core/dates.js';
import { newId } from '../core/ids.js';
import { coll } from './profit.js';

export const EXPIRY_KINDS = Object.freeze({
  ITP: { label: 'ITP', subjects: ['truck', 'trailer'] },
  RCA: { label: 'RCA', subjects: ['truck', 'trailer'] },
  CASCO: { label: 'CASCO', subjects: ['truck', 'trailer'] },
  TAHO_CAL: { label: 'Calibrare tahograf', subjects: ['truck'] },
  ROVINIETA: { label: 'Rovinietă', subjects: ['truck'] },
  PERMIS: { label: 'Permis de conducere', subjects: ['driver'] },
  CARD_TAHO: { label: 'Card tahograf', subjects: ['driver'] },
  other: { label: 'Altele', subjects: ['truck', 'trailer', 'driver'] },
});

/** Praguri de alertă în zile (30/15/7) și nivelurile rezultate. */
export const EXPIRY_THRESHOLDS = Object.freeze([30, 15, 7]);

/**
 * Starea unei scadențe față de azi.
 *  daysLeft < 0 ⇒ 'overdue'; 0 ⇒ 'today'; 1..7 ⇒ 'd7'; 8..15 ⇒ 'd15'; 16..30 ⇒ 'd30'; > 30 ⇒ 'ok'.
 * @returns {{ daysLeft:number, level:'overdue'|'today'|'d7'|'d15'|'d30'|'ok', severity:'error'|'warn'|'info'|null }}
 */
export function expiryStatus(dueDate, today) {
  const daysLeft = diffDays(today, dueDate);
  let level = 'ok';
  if (daysLeft < 0) level = 'overdue';
  else if (daysLeft === 0) level = 'today';
  else if (daysLeft <= 7) level = 'd7';
  else if (daysLeft <= 15) level = 'd15';
  else if (daysLeft <= 30) level = 'd30';
  const severity = level === 'overdue' || level === 'today' || level === 'd7' ? 'error' : level === 'd15' ? 'warn' : level === 'd30' ? 'info' : null;
  return { daysLeft, level, severity };
}

export function expiryLabel(rec) {
  return (rec.kind === 'other' && rec.label) ? rec.label : (EXPIRY_KINDS[rec.kind]?.label || rec.label || rec.kind);
}

/** Text ro pentru nivel: „expirat de 3 zile”, „expiră azi”, „în 7 zile”. */
export function expiryText(st) {
  if (st.level === 'overdue') return `expirat de ${-st.daysLeft} ${-st.daysLeft === 1 ? 'zi' : 'zile'}`;
  if (st.level === 'today') return 'expiră azi';
  if (st.daysLeft === 1) return 'mâine';
  return `în ${st.daysLeft} zile`;
}

function subjectName(state, type, id) {
  if (type === 'truck') { const t = coll(state, 'trucks').find((x) => x.id === id); return t ? (t.plateDisplay || t.plate) : id; }
  if (type === 'trailer') { const t = coll(state, 'trailers').find((x) => x.id === id); return t ? (t.plate) : id; }
  if (type === 'driver') { const t = coll(state, 'drivers').find((x) => x.id === id); return t ? t.name : id; }
  return id;
}

/** Scadențele „curente”: pe (subiect, tip) cea mai târzie nereînnoită și activă. */
export function currentExpiries(state) {
  const best = new Map();
  for (const r of coll(state, 'expiries')) {
    if (r.active === false || r.renewedAt || !r.dueDate) continue;
    const key = `${r.subjectType}|${r.subjectId}|${r.kind}|${r.kind === 'other' ? r.label || '' : ''}`;
    const cur = best.get(key);
    if (!cur || r.dueDate > cur.dueDate) best.set(key, r);
  }
  return [...best.values()];
}

/**
 * Alertele pentru Acasă: toate scadențele curente aflate la ≤ 30 de zile sau depășite, cele mai urgente primele.
 * Reînnoirea (o scadență nouă mai târzie) face ca alerta veche să dispară.
 * @returns {Array<{ id, subjectType, subjectId, subjectName, kind, label, dueDate, daysLeft, level, severity, text }>}
 */
export function expiryAlerts(state, today, o = {}) {
  const maxDays = o.withinDays ?? 30;
  const out = [];
  for (const r of currentExpiries(state)) {
    const st = expiryStatus(r.dueDate, today);
    if (st.daysLeft > maxDays) continue;
    out.push({
      id: r.id, subjectType: r.subjectType, subjectId: r.subjectId, subjectName: subjectName(state, r.subjectType, r.subjectId),
      kind: r.kind, label: expiryLabel(r), dueDate: r.dueDate, daysLeft: st.daysLeft, level: st.level, severity: st.severity, text: expiryText(st),
    });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft || (a.subjectName < b.subjectName ? -1 : a.subjectName > b.subjectName ? 1 : a.label < b.label ? -1 : 1));
  return out;
}

/** Toate scadențele curente (și cele îndepărtate) pentru lista din Setări / pe Camion. */
export function expiryList(state, today) {
  return currentExpiries(state).map((r) => {
    const st = expiryStatus(r.dueDate, today);
    return { id: r.id, subjectType: r.subjectType, subjectId: r.subjectId, subjectName: subjectName(state, r.subjectType, r.subjectId), kind: r.kind, label: expiryLabel(r), dueDate: r.dueDate, note: r.note || '', ...st, text: expiryText(st) };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Reînnoire: întoarce înregistrările de scris (`put`): cea veche marcată reînnoită și una nouă cu scadența nouă.
 * @param {object} rec scadența curentă @param {string} newDueDate @param {string} nowIso
 */
export function renewExpiry(rec, newDueDate, nowIso, o = {}) {
  if (!(newDueDate > rec.dueDate)) throw new RangeError('scadența nouă trebuie să fie după cea veche');
  const old = { ...rec, renewedAt: nowIso, updatedAt: nowIso };
  const next = {
    ...rec, id: o.id || newId('exp'), dueDate: newDueDate, renewedAt: null, createdAt: nowIso, updatedAt: nowIso, note: o.note ?? rec.note ?? '',
  };
  return { old, next };
}

// --------------------------------------------------------------------------- iCalendar (.ics)
function icsEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** Împarte linia la 75 de octeți UTF-8 (RFC 5545 §3.1), continuare cu CRLF + spațiu. */
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) { parts.push(cur); cur = ''; curBytes = 0; limit = 74; }
    cur += ch; curBytes += b;
  }
  if (cur) parts.push(cur);
  return parts.join('\r\n ');
}
const ymd = (d) => d.replace(/-/g, '');
const stamp = (iso) => { const t = iso.replace(/[-:]/g, '').replace(/\.\d+/, ''); return t.endsWith('Z') ? t : t + 'Z'; };

/**
 * Calendar .ics cu o zi întreagă pe scadență, cu memento (VALARM afișat) cu 30, 15 și 7 zile înainte.
 * Fără e-mail / push: calendarul utilizatorului afișează mementourile. `nowIso` injectat (DTSTAMP).
 * @param {object} state @param {{nowIso:string, today?:string, includeFuture?:boolean, calName?:string}} o
 * @returns {string} text iCalendar cu linii CRLF
 */
export function buildIcs(state, o) {
  const nowIso = o.nowIso;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flota Costuri//Scadente//RO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(o.calName || 'Flota Costuri – scadențe')}`,
  ];
  const items = currentExpiries(state).sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : 1));
  for (const r of items) {
    const name = subjectName(state, r.subjectType, r.subjectId);
    const title = `${expiryLabel(r)} – ${name}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@flota-costuri`,
      `DTSTAMP:${stamp(nowIso)}`,
      `DTSTART;VALUE=DATE:${ymd(r.dueDate)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(r.dueDate, 1))}`,
      `SUMMARY:${icsEscape('Expiră: ' + title)}`,
      `DESCRIPTION:${icsEscape(`${title}. Scadență ${fmtDate(r.dueDate)}.${r.note ? ' ' + r.note : ''}`)}`,
      'TRANSP:TRANSPARENT',
    );
    for (const d of EXPIRY_THRESHOLDS) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`${title} expiră în ${d} zile`)}`, `TRIGGER:-P${d}D`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
