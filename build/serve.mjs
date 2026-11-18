// Server static minim (fără dependențe) pentru `npm run dev` și testele E2E. Servește un director, tip MIME corect,
// fără listare de directoare, cu CSP-ul din `_headers` aplicat ca antet când există.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function parseHeaders(dir) {
  const f = join(dir, '_headers');
  if (!existsSync(f)) return {};
  const out = {}; let cur = null;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = line.trim(); out[cur] = out[cur] || {}; continue; }
    const i = line.indexOf(':'); if (cur && i > 0) out[cur][line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** @returns {Promise<{ server:import('node:http').Server, port:number, url:string, close():Promise<void> }>} */
export async function serve(dir, { port = 0, host = '127.0.0.1', log = false } = {}) {
  const root = resolve(dir);
  const global = parseHeaders(root)['/*'] || {};
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      let p = normalize(decodeURIComponent(u.pathname));
      if (p.endsWith('/') || p === '') p = join(p, 'index.html');
      const file = resolve(join(root, p));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end('interzis'); }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('negăsit'); }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...global });
      res.end(req.method === 'HEAD' ? undefined : body);
      if (log) console.log(`${req.method} ${u.pathname}`);
    } catch (e) { res.writeHead(500); res.end(String(e.message)); }
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(port, host, r); });
  const actual = server.address().port;
  return { server, port: actual, url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${actual}`, close: () => new Promise((r) => server.close(() => r())) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'dist'; const port = Number(process.argv[3] || 5173);
  serve(dir, { port, log: true }).then((s) => console.log(`servesc ${resolve(dir)} pe ${s.url}`));
}
