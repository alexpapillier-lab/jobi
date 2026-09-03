import json, os, re, collections, pathlib

# ID cílového servisu – ať skript nepatří jednomu zákazníkovi.
#   JOBI_SERVICE_ID=<uuid> python3 build_import.py
SERVICE = os.environ.get("JOBI_SERVICE_ID", "").strip()
if not SERVICE:
    raise SystemExit("Chybí JOBI_SERVICE_ID – uuid servisu, do kterého se importuje.")
BRAND_OF = {
    "iPhone": "Apple", "iPad": "Apple", "MacBook": "Apple",
    "Apple Watch": "Apple", "Watch": "Apple", "AirPods": "Apple",
    "Vysavače": "Dyson", "Čističky vzduchu": "Dyson",
    "Fény a kulmy": "Dyson", "Ostatní": "Dyson",
}
# „Watch“ je starší kategorie, „Apple Watch“ novější a prázdná – slučujeme do jedné.
CATEGORY_OF = {"Watch": "Apple Watch"}

# Ve zdroji se vyskytují jen minuty, hodiny a dny – plus rozsahy („2 - 3 dny“)
# a dva překlepy („1 - 3 dmy“, „60 mion.“). Jednotku proto určuje první písmeno.
UNIT = {"m": 1, "h": 60, "d": 1440}

def minutes(t: str):
    """'3 dny' → 4320, '2 - 3 dny' → 4320 (horní mez). None, když čas chybí."""
    if not t: return None
    s = t.strip().lower().replace("\xa0", " ")
    m = re.match(r"(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*([a-zá-ž]+)", s)
    if not m: return None
    # u rozsahu bereme horní mez – slibovat kratší dobu, než je jistá, by bylo horší
    n = float((m.group(2) or m.group(1)).replace(",", "."))
    mult = UNIT.get(m.group(3)[0])
    return int(round(n * mult)) if mult else None

# Překlepy ve zdroji. Opravené i v Jobi – kdyby se opravily i v zakázkovém
# listu, může tahle tabulka zmizet.
OPRAVY_NAZVU = {"Výměna disleje": "Výměna displeje"}

det = json.load(open("catalog_detail.json"))
records = [v.get("response", v) for v in det.values()]

# ── modely: sloučit duplicitní kategorie, přednost má záznam s ceníkem ──
models = {}   # (kategorie, model) -> záznam
for r in records:
    src_cat = (r.get("parent") or {}).get("description") or "Ostatní"
    cat = CATEGORY_OF.get(src_cat, src_cat)
    key = (cat, r["description"])
    prev = models.get(key)
    if prev is None or (not (prev.get("priceLists") or []) and (r.get("priceLists") or [])):
        models[key] = r

# ── opravy: seskupit shodné (název, popis, cena, čas) přes modely ──
groups = collections.defaultdict(lambda: {"models": [], "priority": 10**9})
for (cat, name), r in models.items():
    for pl in r.get("priceLists") or []:
        nazev = OPRAVY_NAZVU.get(pl["name"], pl["name"])
        # Seskupujeme podle převedených minut, ne podle textu: „3 dny“ i „2 - 3 dny“
        # skončí na 4320 a v Jobi by z nich jinak byly dva nerozlišitelné řádky.
        k = (nazev, (pl.get("description") or "").strip(), float(pl["price"]),
             minutes(pl.get("time_requirement")) or 0)
        g = groups[k]
        g["models"].append((cat, name))
        g["priority"] = min(g["priority"], int(pl.get("priority") or 0))

brands = sorted({BRAND_OF[c] for (c, _) in models})
cats = sorted({(BRAND_OF[c], c) for (c, _) in models})

def q(s): return "'" + str(s).replace("'", "''") + "'"

out = [
    "-- Import katalogu ze zakazkovylist.cz do servisu iSwap Repair Point Praha",
    "-- Zdroj: https://zakazkovylist.cz/api/rest/device-type/  (přes servis.iswap.cz)",
    f"-- Značky: {len(brands)}, kategorie: {len(cats)}, modely: {len(models)}, opravy: {len(groups)}",
    "begin;", "",
    f"create temp table _b(name text, id uuid) on commit drop;",
    f"create temp table _c(brand text, name text, id uuid) on commit drop;",
    f"create temp table _m(cat text, name text, id uuid) on commit drop;", "",
]

out.append("-- značky")
for b in brands:
    out.append(f"with i as (insert into public.device_brands(service_id,name) values ({q(SERVICE)},{q(b)}) returning id)"
               f" insert into _b select {q(b)}, id from i;")

out.append("\n-- kategorie")
for i, (b, c) in enumerate(cats):
    out.append(f"with i as (insert into public.device_categories(service_id,brand_id,name,order_index)"
               f" select {q(SERVICE)},(select id from _b where name={q(b)}),{q(c)},{i} returning id)"
               f" insert into _c select {q(b)},{q(c)}, id from i;")

out.append("\n-- modely")
ordered = sorted(models.items(), key=lambda kv: (kv[0][0], kv[1].get("priority") or 0, kv[0][1]))
for i, ((cat, name), r) in enumerate(ordered):
    out.append(f"with i as (insert into public.device_models(service_id,category_id,name,order_index)"
               f" select {q(SERVICE)},(select id from _c where name={q(cat)}),{q(name)},{r.get('priority') or i} returning id)"
               f" insert into _m select {q(cat)},{q(name)}, id from i;")

out.append("\n-- opravy (model_ids se dohledají podle kategorie a názvu modelu)")
for i, ((name, desc, price, mins), g) in enumerate(sorted(groups.items(), key=lambda kv: (kv[1]["priority"], kv[0][0]))):
    pairs = ",".join(f"({q(c)},{q(n)})" for c, n in sorted(set(g["models"])))
    out.append(
        f"insert into public.repairs(service_id,name,price,estimated_time,details,order_index,model_ids)"
        f" select {q(SERVICE)},{q(name)},{price:.2f},{mins},{q(desc)},{i},"
        f" coalesce((select jsonb_agg(id) from _m where (cat,name) in ({pairs})),'[]'::jsonb);")

out.append("\ncommit;")
pathlib.Path("import_katalog.sql").write_text("\n".join(out) + "\n")

# souhrn
unresolved = []
print(f"  značky:    {len(brands)}  {brands}")
print(f"  kategorie: {len(cats)}")
print(f"  modely:    {len(models)}")
print(f"  opravy:    {len(groups)}  (z 1334 položek ceníku)")
print(f"  bez času:  {sum(1 for (_,_,_,m) in groups if not m)}")
print(f"  nepřevedené formáty času: {unresolved or 'žádné'}")
print(f"  SQL: {len(open('import_katalog.sql').read().splitlines())} řádků")
