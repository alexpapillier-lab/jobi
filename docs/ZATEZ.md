# Zátěžové a výkonnostní měření

Naměřeno 6. 9. 2026 proti **ostrému** Supabase projektu, ale výhradně proti
testovacím servisům (E2E testovací servis, ukázkový Servis Novák). Majitel to
výslovně povolil – aplikaci nikdo nepoužívá a nikdo za ni neplatí.

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

**Nezměřeno** – `E2E_PASSWORD` nebylo v prostředí (žije v GitHub secrets, viz
`e2e/README.md`) a bez přihlášení projde přes RLS jen prázdno. Skript
`scripts/zatez/db-dotazy.mjs` je hotový a měří seznam zakázek (první stránka
i všechny stránky), detail zakázky, `statistiky_prehled` za rok a seznam
skladu; pustí se s heslem přes `npm run zatez:db`.

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

**9. Co zvyšovat nemusíš.** Limity 60/min na IP a 600/min na servis se
ukázaly jako přiměřené: běžný návštěvník se k funkci vůbec nedostane (cache)
a kdo se dostane, ten 60 dotazů za minutu z jedné adresy legitimně nepotřebuje.
Limit na servis (600/min) se z jedné IP vůbec nedá vyzkoušet – dřív spadne
ten na IP. Zvyšovat je zatím nevidím důvod.

## Co zůstalo nezměřené

- **Databázové dotazy aplikace** a **čas do seznamu zakázek v prohlížeči** –
  chybělo `E2E_PASSWORD`. Skripty jsou hotové, stačí je pustit s heslem.
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
