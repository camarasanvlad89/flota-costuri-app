// Politica de securitate a conținutului (DEV-PLAN 4.9). O SINGURĂ sursă: orice serviciu extern nou se adaugă aici,
// în 4.9 și în Setări > Date (lista cu comutator per serviciu). Nicio dată nu pleacă spre alte servere.
export const CONNECT_SRC = [
  "'self'",
  'https://accounts.google.com',
  'https://www.googleapis.com',
  'https://oauth2.googleapis.com',
  'https://api.frankfurter.dev',
  'https://router.project-osrm.org',
  'https://nominatim.openstreetmap.org',
];
/** Gazde permise în `connect-src` (folosită și de verificarea statică și de testul E2E „0 cereri externe”). */
export const ALLOWED_EXTERNAL_HOSTS = CONNECT_SRC.filter((s) => s.startsWith('https://')).map((s) => new URL(s).host)
  .concat(['accounts.google.com']);

/**
 * @param {{ inlineHashes?: string[], mode: 'multi'|'single', meta?: boolean }} o
 * `multi`  = dist/index.html (+ antet pe gazdă): script 'self' + Google Identity Services + hash-urile scripturilor inline.
 * `single` = dist/flota-costuri.html: tot inline, doar hash-uri; fără Google (nu merge din file://).
 * `meta: true` omite directivele care NU sunt valabile într-un <meta> (frame-ancestors, report-uri, sandbox).
 */
export function buildCsp({ inlineHashes = [], mode, meta = true }) {
  const hashes = inlineHashes.map((h) => `'${h}'`);
  const d = [];
  if (mode === 'single') {
    d.push(`default-src 'none'`);
    d.push(`script-src ${hashes.join(' ') || "'none'"}`);
    d.push(`style-src 'unsafe-inline'`);
    d.push(`connect-src ${CONNECT_SRC.filter((s) => s !== "'self'" && !/google/.test(s)).join(' ')}`);
    d.push(`img-src data: blob:`);
    d.push(`font-src data:`);
  } else {
    d.push(`default-src 'self'`);
    d.push(`script-src 'self' https://accounts.google.com/gsi/ ${hashes.join(' ')}`.trim());
    d.push(`connect-src ${CONNECT_SRC.join(' ')}`);
    d.push(`img-src 'self' data: blob:`);
    d.push(`style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style`);
    d.push(`font-src 'self' data:`);
    d.push(`frame-src https://accounts.google.com`);
    d.push(`worker-src 'self'`);
    d.push(`manifest-src 'self'`);
  }
  d.push(`base-uri 'none'`);
  d.push(`object-src 'none'`);
  d.push(`form-action 'none'`);
  if (!meta) d.push(`frame-ancestors 'none'`);
  return d.join('; ');
}

/** Antete de securitate pentru `dist/_headers` (Netlify / Cloudflare Pages). */
export function buildHeadersFile({ csp }) {
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // GIS deschide o fereastră popup și primește token prin postMessage: `same-origin` ar rupe fluxul.
    '  Cross-Origin-Opener-Policy: same-origin-allow-popups',
    '/index.html',
    '  Cache-Control: no-cache',
    '/config.js',
    '  Cache-Control: no-cache',
    '/sw.js',
    '  Cache-Control: no-cache',
    '/manifest.webmanifest',
    '  Cache-Control: no-cache',
    '/app.*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}
