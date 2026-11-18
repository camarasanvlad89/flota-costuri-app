// Descărcare în browser. Fără efect în afara browserului (teste node).
export function downloadBytes(bytes, filename, mime) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new Error('downloadBytes necesită un browser');
  }
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const blob = new Blob([data], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MIME_CSV = 'text/csv;charset=utf-8';
export const MIME_ICS = 'text/calendar;charset=utf-8';
