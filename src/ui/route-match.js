// Potrivire de rute pentru routerul hash (pur).
export function parseHash(hash) {
  let h = String(hash || '').replace(/^#/, '');
  if (!h.startsWith('/')) h = '/' + h;
  const q = h.indexOf('?');
  const path = q >= 0 ? h.slice(0, q) : h;
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  return { path: path.replace(/\/+$/, '') || '/', query };
}
/** Model: '/camion/:id', '/setari/:sectiune?' (parametru opțional). */
export function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/\/+$/, '').split('/').map((seg) => {
    if (!seg) return '';
    const m = /^:([a-zA-Z]+)(\?)?$/.exec(seg);
    if (m) { keys.push(m[1]); return m[2] ? '(?:/([^/]+))?' : '/([^/]+)'; }
    return '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { re: new RegExp('^' + (re || '/') + '$'), keys };
}
export function matchRoute(routes, path) {
  for (const r of routes) {
    const c = r._c || (r._c = compile(r.route));
    const m = c.re.exec(path);
    if (m) {
      const params = {};
      c.keys.forEach((k, i) => { if (m[i + 1] != null) params[k] = decodeURIComponent(m[i + 1]); });
      return { screen: r, params };
    }
  }
  return null;
}
export function buildPath(path, query) {
  const qs = query && String(query) ? '?' + String(query) : '';
  return '#' + path + qs;
}
