import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { zipSync, strToU8 } from 'fflate';
const html = htm.bind(h);
function App() {
  const [n, setN] = useState(0);
  return html`<button id="b" onClick=${() => setN(n + 1)}>Clic ${n}</button>`;
}
render(html`<${App} />`, document.getElementById('app'));
window.__mini = {
  version: typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__,
  zipLen: zipSync({ 'a.txt': strToU8('salut') }).length,
  xlsx: () => globalThis.XLSX.version,
  html: '</script><!-- test -->',
};
