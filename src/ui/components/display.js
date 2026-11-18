import { html, h, Component, useState, useRef } from '../dom.js';
import { Icon } from './icons.js';
import { t } from '../strings.js';
import { fmtMoney, fmtNumber } from '../../core/index.js';

export function Button({ kind, sm, icon, children, class: cls, ...rest }) {
  const c = ['btn', kind === 'sec' ? 'sec' : kind === 'ghost' ? 'ghost' : '', sm ? 'sm' : '', cls || ''].filter(Boolean).join(' ');
  return html`<button type="button" class=${c} ...${rest}>${icon ? html`<${Icon} name=${icon} size="sm" />` : null}${children}</button>`;
}
export function IconButton({ icon, label, ...rest }) {
  return html`<button type="button" class="ibtn" aria-label=${label} title=${label} ...${rest}><${Icon} name=${icon} /></button>`;
}

const BADGE = {
  recurring: ['c-accent', 'repeat'], 'manual-fx': ['c-foreign', 'globe'], 'stale-fx': ['c-caution', 'offline'], 'ecb-fx': ['c-foreign', 'globe'],
  derived: ['c-neutral', 'sparkle'], nodoc: ['c-caution', 'docoff'], demo: ['c-foreign', 'info'], provisional: ['c-caution', 'clock'],
  closed: ['c-neutral', 'lock'], foreign: ['c-foreign', 'globe'], info: ['c-info', 'info'], warn: ['c-caution', 'alert'], bad: ['c-loss', 'alert'],
  ok: ['c-gain', 'check'], neutral: ['c-neutral', 'info'], auto: ['c-accent', 'repeat'],
};
export function Badge({ kind = 'neutral', children, title }) {
  const [cls, ic] = BADGE[kind] || BADGE.neutral;
  const text = children != null ? children : t.badges[kind] || kind;
  return html`<span class=${'chip ' + cls} title=${title || null}><${Icon} name=${ic} />${text}</span>`;
}

export function Kpi({ label, value, delta, big, tone, onClick, hint }) {
  const body = html`<div class="l">${label}${hint ? html`<span class="faint sm" title=${hint}>${html`<${Icon} name="info" size="sm" label=${hint} />`}</span>` : null}</div>
    <div class=${'v ' + (tone || '')}>${value}</div>${delta ? html`<div class="d">${delta}</div>` : null}`;
  return onClick
    ? html`<button type="button" class=${'kpi' + (big ? ' big' : '')} onClick=${onClick} style="text-align:left">${body}</button>`
    : html`<div class=${'kpi' + (big ? ' big' : '')}>${body}</div>`;
}

