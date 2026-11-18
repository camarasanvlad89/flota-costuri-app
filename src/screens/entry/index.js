import { html } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx } from '../../ui/hooks.js';
import { EntryForm, PageHeader, Card } from '../../ui/components/index.js';

const KINDS = { cheltuiala: 'expense', venit: 'income', recuperare: 'recovery' };

function EntryScreen({ params }) {
  const ctx = useCtx();
  const kind = KINDS[params.kind] || 'expense';
  return html`<div class="stack" style="max-width:720px"><${PageHeader} title=${kind === 'expense' ? t.nav.entry : t.nav.income} sub="Valorile implicite vin din ultima intrare. Ctrl+Enter salvează și rămâi." />
    <${Card}><${EntryForm} key=${kind} kind=${kind} onSaved=${() => ctx.nav('/tranzactii')} onCancel=${() => ctx.nav('/tranzactii')} /><//></div>`;
}
export const screen = { id: 'entry', route: '/nou/:kind', title: () => t.nav.entry, component: EntryScreen };
