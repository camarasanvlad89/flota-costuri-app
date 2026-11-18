# Flota Costuri

Aplicație web statică (fără server și fără bază de date) pentru administratorul unei firme de transport: cheltuieli și venituri pe camion, profit, curse, import GPS, rapoarte și export Excel cu grafice.
Datele rămân în browser (mod local) sau în Google Drive-ul utilizatorului (după logare cu Google). Datele din modul demo sunt fictive.

- Rulare locală: `npm install && npm run build`, apoi servește `dist/` (ex. `python3 -m http.server`).
- Teste: `npm test`.
- Publicare: branch-ul `gh-pages` conține build-ul (`dist/`).
