# E2E testy

Projdou hlavní cestu servisu v prohlížeči: přihlásit se, založit zakázku,
najít ji v seznamu a přidat provedenou opravu. Doplňují unit testy, které
hlídají výpočty, ale o rozbité obrazovce nic nevědí.

Kromě toho hlídají to nejdůležitější: **že se nic neztratí mezi aplikací
a databází**. Několik testů proto shodí síť přesně mezi kliknutím a zápisem
a hodnotu pak ověřuje až po přenačtení stránky – to, co je jen na obrazovce,
takový test neuspokojí.

| Soubor | Co hlídá |
| --- | --- |
| `zakazka.spec.ts` | příjem, opravy, kontrola po opravě, zápůjčka, stopky, storno |
| `spolehlivost.spec.ts` | fronta neuložených změn, výpadek sítě, komentáře |
| `vypadky.spec.ts` | výpadek u zákazníka, reklamace, nabídky, kontroly, termínu a objednávky dílů; zavření okna, přepnutí servisu, odhlášení, souběžná úprava |
| `sklad.spec.ts` | produkty, počty kusů, odchod ze stránky před zápisem |
| `cenik.spec.ts` | ceník oprav a opakování neúspěšného zápisu |
| `objednavky-dilu.spec.ts` | objednávka u dodavatele od návrhu po naskladnění |
| `faktura-a-nabidka.spec.ts` | nabídka, faktura, uzávěrka, rozepsaný doklad |
| `portal.spec.ts` | zákazník schválí nabídku na appjobi.com |
| `statistiky.spec.ts` | čísla odpovídají tomu, co se stalo |
| `kalendar.spec.ts` | slíbený termín dokončení |
| `soubezna-prace.spec.ts` | dva lidé naráz, práva technika |
| `servisy.spec.ts` | založení servisu, zkratka v číslech zakázek, pozvánky, smazání servisu |
| `onboarding.spec.ts` | první hodina nového zákazníka: registrace, servis, První kroky, zakázka, faktura, tisk, portál |
| `prohlizece.spec.ts` | hlavní cesty v Safari a Firefoxu, portál v mobilním Safari |
| `zakaznici*.spec.ts`, `hledani`, `nastaveni`, `reklamace`, `rezervace`, `prihlaseni` | zbytek |

## Spuštění

```bash
E2E_PASSWORD='…' E2E_PASSWORD_TECHNIK='…' npm run test:e2e
```

Vývojový server si Playwright spustí sám (`npm run dev:web` na portu 5190).
Pro krokování a prohlížení snímků slouží `npm run test:e2e:ui`.

## Safari a Firefox

Hlavní sada schválně jede jen v Chromiu – běží v CI po každém pushi a tři
prohlížeče by ji ztrojnásobily. Malá sada pro ostatní prohlížeče má vlastní
config a pouští se zvlášť:

```bash
E2E_PASSWORD='…' npm run test:e2e:prohlizece
```

## První hodina nového zákazníka

`onboarding.spec.ts` jde cestou, kterou projde každý, kdo si Jobi zkusí:
registrace → založení servisu → karta „První kroky“ → první zakázka → faktura
→ tisk ve webové větvi → odkaz pro zákazníka. Ostatní sady jezdí v servisu,
který má za sebou měsíce provozu, takže o prázdném servisu nevědí nic.

```bash
E2E_ONBOARDING_PASSWORD="$(openssl rand -base64 24)" npm run test:e2e:onboarding
```

Heslo se generuje při běhu a v repozitáři není. Sada **zakládá účet a servisy
v ostré databázi**; servisy si na konci smaže (`service-delete-own`, pojistka
na název „E2E onboarding“), účet smazat nejde – aplikace na to rozhraní nemá –
a zůstane v Auth. Adresy jsou vždy na `@jobi.test`, takže žádný e-mail
neodejde. Proto má sada vlastní config a v CI neběží.

Projdou v ní jen cesty, bez kterých se nedá pracovat: přihlášení, seznam
a založení zakázky, hledání, faktura, tisk dokladu ve webové větvi
(`src/lib/webPrint.ts`) a zákaznický portál. Portál se navíc otevírá v
**mobilním Safari** (`devices["iPhone 14"]`) – zákazník ho na iPhonu jinak
otevřít nemůže, WKWebView i Chrome pro iOS jedou na WebKitu.

