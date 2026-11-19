import { html, useState, useEffect, useRef, useMemo } from './dom.js';
import { CtxContext, useCtx, useStore, useDisplayCurrency, useMonth, useSingleton, useCollection } from './hooks.js';
import { useLocation, matchRoute, navigate } from './router.js';
import { navItems, screens } from './registry.js';
import { t } from './strings.js';
import { Icon, ErrorBoundary, Button, IconButton, Drawer, Sheet, Modal, ToastHost, ConfirmDialog, ShortcutsDialog, SyncStatus, DataStatus, DataStatusPanel, DemoBadge, Loading, EntryForm, Badge } from './components/index.js';
import { verifyCount, monthLabel, shiftMonth, isFirstRun, lastEntry, entryToForm, backupAgeDays, backupAgeLabel, backupReminderDue, sharedOriginAckKey, coll } from './selectors.js';
import { todayLocal } from '../core/index.js';
import { Welcome } from './Welcome.js';

function useToasts(host) {
  const [list, setList] = useState(host.toasts);
  useEffect(() => host.subscribeToasts(setList), [host]);
  return list;
}

function NavButton({ s, active, count }) {
  const ctx = useCtx();
  const path = s.nav.path || s.route.replace(/\/:.*$/, '');
  return html`<button type="button" class="nav" aria-current=${active ? 'page' : null} title=${s.title()} onClick=${() => ctx.nav(path)}>
    <${Icon} name=${s.nav.icon} /><span class="lbl">${s.nav.label}</span>${count ? html`<span class="badge" aria-label=${count + ' de verificat'}>${count}</span>` : null}</button>`;
}

function Sidebar({ screen }) {
  const queue = useStore(verifyCount);
  const company = useSingleton('company');
  const items = navItems();
  let lastGroup = null;
  return html`<aside class="side" aria-label="Meniu">
    <div class="org" style="cursor:default"><span class="logo" aria-hidden="true"></span><div><b>${company.name || t.appName}</b><span>Administrator</span></div></div>
    <nav aria-label="Ecrane">${items.map((s) => {
      const g = s.nav.group;
      const head = g && g !== lastGroup ? html`<div class="nav-grp">${t.nav.groups[g] || g}</div>` : null;
      lastGroup = g;
      return html`${head}<${NavButton} s=${s} active=${screen && (screen.id === s.id || (s.nav.also || []).includes(screen.id))} count=${s.id === 'verify' ? queue : 0} />`;
    })}</nav>
    <div class="spacer"></div></aside>`;
}

function MonthPicker() {
  const [m, setM] = useMonth();
  const ctx = useCtx();
  const state = ctx.store.state();
  const closed = state && (state.singletons ? state.singletons.company : state.company);
  const isClosed = closed && closed.closedThrough && m <= closed.closedThrough;
  return html`<div class="row" role="group" aria-label="Luna afișată" style="gap:2px">
    <${IconButton} icon="back" label="Luna anterioară" onClick=${() => setM(shiftMonth(m, -1))} />
    <span class="pill-btn month-lbl">${html`<${Icon} name=${isClosed ? 'lock' : 'clock'} size="sm" />`} ${monthLabel(m)}${isClosed ? html` <span class="sr-only vh">(lună închisă)</span>` : null}</span>
    <${IconButton} icon="chev" label="Luna următoare" onClick=${() => setM(shiftMonth(m, 1))} /></div>`;
}
function CurrencyToggle() {
  const [cur, setCur] = useDisplayCurrency();
  return html`<div class="seg" role="group" aria-label="Moneda de afișare"><button type="button" aria-pressed=${cur === 'RON'} onClick=${() => setCur('RON')}>RON</button><button type="button" aria-pressed=${cur === 'EUR'} onClick=${() => setCur('EUR')} title=${t.eurNote}>EUR</button></div>`;
}

const LS_SNOOZE = 'flota:backupSnoozeUntil';
const LS_ORIGIN_ACK = 'flota:sharedOriginAck';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* mod privat: se reafișează la următoarea deschidere */ } };

