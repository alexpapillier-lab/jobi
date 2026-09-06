# Jobi – roadmapa a checklist k prodeji

Sepsáno 4. 9. 2026 po srovnání s MyRepair.app (390–6 990 Kč/měs plus příplatky)
a ZakázkovýList.cz (499 Kč/měs, jen evidence). Ceník (5. 9.): Starter 590,
Business 1 490, Enterprise od 2 490 Kč/měs za servis, ročně o 15 % levněji,
bez příplatků za uživatele. Příplatky jen za pobočku navíc (490) a balíček
SMS (199 za 100 zpráv).

Stav: `[ ]` nezačato · `[~]` rozděláno · `[x]` hotovo

## A. Produkt – co Jobi potřebuje, aby bylo lepší než konkurence

Seřazeno podle toho, kolik času a peněz to servisu ušetří.

1. `[x]` **Zákaznický portál** (nasazeno 4. 9.; chybí platební brána, QR platba je) – odkaz v SMS: stav zakázky, fotky z příjmu,
   cenová nabídka ke schválení jedním klikem s časovým razítkem, podpis
   příjemky prstem, platba předem (QR / brána), potvrzení vyzvednutí.
2. `[x]` **Stavebnice automatizací** (nasazeno 4. 9.; WhatsApp zatím ne) – pravidla „když stav X → šablona Y“ pro
   SMS, e-mail, WhatsApp; upomínky „čeká 7 dní na vyzvednutí“, skladné,
   žádost o recenzi po vydání. Základ (SMS podle stavu) existuje.
3. `[x]` **Cenová nabídka a schválení** jako první krok opravy (nasazeno 5. 9.):
   rozpis se skládá z ceníku nebo ručně, zákazník ho vidí položku po položce
   v portálu a schválí nebo zamítne; po schválení se položky jedním tlačítkem
   přenesou do provedených oprav. Položky drží `tickets.quote_items`,
   editor je `src/components/orders/QuoteBuilder.tsx`.
4. `[x]` **Díly od dodavatele až po marži** (nasazeno 5. 9.: dodavatelé, objednávky, minimum, rezervace ze zakázky, marže ve Statistikách) – objednávky dílů u dodavatelů,
   rezervace dílu na zakázku, doobjednání pod minimem, marže na opravu
   a na technika. Sklad a vazba díl↔oprava existují, chybí nákupní strana.
5. `[~]` **Více poboček a lidé** (pobočky nasazeny 5. 9. jako placený modul `branches` zapínaný v Owner panelu: tabulka `branches`, vlastní IČO/DIČ/účet pobočky,
   výchozí pobočka na servis, zkratka v čísle zakázky, adresa a telefon
   pobočky na dokumentech a v portálu, filtr v Zakázkách / Kalendáři /
   Skladu / Statistikách / Fakturách, domovská pobočka člena, srovnání
   poboček ve Statistikách, konsolidované statistiky přes všechny servisy
   majitele jako modul `consolidated`). 6. 9.: **omezení člena na vlastní
   pobočku** – v Týmu oprávnění „Jen vlastní pobočka“ (`capabilities.branch_only`),
   hlídá databáze restriktivními politikami na zakázky, reklamace a faktury
   (funkce `pobocka_povolena`, migrace 20260908140000; ověřeno probe v TEST2:
   člen s domovskou pobočkou Brno vidí 3 z 50 zakázek), aplikace mu ukáže jen
   jeho pobočku bez přepínače. **KPI techniků** (6. 9.): karta Technici ve
   Statistikách – kdo zakázky přijímá a dokončuje (z historie zakázek podle
   koncových stavů servisu) a hodiny + tržba hodinové práce (RPC
   `statistiky_technici`, migrace 20260908150000). **Čas na opravě** (6. 9.,
   migrace 20260908160000): volitelné stopky (Nastavení → Zakázky → Hodinová
   práce → Stopky na zakázce, `config.cas_na_oprave`), tabulka
   `ticket_work_sessions`, karta v detailu, odpracovaný čas v KPI techniků.
   Chybí: vytížení techniků v Kalendáři (z úseků jde dopočítat).