Na co si tu dát pozor:

- **Netestuje se vývojový server, ale hotový build** (`vite build` do
  `dist-web-prohlizece/`, pak statický server). Za prvé se tím testuje to, co
  zákazník opravdu dostane – Vite ve vývoji posílá zdrojáky jak jsou (esnext),
  build je přepisuje kvůli Safari 14. Za druhé vývojový server po každé úpravě
  souboru přenačte stránku a rozjetý test tím spadne uprostřed.
- **Portál běží ze statického serveru nad `web/`** (port 5762), ne z
  appjobi.com. Jinak by se opravy v `web/z/` daly ověřit až po nasazení.
- **Testy hlídají i konzoli.** Neodchycená chyba stránky nebo `console.error`
  test shodí – přesně takhle se v Safari a Firefoxu projeví většina rozdílů.
  Výjimky (např. cookie `__cf_bm`, kterou Firefox odmítá Cloudflare) jsou
  v `hlidejChyby` vyjmenované i s důvodem.
- **Podpis v portálu se testuje pixely na canvasu**, ne tím, že tam pole je.
  Prázdné podpisové pole vypadá stejně jako rozbité.

## Testovací účet

Testy jezdí proti ostrému Supabase pod účtem `e2e@jobi.test` ve **vlastním
servisu** „E2E testovaci servis“. RLS ho odděluje stejně jako kterékoli dva
zákaznické servisy, takže se test nemůže dotknout cizích dat. Účet nemá
potvrzený e-mail na skutečné doméně a nikam se s ním nedá přihlásit jinam.

Testy souběžné práce potřebují druhý účet ve **stejném** servisu:
`e2e-technik@jobi.test`, role člen s právy na zakázky, stavy, zákazníky a tisk.
Bez něj by nešlo ověřit, že se změny mezi lidmi propisují a že práva platí
i v rozhraní.

Hesla jsou v GitHub secrets jako `E2E_PASSWORD` a `E2E_PASSWORD_TECHNIK`. Bez něj testy nejedou –
schválně nemají tichý fallback: test, který se bez přihlášení tváří, že
prošel, je horší než žádný.

Heslo nikde jinde není. Pro místní spuštění si ho nastavte nové:

```sql
update auth.users
   set encrypted_password = crypt('<nové heslo>', gen_salt('bf'))
 where email = 'e2e@jobi.test';
```

a pak `gh secret set E2E_PASSWORD --repo alexpapillier-lab/jobi` (u technika
`E2E_PASSWORD_TECHNIK` a e-mail `e2e-technik@jobi.test`).

Servis má nároky nastavené jako **trvalé**, ne zkušební, aby testy nepřestaly
fungovat po třiceti dnech. Zkratka `E2E` je v `service_settings.config`
na dvou místech (`abbreviation` i `companyData.abbreviation`), protože
generátor čísel čte to první a nastavení aplikace píše obě.

## Data po testech

Zakázky se po sobě nemažou – jsou v testovacím servisu, kam nikdo nekouká,
a nová zakázka v každém běhu je zároveň důkaz, že zakládání funguje.
Kdyby jich bylo moc, smazat je jde jedním dotazem:

```sql
delete from tickets where service_id = '882beee7-4564-4d10-8ac6-16dc19240b57';
delete from warranty_claims where service_id = '882beee7-4564-4d10-8ac6-16dc19240b57';
```

Ve stejném servisu jezdí i **syntetický hlídač** (`scripts/hlidac/`, každých
15 minut). Zakládá zakázky s číslem `HLIDAC-…`, hned je dává do koše a denní
úloha `jobi-uklid-hlidace` je odtud po dvou dnech maže. Kdyby test počítal
zakázky v seznamu, musí s ním počítat – živá zakázka hlídače v seznamu
existuje jen pár sekund, ale právě v tu chvíli může běžet i test.
Podrobnosti: `docs/HLIDAC_PROVOZU.md`.

