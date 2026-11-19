import { html, useState } from './dom.js';
import { Button, Card, Note } from './components/index.js';
import { useCtx } from './hooks.js';
import { call } from './api.js';
import { GuideView } from './guide/view.js';

/** Prima pornire: „Date demo sau gol?” (4.4) / cont Drive fără date (8.0.1). */
export function Welcome({ mode, onDone }) {
  const ctx = useCtx();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [guide, setGuide] = useState(false);
  async function choose(kind) {
    setBusy(true); setErr(null);
    try {
      if (kind === 'demo') {
        const doc = call('buildDemoDb');
        await ctx.store.replaceDoc(doc, { reason: 'demo', newEpoch: true });
      } else {
        await ctx.store.replaceDoc(call('buildEmptyDb'), { reason: 'empty', newEpoch: false });
      }
      await ctx.store.setSingleton('ui', { welcomeDone: true, isDemo: kind === 'demo' });
      if (ctx.catchUp) ctx.catchUp().catch(() => {});
      onDone();
    } catch (e) { setErr(e.apiName ? 'Datele demo nu sunt disponibile în această versiune.' : e.message); } finally { setBusy(false); }
  }
  async function restore(file) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const text = await file.text();
      const r = call('parseBackup', text);
      if (!r.ok) throw new Error(r.error);
      await ctx.store.replaceDoc(r.doc, { reason: 'restore', newEpoch: true });
      await ctx.store.setSingleton('ui', { welcomeDone: true });
      if (ctx.catchUp) ctx.catchUp().catch(() => {});
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  if (guide) return html`<div class="stage" style="max-width:1100px;margin:24px auto;padding:0 16px"><${GuideView} embedded onClose=${() => setGuide(false)} /></div>`;
  return html`<div class="stage" style="max-width:720px;margin:48px auto"><${Card} title="Bun venit la Flota Costuri">
    <p class="muted" style="margin-bottom:12px">${mode === 'google' ? 'Nu s-au găsit date. Începe gol sau restaurează un backup.' : 'Alege cum începi. Poți reveni oricând din Setări > Date.'}</p>
    <div class="stack">
      ${mode === 'local' ? html`<div><${Button} onClick=${() => choose('demo')} disabled=${busy}>Pornește cu date demo<//><p class="muted sm">Date fictive (XX00DEM, oct. 2026) ca să vezi tot fluxul GPS, confruntarea și km pe gol.</p></div>` : null}
      <div><${Button} kind="sec" onClick=${() => choose('empty')} disabled=${busy}>Începe gol<//><p class="muted sm">Primești o listă scurtă: 1. camioanele, 2. cursele, 3. cheltuielile fixe.</p></div>
      <div><label class="btn sec" style="cursor:pointer">Restaurează un backup JSON<input type="file" accept=".json,application/json" class="vh" onChange=${(e) => restore(e.currentTarget.files[0])} /></label></div>
      <div><${Button} kind="ghost" icon="help" onClick=${() => setGuide(true)}>Cum se folosește?<//><p class="muted sm">Un ghid scurt, cu exemple. Îl găsești oricând în meniu, la „Cum se folosește”.</p></div>
      ${err ? html`<${Note} kind="warn">${err}<//>` : null}
    </div><//></div>`;
}
