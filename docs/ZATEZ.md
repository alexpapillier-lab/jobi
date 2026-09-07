# Zátěžové a výkonnostní měření

Naměřeno 6. a 7. 9. 2026 proti **ostrému** Supabase projektu, ale výhradně proti
testovacím servisům (E2E testovací servis, ukázkový Servis Novák a zátěžový
servis založený jen k měření, oddíl 5). Majitel to výslovně povolil –
aplikaci nikdo nepoužívá a nikdo za ni neplatí.

`docs/KAPACITA.md` počítá, kolik místa a peněz padesát servisů spotřebuje.
Tenhle dokument říká něco jiného: **jak rychle to odpovídá a kdy to přestane
odpovídat.** `docs/LIMITY.md` popisuje stropy tak, jak jsou napsané v kódu;
tady jsou změřené.

## Jak se to pouští

```sh
npm run zatez              # veřejná rozhraní, rampa 1 → 5 → 20 → 50
npm run zatez:limity       # po kolikátém požadavku přijde 429 a kdy se pustí
npm run zatez:prohlizec    # načtení aplikace v prohlížeči (Playwright)
E2E_PASSWORD='…' npm run zatez:db   # databázové dotazy aplikace
E2E_PASSWORD='…' npm run zatez:appka   # odezva appky po přihlášení (viz oddíl 5)
```

Skripty jsou v `scripts/zatez/`. `k6` na stroji není, generátor je vlastní
v Node nad `fetch` – měří se síť a databáze, ne generátor. Že úzkým hrdlem
není generátor, se pozná z propustnosti: kdyby byl, rostla by odezva lineárně
se souběžností a `req/s` by zůstávalo konstantní. To se neděje.

Testovací servisy jsou v `scripts/zatez/spolecne.mjs` na pevném seznamu.
Cokoli mimo něj skripty odmítnou – zátěž proti ostrému zákazníkovi by mu
vyčerpala jeho limit 60 dotazů za minutu a na jeho webu by zmizel ceník.

## Odkud se měřilo

