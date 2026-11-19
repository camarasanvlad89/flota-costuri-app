// Ecranul „Ghid: cum se folosește aplicația”: cuprins, căutare, secțiuni expandabile, bloc „Despre aplicație”.
// Conținutul vine din ./content.js (aceeași sursă ca docs/GHID-UTILIZATOR.md).
import { html, useState, useEffect, useMemo, useRef } from '../dom.js';
import { useCtx, useSingleton } from '../hooks.js';
import { t } from '../strings.js';
import { Icon, Button, Card, Note, PageHeader } from '../components/index.js';
import { backupAgeLabel } from '../selectors.js';
import { fmtDate } from '../../core/index.js';
import { GUIDE, NEWS, inline, filterGuide, allIds } from './content.js';

const IDS = allIds(GUIDE);

/** Text cu marcaje → noduri. În modul „embedded” (ecranul de bun venit) legăturile către ecrane nu se pot deschide. */
export function Inline({ text, embedded, go }) {
  return html`${inline(text).map((p) => {
    if (p.t === 'b') return html`<strong>${p.x}</strong>`;
    if (p.t === 'code') return html`<code>${p.x}</code>`;
    if (p.t === 'link') {
      const guideLink = p.to.startsWith('/ghid/');
      if (embedded && !guideLink) return html`<span class="glink off" title="Se poate deschide după ce alegi cum începi">${p.x}</span>`;
      return html`<a class="glink" href=${'#' + p.to} onClick=${embedded ? (e) => { e.preventDefault(); go(p.to); } : null}>${p.x}</a>`;
    }
    return p.x;
  })}`;
}

export function Block({ b, embedded, go, nav }) {
  const I = (x) => html`<${Inline} text=${x} embedded=${embedded} go=${go} />`;
  switch (b.t) {
    case 'p': return html`<p>${I(b.x)}</p>`;
    case 'ul': return html`<ul>${b.items.map((i) => html`<li>${I(i)}</li>`)}</ul>`;
    case 'ol': return html`<ol>${b.items.map((i) => html`<li>${I(i)}</li>`)}</ol>`;
    case 'dl': return html`<dl class="guide-dl">${b.items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${I(v)}</dd></div>`)}</dl>`;
    case 'note': return html`<${Note}>${I(b.x)}<//>`;
    case 'warn': return html`<${Note} kind="warn">${I(b.x)}<//>`;
    case 'ex': return html`<div class="note-box guide-ex">${I(b.x)}</div>`;
    case 'steps': return html`<ol class="checklist guide-steps">${b.items.map((s, n) => html`<li>
      <span class="st c-accent" aria-hidden="true">${n + 1}</span><span class="tx">${I(s.x.replace(/^\*\*\d+\.\s*/, '**'))}</span>
      ${!embedded && s.to ? html`<${Button} sm kind="sec" onClick=${() => nav(s.to)}>Deschide<//>` : null}</li>`)}</ol>`;
    default: return null;
  }
}

function GuideCard({ c, open, toggle, embedded, go, nav }) {
  return html`<article class="card guide-card" id=${'g-' + c.id}>
    <h3 class="guide-h"><button type="button" aria-expanded=${open ? 'true' : 'false'} aria-controls=${'gb-' + c.id} onClick=${toggle}><span>${c.title}</span><${Icon} name="chev-down" /></button></h3>
    <div class="guide-body" id=${'gb-' + c.id} hidden=${!open}>${c.blocks.map((b) => html`<${Block} b=${b} embedded=${embedded} go=${go} nav=${nav} />`)}</div></article>`;
}

/** „Despre aplicație”: versiune, dată build, mod, ultimul backup, noutăți. */
export function AboutBlock() {
  const ctx = useCtx();
  const ui = useSingleton('ui');
  const version = (ctx.config && ctx.config.appVersion) || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');
  const built = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;
  const nowMs = ctx.clock ? ctx.clock.now() : Date.now();
  const google = ctx.mode === 'google';
  const email = ctx.auth && ctx.auth.user ? ctx.auth.user.email : null;
  return html`<${Card} title="Despre aplicație" class="guide-about">
    <div class="kvgrid guide-about-grid">
      <div><span>Versiune</span><span>${version}</span></div>
      <div><span>Data build-ului</span><span>${built ? fmtDate(built.slice(0, 10)) : '—'}</span></div>
      <div><span>Mod curent</span><span>${google ? 'Google Drive' : 'Local'}</span></div>
      <div><span>Ultimul backup</span><span>${backupAgeLabel(ui.lastBackupAt, nowMs)}</span></div></div>
    <p class="guide-about-mode">${google
      ? html`<b>Mod Google Drive.</b> Datele sunt într-un fișier din folderul ascuns al aplicației din Google Drive${email ? html`, pentru contul <b>${email}</b>` : ''}.`
      : html`<b>Mod local.</b> Datele sunt doar în browserul acestui dispozitiv. Alt browser sau alt dispozitiv are alt set de date. Pentru a le păstra, fă backup.`}</p>
    <div class="toolbar"><${Button} icon="download" onClick=${() => ctx.downloadBackup && ctx.downloadBackup()}>${t.errors.backup}<//></div>
    <h3 class="guide-news-h">Noutăți în versiunea ${NEWS.version}</h3>
    <ul class="guide-news">${NEWS.items.map((i) => html`<li>${i}</li>`)}</ul><//>`;
}