## Na co si dát pozor

- **Testy nejsou paralelní.** Pracují se stejnou zakázkou a společným servisem.
- **Napovídač zařízení leží přes tlačítko Vytvořit zakázku.** Zavře se
  vyplněním dalšího pole; Escape zavře celé okno, ne jen napovídač.
- **Okno je široké 1440×1000.** V menším se spodní lišta překrývá s obsahem.
- **Osobní předvolby se ukládají k účtu** (`user_preferences`), ne jen do
  prohlížeče. Test, který předvolbu přepne a spadne, ji nechá přepnutou pro
  všechny další běhy – proto si `zakazka.spec.ts` asistenta postupu na začátku
  vždy zapne. Hledání v Nastavení jde přes klíčová slova podsekcí v
  `Settings.tsx`, nový přepínač tam musí mít slovo, jinak ho hledání nenajde.
- **Escape zavře celý detail zakázky.** Rozbalenou nabídku (např. hledání
  produktu) skryjte smazáním textu, ne Escapem.
- **Přihlášení pevně volí testovací servis** (`SERVIS.id` v `pomocnici.ts`): účet
  e2e@jobi.test je i v ukázkovém servisu pro snímky na web a aplikace by jinak
  vzala první servis ze seznamu.
- **Online rezervace:** testovací servis má `public_slug = e2e-servis` a v
  `service_settings.config.rezervace` zapnuté rezervace; `rezervace.spec.ts`
  volá edge funkci `public-booking` napřímo. Funkce pouští 10 rezervací za
  hodinu z jedné adresy – při mnoha místních bězích za sebou vrátí 429;
  počítadlo vynuluje `delete from rate_hits where kanal = 'booking'`.
- **Stopky na zakázce:** testovací servis má `config.cas_na_oprave = true`; test
  v `zakazka.spec.ts` úsek spustí a zastaví.
- **Náhradní zařízení:** v `service_settings.config.nahradniZarizeni` testovacího
  servisu je položka „iPhone SE náhradní (E2E)“ se sériovým číslem E2E-SN-001 a
  kaucí 2 000 – test zápůjčky ji vybírá ze seznamu.
- **Testovací servis potřebuje produkty ve skladu** („Displej AUDIT“) – test
  výběru dílů u opravy je hledá. Kdyby zmizely, založte libovolný produkt se
  slovem AUDIT v názvu. „Displej AUDIT“ má nastaveného dodavatele, protože
  bez něj by nešlo objednávat díly.
- **Číslo zakázky je v DOM vícekrát.** Vykresluje se ve dvou rozvrženích
  a schované stránky zůstávají připojené, takže `getByText` padá na
  „resolved to 2 elements“. Používejte `vidZakazku(page, kod)` z pomocníků.
- **Výpadek sítě se dělá `page.route`, ne `context.setOffline`.** Shodí se
  jen zápisy do jedné tabulky, zbytek aplikace zůstane použitelný a test
  trefí přesně ten okamžik, kdy uložení neprojde. Vzor musí být regulární
  výraz (`/\/rest\/v1\/tickets/`); glob s hvězdičkou se o dotazovací část
  URL rozbije.
- **Placeholder „Výměna displeje, výměna baterie, diagnostika“ patří oknu
  Nová zakázka, ne detailu.** Okno příjmu zůstává připojené v DOM i zavřené,
  takže se do něj text opravdu zapíše – a protože se rozpracovaný příjem
  ukládá do localStorage, najde ho tam test i po přenačtení. Zakázka přitom
  zůstane nezměněná. V otevřeném detailu se pole jmenuje
  `input[placeholder="Popis požadované opravy"]` a bere se s `:visible`.
- **Sklad a ceník se ukládají s odkladem.** Že je změna v databázi, se pozná
  podle toho, že z `localStorage` zmizel klíč `jobi_sklad_neulozeno_v1`
  (u ceníku `jobi_zarizeni_neulozeno_v1`). Bez téhle kontroly test projde
  i nad hodnotou, která je jen na obrazovce.