export function Card({ title, right, children, class: cls }) {
  return html`<section class=${'card ' + (cls || '')}>${title || right ? html`<div class="card-h"><h2>${title}</h2>${right || null}</div>` : null}${children}</section>`;
}
export function PageHeader({ title, sub, children }) {
  return html`<div class="page-h"><div><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : null}</div><div class="toolbar">${children}</div></div>`;
}
export function EmptyState({ icon = 'inbox', title, children, action }) {
  return html`<div class="empty"><${Icon} name=${icon} /><b>${title}</b>${children ? html`<div>${children}</div>` : null}${action || null}</div>`;
}
export function Loading({ text }) {
  return html`<div class="empty" role="status" aria-live="polite"><${Icon} name="sync" /><b>${text || t.common.loading}</b></div>`;
}
export function ErrorState({ error, onRetry }) {
  const msg = error && error.apiName ? t.errors.missingApi(error.apiName) : (error && error.message) || String(error || '');
  return html`<div class="empty" role="alert"><${Icon} name="alert" /><b>${t.errors.title}</b><div>${msg}</div>${onRetry ? html`<${Button} kind="sec" onClick=${onRetry}>${t.common.retry}<//>` : null}</div>`;
}
export function ProgressBar({ value, max = 100, label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return html`<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value} aria-label=${label || null}><i style=${'width:' + pct + '%'}></i></div>`;
}
export function Note({ kind, children }) { return html`<div class=${'note-box ' + (kind || '')}>${children}</div>`; }

/** Pilulă de profit: semn și pictogramă, nu doar culoare. */
export function Pl({ value, cur = 'RON' }) {
  const neg = value < 0;
  return html`<span class=${'pl ' + (neg ? 'neg' : 'pos')}><span aria-hidden="true">${neg ? '▼' : value > 0 ? '▲' : '■'}</span>${fmtMoney(value, cur, { sign: true })}</span>`;
}

export function Tabs({ tabs, value, onChange, label }) {
  const ref = useRef(null);
  const onKey = (e) => {
    const i = tabs.findIndex((x) => x.id === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n >= 0) { e.preventDefault(); onChange(tabs[n].id); const b = ref.current && ref.current.querySelectorAll('[role=tab]')[n]; if (b) b.focus(); }
  };
  return html`<div class="tabs-row" role="tablist" aria-label=${label || null} ref=${ref} onKeyDown=${onKey}>
    ${tabs.map((x) => html`<button type="button" role="tab" id=${'tab-' + x.id} aria-selected=${x.id === value} tabindex=${x.id === value ? 0 : -1} onClick=${() => onChange(x.id)}>${x.label}</button>`)}</div>`;
}

export function Stepper({ steps, current }) {
  return html`<ol class="steps" aria-label="Pași">${steps.map((s, i) => html`
    <li class=${'step ' + (i < current ? 'done' : i === current ? 'now' : '')} aria-current=${i === current ? 'step' : null}><i>${i < current ? '✓' : i + 1}</i>${s}</li>${i < steps.length - 1 ? html`<li class="step-sep" aria-hidden="true"></li>` : null}`)}</ol>`;
}
export function Wizard({ steps, current, children, onBack, onNext, nextLabel, nextDisabled, backDisabled, extra }) {
  return html`<div class="stack"><${Stepper} steps=${steps} current=${current} />${children}
    <div class="toolbar"><${Button} kind="sec" onClick=${onBack} disabled=${backDisabled || current === 0}>${t.common.back}<//>
    <span class="grow"></span>${extra || null}<${Button} onClick=${onNext} disabled=${nextDisabled}>${nextLabel || t.common.next}<//></div></div>`;
}

/* ---------- Grafice SVG (cu alternativă de date) ---------- */
const PALETTE = ['var(--series)', 'var(--caution)', 'var(--gain-solid)', 'var(--foreign)', 'var(--info)'];
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
/** Chart({ type:'bar'|'line'|'stacked', series:[{name,data,color?}], labels, format, title, desc, height }) */
export function Chart({ type = 'bar', series, labels, format = (v) => fmtNumber(v, 0), title, desc, height = 220 }) {
  const [asTable, setAsTable] = useState(false);
  const W = 640, H = height, L = 52, R = 10, T = 12, B = 26;
  const n = labels.length;
  const stacked = type === 'stacked';
  const all = stacked
    ? labels.map((_, i) => series.reduce((a, s) => a + (s.data[i] || 0), 0))
    : series.flatMap((s) => s.data.map((v) => v || 0));
  const lo = Math.min(0, ...(stacked ? [0] : all)), hi = Math.max(0, ...all);
  const top = niceMax(hi), bot = lo < 0 ? -niceMax(-lo) : 0;
  const y = (v) => T + (H - T - B) * (1 - (v - bot) / (top - bot || 1));
  const x0 = (i) => L + ((W - L - R) * (i + 0.5)) / n;
  const bw = Math.max(4, Math.min(36, ((W - L - R) / n) * 0.62 / (stacked || type === 'line' ? 1 : series.length)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => bot + (top - bot) * f);
  const els = [];
  ticks.forEach((tv) => {
    els.push(h('line', { class: tv === 0 ? 'zero' : 'grid', x1: L, x2: W - R, y1: y(tv), y2: y(tv) }));
    els.push(h('text', { x: L - 6, y: y(tv) + 4, 'text-anchor': 'end' }, format(tv)));
  });
  labels.forEach((lb, i) => els.push(h('text', { x: x0(i), y: H - 8, 'text-anchor': 'middle' }, lb)));
  if (type === 'line') {
    series.forEach((s, si) => {
      const pts = s.data.map((v, i) => `${x0(i)},${y(v || 0)}`).join(' ');
      els.push(h('polyline', { points: pts, fill: 'none', stroke: s.color || PALETTE[si % PALETTE.length], 'stroke-width': 2.2 }));
      s.data.forEach((v, i) => els.push(h('circle', { cx: x0(i), cy: y(v || 0), r: 3, fill: s.color || PALETTE[si % PALETTE.length] }, h('title', null, `${s.name} · ${labels[i]}: ${format(v || 0)}`))));
    });
  } else if (stacked) {
    labels.forEach((lb, i) => {
      let acc = 0;
      series.forEach((s, si) => {
        const v = s.data[i] || 0;
        const y1 = y(acc + v), y2 = y(acc);
        els.push(h('rect', { x: x0(i) - bw / 2, y: y1, width: bw, height: Math.max(0, y2 - y1), fill: s.color || PALETTE[si % PALETTE.length], rx: 2 }, h('title', null, `${s.name} · ${lb}: ${format(v)}`)));
        acc += v;
      });
    });
  } else {
    labels.forEach((lb, i) => series.forEach((s, si) => {
      const v = s.data[i] || 0;
      const xx = x0(i) - (bw * series.length) / 2 + si * bw;
      const ya = y(Math.max(v, 0)), yb = y(Math.min(v, 0));
      const neg = v < 0 && series.length === 1;
      els.push(h('rect', { x: xx, y: ya, width: bw - 2, height: Math.max(1, yb - ya), rx: 2, fill: neg ? 'var(--loss-solid)' : s.color || PALETTE[si % PALETTE.length] }, h('title', null, `${s.name} · ${lb}: ${format(v)}`)));
    }));
  }
  const svg = h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title || desc || 'Grafic' },
    h('title', null, title || 'Grafic'), h('desc', null, desc || ''), ...els);
  const legend = series.length > 1 ? html`<div class="legend">${series.map((s, si) => html`<span><i style=${'background:' + (s.color || PALETTE[si % PALETTE.length])}></i>${s.name}</span>`)}</div>` : null;
  return html`<figure style="margin:0">
    ${asTable ? html`<div class="tw" tabindex="0" role="region" aria-label=${title || 'Tabel'}><table class="tbl"><caption class="vh">${title}</caption><thead><tr><th scope="col"></th>${series.map((s) => html`<th scope="col" class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${labels.map((lb, i) => html`<tr><th scope="row">${lb}</th>${series.map((s) => html`<td class="r">${format(s.data[i] || 0)}</td>`)}</tr>`)}</tbody></table></div>` : svg}
    ${legend}
    <button type="button" class="btn ghost sm" style="margin-top:8px" aria-pressed=${asTable} onClick=${() => setAsTable(!asTable)}>${asTable ? 'Arată graficul' : t.common.showAsTable}</button></figure>`;
}
/** Bare orizontale: rows = [{ label, value (număr), display, nd? }] */
export function HBars({ rows, max }) {
  const m = max || Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return html`<div role="list">${rows.map((r) => html`<div class="hb" role="listitem"><span class="t-lbl">${r.label}</span>
    <div class="t"><i class=${r.nd ? 'nd' : ''} style=${'width:' + Math.min(100, (Math.abs(r.value) / m) * 100) + '%'}></i></div><span class="v">${r.display}</span></div>`)}</div>`;
}

/* ---------- Eroare globală ---------- */
export class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  componentDidCatch(error) { this.setState({ error }); if (typeof console !== 'undefined') console.error('[ErrorBoundary]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    const { onBackup, inline } = this.props;
    const e = this.state.error;
    return html`<div class=${inline ? 'card' : 'stage'} role="alert" style="max-width:640px;margin:48px auto"><div class="empty"><${Icon} name="alert" /><b>${t.errors.title}</b>
      <div>${e && e.apiName ? t.errors.missingApi(e.apiName) : t.errors.body}</div>
      <div class="muted sm mono">${String((e && e.message) || e)}</div>
      <div class="toolbar">${onBackup ? html`<${Button} onClick=${onBackup} icon="download">${t.errors.backup}<//>` : null}
      <${Button} kind="sec" onClick=${() => (inline ? this.setState({ error: null }) : location.reload())}>${inline ? t.common.retry : t.errors.reload}<//></div></div></div>`;
  }
}
