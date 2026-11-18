/** 'XX-00-DEM' | 'XX 00 DEM' | 'xx00dem' -> 'XX00DEM' */
export function normalizePlate(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** 'XX00DEM' -> 'XX 00 DEM'; 'B123ABC' -> 'B 123 ABC'; formate necunoscute rămân normalizate. */
export function displayPlate(s) {
  const n = normalizePlate(s);
  const m = /^([A-Z]{1,2})(\d{2,3})([A-Z]{3})$/.exec(n);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : n;
}

/** 'XX00DEM/XX30DEM' -> { truck:'XX00DEM', trailer:'XX30DEM' }; fără remorcă => trailer null. */
export function parsePlates(s) {
  const parts = String(s ?? '').split(/[\/,;|\\]+/).map(normalizePlate).filter(Boolean);
  return { truck: parts[0] || '', trailer: parts[1] || null };
}
