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
   majitele jako modul `consolidated`; chybí: omezení přístupu jen na pobočku,
   čas na opravě, vytížení techniků v Kalendáři, KPI techniků).
6. `[ ]` **Online rezervace** termínu s výběrem opravy z ceníku a předběžnou
   cenou, vložitelná na web servisu (veřejný ceník přes API už je).
7. `[~]` **Účetnictví a pokladna** (5. 9.: iDoklad i Fakturoid – Nastavení →
   Fakturace a DPH → Propojení, tlačítko Odeslat v detailu faktury; edge funkce
   `invoice-export`, tabulka `service_integrations`, placený modul `accounting`)
   – zbývá Pohoda, Money, platební terminál (SumUp, GoPay), denní uzávěrka.
8. `[ ]` **Apple a telefonní specifika** – kontrola IMEI a záruky při příjmu,
   Find My, historie zařízení napříč servisy, checklist příjmu s fotkou.
9. `[ ]` **AI, kde šetří minuty** – z fotky a popisu navrhnout opravu a cenu
   z ceníku, napsat SMS zákazníkovi, shrnout historii zařízení.
10. `[ ]` **Migrace jedním klikem** ze Zakázkového listu i MyRepair včetně
    zákazníků, historie a ceníku (import ze Zakázkového listu existuje
    ve `scripts/import-zakazkovylist`).

První tři měsíce: body 1, 2, 4.

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
- `[ ]` Právní texty na dokumentech (příjemka, záruční list) zkontrolovat
  právníkem – jsou přepsané, ne převzaté.

### Provoz a bezpečnost
- `[~]` Zálohy DB – hotová automatická denní záloha mimo Supabase
  (`.github/workflows/backup-db.yml`): dump, zkouška obnovy do prázdného
  Postgresu s porovnáním počtů řádků, šifrování AES-256 a artefakt na 90 dní.
  Zbývá uživateli doplnit secrets `SUPABASE_DB_URL` a `BACKUP_PASSPHRASE`,
  do té doby workflow jen napíše, co chybí. Viz `docs/ZALOHY_DATABAZE.md`.
- `[~]` Monitoring a alerting – hotový hlídač `alerts-check` (pg_cron každou
  hodinu, e-mail přes Resend, tlumení 6 hodin, chyby z dev serveru se
  přeskakují). Viz `docs/HLIDAC_PROVOZU.md`. Zbývá stavová stránka a hlídání
  zvenčí, že aplikace vůbec běží.
- `[~]` Audit RLS a edge funkcí před prvním cizím zákazníkem (zejména
  veřejné API, capture-upload, invoice-send-email). 5. 9.: proběhlo první
  kolo z účtu technika (`scripts/rls-probe.sql`, 45 testů). Opraveno mazání
  zákazníků bez práva, přepis a mazání cizích komentářů a vystavování faktur
  bez zaplaceného modulu. Zbývá projet totéž z role správce a projít veřejné
  API a capture funkce.
- `[ ]` Rate limity a kvóty na veřejném API a SMS.
- `[ ]` Supabase plán a limity (řádky, storage fotek, realtime spojení)
  spočítat na 50 servisů.
- `[ ]` Tajemství a klíče: rotace, kde leží, kdo má přístup.

### Aplikace a vydávání
- `[x]` Podepsané a notarizované macOS buildy, OTA aktualizace, kanály
  stable / beta, JobiDocs zvlášť.
- `[~]` Windows build (workflow existuje) – otestovat instalaci, tisk přes
  JobiDocs a aktualizace na Windows.
- `[ ]` Verze pro tablet / telefon: web funguje, ověřit celé flow příjmu
  na telefonu včetně fotek.
- `[ ]` Ověřit v desktopu po 0.2.8: tisk s vypnutým JobiDocs, aktualizace
  na pozadí, presence s druhým uživatelem, migrace firemních údajů.
- `[ ]` E2E testy hlavních cest (založit zakázku, změnit stav, vytisknout,
  vystavit fakturu) – dnes jen unit testy.
- `[ ]` Výkon: Statistiky počítají z všech zakázek v prohlížeči – přesunout
  agregace na server dřív, než servis přesáhne ~10 000 zakázek.

### Web, podpora, prodej
- `[~]` appjobi.com – ceník se třemi tarify, balíčky SMS, zkušební období
  a aktuální funkce hotové (5. 9.); zbývá srovnání s konkurencí, screenshoty
  nové verze a video.
- `[x]` Nápověda: 10 kapitol na `appjobi.com/napoveda` (první kroky, příjem,
  stavy a automatizace, tisk a JobiDocs, nabídka a portál, SMS, faktury,
  sklad, tým a pobočky, import a API). V aplikaci Nastavení → Aplikace →
  Nápověda a podpora, odkazy skáčou rovnou na kapitolu.
- `[~]` Podpora: formulář „Nahlásit chybu“ hotový (edge funkce
  `support-report` přiloží verzi, platformu, servis a posledních 10 chyb
  z logu, e-mail chodí na podpora@appjobi.com s reply-to na uživatele).
  Zbývá slíbit reakční dobu a říct, kdo podporu drží.
- `[ ]` Import z konkurence jako služba při přechodu (bod A10).
- `[ ]` Pilot: 3 cizí servisy zdarma za zpětnou vazbu, teprve pak ceník.
- `[ ]` Fakturace zákazníků Jobi (kdo vystavuje, DPH, měsíční / roční).
