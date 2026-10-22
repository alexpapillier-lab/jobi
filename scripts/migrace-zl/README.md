# Migrace servisu ze Zakázkového listu do Jobi

Zakázkový list (zakazkovylist.cz) nemá export zakázek. Tenhle nástroj se
za servis přihlásí do ZL jako prohlížeč, projde všechny zakázky a reklamace
a vyrobí CSV soubory přesně ve tvaru, který čeká import v Jobi
(**Nastavení → Firma → Migrace z jiného systému**). Běží na počítači servisu,
nic neposílá nikam jinam než do Zakázkového listu.

Vzniklo z `zakazkovylist-bot` (hodinový bot na provize, v provozu od 2025)
a z `scrape_all.js`, kterým se 3. 9. 2026 stáhlo 3 590 zakázek a 120 reklamací
iSwapu bez jediné chyby. Přihlášení i čtení stránek je převzaté 1:1.

## Co je potřeba

- Mac nebo Windows s **Node.js 22.18 nebo novějším** (`node -v`). Skript je
  v TypeScriptu, Node ho spustí přímo, nic se nepřekládá.
- Přihlašovací údaje do Zakázkového listu (účet, který vidí všechny zakázky).
- Asi 1 GB místa na prohlížeč Chromium pro Playwright.

## Postup krok za krokem

### 1. Příprava (jednou)

V repu Jobi je Playwright už v závislostech – stačí `npm install` v kořeni
a prohlížeč:

```bash
cd scripts/migrace-zl
npx playwright install chromium
```

Servis bez repa dostane jen tuhle složku (zip) a spustí v ní:

```bash
npm install
npx playwright install chromium
```

### 2. Zkouška bez přihlášení

```bash
node migrace.ts zkouska
```

Otevře přihlašovací stránku ZL a ověří, že formulář vypadá tak, jak ho bot
čeká. Když ZL mezitím změnil web, řekne to hned – dřív, než se zadá heslo.

### 3. Stažení a převod

```bash
node migrace.ts
```

Zeptá se na e-mail a heslo do ZL (heslo se při psaní nezobrazuje). Kdo nechce
psát, může je dát do proměnných prostředí jen pro tenhle příkaz:

```bash
ZL_EMAIL="servis@example.cz" ZL_PASSWORD="…" node migrace.ts
```

Má-li účet víc poboček, skript je vypíše a zeptá se, kterou stáhnout; nebo
rovnou `--pobocka "část názvu"`. Každou pobočku stahujte do vlastní složky
(`--vystup pobocka-brno`).

Výsledek je ve složce `migrace-zl-vystup/` (jde změnit přes `--vystup`):

| Soubor | Co s ním |
|---|---|
| `report.md` | začněte tady: počty, stavy, co se nepřeneslo, chyby |
| `zakaznici.csv` | Migrace → 1. Importovat zákazníky |
| `zakazky.csv` | Migrace → 2. Importovat zakázky, předvolba „Zakázkový list“ |
| `cenik.csv` | Migrace → 3. Importovat ceník (jen když byl zdroj ceníku, viz níže) |
| `komentare.csv` | Migrace → 4. Importovat komentáře (až po zakázkách) |
| `reklamace.csv` | archiv – Jobi reklamace z CSV neimportuje |
| `zakazky.ndjson`, `reklamace.ndjson`, `seznam-*.json`, `stahovani.log` | surová stažená data a stav stahování |

### 4. Import v Jobi

1. Nejdřív zákazníci, pak zakázky, ceník a nakonec komentáře. Duplicity se
   přeskakují (telefon, číslo zakázky, oprava u modelu, komentář se stejným
   datem a textem), import jde pustit znovu.
2. U zakázek zkontrolujte tabulku **Stavy ze souboru → stavy servisu**. Servis,
   který si v Jobi založil stejné stavy jako v ZL, dostane přiřazení 1:1.
3. Po kontrole složku s výstupem smažte.

## Jak dlouho to trvá

- Seznam zakázek: 50 na stranu, asi 1 s na stranu (3 600 zakázek ≈ 1–2 min).
- Detaily: 3 najednou, řádově **10 minut na 1 000 zakázek** (iSwap: 3 700 detailů
  za 15–30 minut podle připojení). `--soubezne 4` je rychlejší, víc než 6 nejde,
  ať ZL nezahltíme.

