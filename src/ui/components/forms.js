import { html, useState, useEffect, useRef } from '../dom.js';
import { t } from '../strings.js';
import { parseAmount, toDecimalString, fmtMoney, currencyExp } from '../../core/index.js';

let uid = 0;
export function useUid(prefix = 'f') {
  const r = useRef(null);
  if (r.current === null) r.current = prefix + '-' + (++uid);
  return r.current;
}

/** Câmp etichetat: eticheta, indicația și eroarea sunt legate prin aria-*. */
export function Field({ label, error, hint, children, class: cls, id, required }) {
  const fid = id || useUid();
  return html`<div class=${'field' + (error ? ' err' : '') + (cls ? ' ' + cls : '')}>
    <label for=${fid}>${label}${required ? ' *' : ''}</label>${typeof children === 'function' ? children({ id: fid, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? fid + '-e' : hint ? fid + '-h' : undefined }) : children}
    ${hint && !error ? html`<span class="hintt" id=${fid + '-h'}>${hint}</span>` : null}${error ? html`<span class="errm" id=${fid + '-e'} role="alert">${error}</span>` : null}</div>`;
}
export function TextInput({ value, onInput, onChange, label, error, hint, type = 'text', inputMode, class: cls, ...rest }) {
  return html`<${Field} label=${label} error=${error} hint=${hint}>${(a) => html`<input ...${a} class=${cls || ''} type=${type} inputmode=${inputMode || null} value=${value ?? ''} onInput=${(e) => (onInput || onChange) && (onInput || onChange)(e.currentTarget.value, e)} ...${rest} />`}<//>`;
}
export function DateInput({ value, onChange, label, error, hint, min, max, ...rest }) {
  return html`<${Field} label=${label} error=${error} hint=${hint}>${(a) => html`<input ...${a} type="date" value=${value || ''} min=${min || null} max=${max || null} onInput=${(e) => onChange(e.currentTarget.value || null)} ...${rest} />`}<//>`;
}
/** options: [{ value, label, disabled? }] sau șiruri */
export function Select({ value, onChange, options, label, error, hint, placeholder, ...rest }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return html`<${Field} label=${label} error=${error} hint=${hint}>${(a) => html`<select ...${a} value=${value ?? ''} onChange=${(e) => onChange(e.currentTarget.value)} ...${rest}>
    ${placeholder != null ? html`<option value="">${placeholder}</option>` : null}${opts.map((o) => html`<option value=${o.value} disabled=${o.disabled || false} selected=${o.value === value}>${o.label}</option>`)}</select>`}<//>`;
}
/** Câmp cu sugestii native (datalist): scrie text liber sau alege o opțiune; întoarce valoarea textului. */
export function Combobox({ value, onChange, options, label, error, hint, placeholder, ...rest }) {
  const lid = useUid('dl');
  return html`<${Field} label=${label} error=${error} hint=${hint}>${(a) => html`<input ...${a} list=${lid} value=${value ?? ''} placeholder=${placeholder || null} autocomplete="off" onInput=${(e) => onChange(e.currentTarget.value)} ...${rest} />
    <datalist id=${lid}>${options.map((o) => html`<option value=${typeof o === 'string' ? o : o.value}>${typeof o === 'string' ? '' : o.label || ''}</option>`)}</datalist>`}<//>`;
}
export function Checkbox({ checked, onChange, label, ...rest }) {
  const id = useUid('cb');
  return html`<div class="checkrow"><input id=${id} type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.currentTarget.checked)} ...${rest} /><label for=${id}>${label}</label></div>`;
}
export function Segmented({ value, onChange, options, label }) {
  return html`<div class="opts" role="group" aria-label=${label || null}>${options.map((o) => html`<button type="button" class="opt" aria-pressed=${o.value === value} onClick=${() => onChange(o.value)}>${o.label}</button>`)}</div>`;
}

