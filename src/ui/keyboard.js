// Taste rapide (WCAG 2.1.4): scurtăturile dintr-o singură tastă acționează doar când focusul nu e într-un câmp
// și se pot dezactiva. Combinațiile cu modificatori (Ctrl+Enter, Alt+Shift+D) merg și în câmpuri.

/** Normalizează un eveniment la „Ctrl+Alt+Shift+Key”. Literele se compară fără majuscule; Shift se ignoră pentru caractere simple. */
export function comboOf(e) {
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  let key = e.key;
  if (e.code && /^Key[A-Z]$/.test(e.code) && (e.altKey || e.ctrlKey || e.metaKey)) key = e.code.slice(3); // Alt+D pe Mac dă „∂”
  if (key === ' ') key = 'Space';
  const single = key && key.length === 1;
  if (single) key = key.toLowerCase();
  if (e.shiftKey && (!single || mods.length)) mods.push('Shift');
  if (single && !mods.length) return key;
  // ordine canonică: Ctrl, Alt, Shift
  const order = ['Ctrl', 'Alt', 'Shift'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, single ? key : key].join('+');
}
export function normalizeSpec(spec) {
  if (spec.includes(' ')) return spec.split(/\s+/).map(normalizeSpec).join(' ');
  const parts = spec.split('+');
  const key = parts.pop();
  const mods = parts.map((p) => (p.toLowerCase() === 'cmd' || p.toLowerCase() === 'meta' ? 'Ctrl' : p[0].toUpperCase() + p.slice(1).toLowerCase()));
  const order = ['Ctrl', 'Alt', 'Shift'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const k = key.length === 1 ? key.toLowerCase() : key;
  return [...mods, k].join('+');
}
export const isEditable = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true);

export function createKeyboard({ enabled = () => true, target } = {}) {
  const layers = []; // cele mai noi primele
  let pending = null, timer = null;
  function run(layer, spec, e) {
    const fn = layer.map.get(spec);
    if (fn) { e.preventDefault(); fn(e); return true; }
    return false;
  }
  function onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    const combo = comboOf(e);
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const hasMod = /^(Ctrl|Alt)/.test(combo);
    const inField = isEditable(e.target);
    const plain = !hasMod && !/^(Ctrl|Alt)/.test(combo);
    const singleKey = plain && combo.length === 1;
    if (plain && (inField || !enabled())) { pending = null; return; }
    if (pending && singleKey) {
      const seq = pending + ' ' + combo;
      pending = null; clearTimeout(timer);
      for (const l of layers) if (run(l, seq, e)) return;
    }
    for (const l of layers) {
      if (run(l, combo, e)) return;
    }
    if (singleKey && layers.some((l) => [...l.map.keys()].some((k) => k.startsWith(combo + ' ')))) {
      pending = combo; clearTimeout(timer); timer = setTimeout(() => { pending = null; }, 1200);
    }
  }
  function register(map) {
    const layer = { map: new Map(Object.entries(map).map(([k, v]) => [normalizeSpec(k), v])) };
    layers.unshift(layer);
    return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
  }
  const tgt = target || (typeof document !== 'undefined' ? document : null);
  if (tgt) tgt.addEventListener('keydown', onKey);
  return { register, destroy() { if (tgt) tgt.removeEventListener('keydown', onKey); }, _onKey: onKey };
}