- **Přepínač servisů je jen v rozbalené postranní liště.** Ve sbalené v DOM
  vůbec není; rozbalí se najetím myší (`hover` na „Hlavní navigace“) a teprve
  pak se objeví `[aria-label^="Servis: "]`. Jednotlivé servisy v nabídce mají
  `data-servis="<id>"` – podle názvu se trefit nedá, servisů bývá víc
  s podobným jménem a spletený klik by test odvedl do cizích dat.
- **`servisy.spec.ts` potřebuje nasazenou edge funkci `service-delete-own`.**
  Bez ní vrátí mazání 404 a servis po testu zůstane:
  `npx supabase functions deploy service-delete-own`.
- **`servisy.spec.ts` si zakládá vlastní servis.** Jako jediný nepracuje
  v testovacím servisu: v prvním testu si servis založí, v posledním ho smaže
  a `test.afterAll` po sobě uklidí i po pádu uprostřed. Mazání má pojistku –
  smaže jen servis, jehož název začíná na „E2E servisy“, a nikdy testovací
  servis. Uklidit se musí vždycky: **jeden účet smí mít nejvýš tři vlastní
  servisy** (`MAX_SERVICES` v edge funkci `service-create`) a e2e@jobi.test už
  dva má, takže jeden zapomenutý zbytek zablokuje všechny další běhy.
  Pozvánky chodí jen na adresy `@jobi.test`; Resend je neodešle, ale pozvánka
  v databázi vznikne a test ji po sobě zase smaže.
- **`onboarding.spec.ts` zakládá dva servisy na jeden běh** – jeden z aplikace
  a druhý voláním `service-create` napřímo (simuluje zakládání přerušené
  uprostřed). Účet je pokaždé nový, takže se do limitu tří vejdou, ale
  `test.afterAll` je stejně maže oba; bez toho by opakovaný běh na tomtéž účtu
  narazil.
- **Tiskový dialog se v testu nepotvrdí.** Webový tisk skládá HTML a vloží ho
  do skrytého iframu (`srcdoc`) – test si podchytí zápis do té vlastnosti,
  takže vidí, co by se vytisklo, a `print()` v iframu vypne. Bez toho by se
  test zastavil na dialogu prohlížeče.
- **Adresu Supabase a klíče si `servisy.spec.ts` odposlechne z požadavků**,
  které aplikace sama dělá (`page.on("request")`). Anon klíč se do balíčku
  zapéká při buildu a na `window` není, takže jinak by test nemohl ověřit, že
  servis opravdu zmizel ze seznamu, ani po sobě uklidit.
- **Testy po sobě uklízejí, co je nastavením servisu.** Náhradní zařízení,
  opravy v ceníku, produkty a koncepty faktur se na konci mažou – jinak by
  testovací servis po pár týdnech vypadal jako smetiště.

## Ukázkový servis pro snímky na web

Kromě testovacího servisu má účet `e2e@jobi.test` ještě „Servis Novák"
(`72de5c11-6c2d-486a-9a44-dd0a9060cf97`) s vymyšlenými, ale věrohodnými
daty. Slouží jen k fotografování obrazovek pro appjobi.com:

```bash
E2E_PASSWORD='…' node scripts/snimky-pro-web.mjs
```

Skript se přihlásí, podstrčí aktivní servis přes `localStorage` a uloží
sedm snímků do `web/img/`. Pak je zmenšete (`sips -Z 1600`, `pngquant`).
Nároky servisu jsou trvalé – zkušební období by jinak po měsíci skončilo
a snímky by ukazovaly zamykací obrazovku.

Hesla testovacích účtů jsou jen v GitHub secrets. Když je potřeba spustit
něco místně a heslo není k dispozici, nastaví se nové podle postupu výš
a secret se přepíše – nic jiného na starém hesle nezávisí.

## Pojistky v datech testovacího servisu

- **`FIXTURE zakazka bez cisla`** – zakázka bez `code` v E2E servisu. Nemazat:
  drží ji test „zakázka bez čísla nesundá hledání“ (`hledani.spec.ts`). Zakázka
  bez čísla vzniká importem nebo veřejným API a filtr hledání na ní kdysi
  shodil celou stránku Zakázky.
