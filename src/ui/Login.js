import { html, useState, useEffect } from './dom.js';
import { Button, Card, Note, Icon } from './components/index.js';

/** Ecranul de conectare (mod Google configurat, fără cont memorat). `auth.signIn()` se apelează SINCRON în handler-ul de click. */
export function Login({ auth, onUser, onLocal, preloadState }) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(preloadState === 'ready' || !!(auth.isReady && auth.isReady()));
  // GIS poate sosi târziu sau poate eșua (offline): se reîncearcă la revenirea rețelei și periodic, iar butonul se activează singur
  useEffect(() => {
    if (ready) return undefined;
    let dead = false;
    const retry = () => Promise.resolve(auth.preload()).then((r) => { if (!dead && r === 'ready') setReady(true); }, () => {});
    retry();
    window.addEventListener('online', retry);
    const iv = setInterval(retry, 8000);
    return () => { dead = true; window.removeEventListener('online', retry); clearInterval(iv); };
  }, [ready, auth]);
  function retryNow() {
    setErr(null); setBusy(true);
    Promise.resolve(auth.preload()).then((r) => {
      setBusy(false);
      if (r === 'ready') { setReady(true); setErr('Google este pregătit. Apasă din nou „Conectează Google”.'); } else setErr('Serviciul Google încă nu poate fi încărcat (offline sau blocat).');
    }, () => { setBusy(false); setErr('Serviciul Google încă nu poate fi încărcat (offline sau blocat).'); });
  }
  function go() {
    if (!ready) { retryNow(); return; }
    setErr(null); setBusy(true);
    const p = auth.signIn(); // fără await înainte: altfel browserul blochează popup-ul
    Promise.resolve(p).then((r) => {
      setBusy(false);
      if (r && r.ok === false) { setErr(r.message || 'Conectarea a eșuat.'); return; }
      if (auth.user) onUser(auth.user); else setErr('Conectarea nu a returnat un utilizator.');
    }, (e) => { setBusy(false); setErr((e && e.message) || 'Conectarea a eșuat.'); });
  }
  return html`<main class="stage" style="max-width:560px;margin:64px auto"><${Card} title="Flota Costuri">
    <p class="muted" style="margin-bottom:12px">Conectează-te cu contul Google al administratorului. Datele se salvează într-un fișier din Google Drive-ul tău (folderul ascuns al aplicației), nu pe un server.</p>
    <div class="stack"><div class="toolbar"><${Button} onClick=${go} disabled=${busy} icon="user">${busy ? 'Se conectează…' : ready ? 'Conectează Google' : 'Reîncearcă Google'}<//>
      <${Button} kind="sec" onClick=${onLocal}>Continuă fără Google (mod local)<//></div>
      ${!ready ? html`<${Note} kind="warn">Serviciul Google nu a putut fi încărcat (offline sau blocat). Se reîncearcă automat; poți continua și în mod local.<//>` : null}
      ${err ? html`<${Note} kind="warn">${err}<//>` : null}
      <p class="muted sm"><${Icon} name="info" size="sm" /> O conectare pe zi este normală. Datele din modul local nu se unesc automat cu cele din Drive; mutarea se face prin backup JSON.</p></div><//></main>`;
}

/** Ecran blocant: contul Google ales nu este cel al datelor din acest browser. Nimic nu se trimite în Drive și nu se unește. */
export function AccountMismatch({ localEmail, newUser, dirty, onBack, onWipe, onBackup }) {
  const [sure, setSure] = useState(false);
  return html`<main class="stage" role="alert" style="max-width:600px;margin:48px auto"><${Card} title="Datele locale aparțin altui cont Google">
    <p>Datele din acest browser sunt ale contului <b>${localEmail || 'anterior'}</b>, dar acum ești conectat ca <b>${(newUser && newUser.email) || 'alt cont'}</b>. Ca să nu se amestece conturile, nimic nu se trimite în Drive și nu se unește automat.</p>
    ${dirty > 0 ? html`<${Note} kind="warn">${dirty} modificări ale contului anterior nu au fost sincronizate. Descarcă un backup înainte de a șterge datele locale.<//>` : null}
    <div class="stack"><div class="toolbar"><${Button} onClick=${onBack}>Revino la ${localEmail || 'contul anterior'}<//>
      <${Button} kind="sec" icon="download" onClick=${onBackup}>Descarcă backup<//></div>
      <div class="toolbar">${sure ? html`<${Button} class="danger" onClick=${onWipe}>Da, șterge datele locale și folosește ${(newUser && newUser.email) || 'noul cont'}<//>`
        : html`<${Button} kind="sec" onClick=${() => setSure(true)}>Șterge datele locale și folosește ${(newUser && newUser.email) || 'noul cont'}<//>`}</div>
      <p class="muted sm">Ștergerea afectează doar acest browser; datele contului anterior rămân în Google Drive.</p></div><//></main>`;
}
