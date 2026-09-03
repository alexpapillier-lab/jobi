import json, os, re, pathlib, urllib.request, time
from concurrent.futures import ThreadPoolExecutor

# Tokeny se čtou za běhu ze zdrojáků servis.iswap, aby nebyly nikdy v tomhle repu.
SRC_DEFAULT = "~/servis.iswap/servis.iswap/functions/api/devices/[id].js"
SRC_PATH = pathlib.Path(os.path.expanduser(os.environ.get("ISWAP_DEVICES_FN", SRC_DEFAULT)))
if not SRC_PATH.exists():
    raise SystemExit(f"Nenalezeno: {SRC_PATH}\nNastav ISWAP_DEVICES_FN na cestu k functions/api/devices/[id].js")
SRC = SRC_PATH.read_text()
TOK = {k: re.search(rf"{k}: '([^']+)'", SRC).group(1) for k in ("applicationToken", "brandToken")}
BASE = "https://zakazkovylist.cz/api/rest/device-type/"

def get(path):
    req = urllib.request.Request(BASE + path, headers={**TOK, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

lst = get("list")
devices = lst["response"] if isinstance(lst, dict) and "response" in lst else lst
ids = [v["id"] for v in devices.values()]
print(f"  zařízení v seznamu: {len(ids)}")

out, fails = {}, []
def one(i):
    for attempt in range(3):
        try:
            out[i] = get(str(i)); return
        except Exception as e:
            time.sleep(1.5 * (attempt + 1)); err = e
    fails.append((i, str(err)))

with ThreadPoolExecutor(max_workers=4) as ex:
    list(ex.map(one, ids))

pathlib.Path("catalog_list.json").write_text(json.dumps(devices, ensure_ascii=False))
pathlib.Path("catalog_detail.json").write_text(json.dumps(out, ensure_ascii=False))
print(f"  staženo detailů: {len(out)}   chyby: {len(fails)}")
for i, e in fails[:5]: print(f"    {i}: {e}")