/**
 * Notificări: nimic nu stă permanent pe pagină și nimic nu mută conținutul (stratul e plutitor).
 * - probleme reale (date doar în memorie, ceas greșit): vizibile cât timp durează;
 * - memento backup: doar dacă ai date și backup-ul lipsește sau are peste 7 zile; „Mai târziu” îl amână 24 h;
 * - origine partajată (github.io): o singură dată, până la „Am înțeles”.
 */
function Notices() {
  const ctx = useCtx();
  const ui = useSingleton('ui');
  const [, bump] = useState(0);
  const now = ctx.clock.now();
  const st = ctx.store.state();
  const hasData = (ui.welcomeDone && !isFirstRun(st)) || coll(st, 'entries').length > 0;
  const originKey = sharedOriginAckKey(typeof location !== 'undefined' ? location.hostname : '', ctx.sharedOrigin);
  const items = [];
  if (ctx.memoryOnly) items.push(html`<div class="banner danger plain" role="alert"><${Icon} name="alert" /><span>${t.banners.memoryOnly}</span><button type="button" class="lnk" onClick=${ctx.downloadBackup}>${t.errors.backup}</button></div>`);
  if (ctx.clockBad) items.push(html`<div class="banner danger plain" role="alert"><${Icon} name="clock" /><span>${t.banners.clock}</span></div>`);
  const soft = []; // notificările „moi” vin pe rând: întâi avertismentul de origine (o singură dată), apoi memento-ul de backup
  if (originKey && lsGet(LS_ORIGIN_ACK) !== originKey) {
    soft.push(html`<div class="banner caution plain" role="status" data-testid="shared-origin"><${Icon} name="alert" /><span>${ctx.sharedOrigin.accepted ? t.banners.sharedOrigin : t.banners.sharedOriginBlocked}</span>
      <button type="button" class="lnk" onClick=${() => { lsSet(LS_ORIGIN_ACK, originKey); bump((n) => n + 1); }}>Am înțeles</button>
      <button type="button" class="lnk" onClick=${() => ctx.nav('/setari/date')}>Detalii</button></div>`);
  }
  if (backupReminderDue({ lastBackupAt: ui.lastBackupAt, nowMs: now, snoozeUntil: Number(lsGet(LS_SNOOZE)), hasData })) {
    soft.push(html`<div class="banner caution plain" role="status" data-testid="backup-reminder"><${Icon} name="download" /><span>${t.banners.backupDue(backupAgeLabel(ui.lastBackupAt, now))}</span>
      <button type="button" class="lnk" onClick=${() => ctx.downloadBackup()}>Descarcă acum</button>
      <button type="button" class="lnk" onClick=${() => { lsSet(LS_SNOOZE, String(now + 86400000)); bump((n) => n + 1); }}>Mai târziu</button></div>`);
  }
  if (soft.length) items.push(soft[0]);
  return items.length ? html`<section class="notices" aria-label="Notificări">${items.map((b, i) => html`<div key=${i}>${b}</div>`)}</section>` : null;
}

function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('flota:theme') || ''; } catch { return ''; } });
  function applyTheme(v) {
    setTheme(v);
    try { v ? localStorage.setItem('flota:theme', v) : localStorage.removeItem('flota:theme'); } catch { /* ignorat */ }
    if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme');
  }
  return [theme, applyTheme];
}

