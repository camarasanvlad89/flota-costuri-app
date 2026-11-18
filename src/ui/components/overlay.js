import { html, useEffect, useRef } from '../dom.js';
import { Icon } from './icons.js';
import { Button, IconButton } from './display.js';
import { t } from '../strings.js';
import { useUid } from './forms.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Prinde focusul în `ref`, închide cu Esc, readuce focusul la declanșator la ieșire (8.0.2). */
function useDialog(ref, onClose) {
  useEffect(() => {
    const opener = document.activeElement;
    const el = ref.current;
    const first = el && el.querySelector('[autofocus],' + FOCUSABLE);
    if (first) first.focus(); else if (el) el.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && opener.focus && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  const tid = useUid('m');
  useDialog(ref, onClose);
  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby=${tid} ref=${ref} tabindex="-1">
      <h2 id=${tid}>${title}<${IconButton} icon="close" label=${t.common.close} onClick=${onClose} /></h2>
      <div class="body">${children}</div>${footer ? html`<footer>${footer}</footer>` : null}</div></div>`;
}
/** Pe telefon: panoul urmărește viewport-ul vizual (tastatura virtuală) și câmpul activ rămâne vizibil (8.0.3). */
function useKeyboardAware(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return undefined;
    const vv = window.visualViewport;
    const phone = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
    const fit = () => {
      if (!vv || !phone()) { el.style.height = ''; el.style.top = ''; return; }
      el.style.height = Math.round(vv.height) + 'px';
      el.style.top = Math.round(vv.offsetTop) + 'px';
      el.style.bottom = 'auto';
    };
    const onFocus = (e) => {
      const t = e.target;
      if (!phone() || !t || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignorat */ } }, 250);
    };
    fit();
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    el.addEventListener('focusin', onFocus);
    return () => { if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); } el.removeEventListener('focusin', onFocus); };
  }, []);
}
/** Foaie de jos pe telefon (meniul „Mai mult”, „Adaugă”); pe desktop apare ca modal centrat prin CSS. */
export function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  const tid = useUid('s');
  useDialog(ref, onClose);
  return html`<div class="sheet-scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose && onClose(); }} onClick=${(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby=${tid} ref=${ref} tabindex="-1">
      <header><h2 id=${tid}>${title}</h2><${IconButton} icon="close" label=${t.common.close} onClick=${onClose} /></header>
      <div class="sheet-body">${children}</div></div></div>`;
}

export function Drawer({ title, onClose, children, footer }) {
  const ref = useRef(null);
  const tid = useUid('d');
  useDialog(ref, onClose);
  useKeyboardAware(ref);
  return html`<div><div class="drawer-scrim" onClick=${onClose}></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby=${tid} ref=${ref} tabindex="-1">
      <header><h2 id=${tid}>${title}</h2><${IconButton} icon="close" label=${t.common.close} onClick=${onClose} /></header>
      <div class="body">${children}</div>${footer ? html`<footer>${footer}</footer>` : null}</aside></div>`;
}
/** ConfirmDialog({ title, body, confirmLabel, danger, onResult(bool) }) */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, danger, onResult }) {
  return html`<${Modal} title=${title} onClose=${() => onResult(false)}
    footer=${html`<${Button} kind="sec" onClick=${() => onResult(false)}>${cancelLabel || t.common.cancel}<//>
      <${Button} class=${danger ? 'danger' : ''} onClick=${() => onResult(true)}>${confirmLabel || t.common.confirm}<//>`}>
    <div>${body}</div><//>`;
}
/** Regiunea de toast-uri (aria-live=polite). toasts: [{ id, kind, text, actionLabel, onAction }] */
export function ToastHost({ toasts, dismiss }) {
  return html`<div class="toasts" role="status" aria-live="polite" aria-atomic="false">${toasts.map((x) => html`<div class=${'toast ' + (x.kind || 'info')} key=${x.id}>
    <span>${x.text}</span>${x.actionLabel ? html`<button type="button" onClick=${() => { x.onAction && x.onAction(); dismiss(x.id); }}>${x.actionLabel}</button>` : null}
    <button type="button" aria-label=${t.common.close} onClick=${() => dismiss(x.id)}><${Icon} name="close" size="sm" /></button></div>`)}</div>`;
}
export function ShortcutsDialog({ onClose, enabled }) {
  return html`<${Modal} title=${t.common.shortcuts} onClose=${onClose}>
    ${enabled === false ? html`<p class="muted">Tastele rapide sunt dezactivate (Setări > Date > Accesibilitate).</p>` : null}
    <dl class="kv">${t.shortcutsHelp.map(([k, d]) => html`<dt><span class="kbd">${k}</span></dt><dd>${d}</dd>`)}</dl><//>`;
}