6. `[~]` **Online rezervace** (6. 9., migrace 20260908110000, edge funkce
   `public-booking`): formulář k vložení na web servisu (`<div id="jobi-rezervace">`
   + skript `…/public-booking/embed.js?service=slug`), nezávazná rezervace
   s termínem podle otevírací doby (Nastavení → Veřejné API → Online rezervace:
   zapnutí, dny, hodiny, krok, úvodní text), limit 10/hod na adresu a skryté pole
   proti robotům, e-mail servisu přes Resend. V Jobi panel „Rezervace z webu“
   v Kalendáři: potvrdit, zrušit, „Založit zakázku“ s předvyplněným příjmem,
   po založení se rezervace označí jako převedená s odkazem na zakázku.
   Vyžaduje modul veřejného API (`api_catalog`). Formulář nabízí model a opravu
   z veřejného ceníku s předběžnou cenou (ověřuje se na serveru, migrace
   20260908120000); zakázka z rezervace vzniká rovnou s plánovanou opravou.
   Zákazník dostane potvrzení e-mailem (Resend, odpověď jde na e-mail servisu;
   nasazeno 6. 9.). Formulář přepsán 6. 9.: sekce Kontakt / Zařízení a oprava /
   Termín / Poznámka, vlastní styl s předponou `jobi-rez` (přebít jde
   `--jobi-akcent`), **výběr víc oprav najednou** se součtem ceny i času
   (`bookings.repair_ids`, migrace 20260908230000) a odhadem, kdy bude hotovo.
   Zbývá: SMS zákazníkovi,
   volitelně cesty `/v1/booking` ve Workeru (`infra/cloudflare/jobi-api-worker.js`
   je připravený, stačí znovu vložit do Cloudflare).
7. `[~]` **Účetnictví a pokladna** (5. 9.: iDoklad i Fakturoid – Nastavení →
   Fakturace a DPH → Propojení, tlačítko Odeslat v detailu faktury; edge funkce
   `invoice-export`, tabulka `service_integrations`, placený modul `accounting`)
   – 6. 9. **denní uzávěrka**: způsob platby při označení Zaplaceno
   (`invoices.payment_method`, migrace 20260908130000), dialog Uzávěrka nad
   seznamem faktur (doklady dne podle způsobu platby, tisk). Zbývá Pohoda,
   Money, platební terminál (SumUp, GoPay).
8. `[~]` **Apple a telefonní specifika** – kontrola IMEI a záruky při příjmu,
   Find My, historie zařízení napříč servisy, checklist příjmu s fotkou.
   Hotovo 6. 9.: **historie zařízení** – při příjmu i v detailu Jobi ukáže, že
   zařízení se stejným sériovým číslem / IMEI už v servisu bylo (kód, datum,
   závada; v detailu proklik), a **kontrola IMEI** podle kontrolní číslice
   (překlep je vidět hned). `src/lib/zarizeniHistorie.ts`. Zbývá: záruka a
   aktivační zámek u Apple (bez oficiálního API; jen odkaz na checkcoverage),
   IMEI databáze blacklistu (placené API).
9. ~~**AI, kde šetří minuty**~~ – **vyřazeno 6. 9.** po dohodě s majitelem: pro
   malý servis komplikace navíc a platba za API u každé zakázky, přínos
   nejistý. Nevracet se, dokud o to neřeknou sami zákazníci.
10. `[~]` **Migrace jedním klikem** ze Zakázkového listu i MyRepair včetně
    zákazníků, historie a ceníku (import ze Zakázkového listu existuje
    ve `scripts/import-zakazkovylist`).
    Hotovo 6. 9.: **import zákazníků z CSV** (Zákazníci → Import z CSV; `src/lib/csv.ts`,
    `ImportZakazniku.tsx`) – oddělovač i sloupce se poznají samy, ručně jde přemapovat,
    duplicity podle normalizovaného telefonu se přeskočí, dávkové vkládání. Zbývá:
    import zakázek s historií (chce vzorové exporty z MyRepair a Zakázkového listu –
    nemáme), přenos katalogu z těchto systémů.

