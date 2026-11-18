#!/usr/bin/env python3
"""Referință OOXML generată cu XlsxWriter (DEV-PLAN 9, faza 2). Doar la dezvoltare: `pip3 install xlsxwriter`.

Produce, în acest director:
  ref-3charts.xlsx      un registru cu aceleași 3 grafice ca primele din export (profit pe camion = bare, profit lunar = coloane,
                        încărcați vs goi = coloane stivuite) și șiruri în sharedStrings, ca exportul aplicației.
  structure.json        lista părților, tipurile de conținut, tipurile de relații și ORDINEA copiilor elementelor de grafic
                        (c:chartSpace, c:chart, c:plotArea, c:barChart, c:ser, c:catAx, c:valAx, ...), citite din zip.
Testul tests/unit/export-structure/structure.test.js compară exportul aplicației cu structure.json: Excel dă „repair” la orice abatere de
ordine, iar verificările „XML bine format” și openpyxl NU o prind. Verificarea finală rămâne manuală în Excel și LibreOffice (RELEASE-CHECKLIST).
"""
import json
import os
import re
import xml.etree.ElementTree as ET
import zipfile

import xlsxwriter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "ref-3charts.xlsx")

wb = xlsxwriter.Workbook(OUT, {"strings_to_numbers": False, "default_date_format": "dd.mm.yyyy"})
bold = wb.add_format({"bold": True})
money = wb.add_format({"num_format": "#,##0.00"})
ws = wb.add_worksheet("Clasament")
ws.write_row(0, 0, ["Camion", "Venit", "Cost", "Profit"], bold)
rows = [("XX 00 DEM", 12000.5, 8000.25), ("XX 01 DEM", 9000, 7000.1), ("XX 02 DEM", 5000, 5200.75)]
for i, (p, v, c) in enumerate(rows, start=1):
    ws.write_string(i, 0, p)
    ws.write_number(i, 1, v, money)
    ws.write_number(i, 2, c, money)
    ws.write_formula(i, 3, f"=B{i+1}-C{i+1}", money, round(v - c, 2))
ch1 = wb.add_chart({"type": "bar"})
ch1.add_series({"name": "Profit", "categories": "=Clasament!$A$2:$A$4", "values": "=Clasament!$D$2:$D$4", "fill": {"color": "#5B6EE1"}})
ch1.set_title({"name": "Profit pe camion"}); ch1.set_legend({"none": True})
ws.insert_chart("F2", ch1)

ws2 = wb.add_worksheet("Profit lunar")
ws2.write_row(0, 0, ["Luna", "Profit"], bold)
for i, (m, p) in enumerate([("2026-08", 3000.0), ("2026-09", -1200.5), ("2026-10", 4100.75)], start=1):
    ws2.write_string(i, 0, m); ws2.write_number(i, 1, p, money)
ch2 = wb.add_chart({"type": "column"})
ch2.add_series({"name": "Profit lunar", "categories": "='Profit lunar'!$A$2:$A$4", "values": "='Profit lunar'!$B$2:$B$4"})
ch2.set_title({"name": "Profit lunar flotă"}); ch2.set_legend({"none": True})
ws2.insert_chart("D2", ch2)

ws3 = wb.add_worksheet("Km pe gol")
ws3.write_row(0, 0, ["Camion", "Încărcați (km)", "Goi (km)"], bold)
for i, (p, l, g) in enumerate([("XX 00 DEM", 5200.5, 3175.8), ("XX 01 DEM", 4100, 2900.25)], start=1):
    ws3.write_string(i, 0, p); ws3.write_number(i, 1, l); ws3.write_number(i, 2, g)
ch3 = wb.add_chart({"type": "column", "subtype": "stacked"})
ch3.add_series({"name": "='Km pe gol'!$B$1", "categories": "='Km pe gol'!$A$2:$A$3", "values": "='Km pe gol'!$B$2:$B$3"})
ch3.add_series({"name": "='Km pe gol'!$C$1", "categories": "='Km pe gol'!$A$2:$A$3", "values": "='Km pe gol'!$C$2:$C$3"})
ch3.set_title({"name": "Km încărcați vs goi"})
ws3.insert_chart("E2", ch3)
wb.close()

# ───────── extragere structură ─────────
def local(tag):
    return tag.split("}")[-1]


def prefixed(el):
    ns = el.tag.split("}")[0][1:] if "}" in el.tag else ""
    pre = {"http://schemas.openxmlformats.org/drawingml/2006/chart": "c", "http://schemas.openxmlformats.org/drawingml/2006/main": "a"}.get(ns, "")
    return (pre + ":" if pre else "") + local(el.tag)


orders = {}  # nume container -> listă ordonată de copii (unirea, păstrând ordinea relativă)


def merge(container, names):
    cur = orders.setdefault(container, [])
    for n in names:
        if n not in cur:
            # inserează după ultimul element deja cunoscut care îl precede în `names`
            idx = names.index(n)
            pos = 0
            for j in range(idx - 1, -1, -1):
                if names[j] in cur:
                    pos = cur.index(names[j]) + 1
                    break
            cur.insert(pos, n)


def walk(el):
    kids = [prefixed(c) for c in el]
    if kids:
        merge(prefixed(el), kids)
    for c in el:
        walk(c)


z = zipfile.ZipFile(OUT)
parts = sorted(z.namelist())
ct = ET.fromstring(z.read("[Content_Types].xml"))
overrides = {o.get("PartName"): o.get("ContentType") for o in ct if local(o.tag) == "Override"}
defaults = {o.get("Extension"): o.get("ContentType") for o in ct if local(o.tag) == "Default"}
rel_types = {}
for n in parts:
    if n.endswith(".rels"):
        for r in ET.fromstring(z.read(n)):
            rel_types.setdefault(re.sub(r"\d+", "N", n), set()).add(r.get("Type"))
for n in parts:
    if re.match(r"xl/charts/chart\d+\.xml$", n):
        walk(ET.fromstring(z.read(n)))
generic = lambda p: re.sub(r"\d+", "N", p)
doc = {
    "_comment": "GENERAT de make_ref.py (XlsxWriter %s). Nu edita." % xlsxwriter.__version__,
    "parts": sorted({generic(p) for p in parts}),
    "contentTypeOverridesByKind": {generic(k): v for k, v in sorted(overrides.items())},
    "contentTypeDefaults": defaults,
    "relationshipTypesByRels": {k: sorted(v) for k, v in sorted(rel_types.items())},
    "chartChildOrder": orders,
    "sharedStrings": "xl/sharedStrings.xml" in parts,
}
with open(os.path.join(HERE, "structure.json"), "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("ref-3charts.xlsx + structure.json:", len(parts), "părți,", len(orders), "tipuri de container grafic")
