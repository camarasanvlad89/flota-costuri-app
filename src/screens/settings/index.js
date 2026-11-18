import { html } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { useCtx } from '../../ui/hooks.js';
import { PageHeader } from '../../ui/components/index.js';
import { CompanySection, FleetSection, CategoriesSection, CountriesSection, CurrenciesSection, ExpiriesSection, AliasesSection, IntegrationsSection, DataSection } from './sections.js';
import { FixedSection } from './Fixed.js';

const SECTIONS = [
  ['firma', 'Firmă', CompanySection], ['camioane', 'Camioane, remorci, șoferi', FleetSection], ['categorii', 'Categorii', CategoriesSection], ['fixe', 'Cheltuieli fixe', FixedSection],
  ['tari', 'Țări & TVA', CountriesSection], ['valute', 'Valute', CurrenciesSection], ['expirari', 'Scadențe', ExpiriesSection], ['aliasuri', 'Alias-uri locuri', AliasesSection],
  ['integrari', 'Integrări', IntegrationsSection], ['date', 'Date, backup, accesibilitate', DataSection],
];

function SettingsScreen({ params }) {
  const ctx = useCtx();
  const id = params.sectiune || 'firma';
  const cur = SECTIONS.find((s) => s[0] === id) || SECTIONS[0];
  const Body = cur[2];
  return html`<div class="stack"><${PageHeader} title=${t.nav.settings} sub=${cur[1]} />
    <div class="split"><nav class="card listnav" aria-label="Secțiuni setări">${SECTIONS.map(([k, l]) => html`<button type="button" aria-current=${k === cur[0] ? 'true' : null} onClick=${() => ctx.nav('/setari/' + k)}>${l}</button>`)}</nav>
      <div key=${cur[0]}><${Body} /></div></div></div>`;
}
export const screen = { id: 'settings', route: '/setari/:sectiune?', title: () => t.nav.settings, nav: { label: t.nav.settings, icon: 'settings', order: 9, group: 'admin', path: '/setari' }, component: SettingsScreen };