První tři měsíce: body 1, 2, 4.

**Rozhodnutí k tarifům (6. 9. 2026):**
- **Online rezervace jsou ve všech tarifech**, i ve Starteru. Důvod: nestojí nás
  nic (pár požadavků denně), ale přivádí servisu zákazníky – je to funkce, kvůli
  které si Jobi nechá i malý servis. Nastavení je v Zakázkách, ne v API.
- **Výběr opravy z ceníku ve formuláři (cena a délka opravy) zůstává na modulu
  veřejného API** (`api_catalog`, dnes Enterprise): ceník jde ven přes `/v1/catalog`.
  Bez modulu formulář funguje s volným textem. Až se bude měnit ceník tarifů,
  tohle je hranice mezi „rezervace zdarma“ a „rezervace s ceníkem“.
- **Zápis přes API** (od 6. 9. i zakládání a mazání skladu a ceníku) je pod
  `api_catalog`/`api_inventory`, tedy Enterprise. Kdo si dělá vlastní rozhraní na
  sklad, platí za API, ne za rezervace.

## B. Checklist do první produkční fáze „na prodej“

### Účet, registrace, platby
- `[x]` Registrace a přihlášení včetně onboardingu (5. 9.: zákazník si servis
  založí sám přes `service-create`, karta První kroky v Zakázkách vede
  k vyplnění firmy a první zakázce, ukázková data na jedno kliknutí i s úklidem).
- `[x]` Zkušební období (5. 9.: nový servis má celou aplikaci na 30 dní přes
  nárok `access`; poslední týden odpočítává proužek a po vypršení se aplikace
  zamkne obrazovkou „Vyberte si plán“ – data zůstávají, jen se do nich nedá.
  Root owner projde vždy, plán se zapíná v Owner → Placené moduly. Zatím jen
  v klientovi; serverová kontrola zápisů přijde s platební bránou).
- `[~]` Placené moduly – `service_entitlements` a Owner panel hotové. Napojení
  na Stripe je předpřipravené (5. 9.: tabulka `service_billing`, edge funkce
  `billing-checkout`, `billing-portal`, `billing-webhook` s ověřením podpisu,
  mapování cena → moduly přes lookup key). Chybí jen účet u Stripe – postup
  v `docs/STRIPE.md`. Faktury za předplatné vystaví Stripe nebo Fakturoid.
- `[x]` Stránka Předplatné v Nastavení (5. 9.): stav, konec zkušebního období,
  další platba, počet poboček, odkaz do Stripe Checkout a zákaznického portálu.

### Právní
- `[~]` Obchodní podmínky a smlouva o zpracování osobních údajů (GDPR) –
  napsané: `web/obchodni-podminky.html` a `web/zpracovani-udaju.html`
  (servis je správce, Jobi zpracovatel; subdodavatelé Supabase, Cloudflare,
  Twilio, Resend, Stripe). Zbývá doplnit identitu provozovatele místo
  `[doplňte]` a nechat projít právníkem.
- `[x]` Zásady ochrany osobních údajů na webu – `web/ochrana-osobnich-udaju.html`.
  Cookie lišta netřeba, web neměří návštěvnost ani neukládá cookies.
- `[x]` Export a výmaz dat servisu na žádost (GDPR) – v Owner panelu tlačítko
  „Exportovat data (JSON)“ (akce `export` ve `service-manage`, kompletní obsah
  servisu včetně seznamu souborů) a mazání, které nově uklidí i úložiště.
- `[~]` Právní texty na dokumentech (6. 9., `jobidocs/core/defaults.ts` LEGAL_TEXTS):
  záruční list už neomezuje díly na 12 měsíců (spotřebitel má ze zákona 24
  měsíců z vadného plnění, § 2615 → § 2165 OZ) a nevylučuje pozdější reklamaci
  vnějšího poškození; reklamační příjemka má náležitosti potvrzení podle § 19
  zákona o ochraně spotřebitele (kdy, co, požadovaný způsob, 30 dnů, písemné
  potvrzení o vyřízení); zakázkový list zmiňuje prodej nevyzvednuté věci po
  6 měsících (§ 2609 OZ). Smlouva o zápůjčce nová. **Ještě nechat přečíst
  právníkem** – texty jsou výchozí a servis si je v JobiDocs upravuje.
