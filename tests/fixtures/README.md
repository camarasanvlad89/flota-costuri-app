# Fixture-uri de test

Toate fișierele cu **FICTIV** în nume sunt inventate (insigna „date demo” în aplicație). Generate de `node scripts/make-fixtures.mjs` (idempotent; `--check` verifică).

| Director | Conținut | Origine |
|---|---|---|
| `gps/` | `safefleet-calatorii-XX00DEM-oct2026.xlsx`, `safefleet-foaie-activitate-zilnica-XX00DEM-oct2026.xlsx` | **REALE** (copiate din `docs/ref/`). Plus variante FICTIV: XX01DEM (alt camion), odometru greșit, călătorii peste miezul nopții. `expected-*.json` = valori calculate independent din fișierele reale. |
| `courses/` | registru .xlsx (7 foi ca în realitate) + CSV (UTF-8 și Windows-1250) cu **rândurile 121–147 din poză** (aug.–oct. 2025), `*.expected.json` | transcris din `docs/ref/tabel-curse-XX00DEM-poza.jpg` |
| `fictiv/` | `FICTIV-curse-XX00DEM-oct2026.xlsx/.csv`: 31 curse în layout-ul real, cu defecte deliberate; `aliases-FICTIV.json`; `FICTIV-expected-flags.json` | inventat, construit din locurile reale ale GPS-ului |
| `fx/` | `pinned.json` (un singur curs EUR/RON = 5,3442), `bnr-FICTIV.xml` | inventat (nu sunt cursuri reale) |
| `xlsx/` | extras de card generic (CSV) și factură UBL | inventate: **nu** reproduc formatul vreunui furnizor real |
| `golden/` | `make_expected.py` (Python `decimal`) + `expected.json` | valori de aur independente de codul aplicației |
| `xlsx-ref/` | `make_ref.py` (XlsxWriter) + referință OOXML | spike export (9) |
| `mini-app/` | aplicație minimă pentru testele de build | – |

Date: 20.08.2025–03.10.2025 (poză) și 01.10.2026–31.10.2026 (GPS real + curse FICTIV). Perioadele nu coincid între ele, intenționat.
