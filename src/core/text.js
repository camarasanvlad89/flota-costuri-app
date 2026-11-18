const EXTRA = { 'Ł': 'L', 'Đ': 'D', 'Ø': 'O', 'Æ': 'AE', 'Œ': 'OE', 'ẞ': 'SS', 'ß': 'SS', 'İ': 'I', 'ı': 'I', 'Þ': 'TH', 'Ð': 'D' };

/**
 * Cheie de comparație: majuscule, fără diacritice (ă î â ș ț ő ű č ć ł ...), `+ - / , . ( ) _` ca separatori,
 * spații comprimate.
 */
export function foldKey(s) {
  let t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  t = t.replace(/[ŁĐØÆŒẞßİıÞÐ]/g, (c) => EXTRA[c] ?? c);
  t = t.replace(/[+\-‐-―−\/\\,.;:()\[\]_]+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function jaro(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(lb - 1, i + win);
    for (let j = lo; j <= hi; j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}

/** Jaro-Winkler pe foldKey, 0..1. Șir gol (după pliere) => 0. */
export function similarity(a, b) {
  const x = foldKey(a), y = foldKey(b);
  if (!x || !y) return 0;
  const j = jaro(x, y);
  let l = 0;
  while (l < 4 && l < x.length && l < y.length && x[l] === y[l]) l++;
  return Math.min(1, j + l * 0.1 * (1 - j));
}