- `[~]` Zálohy DB – hotová automatická denní záloha mimo Supabase
  (`.github/workflows/backup-db.yml`): dump, zkouška obnovy do prázdného
  Postgresu s porovnáním počtů řádků, šifrování AES-256 a artefakt na 90 dní.
  Zbývá uživateli doplnit secrets `SUPABASE_DB_URL` a `BACKUP_PASSPHRASE`,
  do té doby workflow jen napíše, co chybí. Viz `docs/ZALOHY_DATABAZE.md`.
- `[~]` Monitoring a alerting – hotový hlídač `alerts-check` (pg_cron každou
  hodinu, e-mail přes Resend, tlumení 6 hodin, chyby z dev serveru se
  přeskakují). Viz `docs/HLIDAC_PROVOZU.md`. Zbývá stavová stránka a hlídání
  zvenčí, že aplikace vůbec běží.
- `[~]` Audit RLS – druhé kolo 5. 9. večer (správce, člen bez práv, anon): 120
  probe, 6 děr opraveno migrací 20260907130000, mezi nimi mazání libovolného
  servisu anon klíčem a posouvání cizí číselné řady faktur. Detail v
  `docs/AUDIT_ROLE_2026-09.md`. Data vracená portálem zákazníkovi
  zkontrolována: číslo, termíny, zařízení, závada, fotky, opravy jen s názvem
  a cenou, nabídka, podpis, kontakt servisu – žádný telefon, e-mail, IMEI,
  heslo k zařízení, poznámka ani náklad.
- `[~]` (původní zápis) Audit RLS a edge funkcí před prvním cizím zákazníkem (zejména
  veřejné API, capture-upload, invoice-send-email). 5. 9.: proběhlo první
  kolo z účtu technika (`scripts/rls-probe.sql`, 45 testů). Opraveno mazání
  zákazníků bez práva, přepis a mazání cizích komentářů a vystavování faktur
  bez zaplaceného modulu. Zbývá projet totéž z role správce a projít veřejné
  API a capture funkce.
- `[x]` Rate limity a kvóty na veřejných rozhraních – přehled v `docs/LIMITY.md`.
  Veřejné API a SMS je měly, doplněno nahrávání fotek (počet, rychlost,
  velikost a kontrola, že jde opravdu o obrázek), hlášení chyb a zákaznický
  portál včetně limitu na volajícího, který jediný chrání před hádáním tokenů.
- `[x]` Supabase plán a limity spočítané na 50 servisů – `docs/KAPACITA.md`.
  Naměřeno na ostrých datech: 12,4 kB databáze a 1,9 fotky na zakázku.
  Padesát servisů se do plánu Pro vejde i po třech letech, první účet nad
  25 USD až kolem pátého roku. Dřív než cena praskne počítání Statistik
  v prohlížeči.
- `[~]` Tajemství a klíče – soupis v `docs/TAJEMSTVI.md`: co kde leží
  (Supabase secrets, Vault, GitHub, počítač), kdo se k čemu dostane a jak
  se co vyměňuje, když unikne. Zbývá pravidelná rotace a záložní přístup
  pro druhého člověka.

### Aplikace a vydávání
- `[x]` Podepsané a notarizované macOS buildy, OTA aktualizace, kanály
  stable / beta, JobiDocs zvlášť.
- `[x]` Onboarding připomíná JobiDocs: karta První kroky má krok „Nainstalujte
  JobiDocs pro tisk dokumentů" – na desktopu se odškrtne sám, když JobiDocs
  běží, v prohlížeči vede ke stažení aplikace a je nepovinný.
- `[~]` Windows build (workflow existuje) – otestovat instalaci, tisk přes
  JobiDocs a aktualizace na Windows.