/** Acțiunile generale (anulare, taste rapide, temă, backup, deconectare): meniul ⋯ de pe desktop și foaia „Mai mult” de pe telefon. */
function MenuActions() {
  const ctx = useCtx();
  const [theme, applyTheme] = useTheme();
  return html`<button type="button" role="menuitem" class="nav" disabled=${!ctx.host.hasUndo()} onClick=${() => ctx.host.undoLast()}>${t.common.undoLast}</button>
    <button type="button" role="menuitem" class="nav hide-phone" onClick=${() => ctx.showShortcuts()}>${t.common.shortcuts} <span class="kbd">?</span></button>
    <button type="button" role="menuitem" class="nav" onClick=${() => applyTheme(theme === 'dark' ? 'light' : theme === 'light' ? '' : 'dark')}>Temă: ${theme === 'dark' ? 'închisă' : theme === 'light' ? 'deschisă' : 'automată'}</button>
    <button type="button" role="menuitem" class="nav" onClick=${ctx.downloadBackup}>Descarcă backup JSON</button>
    ${ctx.auth && ctx.auth.user ? html`<button type="button" role="menuitem" class="nav" onClick=${() => ctx.signOut()}>Deconectare (${ctx.auth.user.email})</button>` : null}`;
}

function Topbar({ mode }) {
  const ctx = useCtx();
  const [menu, setMenu] = useState(false);
  return html`<header class="top">
    <${MonthPicker} /><${CurrencyToggle} />
    <${DemoBadge} />
    <div class="toolbar tb-right">
      <${SyncStatus} />
      <${DataStatus} />
      <span class="hide-phone"><${IconButton} icon="help" label="Cum se folosește" onClick=${() => ctx.nav('/ghid')} /></span>
      <${Button} sm icon="plus" class="hide-phone" onClick=${() => ctx.openEntry('expense')} title="n">${t.nav.entry}<//>
      <${Button} sm kind="sec" icon="plus" class="hide-phone" onClick=${() => ctx.openEntry('income')} title="v">${t.nav.income}<//>
      <div class="menu-wrap hide-phone">
        <${IconButton} icon="more" label="Mai multe" aria-haspopup="menu" aria-expanded=${menu} onClick=${() => setMenu(!menu)} />
        ${menu ? html`<div class="card menu-pop" role="menu" onClick=${() => setMenu(false)}><${MenuActions} /></div>` : null}
      </div></div></header>`;
}

/** Bara de jos de pe telefon (8.0.3): Acasă, Camioane, + Adaugă, De verificat, Mai mult. */
function MobileNav({ screen }) {
  const ctx = useCtx();
  const queue = useStore(verifyCount);
  const [sheet, setSheet] = useState(null);
  const id = screen && screen.id;
  const mainIds = ['home', 'truck', 'verify'];
  const items = navItems().filter((s) => !mainIds.includes(s.id));
  const tab = (key, icon, label, active, onClick, count, cls) => html`<button type="button" class=${'mtab ' + (cls || '')} aria-current=${active ? 'page' : null} aria-label=${count ? label + ', ' + count : null} onClick=${onClick}>
    <span class="mic"><${Icon} name=${icon} />${count ? html`<span class="badge" aria-hidden="true">${count}</span>` : null}</span><span class="mlbl">${label}</span></button>`;
  const go = (path) => { setSheet(null); ctx.nav(path); };
  return html`<nav class="mnav" aria-label="Navigare principală">
      ${tab('home', 'home', t.nav.home, id === 'home', () => go('/acasa'))}
      ${tab('truck', 'truck', t.nav.trucks, id === 'truck', () => go('/camion'))}
      ${tab('add', 'plus', 'Adaugă', false, () => setSheet('add'), 0, 'mtab-add')}
      ${tab('verify', 'inbox', t.nav.verify, id === 'verify', () => go('/verificare'), queue)}
      ${tab('more', 'more', 'Mai mult', !!id && !mainIds.includes(id), () => setSheet('more'))}</nav>
    ${sheet === 'add' ? html`<${Sheet} title="Adaugă" onClose=${() => setSheet(null)}><div class="sheet-list">
      <button type="button" class="nav" onClick=${() => { setSheet(null); ctx.openEntry('expense'); }}><${Icon} name="plus" /><span class="lbl">${t.nav.entry}</span></button>
      <button type="button" class="nav" onClick=${() => { setSheet(null); ctx.openEntry('income'); }}><${Icon} name="cash" /><span class="lbl">${t.nav.income}</span></button>
      <button type="button" class="nav" onClick=${() => go('/curse?nou=1')}><${Icon} name="route" /><span class="lbl">Cursă nouă</span></button></div><//>` : null}
    ${sheet === 'more' ? html`<${Sheet} title="Mai mult" onClose=${() => setSheet(null)}><div class="sheet-list" role="menu">
      ${items.map((s) => html`<button type="button" role="menuitem" class="nav" aria-current=${id === s.id ? 'page' : null} onClick=${() => go(s.nav.path || s.route.replace(/\/:.*$/, ''))}><${Icon} name=${s.nav.icon} /><span class="lbl">${s.nav.label}</span></button>`)}
      <div class="sheet-sep"></div><div onClick=${() => setSheet(null)}><${MenuActions} /></div></div><//>` : null}`;
}

function NotFound() {
  const ctx = useCtx();
  return html`<div class="empty"><${Icon} name="alert" /><b>${t.errors.notFound}</b><${Button} onClick=${() => ctx.nav('/acasa')}>${t.nav.home}<//></div>`;
}

