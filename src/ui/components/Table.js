import { html } from '../dom.js';
import { t } from '../strings.js';
import { Button } from './display.js';
import { useIsPhone } from '../hooks.js';

/**
 * Table({ columns, rows, rowKey, caption, sort:{key,dir}, onSort, onRowClick, selectable, selected:Set, onSelect(set),
 *         footer: cells[], rowClass(row), emptyText })
 * columns: [{ key, header, render(row), align:'r', sortable, wrap, width, card:'title'|'amount'|'meta'|'badges'|false }]
 * cards (8.0.3): sub 768 px rândurile devin carduri (titlu, sumă, rânduri `meta`, insigne); coloanele fără `card` sunt `meta`.
 * Tabel nativ cu th scope, aria-sort, casete reale pentru selecție, antet lipicios. Paginarea: <Pager/> (fără virtualizare, 8.0.2).
 */
export function Table({ columns, rows, rowKey = (r) => r.id, caption, sort, onSort, onRowClick, selectable, selected, onSelect, footer, rowClass, emptyText, cards }) {
  const phone = useIsPhone();
  if (cards && phone) return html`<${CardList} ...${{ columns, rows, rowKey, caption, onRowClick, selectable, selected, onSelect, footer, rowClass, emptyText, sort, onSort }} />`;
  const sel = selected || new Set();
  const allOn = rows.length > 0 && rows.every((r) => sel.has(rowKey(r)));
  const toggleAll = () => { const n = new Set(sel); rows.forEach((r) => (allOn ? n.delete(rowKey(r)) : n.add(rowKey(r)))); onSelect(n); };
  const toggle = (r) => { const n = new Set(sel); const k = rowKey(r); n.has(k) ? n.delete(k) : n.add(k); onSelect(n); };
  return html`<div class="tw" tabindex="0" role="region" aria-label=${caption || 'Tabel'}><table class="tbl">${caption ? html`<caption class="vh">${caption}</caption>` : null}
    <thead><tr>${selectable ? html`<th scope="col" class="chk"><input type="checkbox" aria-label="Selectează toate rândurile" checked=${allOn} onChange=${toggleAll} /></th>` : null}
      ${columns.map((c) => {
        const active = sort && sort.key === c.key;
        const ariaSort = c.sortable ? (active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none') : null;
        return html`<th scope="col" class=${c.align === 'r' ? 'r' : ''} aria-sort=${ariaSort} style=${c.width ? 'width:' + c.width : null}>
          ${c.sortable && onSort ? html`<button type="button" class="sortb" onClick=${() => onSort({ key: c.key, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}>${c.header}<span aria-hidden="true">${active ? (sort.dir === 'desc' ? '↓' : '↑') : ''}</span></button>` : (c.header === '' || c.header == null ? html`<span class="vh">${c.label || 'Acțiuni'}</span>` : c.header)}</th>`;
      })}</tr></thead>
    <tbody>${rows.length === 0 ? html`<tr><td colspan=${columns.length + (selectable ? 1 : 0)} class="wrap muted">${emptyText || t.common.noData}</td></tr>` : rows.map((r) => {
      const k = rowKey(r);
      const clickable = !!onRowClick;
      return html`<tr key=${k} class=${(rowClass ? rowClass(r) : '') + (sel.has(k) ? ' sel-row' : '')} tabindex=${clickable ? 0 : null}
        onClick=${clickable ? (e) => { if (!e.target.closest('input,button,a,select')) onRowClick(r); } : null}
        onKeyDown=${clickable ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : null}>
        ${selectable ? html`<td class="chk"><input type="checkbox" aria-label="Selectează rândul" checked=${sel.has(k)} onChange=${() => toggle(r)} /></td>` : null}
        ${columns.map((c) => html`<td class=${(c.align === 'r' ? 'r ' : '') + (c.wrap ? 'wrap' : '')}>${c.render ? c.render(r) : r[c.key]}</td>`)}</tr>`;
    })}</tbody>
    ${footer ? html`<tfoot><tr>${selectable ? html`<td></td>` : null}${footer.map((f, i) => html`<td class=${columns[i] && columns[i].align === 'r' ? 'r' : ''}>${f}</td>`)}</tr></tfoot>` : null}</table></div>`;
}
function CardList({ columns, rows, rowKey, caption, onRowClick, selectable, selected, onSelect, footer, rowClass, emptyText, sort, onSort }) {
  const sel = selected || new Set();
  const toggle = (r) => { const n = new Set(sel); const k = rowKey(r); n.has(k) ? n.delete(k) : n.add(k); onSelect(n); };
  const role = (c) => (c.card === undefined ? 'meta' : c.card);
  const by = (r, name) => columns.filter((c) => role(c) === name).map((c) => ({ c, v: c.render ? c.render(r) : r[c.key] }));
  const sortable = columns.filter((c) => c.sortable && onSort);
  return html`<div class="cardlist">
    ${sortable.length ? html`<label class="cl-sort"><span>Sortare</span><select aria-label="Sortează după" value=${sort ? sort.key : ''} onChange=${(e) => { const k = e.currentTarget.value; const c = columns.find((x) => x.key === k); if (c) onSort({ key: k, dir: sort && sort.key === k && sort.dir === 'asc' ? 'desc' : (k === 'date' || k === 'loadDate' ? 'desc' : 'asc') }); }}>
      ${sortable.map((c) => html`<option value=${c.key} selected=${sort && sort.key === c.key}>${c.header}</option>`)}</select>
      ${sort ? html`<button type="button" class="btn ghost sm" aria-label="Schimbă sensul sortării" onClick=${() => onSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>${sort.dir === 'desc' ? '↓' : '↑'}</button>` : null}</label>` : null}
    ${rows.length === 0 ? html`<p class="muted cl-empty">${emptyText || t.common.noData}</p>` : html`<div class="cl-list" role="list" aria-label=${caption || null}>${rows.map((r) => {
      const k = rowKey(r); const clickable = !!onRowClick;
      const title = by(r, 'title'), amount = by(r, 'amount'), meta = by(r, 'meta'), badges = by(r, 'badges');
      return html`<div role="listitem" key=${k} class=${'rc ' + (rowClass ? rowClass(r) : '') + (sel.has(k) ? ' sel-row' : '')} tabindex=${clickable ? 0 : null}
        onClick=${clickable ? (e) => { if (!e.target.closest('input,button,a,select,label')) onRowClick(r); } : null}
        onKeyDown=${clickable ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : null}>
        <div class="rc-top"><div class="rc-title">${title.map((x) => x.v)}</div><div class="rc-amt">${amount.map((x) => x.v)}</div></div>
        ${meta.length ? html`<div class="rc-meta">${meta.map((x) => html`<span><span class="rc-k">${x.c.header}</span> ${x.v}</span>`)}</div>` : null}
        ${badges.length ? html`<div class="rc-badges">${badges.map((x) => x.v)}</div>` : null}
        ${selectable ? html`<label class="rc-sel"><input type="checkbox" aria-label="Selectează rândul" checked=${sel.has(k)} onChange=${() => toggle(r)} /> Selectează</label>` : null}</div>`;
    })}</div>`}
    ${footer ? html`<div class="rc rc-foot">${footer.filter((f) => f !== '' && f != null).join(' · ')}</div>` : null}</div>`;
}
export function Pager({ page, pages, total, size, onPage }) {
  if (pages <= 1) return html`<div class="pager"><span>${total} ${t.common.rows}</span></div>`;
  return html`<nav class="pager" aria-label="Paginare"><span>${(page - 1) * size + 1}–${Math.min(total, page * size)} ${t.common.of} ${total}</span>
    <${Button} kind="ghost" sm onClick=${() => onPage(page - 1)} disabled=${page <= 1}>${t.common.prev}<//>
    <span>${t.common.page} ${page} / ${pages}</span>
    <${Button} kind="ghost" sm onClick=${() => onPage(page + 1)} disabled=${page >= pages}>${t.common.next}<//></nav>`;
}