- `[~]` Verze pro tablet / telefon – celé flow příjmu projito na 375 px
  i 768 px. Opraveno: průsvitná patička okna Nová zakázka, pruh pod ní,
  kde prosvítal obsah, a rozpis cenové nabídky. Zbývá ověřit na skutečném
  iPhonu (napovídače počítají s `window.innerHeight`, který se po vysunutí
  klávesnice na iOS nezmenší) a rozhodnout o umístění hlášek, které na
  telefonu překryjí křížek okna.
- `[ ]` Ověřit v desktopu po 0.2.8: tisk s vypnutým JobiDocs, aktualizace
  na pozadí, presence s druhým uživatelem, migrace firemních údajů.
- `[~]` E2E testy hlavních cest – Playwright, `npm run test:e2e`, v CI
  workflow „E2E testy". Pokryto přihlášení (i odmítnutí špatného hesla),
  založení zakázky s kontrolou čísla a přidání provedené opravy. Jezdí
  v samostatném servisu pod účtem e2e@jobi.test, viz `e2e/README.md`.
  Zbývá tisk a vystavení faktury.
- `[x]` Výkon: Statistiky se počítají na serveru (funkce `statistiky_prehled`,
  migrace 20260907120000). Odpověď pro největší servis 273 kB místo 1,65 MB
  a neroste s počtem zakázek. Zakázky se stahují jen pro režim Tabulka.
- `[x]` **Revize 6. 9. (tři agenti čtením kódu: bezpečnost, logika karet, dokumenty
  a faktury).** Opraveno v jednom commitu: člen s „Jen vlastní pobočka“ viděl přes
  historii, komentáře a úseky práce obsah cizí pobočky a RPC (změna stavu, portálový
  odkaz, statistiky) pobočku nehlídaly – restriktivní politiky a kontroly v RPC
  (migrace 20260908180000); zápis omezeného člena jen do vlastní pobočky; historie
  neukládá kód zařízení ani podpis; stopky jako RPC s unikátním indexem (jeden běžící
  úsek na člověka, 20260908170000); KPI „Dokončil“ počítá zakázky jednou a bez storna
  (20260908190000); sleva se propisuje do „Celkem“ na dokladech; editor faktury
  nepřepíše cizí koncept ani rozepsaná pole, dvojklik na Vystavit nezaloží dva
  doklady; dobropis zaokrouhluje symetricky; uzávěrka tiskne i v desktopu; storno
  zapíše důvod až po úspěšné změně stavu; kontrola/zápůjčka se při chybě vrátí;
  rezervace: limity před validací, termín v rozsahu, změna stavu se zámkem proti
  souběhu, panel načte všechny nevyřízené; import CSV jen s právem na zákazníky,
  uvozovka uprostřed buňky, „číslo zákazníka“ není telefon; drobnosti v knihovnách
  (místní datum, IBAN zadaný rovnou, hranice slova v šablonách). Dodatek: řádek
  „Bez technika“ v KPI, hodinová práce vázaná na účet technika, záruka bez
  přetečení měsíce, legacy proměnné pro JobiDocs odstraněny. Neopraveno (nízké):
  `dates.diagnosed` je čas tisku (chce sloupec na zakázce).
- `[~]` **Lov chyb 5. 9. (dva agenti, reklamace+faktury a sklad+zařízení).**
  Opraveno (commit 376830d): číslo faktury až při uložení (díry v řadě),
  kontrola duplicitního čísla, dodavatel nové faktury ze service_settings,
  zakázka po stornu faktury nabídne novou, Sklad (ks) při úpravě produktu se
  ukládá do skladů, potvrzení před smazáním produktu, import katalogu bez
  `---` a mapování PRODUKTY: na id. Zbývá:
  - `[x]` **Rezervace dílů vs. neuložené opravy** (opraveno 5. 9.): provedené
    opravy se ukládají do databáze hned při přidání a odebrání, úpravy ceny
    s odkladem 400 ms; realtime nepřepíše místní opravy, dokud zápis běží.
    E2E „oprava přidaná majitelem přežije změnu stavu od technika“.
  - `[x]` Detail zakázky bere produkty ze skladu v databázi (5. 9.); výběr
    dílů u ruční opravy nabídne celý sklad, když se model nepozná.
  - `[x]` Kód reklamace přiděluje databáze (`dalsi_cislo_reklamace`, migrace
    20260907140000) + unikátní indexy na kód reklamace a číslo faktury (5. 9.).
  - `[x]` QR platba i z čísla účtu – IBAN se odvodí (`src/lib/banka.ts`, 5. 9.).
  - `[x]` Kosmetika (5. 9.): Stornovat jen u vystavené faktury, koncept má
    v seznamu „koncept z …“, množství česky, historie bez surového id, ceny
    oprav formátované, hláška u odkazu na smazanou zakázku a při návratu
    z Dokončeno (díly se nevrací).

