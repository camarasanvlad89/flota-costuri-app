#!/usr/bin/env node
// Straturi și cicluri (DEV-PLAN 2.1, 10.2). Dependențele merg doar în jos.
//   core: nimic | data: core | domain: core, data | store, auth: core, data | import, export: core, data, domain
//   ui: orice strat de mai jos (ui/api.js este puntea către domeniu/import/export)
//   screens: ui, core, data (NU alte ecrane; NU direct domain/store/import/export ⇒ doar avertisment, trece prin ui/api.js)
// Importuri „goale” permise în src/: preact, preact/hooks, htm, fflate (vendored).
import { APP_ROOT, Report, listFiles, parseImports, read, rel, resolveImport } from './lib/scan.mjs';
import { join, relative, sep } from 'node:path';

export const LAYERS = {
  core: { error: [], warn: [] },
  data: { error: ['core'], warn: [] },
  domain: { error: ['core', 'data'], warn: [] },
  store: { error: ['core', 'data', 'domain'], warn: ['domain'] },   // 10.2: store depinde doar de core; domeniul = avertisment
  auth: { error: ['core', 'data'], warn: [] },
  import: { error: ['core', 'data', 'domain'], warn: [] },
  export: { error: ['core', 'data', 'domain'], warn: [] },
  ui: { error: ['core', 'data', 'domain', 'store', 'auth', 'import', 'export'], warn: [] },
  screens: { error: ['core', 'data', 'ui'], warn: ['domain', 'store', 'auth', 'import', 'export'] },
};
const VENDORED = new Set(['preact', 'preact/hooks', 'htm', 'fflate']);

const layerOf = (file) => {
  const r = relative(join(APP_ROOT, 'src'), file).split(sep);
  if (r[0].startsWith('..')) return null;
  return r.length === 1 ? 'main' : r[0];
};

/** Excepții documentate (fișier → strat țintă): registry.js leagă ecranele (10.9); auth folosește canalul între file din store (4.5). */
const EXCEPTIONS = [
  { file: 'src/ui/registry.js', to: 'screens', level: 'ok' },
  { file: 'src/auth/google.js', to: 'store', level: 'warn', why: '10.2: auth depinde doar de core; canalul între file ar trebui injectat' },
];

export function checkDeps({ srcDir = join(APP_ROOT, 'src'), strictScreens = false, allowMissing = false } = {}) {
  const rep = new Report('straturi și cicluri (check-deps)');
  const files = listFiles(srcDir).filter((f) => !/\.test\.m?js$/.test(f) && !/[\\/]_tests[\\/]/.test(f));
  const graph = new Map();
  for (const f of files) {
    const src = read(f);
    const myLayer = layerOf(f);
    const edges = [];
    for (const imp of parseImports(src)) {
      if (imp.spec.startsWith('node:')) { rep.error(`${rel(f)}: import node:* în cod de aplicație (${imp.spec})`); continue; }
      const target = resolveImport(f, imp.spec);
      if (target === null) { if (!VENDORED.has(imp.spec)) rep.error(`${rel(f)}: import „gol” nepermis „${imp.spec}” (permise: ${[...VENDORED].join(', ')})`); continue; }
      if (target === undefined) { (allowMissing ? rep.warn : rep.error).call(rep, `${rel(f)}: import către fișier inexistent „${imp.spec}”${imp.dynamic ? ' (dinamic)' : ''}`); continue; }
      if (!imp.dynamic) edges.push(target);
      const tLayer = layerOf(target);
      if (myLayer === 'main' || !tLayer || tLayer === 'main') continue;
      if (myLayer === 'screens' && tLayer === 'screens') {
        if (relative(join(srcDir, 'screens'), f).split(sep)[0] !== relative(join(srcDir, 'screens'), target).split(sep)[0]) rep.error(`${rel(f)}: ecranele nu se importă între ele (${rel(target)}); folosește ctx.nav`);
        continue;
      }
      if (tLayer === myLayer) continue;
      const rule = LAYERS[myLayer];
      if (!rule) { rep.warn(`${rel(f)}: strat necunoscut „${myLayer}”`); continue; }
      const ex = EXCEPTIONS.find((e) => e.file === rel(f) && e.to === tLayer);
      if (ex) { if (ex.level === 'warn') rep.warn(`${rel(f)} → ${tLayer}: ${ex.why}`); continue; }
      const allowed = rule.error.includes(tLayer);
      const onlyWarn = rule.warn.includes(tLayer);
      if (!allowed || (strictScreens && onlyWarn)) rep.error(`${rel(f)}: stratul „${myLayer}” nu are voie să importe „${tLayer}” (${rel(target)})`);
      else if (onlyWarn) rep.warn(`${rel(f)}: „${myLayer}” importă direct „${tLayer}” (${rel(target)}); preferă ctx / ui/api.js`);
    }
    graph.set(f, edges);
  }
  // cicluri (Tarjan, doar importuri statice)
  let idx = 0; const st = [], on = new Set(), ix = new Map(), low = new Map();
  const comps = [];
  const strong = (v) => {
    ix.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of graph.get(v) || []) {
      if (!graph.has(w)) continue;
      if (!ix.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w)));
    }
    if (low.get(v) === ix.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1 || (graph.get(v) || []).includes(v)) comps.push(c); }
  };
  for (const v of graph.keys()) if (!ix.has(v)) strong(v);
  for (const c of comps) rep.error(`dependență circulară: ${c.map(rel).join(' ↔ ')}`);
  return { rep, files: files.length, graph };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rep, files } = checkDeps({ strictScreens: process.argv.includes('--strict'), allowMissing: process.argv.includes('--wip') });
  console.log(`(${files} fișiere analizate)`);
  process.exit(rep.print() ? 0 : 1);
}