## Když se to přeruší

Všechno se ukládá průběžně – seznam po každé straně, detail hned po stažení.
Stačí spustit **stejný příkaz znovu**:

- stažené detaily se přeskočí, znovu se zkusí jen ty s chybou,
- seznam kódů se použije uložený, pokud je z posledních 12 hodin
  (`--znovu-seznam` vynutí nový průchod – třeba těsně před ostrým přechodem,
  kdy přibyly nové zakázky),
- spadl-li běh uprostřed seznamu, pokračuje se od první nestažené strany;
  `--od-strany N` začne seznam zakázek od strany N ručně.

Každý detail se zkouší 3× s prodlužovanou pauzou; když ZL mezitím odhlásí,
skript se přihlásí znovu sám. Když selže 8 detailů za sebou (vypadlé připojení),
skončí a řekne, ať se spustí znovu – nevyrábí stovky chybných záznamů.

Jen převod už stažených dat (třeba po úpravě převodníku): `node migrace.ts prevest`.
Umí přečíst i výstup starého `scrape_all.js` (`--vstup` se složkou,
kde jsou `orders_export.ndjson` a `claims_export.ndjson`).

## Co se přenáší

| Ze ZL | Do Jobi |
|---|---|
| Kód zakázky | číslo zakázky (duplicity podle něj) |
| Přijetí zařízení do opravy / Zakázka vydána (jinak dokončena) | datum přijetí / datum dokončení (statistiky sedí) |
| Stav (poslední v historii, bez „- Zakázka dokončena“) | stav servisu podle mapování |
| Historie stavů (datum, stav, kdo) | historie zakázky – „Upravena · Stav: A → B“ s původním datem |
| Jméno a příjmení, telefon, e-mail, firma | zákazník na zakázce + adresář zákazníků |
| Zařízení, sériové číslo, IMEI | zařízení |
| Požadovaná oprava | požadovaná oprava |
| Popis stavu zařízení + Stav zařízení a zjištěné závady | stav zařízení (spojené) |
| Předpokládaná cena, Externí identifikace | stejná pole |
| Položky opravy (název, náklady, cena) | provedené opravy |
| Ceník z API ZL | značky, kategorie, modely a opravy s cenou a časem |
| Komentáře u zakázek (autor, datum, text) | interní komentáře zakázky s původním datem; autor jen jako jméno |
| Komentáře u reklamací | komentáře zakázky, ze které reklamace vznikla, s předponou „[Reklamace KÓD]“ – reklamace v Jobi musí na tu zakázku odkazovat |

Zákazníci se skládají z údajů na zakázkách (totožnost podle kódu zákazníka
v ZL, jinak podle telefonu). Skript zkusí stáhnout i export zákazníků ze ZL
(Zákazníci → Export) – přidá IČO, DIČ a zákazníky bez zakázky. **Tahle cesta
není ověřená naživo** (adresa `/customers/` a tlačítko „Export“ jsou odhad);
když se nepovede, stačí export stáhnout v ZL ručně a přidat `--zakaznici-csv soubor.csv`.

## Co se nepřenáší

- **Reklamace** – import v Jobi je nemá; jsou v `reklamace.csv`. Jejich
  komentáře se přenesou jen tam, kde reklamace v Jobi existuje a odkazuje na
  svou zakázku (komentář jde na zakázku).
- **Kdo co dělal** (Přijal, Opravoval, Vydal, jména v historii) – lidé ze ZL
  nejsou uživatelé Jobi. Historie ukáže „Systém“, statistiky techniků tyhle
  záznamy nepočítají. Jméno je uložené v `ticket_history.details.import`.
- Způsob převzetí/předání, maximální cena, závada pro průvodní dopis.
- **Hesla a kódy obrazovky** – schválně ne. Kdo je chce, přidá `--s-hesly`
  (a CSV po importu hned smaže). **PIN** se ze ZL nestahuje nikdy.
- Fotky, dokumenty, podpisy – bot je nestahuje.

## Ceník

