#!/usr/bin/env python3
"""Valori de aur INDEPENDENTE de codul aplicației (DEV-PLAN 11.1).

Se calculează cu `decimal` din biblioteca standard Python (aritmetică zecimală exactă, rotunjire ROUND_HALF_UP = jumătate în
afara lui zero), NU cu codul JavaScript pe care îl verifică. Atât scriptul cât și `expected.json` se comit; testul
`tests/unit/golden/golden.test.js` citește JSON-ul și apelează funcțiile aplicației.

Rulare: python3 tests/fixtures/golden/make_expected.py   (sau: npm run golden)
Determinist: PRNG cu sămânță fixă; fără dată/oră în rezultat.
"""
import calendar
import json
import os
import random
import sys
from decimal import Decimal, ROUND_HALF_UP, getcontext

getcontext().prec = 60
NBSP = " "
MINUS = "−"
EXP = {"RON": 2, "EUR": 2, "PLN": 2, "CZK": 2, "USD": 2, "GBP": 2, "CHF": 2, "BGN": 2, "HUF": 0}


def rhu(x):
    """jumătate în sus, în afara lui zero, la întreg"""
    d = Decimal(x)
    return int(d.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def mul_div(a, b, c):
    return rhu(Decimal(a) * Decimal(b) / Decimal(c))


# ───────────────────────── mulDiv ─────────────────────────
muldiv = []
for a, b, c in [(354277, 21, 100), (1, 1, 2), (-1, 1, 2), (3, 1, 2), (-3, 1, 2), (5, 1, 10), (4, 1, 10), (123456, 2700, 12700),
                (428675, 10000, 12100), (999999999, 7, 3), (-999999999, 7, 3), (0, 5, 7), (600001, 2, 3), (1, 1, 3), (2, 1, 3)]:
    muldiv.append({"a": a, "b": b, "c": c, "expected": mul_div(a, b, c)})

# ───────────────────────── splitAmounts ─────────────────────────
def split(entered, minor, rate_bp):
    if entered == "net":
        vat = mul_div(minor, rate_bp, 10000)
        return {"gross": minor + vat, "net": minor, "vat": vat}
    if entered == "gross":
        net = mul_div(minor, 10000, 10000 + rate_bp)
        return {"gross": minor, "net": net, "vat": minor - net}
    net = mul_div(minor, 10000, rate_bp)
    return {"gross": net + minor, "net": net, "vat": minor}


split_cases = []
fixed = [
    ("net", 354277, 2100), ("gross", 428675, 2100), ("vat", 74398, 2100),   # tabelul real: 3542,77 / 743,98 / 4286,75
    ("gross", 187660, 2100), ("gross", 253920, 2100), ("net", 253610, 2100), ("gross", 306868, 2100),
    ("net", 123456, 2700), ("gross", 123456, 2700), ("vat", 26247, 2700), ("net", 100000, 1900), ("gross", 119000, 1900),
    ("net", 1, 2100), ("net", 0, 2100), ("gross", 1, 2100), ("net", 99999999, 2500), ("net", 100, 0), ("gross", 100, 0),
]
for e, m, r in fixed:
    split_cases.append({"entered": e, "minor": m, "rateBp": r, "expected": split(e, m, r)})
rng = random.Random(20261018)
RATES = [0, 500, 800, 900, 1000, 1100, 1800, 1900, 2000, 2100, 2200, 2300, 2500, 2700]
for _ in range(1000):
    e = rng.choice(["net", "gross", "vat"])
    r = rng.choice(RATES if e != "vat" else [x for x in RATES if x])
    m = rng.choice([rng.randint(1, 5000), rng.randint(1, 1000000), rng.randint(1, 99999999)])
    split_cases.append({"entered": e, "minor": m, "rateBp": r, "expected": split(e, m, r)})

# ───────────────────────── vatCost (5.2) ─────────────────────────
def vat_cost(treatment, net, vat, ded=100, same_country=True, vat_payer=True, documentation="invoice", rate_bp=0, refundable=True):
    gross = net + vat
    recoverable = 0
    self_assessed = 0
    self_nonrec = 0
    if treatment == "taxed":
        if vat_payer and documentation == "invoice" and (same_country or refundable) and vat > 0:
            recoverable = vat - mul_div(vat, 100 - ded, 100)
    elif treatment == "reverse":
        self_assessed = mul_div(net, rate_bp, 10000)
        ded_eff = ded if (vat_payer and documentation == "invoice") else 0
        self_nonrec = mul_div(self_assessed, 100 - ded_eff, 100)
    cost = net + (vat - recoverable) + self_nonrec
    return {"cost": cost, "recoverable": recoverable, "selfAssessedVat": self_assessed, "selfNonRecoverable": self_nonrec, "nonRecoverableVat": vat - recoverable}


vat_cases = []
def add_vat(name, treatment, net, vat, **kw):
    vat_cases.append({"name": name, "treatment": treatment, "net": net, "vat": vat, "gross": net + vat, "args": kw, "expected": vat_cost(treatment, net, vat, **kw)})

add_vat("RO motorină 50% deductibil", "taxed", 100000, 21000, ded=50)
add_vat("DE motorină 19% / 50%", "taxed", 100000, 19000, ded=50, same_country=False)
add_vat("DE reparație 19% / 100%, rambursabil", "taxed", 250000, 47500, ded=100, same_country=False)
add_vat("DE nerambursabil", "taxed", 250000, 47500, ded=100, same_country=False, refundable=False)
add_vat("fără TVA (none)", "none", 87500, 0)
add_vat("0% scutit (zero)", "zero", 87500, 0)
add_vat("TVA nedeductibil", "nondeductible", 100000, 21000)
add_vat("bon (receipt) nu dă TVA recuperabil", "taxed", 100000, 21000, documentation="receipt")
add_vat("firmă neplătitoare", "taxed", 100000, 21000, vat_payer=False)
add_vat("taxare inversă 21% / 100%", "reverse", 100000, 0, rate_bp=2100)
add_vat("taxare inversă 21% / 50%", "reverse", 100001, 0, ded=50, rate_bp=2100)
add_vat("deducere rotunjire", "taxed", 33333, 7000, ded=50)

# ───────────────────────── conversie și curs încrucișat ─────────────────────────
EUR_RON = Decimal("5.3442")
EUR_HUF = Decimal("364.08")
EUR_PLN = Decimal("4.2815")


def rate10(x):
    return Decimal(x).quantize(Decimal("0.0000000001"), rounding=ROUND_HALF_UP)


def rate_str(x):
    s = format(rate10(x), "f")
    return s


def convert(minor, frm, to, rate):
    major = Decimal(minor) / (Decimal(10) ** EXP[frm])
    return rhu(major * Decimal(rate) * (Decimal(10) ** EXP[to]))


rates = {
    "EUR->RON": rate_str(EUR_RON),
    "RON->EUR": rate_str(1 / EUR_RON),
    "HUF->RON": rate_str(EUR_RON / EUR_HUF),
    "HUF->EUR": rate_str(1 / EUR_HUF),
    "PLN->RON": rate_str(EUR_RON / EUR_PLN),
    "EUR->HUF": rate_str(EUR_HUF),
}
convert_cases = []
for frm, to, minors in [("EUR", "RON", [8750, 100, 1, 123456, 99999999]), ("RON", "EUR", [428675, 1, 100000]),
                        ("HUF", "RON", [123456, 1, 3020000, 99]), ("HUF", "EUR", [123456, 3020000]),
                        ("PLN", "RON", [125000, 33]), ("EUR", "HUF", [8750, 1])]:
    r = rates[f"{frm}->{to}"]
    for m in minors:
        convert_cases.append({"minor": m, "from": frm, "to": to, "rate": r, "expected": convert(m, frm, to, r)})
cross = [
    {"perEur": {"RON": "5.3442", "HUF": "364.08", "PLN": "4.2815"}, "from": "HUF", "to": "RON", "expected": rates["HUF->RON"]},
    {"perEur": {"RON": "5.3442", "HUF": "364.08", "PLN": "4.2815"}, "from": "PLN", "to": "RON", "expected": rates["PLN->RON"]},
    {"perEur": {"RON": "5.3442", "HUF": "364.08", "PLN": "4.2815"}, "from": "RON", "to": "EUR", "expected": rates["RON->EUR"]},
    {"perEur": {"RON": "5.3442", "HUF": "364.08", "PLN": "4.2815"}, "from": "HUF", "to": "EUR", "expected": rates["HUF->EUR"]},
]
rate_div = [{"a": "5.3442", "b": "364.08", "expected": rates["HUF->RON"]}, {"a": "1", "b": "5.3442", "expected": rates["RON->EUR"]}]
# reconciliere EUR: valoarea EUR înghețată pe fiecare intrare, sumele nu se recalculează din total (D11)
frozen = []
for ron_minor in (428675, 74398, 354277, 123456, 1):
    frozen.append({"ronMinor": ron_minor, "eurMinor": convert(ron_minor, "RON", "EUR", rates["RON->EUR"])})
sum_of_frozen = sum(x["eurMinor"] for x in frozen)
total_ron = sum(x["ronMinor"] for x in frozen)
recon = {"entries": frozen, "sumEurFrozen": sum_of_frozen, "totalRon": total_ron, "eurOfTotalRon": convert(total_ron, "RON", "EUR", rates["RON->EUR"]),
         "note": "suma EUR înghețate poate diferi de EUR(total RON); testul reconciliază în fiecare monedă separat"}

# ───────────────────────── allocate (restul pe ultima parte) ─────────────────────────
def allocate(total, weights):
    s = sum(Decimal(w) for w in weights)
    parts = [int((Decimal(total) * Decimal(w) / s).to_integral_value(rounding="ROUND_FLOOR")) for w in weights]
    parts[-1] += total - sum(parts)
    return parts

alloc_cases = [{"total": t, "weights": w, "expected": allocate(t, w)} for t, w in [
    (600001, [4, 2]), (100, [1, 1, 1]), (1, [1, 1]), (999, [3, 3, 3]), (10000, [1, 2, 3, 4]), (7, [5]), (123456, [10, 20, 30]), (0, [1, 2])]]
prorata = {"total": 600001, "monthDays": {"2026-10": 4, "2026-11": 2},
           "course": {"load": "2026-10-28", "unload": "2026-11-02"}, "expected": [400000, 200001],
           "note": "6.000,01 ⇒ 4.000,00 / 2.000,01 (4 zile în octombrie, 2 în noiembrie), 11.1"}
assert allocate(600001, [4, 2]) == [400000, 200001]

# ───────────────────────── formatare (ro-RO) ─────────────────────────
def group(i):
    s = str(i)
    out = []
    while len(s) > 3:
        out.insert(0, s[-3:])
        s = s[:-3]
    out.insert(0, s)
    return ".".join(out)


def fmt_money(minor, cur, code=False):
    dec = EXP[cur]
    a = abs(minor)
    s = str(a).rjust(dec + 1, "0")
    body = group(s[:-dec] if dec else s) + ("," + s[-dec:] if dec else "")
    unit = cur if code else {"RON": "lei", "EUR": "€"}.get(cur, cur)
    neg = minor < 0 and minor != 0
    return (MINUS if neg else "") + body + NBSP + unit


fmt_cases = []
for m, c in [(354277, "RON"), (0, "RON"), (-354277, "RON"), (-1, "RON"), (99999999, "RON"), (123456, "HUF"), (-123456, "HUF"), (0, "HUF"), (8750, "EUR"),
             (125000, "PLN"), (123400, "RON"), (100000, "RON"), (100, "RON"), (5, "EUR"), (99999999999, "RON"), (-8750, "EUR"), (1, "HUF")]:
    fmt_cases.append({"minor": m, "currency": c, "expected": fmt_money(m, c)})
    fmt_cases.append({"minor": m, "currency": c, "code": True, "expected": fmt_money(m, c, True)})


def fmt_km(meters, decimals):
    q = (Decimal(abs(meters)) / 1000).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    ip, _, fp = format(q, "f").partition(".")
    body = group(int(ip)) + ("," + fp if decimals else "")
    return (MINUS if meters < 0 and q != 0 else "") + body + NBSP + "km"


km_cases = [{"meters": m, "decimals": d, "expected": fmt_km(m, d)} for m, d in [(8376300, 1), (8376300, 0), (0, 1), (999, 1), (8377400, 1), (123456789, 1), (450, 0), (-1500, 1)]]


def fmt_pct(ratio, decimals):
    q = (Decimal(ratio) * 100).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    ip, _, fp = format(abs(q), "f").partition(".")
    return (MINUS if q < 0 else "") + group(int(ip)) + ("," + fp if decimals else "") + "%"


pct_cases = [{"ratio": r, "decimals": d, "expected": fmt_pct(r, d)} for r, d in [("0.125", 1), ("0.2", 0), ("0", 1), ("1", 0), ("0.05", 1), ("0.0049", 1), ("12.345", 0)]]

# ───────────────────────── parseAmount ─────────────────────────
parse_cases = [
    {"text": "1234,56", "cur": "RON", "ok": True, "minor": 123456},
    {"text": "1234.56", "cur": "RON", "ok": True, "minor": 123456},
    {"text": "1 234,56", "cur": "RON", "ok": True, "minor": 123456},
    {"text": "1.234,56", "cur": "RON", "ok": True, "minor": 123456},
    {"text": "3542,77", "cur": "RON", "ok": True, "minor": 354277},
    {"text": "0,05", "cur": "EUR", "ok": True, "minor": 5},
    {"text": "100", "cur": "RON", "ok": True, "minor": 10000},
    {"text": "123456", "cur": "HUF", "ok": True, "minor": 123456},
    {"text": "1.234", "cur": "RON", "ok": True, "ambiguous": True, "interpretations": [123400, 123]},
    {"text": "12.500", "cur": "RON", "ok": True, "ambiguous": True, "interpretations": [1250000, 1250]},
    {"text": "12,5", "cur": "HUF", "ok": False, "why": "forinții nu au subdiviziuni"},
    {"text": "abc", "cur": "RON", "ok": False, "why": "nu e număr"},
]

# ───────────────────────── date: sfârșit de lună, an bisect, ziua 31 ─────────────────────────
def add_months(y, m, d, n):
    t = (y * 12 + (m - 1)) + n
    ny, nm = divmod(t, 12)
    nm += 1
    nd = min(d, calendar.monthrange(ny, nm)[1])
    return f"{ny:04d}-{nm:02d}-{nd:02d}"


add_months_cases = []
for y, m, d, n in [(2026, 1, 31, 1), (2028, 1, 31, 1), (2026, 3, 31, 1), (2026, 12, 31, 2), (2026, 1, 30, 1), (2026, 8, 31, 6), (2026, 5, 31, -3), (2028, 2, 29, 12), (2026, 10, 15, 3)]:
    add_months_cases.append({"from": f"{y:04d}-{m:02d}-{d:02d}", "months": n, "expected": add_months(y, m, d, n)})
day31 = {str(y): [f"{y:04d}-{m:02d}-{min(31, calendar.monthrange(y, m)[1]):02d}" for m in range(1, 13)] for y in (2026, 2027, 2028)}
days_in_month = [{"year": y, "month": m, "expected": calendar.monthrange(y, m)[1]} for y, m in [(2026, 2), (2028, 2), (2100, 2), (2000, 2), (2026, 4), (2026, 12)]]
# catch-up: șablon lunar în ziua 31, început 2026-01-31, „azi” 2026-05-10 ⇒ 4 ocurențe (ian, feb, mar, apr); mai (31) încă nu
catchup = {"startDate": "2026-01-31", "dayOfMonth": 31, "frequency": "monthly", "today": "2026-05-10",
           "expectedDates": [add_months(2026, 1, 31, i) for i in range(4)]}
assert catchup["expectedDates"] == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
catchup_leap = {"startDate": "2028-01-31", "dayOfMonth": 31, "frequency": "monthly", "today": "2028-03-31",
                "expectedDates": [add_months(2028, 1, 31, i) for i in range(3)]}
assert catchup_leap["expectedDates"] == ["2028-01-31", "2028-02-29", "2028-03-31"]
quarterly = {"startDate": "2026-01-15", "frequency": "quarterly", "dayOfMonth": 15, "today": "2026-11-20",
             "expectedDates": [add_months(2026, 1, 15, 3 * i) for i in range(4)]}
mid_year_change = {"template": {"startDate": "2026-01-01", "dayOfMonth": 5, "amount": "1500.00", "currency": "RON"},
                   "change": {"effectiveFrom": "2026-07", "amount": "1650.00"}, "today": "2026-09-10",
                   "expected": [{"date": f"2026-{m:02d}-05", "amountMinor": 150000 if m < 7 else 165000} for m in range(1, 10)]}
ended = {"template": {"startDate": "2026-01-10", "endDate": "2026-03-20", "dayOfMonth": 10, "frequency": "monthly"}, "today": "2026-09-01",
         "expectedDates": ["2026-01-10", "2026-02-10", "2026-03-10"]}

# ───────────────────────── 5.2 raport cunoscut: rânduri din poză ─────────────────────────
photo_vat = []
for g, h, i in [("3542.77", "743.98", "4286.75"), ("6064.68", "1273.58", "7338.26"), ("2536.1", "532.58", "3068.68"), ("1400", "294.00", "1694.00"), ("4917.32", "1032.64", "5949.96")]:
    net = int(Decimal(g) * 100)
    photo_vat.append({"net": net, "expectedVat": mul_div(net, 21, 100), "vatInSheet": int(Decimal(h) * 100), "grossInSheet": int(Decimal(i) * 100)})
derived = []
for gross in ("1876.60", "2539.20"):
    g = int(Decimal(gross) * 100)
    net = mul_div(g, 100, 121)
    derived.append({"grossMinor": g, "netMinor": net, "vatMinor": g - net})

doc = {
    "_comment": "GENERAT de make_expected.py (Python decimal). Nu edita de mână; regenerează cu python3 tests/fixtures/golden/make_expected.py",
    "pinned": {"EUR_RON": "5.3442", "EUR_HUF": "364.08", "EUR_PLN": "4.2815"},
    "mulDiv": muldiv, "splitAmounts": split_cases, "vatCost": vat_cases,
    "rates": rates, "convert": convert_cases, "crossRate": cross, "rateDiv": rate_div, "eurReconciliation": recon,
    "allocate": alloc_cases, "prorata": prorata,
    "fmtMoney": fmt_cases, "fmtKm": km_cases, "fmtPct": pct_cases, "parseAmount": parse_cases,
    "addMonths": add_months_cases, "day31": day31, "daysInMonth": days_in_month,
    "recurring": {"catchupMonthEnd": catchup, "catchupLeap": catchup_leap, "quarterly": quarterly, "midYearChange": mid_year_change, "endedTemplate": ended},
    "photoVat21": photo_vat, "photoDerivedFromGross": derived,
}
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "expected.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1, sort_keys=False)
    f.write("\n")
print(f"expected.json: {len(split_cases)} splitAmounts, {len(convert_cases)} convert, {len(fmt_cases)} fmtMoney -> {out}")