Měřilo se **přímo na edge funkce** (`…supabase.co/functions/v1/…`), tedy
mimo Cloudflare. To je záměr: čísla ukazují, co vydrží origin, ne co odchytí
CDN. Skutečný provoz přes `api.appjobi.com` je proti tomu podstatně mírnější
(viz „Co provoz tlumí" níž).

Referenční hodnoty ze stejného stroje a stejné chvíle, aby se dalo oddělit,
co je síť a co práce:

| Co | medián | pozn. |
|---|---:|---|
| TCP + TLS na `supabase.co` | 29 ms | |
| PostgREST bez dotazu (`GET /rest/v1/`) | 55 ms | nové spojení pokaždé |
| `OPTIONS` na edge funkci (žádná databáze) | 201 ms | nové spojení pokaždé |
| `GET public-booking/embed.js` (žádná databáze) | **24 ms** | znovupoužité spojení |
| `GET public-booking` (2 dotazy za sebou) | 183–261 ms | |
| `GET public-catalog` (4 dotazy za sebou + 4 souběžné) | 386 ms | |

Těch 201 ms u `OPTIONS` je klam měření: `curl` zahazuje spojení po každém
požadavku, takže se v čísle veze TLS handshake. Když se spojení drží (což
prohlížeč i CDN dělají), **odpoví edge funkce bez databáze za 24 ms** a zvládne
přes 750 požadavků za vteřinu. Runtime tedy brzdou není.

**Brzdou je počet dotazů do databáze jdoucích za sebou.** Jeden sekvenční
round trip z funkce do Postgresu vyjde zhruba na 85 ms a odezva se z nich
skládá skoro celá:

| Endpoint | dotazů za sebou | 24 ms + 85 ms × n | naměřeno |
|---|---:|---:|---:|
| `embed.js` | 0 | 24 | 24 |
| `public-booking` | 2 | 194 | 183–261 |
| `public-catalog` | 4 | 364 | 386 |

U ceníku jsou ty čtyři: servis podle slugu → kontrola modulu → RPC limitu →
a teprve pak čtyři dotazy na data, ty už souběžně. Kdo chce zrychlit veřejné
API, musí ubrat kroky, ne optimalizovat jednotlivé dotazy.

## 1. Veřejná rozhraní

### Endpointy s limitem 60 dotazů/min na IP

Tady se dávkuje po 40 požadavcích a před každým stupněm se čeká na čistou
minutu. Třicetivteřinový stupeň by u nich neměřil databázi, ale rychlost,
s jakou runtime vrací 429 – limit se z jedné IP vyčerpá už při **jednom**
vlákně (60 × ~400 ms = 24 s).

| Endpoint | Souběžně | Požadavků | req/s | medián ms | p95 ms | max ms | chybovost |
|---|---:|---:|---:|---:|---:|---:|---:|
| catalog `e2e-servis` (3,8 kB) | 1 | 40 | 2,5 | 386 | 506 | 510 | 0 % |
| catalog `e2e-servis` (3,8 kB) | 5 | 40 | 11,0 | 418 | 652 | 710 | 0 % |
| catalog `e2e-servis` (3,8 kB) | 20 | 40 | 29,4 | 525 | 754 | 943 | 0 % |
| catalog `e2e-servis` (3,8 kB) | 50 | 40 | 17,5 | 1027 | 2103 | 2282 | 0 % |
| catalog `servis-novak` (8,2 kB) | 1 | 40 | 2,3 | 399 | 560 | 1048 | 0 % |
| catalog `servis-novak` (8,2 kB) | 5 | 40 | 11,2 | 398 | 541 | 672 | 0 % |
| catalog `servis-novak` (8,2 kB) | 20 | 40 | 26,6 | 591 | 873 | 876 | 0 % |
| catalog `servis-novak` (8,2 kB) | 50 | 40 | 34,2 | 1008 | 1164 | 1166 | 0 % |
| catalog + ETag → 304 | 1 | 40 | 2,1 | 433 | 720 | 1087 | 0 % |
| catalog + ETag → 304 | 5 | 40 | 11,8 | 396 | 538 | 597 | 0 % |
| catalog + ETag → 304 | 20 | 40 | 25,8 | 709 | 965 | 1161 | 0 % |
| catalog + ETag → 304 | 50 | 40 | 31,0 | 952 | 1094 | 1276 | 0 % |

Tři věci, které z toho lezou:

**Do dvaceti souběžných se skoro nic neděje.** Medián vyroste z 386 na 525 ms,
propustnost roste úměrně souběžnosti (2,5 → 29 req/s). Do téhle chvíle je
brzdou čekání na odpověď, ne server.

**Kolem 30 dotazů za vteřinu je strop jedné funkce.** Při padesáti souběžných
už propustnost neroste (26–34 req/s), jen se prodlužuje fronta – medián přes
vteřinu, p95 do 2,1 s. **Nic se ale nerozbilo: chybovost zůstala na nule ve
všech stupních.** Funkce se pod zátěží zpomalí, neodpadne. To je lepší
chování, než jsem čekal.

**Velikost ceníku je jedno.** Dvakrát větší ceník (8,2 kB proti 3,8 kB)
odpovídá stejně rychle. Čas nežere přenos dat ani jejich množství, ale ta
čtyři kola dotazů do databáze, která se udělají vždycky stejně – ať je
v ceníku deset oprav nebo tisíc.

**304 nešetří serveru vůbec nic.** Odpověď „nezměnilo se" trvá stejně dlouho
jako plná (433 proti 399 ms při jednom vlákně). Je to logické: ETag se počítá
až z hotových dat, takže se předtím stejně spustí limit i všechny čtyři
dotazy. Podmíněný dotaz ušetří přenesené bajty, ne práci databáze.

### Endpointy bez limitu čtení

Tady má rampa smysl v plné délce – 30 s na stupeň, kolik se stihne.

| Endpoint | Souběžně | Požadavků | req/s | medián ms | p95 ms | max ms | chybovost |
|---|---:|---:|---:|---:|---:|---:|---:|
| booking GET nastavení | 1 | 115 | 3,8 | 261 | 331 | 456 | 0 % |
| booking GET nastavení | 5 | 658 | 21,9 | 205 | 333 | 693 | 0 % |
| booking GET nastavení | 20 | 3 163 | **104,8** | 183 | 289 | 715 | 0 % |
| booking GET nastavení | 50 | 5 784 | **191,1** | 251 | 394 | 1132 | 0 % |
| embed.js (bez databáze) | 1 | 860 | 28,6 | 24 | 105 | 268 | 0 % |
| embed.js (bez databáze) | 5 | 4 176 | 139,1 | 24 | 106 | 256 | 0 % |
| embed.js (bez databáze) | 20 | 15 704 | 522,9 | 24 | 109 | 1252 | 0 % |
| embed.js (bez databáze) | 50 | 22 822 | **757,8** | 27 | 190 | 3583 | 0 % |
| portal-ticket neplatný token | 1 | 109 | 3,6 | 274 | 418 | 530 | 0 % |
| portal-ticket neplatný token | 5 | 16 | 16,9 | 268 | 425 | 425 | 31 % → **429** |

**Tohle je nejzajímavější číslo z celého měření.** `public-booking`, který
dělá dva dotazy do databáze, utáhne **191 požadavků za vteřinu**. Ceník, který
dělá čtyři plus RPC limitu, se zasekne na **30**. Šestinásobný rozdíl na
stejném runtime a stejné databázi.

Ceník i sklad totiž při každém dotazu volají `api_zapocitej_cteni`, a ta dělá
dva `INSERT … ON CONFLICT DO UPDATE` – jeden z nich **vždycky do stejného
řádku** (souhrn za servis, `klic = ''`). Padesát souběžných požadavků na jeden
servis se tedy pere o jeden řádek a Postgres je musí seřadit za sebe.
**Nejdražší část veřejného ceníku není čtení dat, ale počítadlo, které hlídá,
aby se nečetlo moc.** Přesně naopak, než bych čekal.

Do dvaceti souběžných to nevadí (limit 60/min stejně dřív usekne provoz) a
před funkcí navíc stojí cache. Ale je to důvod, proč se ceník nedá škálovat
pouhým přidáním výkonu.

`embed.js` je kontrolní vzorek: čistý text, nulová databáze, 758 req/s a
stabilních 24 ms i při padesáti souběžných. Runtime má rezervu, hrdlo je
v databázi.

**Portál dopadl jinak, než tabulka napovídá.** Při jednom vlákně prošlo 109
dotazů bez chyby; 429 přišla až v dalším stupni po dalších 16. Dohromady 125
za minutu, tedy přesně dokumentovaný strop 120/min na volajícího. Limit
funguje, jen ho tahle rampa změřila nešikovně – čisté číslo je níž.

### Kde se to zlomilo

Jediné místo, kde měření skončilo dřív, než mělo:

- **portal-ticket při 5 souběžných** – `429` po 16 požadavcích, ale to je
  součet s předchozím stupněm (viz výš), ne skutečná hranice.

Jinde **ne**. Ani při padesáti souběžných nevrátil žádný endpoint jedinou
chybu – ani `5xx`, ani spadlé spojení. Ceník a sklad se zpomalí na vteřinu až
dvě, `booking` a `embed.js` drží odezvu i propustnost. To je pro projekt dobrá
zpráva: **nic z toho se pod zátěží nerozbije, jen zpomalí.**

Za hranici tedy považuju:

| Endpoint | Praktický strop | Čím je daný |
|---|---:|---|
| `public-catalog` | ~30 req/s | soupeření o řádek počítadla limitu |
| `public-inventory` | ~28 req/s | totéž |
| `public-booking` GET | ~190 req/s | dva dotazy do databáze |
| `public-booking/embed.js` | ~758 req/s | nic, je to text |

Před tímhle stropem ale u ceníku a skladu vždycky sepne limit 60/min na IP,
takže na něj jedna adresa nedosáhne. Dosáhne na něj až **provoz z mnoha IP
adres na jeden servis** – a proti tomu stojí limit 600/min na servis, tedy
10 req/s. Ten je bezpečně pod naměřenými 30.

## 2. Kdy přesně padne 429

Sekvenční sonda: požadavky po jednom, dokud nepřijde 429. Před každým měřením
se čeká na začátek minuty, protože okno limitu je `date_trunc('minute')`.

| Endpoint | 429 po … požadavcích | strop v kódu | `Retry-After` | medián ms |
|---|---:|---:|---:|---:|
| `public-catalog` | **61** | 60/min/IP | 60 | 393 |
| `public-inventory` | **61** | 60/min/IP | 60 | 395 |
| `portal-ticket` GET | **121** | 120/min/IP | *chybí* | 278 |
| `public-booking` GET | >150 | žádný | – | 266 |
| `public-booking/embed.js` | >150 | žádný | – | 31 |

**Limity sedí na kus přesně** – 61. požadavek je první nad stropem 60, 121.
nad stropem 120. Co je v `docs/LIMITY.md` napsané, to platí. Zotavení taky:
v následující minutě vrátil ceník zase `200`.

Dvě věci k tomu:

**`portal-ticket` neposílá `Retry-After`.** Ceník a sklad ho posílají
(`60`), portál ne – klient se tedy nedozví, kdy to má zkusit znovu, a bude
buď zkoušet hned, nebo to vzdá. Jednořádková oprava.

**`public-booking` nemá strop žádný.** Sonda vyčerpala 150 požadavků a nic.
Potvrzuje to, co je vidět v kódu: `GET` větev `public-booking` limit vůbec
nevolá. V `docs/LIMITY.md` tenhle endpoint chybí taky – není to opomenutí
v dokumentaci, opravdu tam žádný limit není.

## 3. Načtení aplikace v prohlížeči

Měřeno na nasazené webové verzi `appjobi.com/servis/`, pětkrát každý scénář,
pokaždé v čistém kontextu (jinak by druhé měření měřilo cache prohlížeče).
Čísla jsou z `performance.getEntriesByType` v prohlížeči, ne z Playwrightu.

| Scénář | běhů | medián ms | p95 ms | FCP ms | požadavků | přeneseno kB | rozbaleno kB |
|---|---:|---:|---:|---:|---:|---:|---:|
| studený start → přihlašovací obrazovka | 5 | 550 | 657 | 344 | 3 | 490 | 1738 |
| totéž na pomalém 4G (1,6 Mb/s, 150 ms) | 5 | 3594 | 3601 | 2820 | 4 | 535 | 1782 |

TTFB 94 ms, DOMContentLoaded 189 ms. Největší soubory:

| Soubor | kB (přeneseno) |
|---|---:|
| `index-*.js` | 484 |
| `index-*.css` | 5 |

**Celá aplikace je jeden balík.** Tři požadavky, z toho jeden nese 484 kB po
kompresi (1,7 MB rozbaleno). Na stolním počítači to nevadí – 550 ms. Na
pomalém 4G je to **3,6 vteřiny na přihlašovací obrazovku**, z toho 2,8 s do
prvního vykreslení, a to se ještě nenačetla jediná zakázka.

Komentář v `index.html` říká, že webová verze je „záložní nástroj, po kterém
se sahá z mobilu v dílně". V dílně bývá jeden čárek signálu. Tohle je tedy
scénář, pro který je verze určená, a zrovna v něm je nejpomalejší.

Seznam zakázek po přihlášení se nezměřil – `E2E_PASSWORD` nebylo v prostředí
(je v GitHub secrets, viz `e2e/README.md`). Skript ho umí, stačí ho pustit
s heslem.

## 4. Databázové dotazy aplikace

Změřeno 6. 9. 2026 na testovacím servisu s 1 608 zakázkami, rampa
1 → 5 → 20 → 50 souběžných po 30 vteřinách (`npm run zatez:db`).

| Endpoint | Souběžně | Požadavků | req/s | medián ms | p95 ms | max ms | chybovost | stavy |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| seznam zakázek – 1. stránka (1000 řádků) | 1 | 84 | 2.8 | 280 | 762 | 1446 | 0.0 % | 200×84 |
| seznam zakázek – 1. stránka (1000 řádků) | 5 | 326 | 10.5 | 366 | 837 | 4689 | 0.0 % | 200×326 |
| seznam zakázek – 1. stránka (1000 řádků) | 20 | 512 | 16.4 | 1091 | 1772 | 4961 | 0.0 % | 200×512 |
| seznam zakázek – 1. stránka (1000 řádků) | 50 | 578 | 17.4 | 2198 | 5670 | 10994 | 0.0 % | 200×578 |
| seznam zakázek – stránka po 50 (co by stačilo) | 1 | 182 | 6.1 | 151 | 293 | 396 | 0.0 % | 200×182 |
| seznam zakázek – stránka po 50 (co by stačilo) | 5 | 947 | 31.3 | 130 | 321 | 908 | 0.0 % | 200×947 |
| seznam zakázek – stránka po 50 (co by stačilo) | 20 | 2407 | 74.7 | 188 | 536 | 4203 | 0.0 % | 200×2407 |
| seznam zakázek – stránka po 50 (co by stačilo) | 50 | 3340 | 104.4 | 376 | 859 | 4676 | 0.0 % | 200×3340 |
| seznam zakázek – všechny stránky (fetchAllPages) | 1 | 43 | 1.4 | 681 | 995 | 1044 | 0.0 % | 200×43 |
| seznam zakázek – všechny stránky (fetchAllPages) | 5 | 175 | 5.7 | 729 | 1609 | 5208 | 0.0 % | 200×175 |
| seznam zakázek – všechny stránky (fetchAllPages) | 20 | 282 | 8.7 | 2105 | 3113 | 4972 | 0.0 % | 200×282 |
| seznam zakázek – všechny stránky (fetchAllPages) | 50 | 256 | 7.3 | 5747 | 11533 | 16778 | 0.0 % | 200×256 |
| detail zakázky podle id | 1 | 343 | 11.4 | 72 | 132 | 186 | 0.0 % | 200×343 |
| detail zakázky podle id | 5 | 1563 | 51.9 | 86 | 160 | 196 | 0.0 % | 200×1563 |
| detail zakázky podle id | 20 | 3957 | 131.1 | 151 | 206 | 393 | 0.0 % | 200×3957 |
| detail zakázky podle id | 50 | 5154 | 170.1 | 275 | 522 | 1075 | 0.0 % | 200×5154 |
| statistiky za rok – RPC statistiky_prehled | 1 | 167 | 5.6 | 174 | 198 | 966 | 0.0 % | 200×167 |
| statistiky za rok – RPC statistiky_prehled | 5 | 614 | 20.3 | 252 | 295 | 437 | 0.0 % | 200×614 |
| statistiky za rok – RPC statistiky_prehled | 20 | 674 | 22.1 | 897 | 1047 | 1287 | 0.0 % | 200×674 |
| statistiky za rok – RPC statistiky_prehled | 50 | 675 | 20.9 | 1898 | 5031 | 13982 | 0.0 % | 200×675 |
| seznam skladu | 1 | 371 | 12.3 | 62 | 144 | 155 | 0.0 % | 200×371 |
| seznam skladu | 5 | 1759 | 58.4 | 66 | 144 | 201 | 0.0 % | 200×1759 |
| seznam skladu | 20 | 6446 | 214.3 | 87 | 151 | 292 | 0.0 % | 200×6446 |
| seznam skladu | 50 | 9763 | 321.1 | 135 | 368 | 1177 | 0.0 % | 200×9763 |

**Nic se nezlomilo** – žádný stupeň nevrátil jedinou chybu, jen se prodloužila
fronta.

**Nejdražší je stahování všech zakázek najednou.** Aplikace dnes v Orders
načte celý seznam a filtruje v prohlížeči. Při padesáti souběžných to
znamená medián 5,7 vteřiny a v nejhorším 16,8. Stránkování po padesáti
řádcích, tedy tolik, kolik se vejde na obrazovku, je na stejném stupni
**patnáctkrát rychlejší** (376 ms) a zvládne 104 požadavků za vteřinu místo
sedmi. Je to nejsilnější argument pro doporučení číslo 7 níž.

**Detail zakázky a sklad jsou levné** – 275 a 135 ms i při padesáti
souběžných, protože jde o jeden indexovaný dotaz.

**Statistiky za rok** drží 20 požadavků za vteřinu bez ohledu na zátěž;
agregace běží v databázi a je to vidět (medián 174 ms sólo). Nad padesát
souběžných začne p95 utíkat (5 s), ale statistiky nikdo neotevírá padesátkrát
za vteřinu.

Co se ale dá říct z kódu a z migrací i bez měření:

**Indexy na měřených cestách nechybí.** Dotaz, kterým Orders tahá zakázky
(`service_id` + `deleted_at is null` + `order by created_at desc, id desc`),
má přesně odpovídající index:

```sql
CREATE INDEX idx_tickets_service_deleted_at
  ON public.tickets USING btree (service_id, deleted_at, created_at DESC);
```

Stejně tak `idx_services_public_slug` (unikátní) pro vyhledání servisu podle
veřejné adresy, `idx_tickets_portal_token` (partial) pro portál a primární
klíč `api_read_hits(service_id, klic, minuta, endpoint)` pro počítadlo limitu.
Tabulky ceníku mají index na `service_id`. **Žádný chybějící index jsem
nenašel** – úzké hrdlo veřejného API není v plánech dotazů.

**Zato aplikace tahá pokaždé všechno.** `src/pages/Orders.tsx` i
`src/pages/Statistics.tsx` volají `fetchAllPages` po tisících řádcích a
**stahují všechny zakázky servisu bez filtru** – filtrování a hledání se dělá
až v prohlížeči. Server-side stránkování ani filtr v seznamu zakázek nejsou.
Přesně před tím varuje `docs/KAPACITA.md` v bodě 1; tady je to potvrzené
z druhé strany, ze zdrojáku. Statistiky mají serverovou agregaci
(`statistiky_prehled`) a stahování všech zakázek už je u nich jen záložní
cesta, ale seznam zakázek ji nemá.

## 5. Aplikace nad servisem s hodně daty (6. 9. 2026)

Předchozí měření (oddíl 4) šla přímo na PostgREST a říkala, jak rychle odpoví
databáze. Tohle měří něco jiného: **kolik času uplyne mezi kliknutím a tím,
než je na obrazovce to, kvůli čemu tam člověk šel.** Včetně toho, co k tomu
přidá React a kolik dotazů si aplikace pošle, aniž by o tom kdo věděl.

Měřilo se na zátěžovém servisu založeném jen k tomuhle: **4 800 zakázek**
(+200 v koši), 2 000 zákazníků, 500 faktur, 1 000 skladových položek, 6 664
komentářů a 200 reklamací. Po měření byl servis smazaný – účet smí mít nejvýš
tři servisy a tenhle blokoval ostatní testy.

```sh
npm run build:web && npx vite preview --config vite.config.web.ts --port 5194
E2E_PASSWORD='…' npm run zatez:appka -- --url http://localhost:5194/
```

Skript je `scripts/zatez/appka.mjs`. Měří se na **produkčním balíku**, ne na
dev serveru: React v dev režimu je znatelně pomalejší a Vite posílá stovky
nezabalených modulů, takže by čísla neodpovídala ničemu skutečnému. Čas se
bere z `performance.now()` uvnitř stránky a čeká se na konkrétní prvek, ne na
`networkidle` – „stránka dojela" a „je vidět seznam" jsou dvě různé chvíle.

### Před a po

Medián ze tří běhů, každý v čistém kontextu prohlížeče. Stroj i síť stejné,
mezi oběma sadami se měnil jen kód aplikace (indexy z migrace
`20260906150000_indexy_vykon_seznamu.sql` **v číslech nejsou** – ta se zatím
jen napsala, nepustila).

| Co se měří | před | po | rozdíl |
|---|---:|---:|---|
| zakázky – kostra stránky | 215 ms | 209 ms | – |
| **zakázky – první řádek seznamu** | **2 505 ms** | **520 ms** | **−79 %** |
| **zakázky – konec načítání** | **6 444 ms** | **2 044 ms** | **−68 %** |
| zakázky – dotazů do databáze | 48 | 40 | −8 |
| zakázky – staženo | 8 845 kB | 6 593 kB | −25 % |
| hledání – nejdelší úhoz | 34 ms | 33 ms | – |
| hledání – vykreslení výsledku | 3 ms | 2 ms | – |
| filtr „Dokončené" | 47 ms | 34 ms | – |
| detail – otevření | 52 ms | 54 ms | – |
| detail – konec načítání | 1 282 ms | 1 082 ms | −16 % |
| **zákazníci – konec načítání** | **2 717 ms** | **1 844 ms** | **−32 %** |
| zákazníci – kostra stránky | 29 ms | 30 ms | – |
| sklad – konec načítání | 1 375 ms | 1 262 ms | −8 % |
| faktury – konec načítání | 1 150 ms | 1 106 ms | – |
| statistiky – konec načítání | 1 880 ms | 1 394 ms | −26 % |
| návrat na zakázky | 131 ms | 116 ms | – |

### Co bylo pomalé a proč

**Seznam zakázek čekal, až dojedou úplně všechny zakázky.** `fetchAllPages`
tahal stránky po tisíci **jednu po druhé**: pět kol po ~700 ms, a celou tu
dobu byla na obrazovce hláška „Načítání zakázek…“. Přitom se na první
obrazovku vejde padesát řádků. Teď se první dávka (200 zakázek) vezme zvlášť
a vykreslí hned; zbytek dojíždí na pozadí. Servis pod dvě stě zakázek pošle
pořád jediný dotaz, takže se pro malé servisy nezměnilo nic.

**Zbylé stránky se navíc tahaly zbytečně za sebou.** `fetchAllPages` teď od
druhé stránky posílá čtyři dotazy najednou. Z pěti kol po síti jsou dvě.
První stránka jde dál sama – z její velikosti se pozná, jestli má smysl
posílat další, takže malý servis tím nic neplatí.

**Komentáře se načítaly za celý servis.** 6 664 řádků v sedmi kolech
(~1,4 s a přes megabajt) – kvůli komentářům u jedné otevřené zakázky.
Nikde jinde než v detailu se nezobrazují; teď se natáhnou až k tomu, co je
otevřené. Na seznamu zakázek tím zmizelo sedm dotazů z osmačtyřiceti.

**Sklad se ptal čtyřikrát za sebou** na čtyři nezávislé věci (kategorie,
produkty, sklady, stavy zásob). Teď naráz. Vedle toho se ukázalo, že se
produkty a stavy zásob tahaly **bez stránkování**: PostgREST vrátí nejvýš
1 000 řádků a mlčí o tom, takže servis s tisícem a jednou položkou by o tu
poslední tiše přišel. Zátěžový servis měl přesně 1 000 produktů, tedy
na hraně. Opraveno stránkováním.

**Zákazníci čekali dvakrát.** Nejdřív se natáhli zákazníci, pak (a teprve
pak) dvě úzké kolony zakázek, ze kterých se počítá „kolik má kdo zakázek“.
Jedno na druhém nezávisí, takže se to teď tahá souběžně.

### Co dělá databáze

Žádný z měřených dotazů nebyl sám o sobě pomalý – nejdelší `explain analyze`
skončil pod 20 ms. Zajímavé je, **jak** se k výsledku dostávaly:

| Dotaz | plán před opravou | co s tím |
|---|---|---|
| seznam zakázek, stránka | index podle `service_id` → **Sort přes všech 4 800 řádků**, a to při každé stránce zvlášť | `idx_tickets_service_created_id` |
| zakázky zákazníků (2 kolony) | **Index Scan přes `tickets_pkey`**, tedy přes zakázky *všech* servisů – filtr zahodil 1 178 cizích řádků na každou tisícovku vlastních | `idx_tickets_service_customer_scan` s `include (customer_id)` |
| adresář zákazníků | Sort přes všech 2 000 zákazníků, opět pro každou stránku | `idx_customers_service_created_id` |
| seznam faktur | Sort přes všechny faktury servisu | `idx_invoices_service_created` |
| komentáře | index na `created_at` **napříč servisy**, filtr zahodil 1 145 cizích řádků | `idx_ticket_comments_ticket_created` |

Ten druhý řádek je z nich nejnepříjemnější: jeho cena neroste s daty *tohohle*
servisu, ale s daty **všech servisů dohromady**. U padesáti zákazníků na jedné
databázi by se stránka Zákazníci zpomalovala každému kvůli všem ostatním.

Migrace `supabase/migrations/20260906150000_indexy_vykon_seznamu.sql` tyhle
indexy přidává. **Není pouštěná** – jen přidává indexy, nic nemaže a nemění,
ale do produkce ji má pustit člověk.

### Co zůstalo pomalé

**Aplikace pořád stahuje všechny zakázky.** 6,6 MB JSONu na seznamu zakázek
(po opravě; před ní 8,8). Uživatele to už nebrzdí – seznam je vidět za půl
vteřiny a zbytek dojíždí na pozadí – ale objem dat se tím nezmenšil, jen
schoval. Roste lineárně s počtem zakázek a při 10 000 to bude přes 13 MB.
Dvě cesty (první z nich se udělala den nato):

- **Ubrat sloupce.** Do seznamu se tahá 37 sloupců včetně diagnostiky,
  kontrolních seznamů a fotek – v seznamu se z nich zobrazuje osm. Samotné
  názvy sloupců dělají v JSONu asi 500 B na řádek. Detail by si zbytek
  dotáhl podle `id` (`refetchTicketById` už existuje). Je to ale změna,
  která se dotkne celého detailu zakázky, a ta se dělat naslepo nemá.
  **Uděláno 7. 9. 2026 – viz oddíl 6.**
- **Filtrovat a stránkovat na serveru.** To, co doporučuje bod 8 níž.
  Znamená to přesunout hledání, počty u záložek a seskupení podle stavu do
  databáze; hotové stránkování v prohlížeči by se zahodilo.

**Zobrazení „seskupení podle stavu“ vykresluje celý seznam.** Ostatní režimy
respektují stránkování po padesáti, tenhle vykreslí všechny zakázky naráz a
navíc si pro každou z nich žádá odznak nepřečtených SMS (dotazy po 180 kusech,
tedy u 4 800 zakázek zhruba 27 dotazů). Neměřeno – přepnutí režimu se ukládá
do `user_preferences` testovacího účtu a to by rozhodilo ostatní testy. Ale
z kódu je to vidět a je to jediné místo, kde se počet dotazů odvíjí od počtu
zakázek.

**Statistiky mají 1,2 s do první dlaždice**, i když samotná agregace v databázi
trvá ~200 ms. Zbytek je čekání na nastavení servisu a na dva RPC za sebou.

**Na seznamu zakázek se stejná nastavení tahají několikrát.** `service_settings`
pětkrát, `service_memberships` čtyřikrát, `service_document_settings` třikrát,
`invoices` pětkrát – různé komponenty se ptají na totéž nezávisle na sobě.
Jsou to malé a souběžné dotazy (v součtu ~100 ms), takže to nikoho nebrzdí,
ale je to dvacet zbytečných dotazů z celkových čtyřiceti.

### Co po měření zbylo v datech

Zátěžový servis je smazaný i se vším, co k němu patřilo. Jediná stopa jinde
jsou řádky v `api_read_hits` (počítadlo limitů), které denně uklízí pg_cron.

## 6. Seznam zakázek přestal stahovat detail (7. 9. 2026)

Oddíl 5 skončil s tím, že aplikace pořád stahuje **všechny sloupce všech
zakázek**: 37 sloupců, z nichž seznam zobrazuje osm. Tohle je ta oprava.

Měřeno na **E2E testovacím servisu** (2 146 zakázek, 2 055 zákazníků,
410 reklamací, 214 faktur), ne na zátěžovém z oddílu 5 – ten je smazaný. Stejný skript
(`scripts/zatez/appka.mjs`), stejný stroj, produkční balík a `vite preview`,
medián ze tří běhů v čistém kontextu prohlížeče. Mezi oběma sadami se měnil
jen kód aplikace.

### Co se změnilo v kódu

Sloupce jsou nově na jednom místě (`src/lib/sloupceZakazky.ts`) a jsou dvoje:

- **`SLOUPCE_SEZNAMU`** (15) – kód, zákazník, telefon, zařízení, sériové
  číslo, závada, cizí číslo, stav, datum, provedené opravy se slevou (kvůli
  ceně na kartě), verze a pobočka. Přesně to, z čeho se skládají karty,
  hledání, filtry a počty u záložek.
- **`SLOUPCE_DETAILU`** (38) – celý řádek. Dotahuje se **jedním dotazem podle
  `id`** při otevření zakázky a používá se všude, kde se ze zakázky tiskne,
  fakturuje, zakládá reklamace nebo ukládá.

`service_id` se v seznamu nečte vůbec – pro celý seznam je stejné a doplní se
z proměnné. Samo o sobě to bylo 5 % přenosu (uuid v každém řádku).

### Před a po

| Co se měří | před | po | rozdíl |
|---|---:|---:|---|
| **zakázky – staženo** | **2 891 kB** | **1 507 kB** | **−48 %** |
| **zakázky – první řádek seznamu** | **1 021 ms** | **525 ms** | **−49 %** |
| zakázky – konec načítání | 1 990 ms | 1 805 ms | −9 % |
| zakázky – dotazů do databáze | 42 | 42 | – |
| zakázky – kostra stránky | 229 ms | 207 ms | – |
| hledání – nejdelší úhoz | 40 ms | 33 ms | – |
| filtr „Dokončené" | 51 ms | 48 ms | – |
| detail – otevření okna | 61 ms | 28 ms | – |
| **detail – obsah zakázky** | **~25 ms (z paměti)** | **~210 ms (1 dotaz)** | **+185 ms** |
| zákazníci – konec načítání | 1 875 ms | 1 418 ms | −24 % |
| sklad – konec načítání | 1 146 ms | 1 065 ms | – |
| faktury – konec načítání | 919 ms | 909 ms | – |
| statistiky – konec načítání | 1 807 ms | 1 140 ms | −37 % |

Řádky mimo zakázky (zákazníci, statistiky) se kódem neměnily; kolísají,
protože všechny stránky jedou proti stejné databázi ve stejnou chvíli.

Samotná data z PostgREST, tentýž servis, 2 146 zakázek:

| Sada | sloupců | staženo |
|---|---:|---:|
| původní seznam | 37 | 2 410 kB |
| nový seznam | 15 | **999 kB** |
| detail (jedna zakázka) | 38 | 1,2 kB |

Na E2E servisu je většina sloupců prázdná, a přesto se ušetřilo 59 % – **za
polovinu úspory můžou samotné názvy sloupců.** PostgREST je opakuje v každém
řádku, takže i sloupec plný `null` stojí ~20 kB na tisíc zakázek. U servisu
s vyplněnou diagnostikou, kontrolními seznamy a adresami je úspora větší:
u iSwapu (3 590 zakázek) vychází stejný poměr na **5 MB → ~2 MB**, ve
skutečnosti spíš míň – čím víc má servis vyplněno, tím víc se ubráním
sloupců ušetří.

### Co to stálo

**Detail se otevírá o jeden dotaz později.** Okno vyskočí hned i s číslem
zakázky (to seznam zná), ale obsah se objeví až s dotaženou zakázkou –
~210 ms proti ~25 ms z paměti, z toho 85–150 ms je síť. Do té doby je v okně
„Načítám zakázku…“. Je to vědomá výměna: čeká ten, kdo zakázku otevřel, ne
každý, kdo otevřel seznam.

Ze stejného důvodu přibyly dva malé dotazy navázané na otevřený detail:
zakázka podle `id` a seznam právě půjčených náhradních zařízení (dřív se
počítal z celého seznamu v paměti; teď se filtruje na serveru a u servisu
bez náhradních zařízení se neposílá vůbec).

### Čeho se to dotklo

Riziková část nebyl seznam, ale všechno, co ze seznamu bralo **celou**
zakázku. Ošetřená místa:

| Kde | Co s tím |
|---|---|
| detail zakázky | vykreslí se až nad plnou zakázkou (`uplna`), jinak „Načítám zakázku…“ |
| uložení zakázky | posílá do databáze celý řádek – když plný není, dotáhne se; když se to nepovede, uložení se odmítne místo přepsání prázdnem |
| tisk z řádku seznamu | dotáhne zakázku před otevřením nabídky |
| automatický tisk a automatizace při změně stavu | dotáhnou zakázku, ale jen když je pro ten stav opravdu co spustit |
| reklamace ze zakázky | vybraná zakázka se dotáhne, než se z ní opíšou údaje |
| diagnostika v detailu reklamace | ukáže se až s dotaženou zakázkou (zapisuje se rovnou do ní) |
| „půjčeno na jiné zakázce“ | vlastní dotaz místo průchodu celým seznamem |

Při té příležitosti se spravily tři starší chyby, které vznikly z toho, že
seznamů sloupců byly v kódu čtyři a každý jinak dlouhý:

- `select` za uložením detailu neuměl `test_checklist`, `loaner` ani
  `branch_id` – **po každém uložení tak z obrazovky zmizela kontrola po
  opravě, zápůjčka a pobočka** (do dalšího načtení stránky);
- znovunačtení po souběžné úpravě neumělo `branch_id`, takže zakázka
  vyskočila „bez pobočky“;
- `expected_completion_at` se v Zakázkách vůbec nečetlo, takže uložení
  detailu **přepsalo předpokládané dokončení zadané v Kalendáři** prázdnem.

### Co dál

**Prefetch při najetí myší.** Těch 210 ms u detailu by se dalo schovat, kdyby
se zakázka začala dotahovat už při najetí na řádek. Karty dnes dostávají jen
`onClick`, takže by to znamenalo protáhnout novou vlastnost sedmi
komponentami karet – neuděláno.

**Stránkovat a filtrovat na serveru** zůstává nedodělané a je to pořád ta
větší změna: hledání, počty u záložek i seskupení podle stavu dnes počítá
prohlížeč nad úplným seznamem. Rozbor je v doporučení 8 níž.

## Co provoz tlumí a co ne

Všechna čísla výš jsou z **originu**. Skutečný provoz jde přes
`api.appjobi.com`, kde stojí Cloudflare Worker `jobi-api` s vlastní cache.
Ověřeno na nasazené doméně:

| Adresa | 1. dotaz | 2. dotaz |
|---|---|---|
| `/v1/catalog?service=…` | `X-Jobi-Cache: MISS` | `HIT` |
| `/v1/inventory?service=…` | `MISS` | `HIT` |
| `/v1/embed.js?service=…` | `MISS` | `HIT` |
| `/v1/booking?service=…` | **404 – cesta neexistuje** | – |

**Ceník a sklad jsou tedy schované za cache a origin je skoro nevidí.** Limit
60 dotazů za minutu na IP se u běžného návštěvníka cizího webu prakticky
nespustí, protože se k funkci nedostane.

Při ověřování vypadly dvě věci, které nesedí:

**1. Nasazený Worker nezná `/v1/booking`.** Na dotaz odpověděl sám seznamem
cest, které zná:

```
{"error":"Neznámá cesta",
 "known":["/v1/catalog","/v1/inventory","/v1/embed.js","/v1/write","/v1/openapi.json"]}
```

`infra/cloudflare/jobi-api-worker.js` přitom `/v1/booking` i `/v1/booking.js`
v `MAPA` má. Zdroj je před nasazením a **nepozná se to** – hlavička
`X-Jobi-Verze` hlásí `6` na obou stranách, protože se při přidání cest
nezvedla. Rezervační formulář proto míří rovnou na `…supabase.co` (což
`public-booking/embed.js` dělá záměrně – komentář to zdůvodňuje tím, že
rezervací je pár denně), takže
**každé zobrazení stránky s rezervačním formulářem je nekešovaný dotaz na
origin, který udělá dva dotazy do databáze za sebou – a nepočítá se do
žádného limitu.** `docs/LIMITY.md` `public-booking` GET taky neuvádí.

**2. Cache-Control, který dostane prohlížeč, je čtyři hodiny, ne pět minut.**
Funkce posílá `max-age=300`, ale odpověď z `api.appjobi.com` nese
`max-age=14400` – přepisuje to nastavení zóny, ne Worker (v jeho kódu se
`14400` nikde nevyskytuje). Servis, který si opraví cenu, ji tedy na svém
webu uvidí až za čtyři hodiny, ne za pět minut. Purge cache po uložení
ceníku nikde není.

## Doporučení

Seřazeno podle toho, co by mě při spuštění provozu pro padesát servisů
trápilo nejdřív.

**1. Dodělat `public-booking` do Workeru a dát mu limit.** Je to jediné
veřejné rozhraní, které sahá do databáze, nemá strop a nechodí přes cache.
Nasadit Worker s cestami, které už v `MAPA` jsou, a přepnout na ně
`public-booking/embed.js`. Do té doby platí, že jeden web s rezervačním
formulářem a slušnou návštěvností tluče přímo na origin. Limit stačí stejný
jako u ceníku (60/min na IP) – rezervací je pár denně, čtení nastavení
formuláře je to jediné, co se opakuje.

**2. Zvednout `X-Jobi-Verze` při každé změně Workeru.** Teď se nedá poznat,
že je nasazená jiná verze než ve zdrojáku – přesně to se stalo u `/v1/booking`.
Levné a ušetří to hodinu hádání.

**3. Srovnat cache TTL se skutečností.** Buď snížit `max-age` v nastavení
zóny na 300 s, aby seděl se záměrem funkce, nebo (lepší) nechat čtyři hodiny
a **purgnout cache při uložení ceníku a skladu**. Servis, který opraví cenu
a čtyři hodiny ji na svém webu nevidí, bude psát na podporu.

**4. Nedělat z počítadla limitu úzké hrdlo.** Souhrnný řádek za servis
(`klic = ''`) je jediný řádek, o který se perou všechny souběžné požadavky
téhož servisu – kvůli němu utáhne ceník 30 req/s místo 190. Dvě levné
možnosti, obě bez změny chování navenek:

- rozprostřít souhrn na několik řádků (`klic = 'souhrn:' || (náhoda 0–9)`)
  a při vyhodnocení je sečíst – klasický *sharded counter*, odpadne tím
  soupeření o jeden řádek;
- nebo souhrn za servis nepočítat při každém dotazu, ale dopočítávat ho
  z řádků na IP, které se rozkládají samy.

Není to naléhavé (limit 60/min i cache před funkcí drží provoz hluboko pod
hranicí), ale je dobré vědět, že přidání výkonu tenhle strop neposune.

**5. Přidat `Retry-After` do 429 z `portal-ticket`.** Ceník a sklad ho
posílají, portál ne. Zákazník, kterému se odkaz na zakázku zasekne na limitu,
tak nemá jak zjistit, že stačí počkat minutu. Jeden řádek.

**6. Zlevnit 304.** ETag se počítá až z hotových dat, takže podmíněný dotaz
stojí server přesně tolik co plná odpověď. Kdyby se otisk skládal z něčeho
levného – `max(updated_at)` nad dotčenými tabulkami – dala by se odpověď
`304` vrátit po jednom dotazu místo čtyř kol.

**7. Rozdělit balík aplikace.** 484 kB v jednom souboru je 3,6 s na pomalém
4G. Statistiky, Nastavení a JobiDocs se při běžné práci neotvírají a do
prvního načtení nemusí patřit; `React.lazy` na úrovni stránek by z toho ubral
podstatnou část. Týká se to jen webové verze – desktopová appka má balík
lokálně.

**8. Server-side filtr a stránkování v seznamu zakázek.** Dnes se stahují
všechny zakázky servisu a filtruje se v prohlížeči. U 3 500 zakázek to jde,
u 10 000 to bude znát – a to je při 937 zakázkách ročně (číslo
z `docs/KAPACITA.md`) zhruba desátý rok, u rušnějšího servisu dřív. Není to
na teď, ale je to jediné místo, kde náklady rostou s objemem dat.

*Doplněno 6. 9. 2026 (oddíl 5):* nejhorší část je pryč i bez serverového
filtru – seznam se vykresluje z první stránky a zbytek dojíždí na pozadí,
takže na data nikdo nečeká. **Objem přenesených dat ale zůstal** (6,6 MB při
4 800 zakázkách) a roste dál lineárně. Až bude potřeba to řešit, začíná se
ubráním sloupců, ne přepisem filtrování.

*Doplněno 7. 9. 2026 (oddíl 6):* sloupce ubrané jsou – z řádku seznamu je
zhruba polovina původního objemu a detail si zbytek dotáhne sám. Přenos
pořád roste s počtem zakázek, jen o polovinu pomaleji: u 10 000 zakázek to
vychází na ~6 MB místo 13. Skutečné stránkování na serveru tím **není**
hotové a zůstává tímhle bodem.

**9. Co zvyšovat nemusíš.** Limity 60/min na IP a 600/min na servis se
ukázaly jako přiměřené: běžný návštěvník se k funkci vůbec nedostane (cache)
a kdo se dostane, ten 60 dotazů za minutu z jedné adresy legitimně nepotřebuje.
Limit na servis (600/min) se z jedné IP vůbec nedá vyzkoušet – dřív spadne
ten na IP. Zvyšovat je zatím nevidím důvod.

## Co zůstalo nezměřené

- ~~**Databázové dotazy aplikace** a **čas do seznamu zakázek v prohlížeči**~~ –
  doměřeno 6. 9. 2026, viz oddíly 4 a 5.
- **Zobrazení „seskupení podle stavu“ nad velkým servisem** – přepnutí režimu
  se ukládá do `user_preferences` testovacího účtu, takže by měření rozhodilo
  ostatní testy. Z kódu je vidět, že tenhle režim jako jediný vykresluje
  všechny zakázky naráz (viz oddíl 5).
- **Chování více servisů najednou.** Měřilo se vždycky proti jednomu servisu.
  Jestli si edge funkce padesáti servisů navzájem berou výkon, se z jednoho
  stroje a jedné IP zjistit nedá.
- **`POST public-booking`** – vynecháno záměrně, zakládalo by rezervace, které
  by po mně někdo musel mazat, a má strop 10/hod.
- **Portál s platným tokenem** – `GET` zapisuje `portal_last_opened_at`
  a událost `opened`, takže se měřila jen cesta s neplatným tokenem. Ta jde
  stejným kódem až po místo zápisu a je to zároveň cesta, kterou by šel
  někdo, kdo tokeny hádá.

## Co se při měření nezapíše do dat

Skripty jen čtou. Jediná stopa jsou řádky v `api_read_hits` – počítadlo
limitu, jeden řádek na servis/klíč/minutu/endpoint. Maže je denně pg_cron
(`jobi-uklid-api`, viz `docs/ZADANI_API.md`). Nic jiného po měření nezbývá.
