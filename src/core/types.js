// Doar @typedef (fără cod). Tipurile de bază ale nucleului; restul tipurilor de domeniu se adaugă de modulele lor.

/** @typedef {number} Minor   Sumă întreagă în unitatea minoră a monedei (bani; HUF = forinți). Number.isSafeInteger. */
/** @typedef {number} Meters  Distanță întreagă în metri. */
/** @typedef {number} Bp      Puncte de bază (21% = 2100). */
/** @typedef {string} RateStr Șir zecimal cu până la 10 zecimale, ex. '5.3442' (unități ale monedei țintă pentru 1 unitate sursă). */
/** @typedef {string} IsoDate 'YYYY-MM-DD' */
/** @typedef {string} Month   'YYYY-MM' */
/** @typedef {{from: IsoDate, to: IsoDate}} Range  Interval inclusiv. */
/** @typedef {{now(): number}} Clock */
export {};