Ceník (modely a opravy s cenou) ZL vydává přes API
`zakazkovylist.cz/api/rest/device-type/`, které chce hlavičky `applicationToken`
a `brandToken`. Tokeny patří k napojení ceníku na web servisu – kdo je má,
dá je do prostředí:

```bash
ZL_APPLICATION_TOKEN="…" ZL_BRAND_TOKEN="…" node migrace.ts
```

U iSwapu jsou ve zdrojácích `servis.iswap` (viz `scripts/import-zakazkovylist/README.md`);
načtení bez vypsání na obrazovku:

```bash
F=~/servis.iswap/servis.iswap/functions/api/devices/'[id].js'
export ZL_APPLICATION_TOKEN=$(sed -n "s/.*applicationToken: '\([^']*\)'.*/\1/p" "$F")
export ZL_BRAND_TOKEN=$(sed -n "s/.*brandToken: '\([^']*\)'.*/\1/p" "$F")
```

Už stažený katalog jde použít přes `--katalog-json`. Bez tokenů jde vyrobit
hrubý ceník z provedených oprav na zakázkách (`--cenik-ze-zakazek`: model =
pole Zařízení, cena = nejčastější cena u modelu) – překlepy v názvech položek
se přenesou jako samostatné opravy, proto jen na výslovné přání.

Značky ZL nevede; odvozují se z kategorie (iPhone, iPad… → Apple) a z názvů
modelů (Dyson V15 → Dyson). Po importu je zkontrolujte na stránce Zařízení.

## Bezpečnost

- Přihlašovací údaje jdou jen z klávesnice nebo z proměnných prostředí toho
  jednoho příkazu. Nikam se nezapisují – ani do logu, ani do výstupní složky.
  Tokeny k ceníku stejně.
- Stažená data zůstávají na počítači, kde skript běží; složka má práva jen pro
  přihlášeného uživatele (0700, soubory 0600). Jsou v ní osobní údaje
  zákazníků – po importu ji smažte. V repu je `migrace-zl-vystup/` v `.gitignore`.
- Skript komunikuje jen se `app.zakazkovylist.cz` (a s API ceníku, když dostane
  tokeny). Do Jobi nic neposílá – soubory nahrává člověk v aplikaci.

## Pro vývoj

```bash
npx vitest run scripts/migrace-zl                    # převodník proti fixture + import Jobi
MIGRACE_ZL_PROHLIZEC=1 npx vitest run scripts/migrace-zl   # i extrakce v Chromiu nad fixtures/*.html
MIGRACE_ZL_DATA=/cesta/k/vystupu npx vitest run scripts/migrace-zl   # skutečná data projdou importem bez chyb
npx tsc -p scripts/migrace-zl
```

- `prevod.ts` – čistý převod NDJSON → CSV + report, bez sítě a bez importů ze `src/`
  (aby šla složka zkopírovat samostatně). Testy naopak importují `src/lib`
  a pouštějí výstup přes skutečný import Jobi.
- `stahovani.ts` – Playwright: přihlášení, seznamy, detail, export zákazníků, API ceníku.
  `vytahniDetail`/`vytahniSeznam` běží v prohlížeči, nesmí sahat mimo sebe.
- `migrace.ts` – příkazová řádka, průběžné ukládání, pokračování.
- `fixtures/` – umělá data podle struktury z kódu bota (skutečné HTML ZL
  nikde uložené není, diagnostické soubory bota jsou prázdné).
- `ZL_ZKUSEBNI_ADRESA=http://localhost:…` přesměruje bota na atrapu ZL – jen pro
  zkoušku přihlášení, stránkování a pokračování bez skutečného účtu.

Selektory, na kterých to stojí (když ZL změní web, hledat tady): `#frm-loginForm`,
`#frm-loginForm-email`, `#frm-loginForm-password`, karty poboček `h5` na
`/change-branch`, stránkování `div.col-pagination a`, odkazy `/order/detail/…`
a `/complaint/detail/…`, tabulky th/td v detailu, rozpis s hlavičkou „Položka
opravy“, komentáře `[id*="CommentsDatagrid-datagrid-tbody"]`, historie `#logModal`.