### Web, podpora, prodej
- `[~]` appjobi.com – ceník se třemi tarify, balíčky SMS, zkušební období
  a aktuální funkce hotové (5. 9.). Skutečné snímky aplikace z ukázkového
  servisu v hero i v sekci Ukázky (`scripts/snimky-pro-web.mjs`), sekce
  Jak to chodí u pultu, revize všech textů. Srovnávací tabulka s názvy
  konkurentů **ne** (6. 9.: reklama konkurenci, riziko zastaralých údajů); místo
  toho: argumenty v ceníku beze jmen (neomezení uživatelé v ceně, žádné
  příplatky za moduly, cena za servis, ne za člověka) a sekce „Přecházíte
  z jiného systému?“ (import CSV, pomoc s přechodem) – **hotovo 6. 9.**, včetně
  nových snímků (Rezervace, Kontrola a zápůjčka) a dvou karet funkcí. Zbývá video.
- `[x]` Nápověda: 10 kapitol na `appjobi.com/napoveda` (první kroky, příjem,
  stavy a automatizace, tisk a JobiDocs, nabídka a portál, SMS, faktury,
  sklad, tým a pobočky, import a API). V aplikaci Nastavení → Aplikace →
  Nápověda a podpora, odkazy skáčou rovnou na kapitolu.
- `[~]` Podpora: formulář „Nahlásit chybu“ hotový (edge funkce
  `support-report` přiloží verzi, platformu, servis a posledních 10 chyb
  z logu, e-mail chodí na podpora@appjobi.com s reply-to na uživatele).
  Zbývá slíbit reakční dobu a říct, kdo podporu drží.
- `[x]` Veřejné API – zápis rozšířen (6. 9.): zakládání, úpravy a mazání produktů
  a oprav, značky/kategorie/modely (bez mazání), vazby ověřené na servis,
  `created_ids` v odpovědi; ověřeno živě dočasným tokenem v E2E servisu.
- `[ ]` Import z konkurence jako služba při přechodu (bod A10).
- `[ ]` Pilot: 3 cizí servisy zdarma za zpětnou vazbu, teprve pak ceník.
- `[ ]` Fakturace zákazníků Jobi (kdo vystavuje, DPH, měsíční / roční).


## Inspirace z MyRepair (průchod jejich aplikací 5. 9. 2026)

Jejich ceník: Start 390 Kč (30 zakázek, 1 uživatel), Technik 990 Kč (3 uživatelé),
Business 2 990 Kč (10 uživatelů, 3 pobočky), Premium 6 990 Kč. Jobi s neomezenými
uživateli za 590–1 490 Kč je pro každý servis s víc lidmi výrazně levnější – hlavní
obchodní argument. Jejich slabina: přes padesát položek menu, Wallet program,
newslettery, heatmapy, predikce; pro malý servis zahlcující. Jednoduchost Jobi
držet, přebírat jen z první poloviny seznamu.

Co převzít, podle přínosu:
- `[x]` **Asistent postupu v detailu zakázky** (5. 9., `PostupZakazky.tsx`) – řádek kroků (přijato → fotky →
  opravy → nabídka → hotovo → faktura → předáno) se zvýrazněným dalším krokem
  a tlačítkem, které tam skočí. Nový člověk u pultu nemusí nic vědět.
- ~~Jedna časová osa komunikace u zakázky~~ – **zamítnuto 5. 9.**: majitel
  chce SMS chat se zákazníkem a interní komentáře oddělené, ať se neplete,
  co zákazník vidí. Nevracet se k tomu.
