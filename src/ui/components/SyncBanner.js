import { html } from '../dom.js';
import { Icon } from './icons.js';
import { t } from '../strings.js';
import { useSyncStatus, useCtx, useSingleton } from '../hooks.js';

function hhmm(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/** Starea sincronizării în cuvinte (pentru panoul „Stare date”). */
export function syncLabel(st) {
  const s = st.state;
  return s === 'local' ? t.sync.savedLocal : s === 'idle' ? `${t.sync.savedLocal} · ${t.sync.syncedAt} ${hhmm(st.lastSyncedAt)}` : s === 'saving' ? t.sync.saving
    : s === 'offline' ? t.sync.offline : s === 'authNeeded' ? t.sync.authNeeded : s === 'conflict' ? t.sync.conflict : t.sync.error;
}
/** Pilula din antet apare DOAR la o problemă reală (offline, reconectare, conflict, eroare). În rest starea e în iconița „Stare date”. */
export function SyncStatus() {
  const st = useSyncStatus();
  const ctx = useCtx();
  const s = st.state;
  if (s === 'local' || s === 'idle' || s === 'saving') return null;
  const cls = s === 'idle' || s === 'local' ? 'ok' : s === 'saving' ? '' : s === 'error' || s === 'conflict' ? 'bad' : 'warn';
  const label = s === 'local' ? t.sync.savedLocal : s === 'idle' ? `${t.sync.savedLocal} · ${t.sync.syncedAt} ${hhmm(st.lastSyncedAt)}` : s === 'saving' ? t.sync.saving
    : s === 'offline' ? t.sync.offline : s === 'authNeeded' ? t.sync.authNeeded : s === 'conflict' ? t.sync.conflict : t.sync.error;
  return html`<span class=${'status-pill ' + cls} role="status" title=${label}><${Icon} name=${s === 'offline' ? 'offline' : 'sync'} size="sm" /><span class="st-lbl">${label}${st.dirty && s !== 'local' ? ` · ${st.dirty} nesincronizate` : ''}</span>
    ${s === 'authNeeded' && ctx.auth && ctx.auth.signIn ? html`<button type="button" class="cell-link" onClick=${() => ctx.auth.signIn()}>${t.sync.reconnect}</button>` : null}</span>`;
}

/** Insigna „date demo”: apare cât timp seed-ul demo e activ (17.4). */
export function DemoBadge() {
  const ui = useSingleton('ui');
  return ui && ui.isDemo ? html`<span class="demo-badge" title="Date fictive (FICTIV) pentru demonstrație">${t.demoBadge}</span>` : null;
}