/**
 * Sumă în unitatea minoră. Textul tastat se interpretează la `blur` cu `parseAmount`; valorile ambigue („1.234”)
 * nu se reinterpretează pe tăcute: sub câmp apare valoarea citită și alternativa, la un click.
 * value: Minor|null; onChange(minor|null, { text, ok })
 */
export function MoneyInput({ value, currency, onChange, onCurrencyChange, currencies, label = 'Sumă', error, hint, autoFocus, id: idProp }) {
  const id = idProp || useUid('amt');
  const [text, setText] = useState(value == null ? '' : toDecimalString(value, currency).replace('.', ','));
  const [info, setInfo] = useState(null); // { minor, alt, readAs }
  const [bad, setBad] = useState(null);
  const focus = useRef(false);
  useEffect(() => { // sincronizare dinspre părinte (resetare formular, schimbare monedă)
    if (!focus.current) {
      const want = value == null ? '' : toDecimalString(value, currency).replace('.', ',');
      setText(want); setInfo(null); setBad(null);
    }
  }, [value, currency]);
  function commit(raw) {
    const s = raw.trim();
    if (!s) { setInfo(null); setBad(null); onChange(null, { text: '', ok: true }); return; }
    const r = parseAmount(s, currency);
    if (!r.ok) { setBad(r.error || t.errors.badAmount); onChange(null, { text: s, ok: false }); return; }
    setBad(null);
    setInfo(r.ambiguous ? { minor: r.minor, alt: r.alternatives && r.alternatives.find((a) => a !== r.minor), readAs: r.readAs } : null);
    onChange(r.minor, { text: s, ok: true, ambiguous: !!r.ambiguous });
  }
  // calcul live: la fiecare tastă se citește suma în tăcere (fără mesaje de eroare până la blur) și se anunță părintele
  function live(raw) {
    const s = raw.trim();
    if (!s) { onChange(null, { text: '', ok: true, live: true }); return; }
    const r = parseAmount(s, currency);
    onChange(r.ok ? r.minor : null, { text: s, ok: !!r.ok, ambiguous: !!(r.ok && r.ambiguous), live: true });
  }
  const msg = error || bad;
  const curOpts = currencies && currencies.length ? currencies : [currency];
  return html`<div class=${'field' + (msg ? ' err' : '')}><label for=${id}>${label}</label>
    <div class="money"><input id=${id} class="num" inputmode="decimal" autocomplete="off" autofocus=${!!autoFocus} value=${text}
      aria-invalid=${msg ? 'true' : null} aria-describedby=${msg ? id + '-e' : info ? id + '-a' : null}
      onFocus=${() => { focus.current = true; }} onInput=${(e) => { setText(e.currentTarget.value); live(e.currentTarget.value); }}
      onBlur=${(e) => { focus.current = false; commit(e.currentTarget.value); }}
      onKeyDown=${(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); }} />
      ${onCurrencyChange ? html`<select aria-label="Moneda" value=${currency} onChange=${(e) => onCurrencyChange(e.currentTarget.value)}>${curOpts.map((c) => html`<option value=${c} selected=${c === currency}>${c}</option>`)}</select>` : html`<span class="muted" style="align-self:center">${currency}</span>`}</div>
    ${info ? html`<span class="hintt" id=${id + '-a'}>= ${fmtMoney(info.minor, currency)}${info.alt != null ? html` · <button type="button" class="cell-link" onClick=${() => { onChange(info.alt, { ok: true }); setText(toDecimalString(info.alt, currency).replace('.', ',')); setInfo(null); }}>citește ca ${fmtMoney(info.alt, currency)}</button>` : null}</span>` : null}
    ${hint && !msg && !info ? html`<span class="hintt">${hint}</span>` : null}
    ${msg ? html`<span class="errm" id=${id + '-e'} role="alert">${msg}</span>` : null}
    ${currencyExp(currency) === 0 ? html`<span class="hintt">${currency} nu are subdiviziuni.</span>` : null}</div>`;
}
