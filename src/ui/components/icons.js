import { h } from '../dom.js';

const P = {
  fuel: '<path d="M4 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M3 20h12"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/><path d="M6.5 8h5"/>',
  toll: '<path d="M5 21 8.5 3"/><path d="M19 21 15.5 3"/><path d="M12 5v3M12 11v3M12 17v3"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 9.5V20h14V9.5"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h5l3 4v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  inbox: '<path d="M4 6h10M4 12h7M4 18h7"/><path d="m14 16.5 2.5 2.5L21 13.5"/>',
  chart: '<path d="M5 20V11M11 20V4M17 20v-6"/><path d="M2.5 20.5h19"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  docoff: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M3 3l18 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
  upload: '<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12M7.5 11.5 12 16l4.5-4.5"/><path d="M4 20h16"/>',
  offline: '<path d="M3 3l18 18"/><path d="M5.5 12.5A10 10 0 0 1 9 10.3M16 10.2a10 10 0 0 1 2.6 2.3M8.8 16.2a5 5 0 0 1 6.4 0M12 20v.1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cash: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  flash: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"/>',
  gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  empty: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  cloud: '<path d="M7.5 18.5a4.5 4.5 0 0 1-.5-8.97 6 6 0 0 1 11.3 1.7A3.9 3.9 0 0 1 17.5 18.5z"/>',
  disk: '<rect x="3" y="14" width="18" height="6" rx="2"/><path d="M3 14l2.6-8.5h12.8L21 14"/><path d="M7 17h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1.1-1.3 2"/><path d="M12 17.2v.2"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
};

// Șirurile de mai sus sunt constante interne: se transformă în noduri Preact (fără innerHTML).
const parsed = {};
function nodes(name) {
  if (parsed[name]) return parsed[name];
  const out = [];
  const re = /<(path|circle|rect)\s+([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(P[name] || P.info))) {
    const props = {};
    m[2].replace(/([a-z-]+)="([^"]*)"/g, (_, k, v) => { props[k] = v; return ''; });
    out.push(h(m[1], props));
  }
  return (parsed[name] = out);
}

/** Pictogramă inline (stroke). Decorativă (aria-hidden) dacă nu are `label`. */
export function Icon({ name, size, label, class: cls }) {
  const c = 'ic' + (size ? ' ' + size : '') + (cls ? ' ' + cls : '');
  return h('svg', { class: c, viewBox: '0 0 24 24', role: label ? 'img' : undefined, 'aria-label': label || undefined, 'aria-hidden': label ? undefined : 'true' }, nodes(name));
}
export const iconNames = Object.keys(P);