- `[x]` **Zálohové faktury a dobropisy** (5. 9., migrace 20260907150000): druh
  dokladu `invoices.kind` (faktura / zálohová ZF / dobropis DB), vlastní číselné
  řady, „Vystavit dobropis“ z vystavené faktury (záporné položky), „Vyúčtovat
  zálohu“ ze zaplacené proformy (odečet po sazbách DPH), související doklady
  s prokliky, filtr druhu v seznamu, nadpis dokladu z dat (`{{title}}`), e-mail
  podle druhu. Do iDokladu jdou jen běžné faktury. **Zbývá: přebuildovat
  JobiDocs** (změna v `jobidocs/core`) a ověřit v ostrém: proforma bez DUZP,
  vyúčtování na 0 Kč, dobropis bez QR, e-mail s předmětem „Dobropis DB…“.
  Volitelně „Zálohová faktura ze zakázky“ (tlačítko v detailu).
- `[x]` **Hodinová práce jako položka** (5. 9.): třetí režim v přidávání opravy –
  hodiny × sazba + technik; cena a čas se dopočítají, jde upravit. Na fakturu
  a dokumenty jde jako hodiny × Kč/h. Výchozí sazba servisu v Nastavení →
  Zakázky → Hodinová práce (`service_settings.config.hodinova_sazba`).
- `[x]` **Půjčení náhradního zařízení** (5. 9., migrace 20260907180000): karta
  v detailu zakázky (zařízení, sériové číslo, příslušenství, kauce, půjčeno,
  vráceno, poznámka; `tickets.loaner`), stav „U zákazníka“ / „Vráceno“, nový
  typ dokumentu **Smlouva o zápůjčce** v JobiDocs (`smlouva_zapujcka`, výchozí
  šablona s právním textem a podpisy, proměnné `{{loaner.*}}`) i ve webovém
  tisku; v nabídce Tisk, jen když je něco půjčeno. **JobiDocs přebuildovat.**
  Od 6. 9. stálý seznam zařízení v Nastavení → Zakázky → Náhradní zařízení:
  v zakázce se jen vybere a u půjčeného je vidět, ve které zakázce je.
- `[x]` **Kontrola po opravě** (5. 9., migrace 20260907170000): karta v detailu
  zakázky, šablona podle názvu zařízení (telefon / počítač / obecná, vlastní
  v Nastavení → Zakázky → Kontrola po opravě), položky OK / Chyba / Neověřeno
  s poznámkou, ukládá se hned (`tickets.test_checklist`), krok v asistentovi.
  Do dokumentů: JobiDocs proměnné `{{checklist.summary}}` a `{{checklist.list}}`
  (blok se skryje, když kontrola není), webový diagnostický protokol má sekci
  „Kontrola po opravě“. Šablony JobiDocs si proměnnou musí přidat (výchozí
  šablona protokolu ji zatím nemá).
- `[x]` **Otázky při stornu zakázky** (5. 9., `StornoDialog.tsx`): při přepnutí do
  stavu, který je storno (podle klíče `cancelled`/`storno` nebo názvu Zrušeno,
  Storno, Neopraveno…), dialog s důvodem a poznámkou; zapisuje se do historie
  jako `cancel_reason` (migrace 20260907160000). Stav se změní až po potvrzení.
- `[x]` **Kontrola SPF/DMARC** (5. 9.): appjobi.com má SPF (`include:amazonses.com`
  na doméně i `send.` subdoméně), DKIM (`resend._domainkey`) a DMARC `p=none`.
  E-maily jdou přes Resend (`RESEND_FROM_EMAIL`). Až bude pár týdnů provozu bez
  problémů, zpřísnit DMARC na `p=quarantine` (a ideálně přidat `rua=` adresu pro
  reporty).
- Kalendář a online rezervace – už bod 6.

Co Jobi dělá lépe a je to argument na web: neomezení uživatelé, tisk bez dialogu
přes JobiDocs, rezervace dílu s odpisem až v konečném stavu, marže na opravu
a technika, rozpis nabídky propsaný po schválení do zakázky.