export function App({ ctx, mode }) {
  const loc = useLocation();
  const match = useMemo(() => matchRoute(screens, loc.path), [loc.path]);
  const [entryDrawer, setEntryDrawer] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const toasts = useToasts(ctx.host);
  const mainRef = useRef(null);
  const [welcomed, setWelcomed] = useState(false);
  const [firstConnect, setFirstConnect] = useState(null);
  const ui = useStoreUi(ctx);

  useEffect(() => ctx.bus.on('sync:firstConnect', setFirstConnect), [ctx]);
  useEffect(() => {
    ctx.host.setEntryHandler((kind, initial) => setEntryDrawer({ kind, initial, key: Date.now() }));
    ctx.host.setConfirmHandler((opts) => new Promise((resolve) => setConfirm({ opts, resolve })));
    ctx.showShortcuts = () => setShortcuts(true);
    ctx.showStatus = () => setStatusOpen(true);
  }, [ctx]);
  useEffect(() => { if (loc.path === '/' || loc.path === '') navigate('/acasa'); }, [loc.path]);
  useEffect(() => { // focus pe conținut la schimbarea paginii (8.0.2)
    const el = mainRef.current;
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
    if (typeof document !== 'undefined' && match) document.title = match.screen.title() + ' · ' + t.appName;
  }, [loc.path]);
  useEffect(() => { // scurtături globale + ale ecranului
    const k = ctx.keyboard;
    if (!k) return undefined;
    const go = (p) => () => ctx.nav(p);
    const offs = [k.register({
      n: () => ctx.openEntry('expense'), v: () => ctx.openEntry('income'), '?': () => setShortcuts(true),
      'g h': go('/acasa'), 'g l': go('/tranzactii'), 'g v': go('/verificare'), 'g c': go('/curse'),
      'Alt+Shift+D': () => {
        const last = lastEntry(coll(ctx.store.state(), 'entries'));
        if (!last) { ctx.toast({ kind: 'info', text: 'Nu există nicio intrare de duplicat.' }); return; }
        ctx.openEntry(last.kind === 'income' ? 'income' : 'expense', entryToForm(last, todayLocal(ctx.clock)));
      },
    })];
    if (match && match.screen.shortcuts) offs.push(k.register(Object.fromEntries(match.screen.shortcuts.map((s) => [s.keys, () => s.run(ctx)]))));
    return () => offs.forEach((o) => o());
  }, [ctx, match && match.screen.id]);

  const needsWelcome = !welcomed && ui && !ui.welcomeDone && isFirstRun(ctx.store.state()) && coll(ctx.store.state(), 'entries').length === 0;
  const Comp = match && match.screen.component;
  return html`<${CtxContext.Provider} value=${ctx}><${ErrorBoundary} onBackup=${ctx.downloadBackup}>
    <a class="skip" href="#main-content" onClick=${(e) => { e.preventDefault(); mainRef.current && mainRef.current.focus(); }}>Sari la conținut</a>
    ${needsWelcome ? html`<${Welcome} mode=${mode} onDone=${() => setWelcomed(true)} />` : html`
    <div class="app"><${Sidebar} screen=${match && match.screen} /><${MobileNav} screen=${match && match.screen} />
      <div class="main"><${Topbar} mode=${mode} /><${Notices} />
        ${ctx.progress ? html`<${GlobalProgress} />` : null}
        <main id="main-content" class="page" tabindex="-1" ref=${mainRef}>
          <${ErrorBoundary} inline onBackup=${ctx.downloadBackup} key=${loc.path}>${Comp ? html`<${Comp} params=${match.params} query=${loc.query} />` : html`<${NotFound} />`}<//>
        </main></div></div>`}
    ${entryDrawer ? html`<${Drawer} key=${entryDrawer.key} title=${entryDrawer.kind === 'income' ? t.nav.income : t.nav.entry} onClose=${() => setEntryDrawer(null)}>
      <${EntryForm} kind=${entryDrawer.kind} initial=${entryDrawer.initial} onSaved=${() => setEntryDrawer(null)} onCancel=${() => setEntryDrawer(null)} /><//>` : null}
    ${confirm ? html`<${ConfirmDialog} ...${confirm.opts} onResult=${(v) => { confirm.resolve(v); setConfirm(null); }} />` : null}
    ${firstConnect ? html`<${Modal} title="Date și în Drive, și pe acest dispozitiv" onClose=${() => {}}
      footer=${html`<${Button} kind="ghost" onClick=${() => { ctx.sync.resolveFirstConnect('cancel'); setFirstConnect(null); }}>Anulează<//>
        <${Button} kind="sec" onClick=${() => { ctx.sync.resolveFirstConnect('replaceDrive'); setFirstConnect(null); }}>Înlocuiește Drive<//>
        <${Button} onClick=${() => { ctx.sync.resolveFirstConnect('useDrive'); setFirstConnect(null); }}>Folosește Drive<//>`}>
      <p>Există date în ambele locuri. Nimic nu se unește automat.</p>
      <dl class="kv"><dt>Pe acest dispozitiv</dt><dd>${countText(firstConnect.local)}</dd><dt>În Drive</dt><dd>${countText(firstConnect.remote)}</dd></dl><//>` : null}
    ${statusOpen ? html`<${DataStatusPanel} onClose=${() => setStatusOpen(false)} />` : null}
    ${shortcuts ? html`<${ShortcutsDialog} enabled=${!ui || ui.hotkeys !== false} onClose=${() => setShortcuts(false)} />` : null}
    <${ToastHost} toasts=${toasts} dismiss=${(id) => ctx.host.dismiss(id)} />
  <//><//>`;
}
const countText = (c) => (c ? Object.entries(c).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k}: ${v}`).join(' · ') : '—');
function useStoreUi(ctx) {
  const [, setN] = useState(0);
  useEffect(() => ctx.bus.on('store:changed', () => setN((x) => x + 1)), [ctx]);
  const s = ctx.store.state();
  return (s && (s.singletons ? s.singletons.ui : s.ui)) || {};
}
function GlobalProgress() {
  const ctx = useCtx();
  const [p, setP] = useState(ctx.progress && ctx.progress.get ? ctx.progress.get() : null);
  useEffect(() => ctx.bus.on('progress', setP), [ctx]);
  if (!p) return null;
  return html`<div class="global-progress" role="status"><span>${p.label} ${p.done} / ${p.total}${p.eta ? ' · ~' + p.eta : ''}</span><div class="progress"><i style=${'width:' + Math.round((p.done / Math.max(1, p.total)) * 100) + '%'}></i></div>
    ${p.onPause ? html`<button type="button" class="btn ghost sm" onClick=${p.onPause}>${p.paused ? 'Reia' : 'Pauză'}</button>` : null}</div>`;
}
