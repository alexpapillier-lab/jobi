# Import katalogu ze zakázkového listu

Jednorázový přenos zařízení a ceníků oprav ze `zakazkovylist.cz` do katalogu
servisu v Jobi (značky → kategorie → modely, k tomu opravy s cenami a časy).

## Kde je zdroj

API je `https://zakazkovylist.cz/api/rest/device-type/` (`/list` a `/{číselné id}`),
autorizace hlavičkami `applicationToken` a `brandToken`. Tokeny **nejsou v tomhle
repu** – `fetch_catalog.py` si je za běhu přečte ze zdrojáků `servis.iswap`,
kde je má Cloudflare Pages Function, která to API proxuje.

Pozor na dvě slepé uličky: projekt `zakazkovylist-bot` žádné API nevolá, jen
scrapuje stránky Playwrightem. A veřejné `servis.iswap.cz/api/devices/{x}` chce
**číselné id**, ne hash slug z výpisu – jinak vrátí 503.

## Použití

```bash
export ISWAP_DEVICES_FN=~/servis.iswap/servis.iswap/functions/api/devices/'[id].js'
python3 fetch_catalog.py                       # → catalog_list.json, catalog_detail.json

export JOBI_SERVICE_ID=<uuid servisu>
python3 build_import.py                        # → import_katalog.sql

npx supabase db query -f import_katalog.sql --linked
```

Stažená data ani vygenerované SQL se necommitují (viz `.gitignore`) – je to
640 kB dump cizího API a 400 kB SQL s ID jednoho konkrétního servisu.

Import je opakovatelný: smazat řádky servisu ze `repairs`, `device_models`,
`device_categories`, `device_brands` a pustit SQL znovu. Celé je v jedné
transakci, takže při chybě neprojde nic.

## Tři pasti ve zdrojových datech

1. **Kategorie „Apple Watch“ je prázdný duplikát** starší „Watch“ – ceníky nese
   ta stará. Skript je slučuje a přednost dává záznamu, který ceník má.
2. **Časy jsou volný text** ve 32 zápisech: minuty, hodiny, dny, rozsahy
   („2 - 3 dny“) i překlepy („60 mion.“, „1 - 3 dmy“). Převádí se na minuty,
   protože v nich Jobi počítá; u rozsahu se bere horní mez.
3. **Opravy je nutné seskupovat podle převedených minut**, ne podle textu času –
   jinak z „3 dny“ a „2 - 3 dny“ vzniknou dva řádky, které jsou v Jobi
   k nerozeznání.

Stav k 2026-09-02: 2 značky, 9 kategorií, 193 modelů, 583 oprav.
