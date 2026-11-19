import { html } from '../dom.js';
import { useCtx } from '../hooks.js';
import { Button } from './display.js';

/** „Cum funcționează?”: deschide secțiunea potrivită din ghid (#/ghid/<id>). */
export function HelpLink({ id, label }) {
  const ctx = useCtx();
  return html`<${Button} sm kind="ghost" icon="help" class="help-link no-print" onClick=${() => ctx.nav('/ghid/' + id)}>${label || 'Cum funcționează?'}<//>`;
}