/**
 * @param {{ sectionId?:string, embedded?:boolean, onClose?:()=>void }} props
 * `embedded` = afișat pe ecranul de bun venit, înainte ca aplicația să aibă date: navigarea este locală, nu prin rută.
 */
export function GuideView({ sectionId, embedded, onClose }) {
  const ctx = useCtx();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [tocOpen, setTocOpen] = useState(false);
  const [localId, setLocalId] = useState(sectionId || null);
  const id = embedded ? localId : sectionId || null;
  const rootRef = useRef(null);
  const go = (to) => { const target = to.replace('/ghid/', ''); if (embedded) setLocalId(target); else ctx.nav('/ghid/' + target); };
  const nav = (to) => ctx.nav(to);
  const sections = useMemo(() => filterGuide(GUIDE, q), [q]);
  const searching = q.trim().length > 0;
  const cur = id && IDS.get(id) ? IDS.get(id) : null;

  useEffect(() => { // legătură directă către o secțiune sau o rețetă: o deschide și derulează la ea
    if (!cur) return undefined;
    if (cur.card) setOpen((s) => new Set(s).add(cur.card));
    setQ('');
    const tm = setTimeout(() => {
      const el = document.getElementById('g-' + id);
      if (!el) return;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      const b = el.querySelector('button');
      if (b && b.focus) b.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(tm);
  }, [id]);

  const toggle = (cid) => setOpen((s) => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });
  const allCards = GUIDE.sections.flatMap((s) => s.cards.map((c) => c.id));
  const curSection = cur ? cur.section : GUIDE.sections[0].id;
  const total = sections.reduce((n, s) => n + s.cards.length, 0);

  return html`<div class="stack guide" ref=${rootRef}>
    ${embedded ? html`<div class="toolbar"><${Button} kind="sec" icon="back" onClick=${onClose}>Înapoi la început<//></div>` : null}
    <${PageHeader} title=${GUIDE.title} sub=${GUIDE.intro}>
      <${Button} sm kind="sec" class="no-print" onClick=${() => window.print()}>Tipărește sau salvează PDF<//><//>
    ${embedded ? null : html`<${AboutBlock} />`}
    <div class="card guide-tools no-print" role="search">
      <label class="field"><span class="lbl">Caută în ghid</span>
        <input class="inp" type="search" placeholder="de exemplu: backup, TVA, km pe gol" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
      <div class="toolbar">
        <${Button} sm kind="ghost" onClick=${() => setOpen(new Set(allCards))}>Deschide toate<//>
        <${Button} sm kind="ghost" onClick=${() => setOpen(new Set())}>Închide toate<//>
        <button type="button" class="btn ghost sm guide-toc-btn" aria-expanded=${tocOpen ? 'true' : 'false'} aria-controls="guide-toc-list" onClick=${() => setTocOpen(!tocOpen)}><${Icon} name="inbox" size="sm" />Cuprins</button></div>
      <p class="muted sm" role="status" aria-live="polite">${searching ? (total ? total + (total === 1 ? ' rezultat' : ' rezultate') : 'Niciun rezultat. Încearcă alt cuvânt.') : GUIDE.sections.length + ' capitole'}</p></div>
    <div class="split guide-split">
      <nav class=${'card listnav guide-toc no-print' + (tocOpen ? ' open' : '')} aria-label="Cuprinsul ghidului"><div id="guide-toc-list" class="guide-toc-list">
        ${sections.map((s) => html`<button type="button" aria-current=${s.id === curSection ? 'true' : null} onClick=${() => { setTocOpen(false); go('/ghid/' + s.id); }}>${s.title}</button>`)}</div></nav>
      <div class="guide-main stack">${sections.length === 0 ? html`<${Note}>Nimic găsit pentru „${q}”.<//>` : sections.map((s) => html`<section aria-labelledby=${'g-' + s.id} class="stack">
        <h2 class="guide-sec" id=${'g-' + s.id} tabindex="-1">${s.title}</h2>
        ${s.cards.map((c) => html`<${GuideCard} key=${c.id} c=${c} open=${searching || open.has(c.id)} toggle=${() => toggle(c.id)} embedded=${embedded} go=${go} nav=${nav} />`)}</section>`)}</div></div></div>`;
}
