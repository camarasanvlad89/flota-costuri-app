import { html, useState, useEffect, useRef, useMemo } from './dom.js';
import { CtxContext, useCtx, useStore, useDisplayCurrency, useMonth, useSingleton, useCollection } from './hooks.js';
import { useLocation, matchRoute, navigate } from './router.js';
import { navItems, screens } from './registry.js';
import { t } from './strings.js';
import { Icon, ErrorBoundary, Button, IconButton, Drawer, Sheet, Modal, ToastHost, ConfirmDialog, ShortcutsDialog, SyncStatus, DemoBadge, Loading, EntryForm, Badge } from './components/index.js';
import { verifyCount, monthLabel, shiftMonth, isFirstRun, lastEntry, entryToForm, backupAgeDays, coll } from './selectors.js';
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

function Bands({ mode }) {
  const ctx = useCtx();
  const st = ctx.syncStatus;
  const ui = useSingleton('ui');
  const entries = useCollection('entries');
  const days = backupAgeDays(ui.lastBackupAt, ctx.clock.now());
  const bands = [];
  if (mode === 'local') bands.push(html`<div class="banner info plain" role="note"><${Icon} name="info" /><span>${t.banners.demo}</span></div>`);
  if (ctx.sharedOrigin) {
    bands.push(ctx.sharedOrigin.accepted
      ? html`<div class="banner caution plain" role="note" data-testid="shared-origin"><${Icon} name="alert" /><span>${t.banners.sharedOrigin}</span></div>`
      : html`<div class="banner caution plain" role="note" data-testid="shared-origin-blocked"><${Icon} name="alert" /><span>${t.banners.sharedOriginBlocked}</span></div>`);
  }
  if (ctx.memoryOnly) bands.push(html`<div class="banner danger plain" role="alert"><${Icon} name="alert" /><span>${t.banners.memoryOnly}</span><button type="button" class="lnk" onClick=${ctx.downloadBackup}>${t.errors.backup}</button></div>`);
  if (entries.length > 0 || (ui.welcomeDone && !isFirstRun(ctx.store.state()))) {
    bands.push(html`<div class=${'banner plain ' + (days == null || days > 7 ? 'caution' : 'neutral')} role="note"><${Icon} name="download" /><span>${t.banners.backupAge(days)}</span><button type="button" class="lnk" onClick=${ctx.downloadBackup}>Descarcă backup acum</button></div>`);
  }
  if (ctx.clockBad) bands.push(html`<div class="banner danger plain" role="alert"><${Icon} name="clock" /><span>${t.banners.clock}</span></div>`);
  return bands.length ? html`<section class="bands" aria-label="Avertismente">${bands.map((b, i) => html`<div key=${i}>${b}</div>`)}</section>` : null;
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
      <div class="main"><${Topbar} mode=${mode} /><${Bands} mode=${mode} />
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
