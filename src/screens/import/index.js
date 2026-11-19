import { html, useState } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx, useCollection } from '../../ui/hooks.js';
import { HelpLink, Tabs, PageHeader, Card, Table, Button, Note } from '../../ui/components/index.js';
import { CoursesWizard } from './CoursesWizard.js';
import { GpsImport } from './GpsImport.js';
import { ExpensesImport } from './ExpensesImport.js';
import { EInvoiceImport } from './EInvoiceImport.js';
import { fmtDate } from '../../core/index.js';

const TABS = [{ id: 'curse', label: 'Curse (Excel/CSV)' }, { id: 'gps', label: 'GPS SafeFleet' }, { id: 'cheltuieli', label: 'Cheltuieli / extras card' }, { id: 'efactura', label: 'e-Factura XML' }];

const KIND_LABEL = { gps: 'GPS', courses: 'Curse', expenses: 'Cheltuieli / card', efactura: 'e-Factura' };
const COUNT_LABEL = { add: 'adăugate', update: 'actualizate', unchanged: 'neschimbate', skipped: 'omise', days: 'zile', replaced: 'înlocuite', trips: 'călătorii' };

function RecentImports() {
  const ctx = useCtx();
  const logs = useCollection('importLogs').filter((l) => !l.undoneAt).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
  if (!logs.length) return null;
  async function undo(l) {
    const ok = await ctx.confirm({ title: 'Anulezi importul?', body: `Se șterg înregistrările create de importul din ${fmtDate(l.at.slice(0, 10))} (${l.file}); cele actualizate revin la valorile vechi.`, confirmLabel: 'Anulează importul', danger: true });
    if (!ok) return;
    const colMain = l.kind === 'gps' ? 'gpsDays' : l.kind === 'courses' ? 'courses' : 'entries';
    await ctx.store.batch('Anulează import', (tx) => {
      for (const id of l.added || []) tx.remove(colMain, id);
      for (const id of l.addedTrips || []) tx.remove('gpsTrips', id);
      for (const p of l.prev || []) tx.put(colMain, p);
      for (const p of l.prevTrips || []) tx.put('gpsTrips', p);
      for (const id of l.trucks || []) tx.remove('trucks', id);
      for (const id of l.drivers || []) tx.remove('drivers', id);
      tx.put('importLogs', { ...l, undoneAt: new Date().toISOString() });
    }, { allowClosed: true });
    ctx.toast({ kind: 'ok', text: 'Importul a fost anulat.' });
  }
  return html`<${Card} title="Importuri recente"><${Table} caption="Importuri recente" rowKey=${(l) => l.id} rows=${logs} columns=${[
    { key: 'at', header: 'Data', render: (l) => fmtDate(l.at.slice(0, 10)) }, { key: 'k', header: 'Tip', render: (l) => KIND_LABEL[l.kind] || l.kind }, { key: 'f', header: 'Fișier', render: (l) => l.file },
    { key: 'c', header: 'Rezultat', render: (l) => Object.entries(l.counts || {}).map(([k, v]) => `${COUNT_LABEL[k] || k}: ${v}`).join(' · ') },
    { key: 'u', header: '', render: (l) => html`<${Button} sm kind="ghost" onClick=${() => undo(l)}>Anulează importul<//>` }]} /><//>`;
}

function ImportScreen({ query }) {
  const [tab, setTab] = useState(query.get('tab') || 'curse');
  return html`<div class="stack"><${PageHeader} title=${t.nav.import} sub="Nimic nu se scrie până nu apeși „Importă”."><${HelpLink} id="ecran-import" /><//>
    <${Tabs} tabs=${TABS} value=${tab} onChange=${setTab} label="Tip import" />
    ${tab === 'curse' ? html`<${CoursesWizard} />` : null}
    ${tab === 'gps' ? html`<${GpsImport} />` : null}
    ${tab === 'cheltuieli' ? html`<${ExpensesImport} />` : null}
    ${tab === 'efactura' ? html`<${EInvoiceImport} />` : null}
    <${RecentImports} /></div>`;
}
export const screen = { id: 'import', route: '/import', title: () => t.nav.import, nav: { label: t.nav.import, icon: 'upload', order: 5, group: 'gps' }, component: ImportScreen };
