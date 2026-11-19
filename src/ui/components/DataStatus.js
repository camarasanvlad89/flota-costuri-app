import { html } from '../dom.js';
import { Icon } from './icons.js';
import { Button } from './display.js';
import { Sheet } from './overlay.js';
import { useCtx, useSingleton, useSyncStatus } from '../hooks.js';
import { backupAgeLabel, backupOverdue } from '../selectors.js';
import { syncLabel } from './SyncBanner.js';

function useDataStatus() {
  const ctx = useCtx();
  const ui = useSingleton('ui');
  const st = useSyncStatus();
  const now = ctx.clock.now();
  const google = ctx.mode === 'google';
  const overdue = backupOverdue(ui.lastBackupAt, now);
  const problem = ['offline', 'authNeeded', 'conflict', 'error'].includes(st.state);
  return { ctx, ui, st, google, overdue, problem, attn: overdue || problem, label: backupAgeLabel(ui.lastBackupAt, now), email: ctx.auth && ctx.auth.user ? ctx.auth.user.email : null };
}

/** Iconița „Stare date” din antet: nimic permanent pe pagină. Apăsată, deschide panoul (randat la rădăcina aplicației, deasupra barei de jos). */
export function DataStatus() {
  const d = useDataStatus();
  const where = d.google ? 'sincronizat cu Google Drive' : 'doar pe acest dispozitiv';
  const accessible = `Stare date: ${where}, backup ${d.label}${d.overdue ? ' (întârziat)' : ''}${d.problem ? ', ' + syncLabel(d.st) : ''}`;
  return html`<button type="button" class=${'ibtn status-ibtn' + (d.attn ? ' attn' : '')} aria-label=${accessible} title="Stare date" aria-haspopup="dialog" onClick=${() => d.ctx.showStatus && d.ctx.showStatus()} data-testid="data-status">
    <${Icon} name=${d.google ? 'cloud' : 'disk'} />${d.attn ? html`<span class="dot" aria-hidden="true"></span>` : null}</button>`;
}

/** Panoul „Stare date”: modul, locul datelor, salvarea, ultimul backup, acțiuni. */
export function DataStatusPanel({ onClose }) {
  const { ctx, ui, st, google, overdue, label, email } = useDataStatus();
  return html`<${Sheet} title="Stare date" onClose=${onClose}>
    <dl class="kv status-kv" data-testid="data-status-panel">
      <dt>Unde sunt datele</dt>
      <dd>${google
        ? html`<b>Sincronizat cu Google Drive</b>${email ? html` (${email})` : ''}. Datele stau într-un fișier din folderul ascuns al aplicației din Drive-ul tău, plus o copie în acest browser.`
        : html`<b>Doar pe acest dispozitiv.</b> Datele sunt în browserul acesta. Alt telefon, alt calculator sau alt browser are alt set de date, gol. Dacă ștergi datele site-ului din browser, dispar.`}</dd>
      <dt>Salvare</dt><dd>${syncLabel(st)}${st.dirty && st.state !== 'local' ? ` · ${st.dirty} nesincronizate` : ''}</dd>
      <dt>Ultimul backup</dt><dd class=${overdue ? 'neg' : ''}>${label}${overdue && ui.lastBackupAt ? ' (peste 7 zile)' : ''}</dd>
      ${ui.isDemo ? html`<dt>Date demo</dt><dd>Datele curente sunt fictive (demonstrație). Le poți șterge din Setări › Date.</dd>` : null}
    </dl>
    <div class="toolbar"><${Button} icon="download" onClick=${() => ctx.downloadBackup()}>Descarcă backup<//>
      <${Button} kind="sec" onClick=${() => { onClose(); ctx.nav('/ghid/unde-sunt-datele'); }}>Cum se folosește<//>
      ${ctx.sharedOrigin ? html`<${Button} kind="ghost" onClick=${() => { onClose(); ctx.nav('/setari/date'); }}>Securitate<//>` : null}</div><//>`;
}
