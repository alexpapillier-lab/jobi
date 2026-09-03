# Předplatné – co všechno je potřeba udělat

Plán zavedení placeného předplatného: platební brána, automatické
obnovování, slevové kódy, limity členů a samoobslužné založení servisu
po zaplacení. Na konci (sekce 11) navíc plán na verze Jobi pro další
obory – autoservisy, zubaře a spol.

**Výchozí stav:** půlka je hotová. `service_entitlements` už je jediné
místo pravdy o tom, co má servis zaplacené, `valid_until` už se
vyhodnocuje v `has_entitlement()` a serverové kontroly už běží v
`sms-send`, `sms-provision` a `invoice-send-email`. Předplatné tedy
neznamená přestavbu aplikace – znamená, že místo tebe bude do té tabulky
zapisovat webhook od platební brány.

---

## 0. Rozhodnutí – stav k 3. 9. 2026

Většina je rozhodnutá (✅). Zbývá:

| # | Co | Stav |
|---|---|---|
| C3 | Ochranná známka – **potřebuje rešerši** v ÚPV a EUIPO | úkol |
| C5 | Ověřit u účetní registraci identifikované osoby | úkol |
| — | **Do kterého plánu patří veřejné API?** Ceník na webu ho neuvádí, v migraci proto zatím není v žádném plánu | otevřené |

Vše ostatní je rozhodnuté a první migrace podle toho stojí.

### A. Blokuje první migraci

- [x] **A1 – ✅ Plány i moduly.** Základ v plánu, SMS jako placený
      doplněk – přesně jak to už stojí na webu (SMS +199 Kč/měs
      u Starteru, v ceně u Business a Enterprise).
      **Omezení, které je potřeba držet:** doplňky ať zůstanou u jednoho,
      maximálně dvou. Každý další násobí kombinace, které musíš
      otestovat (plán × doplněk × obor). SMS je na doplněk ideální,
      protože má skutečné variabilní náklady (Twilio). Faktury a zbytek
      patří do plánu.
- [x] **A2 – ✅ Ceny zůstávají podle webu.** `web/index.html`:
      Starter 590, Business 1190, Enterprise 2490 Kč, ročně −15 %.
      **Ceny samotné bych neměnil** – proti konkurenci sedí (RepairShopr
      od ~1 260 Kč, RepairDesk od ~2 080 Kč za pobočku, oba dražší).
      **Problém je jinde: chybí důvod k upgradu.** Dnes Starter od
      Business dělí „sklad napříč pobočkami" a „konsolidované
      statistiky" – věci, které malý servis nechce, takže z 590 Kč
      nikdy neodejde. Řešení je A3.
- [ ] **A3 – ✅ Starter 1 člen, Business 6, Enterprise bez limitu.
      Místo navíc za +99 Kč/měs.** Do limitu se **počítají všichni**
      včetně ownera i nepřijatých pozvánek (jinak jde obejít visícími
      pozvánkami), root owner se nepočítá.

      **⚠️ Zbývá dořešit strop doplňkových míst na Starteru, jinak
      Business nikdo nekoupí.** Spočítáno:
      Starter 590 + n × 99 přeroste Business (1190 Kč) až u **sedmého**
      místa navíc. Servis se šesti lidmi by tedy zůstal na Starteru za
      1 085 Kč a Business by neměl komu prodávat – přesně ten problém,
      kvůli kterému limity zavádíme.

      | Lidí | Starter s místy | Business |
      |---|---|---|
      | 1 | 590 | – |
      | 2 | 689 | – |
      | 3 | 788 | – |
      | 4 | 887 | 1 190 |
      | 6 | 1 085 | 1 190 |

      ✅ **Rozhodnuto: na Starteru max 2 místa navíc** (strop 3 lidi).
      Čtvrtý člověk znamená přechod na Business – skok 788 → 1 190 Kč.
      Nad Business jsou místa za +99 bez stropu; Enterprise se prodává
      funkcemi, ne počtem lidí. V migraci jako `plans.max_extra_seats`.
- [x] **A4 – ✅ Měsíčně i ročně**, roční levnější. Web už má −15 %,
      tím se to řídí.
- [ ] **A5 – Servisy zdarma: nedávat je do Stripu.** Návrh byl vést je
      pod Stripem zdarma, ať je všechno na jednom místě. **Nedoporučuju:**
      Stripe má být zdroj pravdy o *platících*. Neplatiči tam udělají
      duchy v MRR, 100% kupóny se chovají jinak než běžné předplatné a
      nikdy nedostanou kartu, takže při zrušení slevy platba stejně
      selže. *Doporučení: `plan_key = 'legacy'`, nárok `source = 'manual'`,
      mimo Stripe.* „Jedno místo" ať je **tvoje admin obrazovka**, která
      ukáže platící i legacy vedle sebe – ne Stripe dashboard.
- [x] **A6 – ✅ Ceník na obor.** `plans.vertical` bude `NOT NULL`,
      první sada plánů `vertical = 'repair'`. Začíná se **Apple servisy**.
      Cena za to je duplikace sady plánů při každém novém oboru – u dvou
      tří oborů je to v pořádku, jen o tom vědět.

### B. Blokuje spuštění prodeje

- [x] **B1 – ✅ Stripe.**
- [x] **B2 – ✅ Týdenní trial**, s výhradou níž. 7 dní je u nástroje,
      do kterého si zákazník musí nejdřív přenést zakázky a nastavit
      dokumenty, dost málo – běžný standard je 14 dní a servis často
      zkouší až o víkendu. Není to ale blokující rozhodnutí, dá se to
      měřit a změnit. **Podmínka: `plans.trial_days` jako sloupec, ne
      konstanta v kódu**, plus tlačítko „prodloužit trial o 7 dní"
      v admin obrazovce. To budeš potřebovat hned u prvního zájemce,
      který napíše „nestihl jsem to vyzkoušet".
- [x] **B3 – ✅ Read-only po vypršení.**
- [x] **B4 – ✅ Do konce zaplaceného období**, pak se neobnoví.
- [x] **B5 – ✅ Slevové kódy ano** – procentuální na první rok
      (kampaně) a partnerské s poznámkou. Doživotní 100% slevy řešit
      ručním nárokem, ne kódem (sekce 5).
- [x] **B6 – ✅ Vlastní fakturace** (revize původního doporučení).
      Fakturoid jsem doporučoval dřív, než jsem věděl, že fakturační
      modul už v repu je: `src/pages/Invoices.tsx`, `invoiceNumbering.ts`,
      `invoiceMath.ts`, `invoiceVat.ts`, `invoice-send-email`. Použít ho
      dává smysl – **jako neplátce DPH vystavuješ jednoduchý doklad bez
      daně**, což je ta nejsnazší varianta.
      **Ale:** ten modul je psaný pro fakturaci *tvých zákazníků jejich*
      zákazníkům – má číslování a DPH nastavení per servis. Pro tvoje
      vlastní faktury potřebuješ **samostatnou číselnou řadu a svoje
      firemní údaje**, ne data servisu. Počítej ~den práce, ne hodinu.
      **K revizi, až se staneš plátcem DPH** – tam začne přibývat
      opravné doklady, zálohy a kontrolní hlášení a Fakturoid se vyplatí.

### C. Mimo kód, ale musí být hotové před první platbou

- [x] **C1 – ✅ Živnost.** S.r.o. až s příjmem, který to unese.
- [x] **C2 – ✅ Kód psal jen majitel.** Autorská práva jsou tím čistá,
      žádná licenční smlouva není potřeba. Kdyby na Jobi někdy dělal
      externista, musí licenční smlouva vzniknout **předem** – zpětně
      se to vyjednává mnohem hůř.
- [ ] **C3 – Známka ano, ale nejdřív rešerše.** Ověřit v databázi
      **ÚPV** (isdv.upv.cz) a **EUIPO** (eSearch), jestli je „Jobi"
      volné ve třídách **9** (software) a **42** (SaaS). „Jobi" je
      krátké slovo a existují značky toho jména v jiných oborech –
      to samo o sobě nevadí, kolize se posuzuje v rámci tříd, ale bez
      rešerše to nejde tvrdit. **Registruj „Jobi", ne sub-značky**
      (viz D2): chráníš tím kmen, ze kterého ostatní názvy vycházejí.
- [x] **C4 – ✅ Odpadá zatím.** iOS appka je mockup, není veřejná.
      Pravidlo platí až ve chvíli, kdy půjde do App Store – sekce 10
      je do té doby neaktuální.
- [ ] **C5 – Identifikovaná osoba: vysvětlení.** Tohle není
      rozhodnutí, ale povinnost, kterou nejspíš už máš. Stručně:
      1. Stripe (Irsko), Supabase, Twilio i Resend ti fakturují
         **ze zahraničí bez DPH**.
      2. Jakmile jako neplátce přijmeš službu od firmy z jiného státu
         EU, musíš se do **15 dnů registrovat jako identifikovaná
         osoba** a odvést z té faktury 21 % DPH (bez nároku na odpočet).
      3. **Nestáváš se plátcem DPH** – svým zákazníkům dál fakturuješ
         bez daně. Odvádíš jen daň z těch přijatých zahraničních služeb.

      **Úkol: zeptat se účetní, jestli už registrovaný jsi.** Twilio a
      Supabase používáš dávno, takže povinnost pravděpodobně běží
      nezávisle na předplatném. Za pozdní registraci jsou pokuty.

### D. Obory

- [x] **D1 – ✅ Cykloservisy jako druhý obor.** Dobrá volba na
      *ověření konceptu*: cykloservis je s opravnou elektroniky skoro
      totožný (přines, diagnostika, oprava, předání), pole vystačí
      stejná – značka, model, výrobní číslo rámu. Prakticky jen slovník
      a statusy.
      **Dvě věci k tomu ale patří:** je to tak blízko, že to
      slovníkovou vrstvu skoro neprověří – návrhové chyby se ukážou až
      u vzdálenějšího oboru. A trh je menší a hodně sezónní (jaro),
      takže od něj nečekej tržby jako od autoservisů. *Volba dává smysl
      jako levný test, ne jako zdroj příjmu.*
- [ ] **D2 – Sub-značky: ano, ale levnou cestou.** JobiAuto a JobiDent
      se prodávají líp než jedno obecné Jobi, to je pravda – mechanik
      hledá software pro autoservisy. **Nedělej z nich ale tři produkty.**
      *Návrh: jeden produkt, jedna aplikace, sub-značky jako marketing.*
      `jobiauto.cz` je landing page vedoucí do téže aplikace, která se
      pro daný obor v hlavičce představí jako „Jobi Auto".
      Co stojí plná varianta: **rešerše a registrace známky ke každému
      názvu zvlášť** (~5 000 Kč za jednu, každá vlastní řízení), vlastní
      doména a údržba každé landing page, a kdyby appky někdy šly do
      obchodů, **tři listingy = trojnásobek releasů a schvalování**.
      Registruj teď „Jobi", sub-značky až podle toho, jestli se obor
      chytne.

**Zubaři počkají.** Rozhodnutí „obor, nebo samostatný produkt?" padne
až po cykloservisech, podle měřítka v sekci 11 (nad ~70 % sdílených
obrazovek obor, pod ~50 % druhý produkt).

---

## 1. Databáze (migrace)

**Hotovo:** `20260903200000_predplatne_plany_a_billing.sql` – `plans`,
`plan_addons`, `service_billing`, `billing_events`, `services.vertical`,
`service_entitlements.source`, funkce `service_seat_count()`,
`service_seat_limit()` a `has_active_subscription()`, naplněný ceník
a doplnění legacy plánu stávajícím servisům.
Otestováno na čistém Postgresu proti všem migracím projektu.
Zbývá z týhle sekce: slevové kódy (sekce 5) a záchranný cron (sekce 4).

- [ ] **`plans`** – katalog plánů: `key` (`starter`/`business`/`enterprise`),
      `vertical` (**NOT NULL**, první sada `'repair'` – viz A6),
      `name`, `price_monthly`, `price_yearly`, `max_members`,
      `trial_days` (viz B2 – ne konstanta v kódu),
      `modules jsonb` (které nároky plán uděluje), `stripe_price_id_monthly`,
      `stripe_price_id_yearly`, `active`, `sort_order`.
      Číst smí kdokoli přihlášený (potřebuje to ceník), zapisovat nikdo
      přes RLS – jen ty přes edge funkci.
      Ceny drž **v haléřích jako integer**, ne v korunách jako float.
      Naplnit podle `web/index.html`: Starter 590 / Business 1190 /
      Enterprise 2490 Kč, ročně −15 %.
      Limity členů **1 / 6 / bez limitu**, k tomu `max_extra_seats`
      (Starter 2, výš bez omezení – viz A3).
- [ ] **`plan_addons`** – placené doplňky nad rámec plánu (viz A1).
      Dva: **SMS** 199 Kč/měs (Starter; výš v ceně) a **místo navíc**
      99 Kč/měs. Ve Stripu jsou to další položky téhož předplatného
      (subscription items), ne druhé předplatné – u míst se mění
      `quantity`, proraci pak Stripe spočítá sám.
- [ ] **Ceník na webu doplnit o počty členů.** `web/index.html` dnes
      limity neuvádí vůbec. Až se zavedou, musí být v ceníku vidět –
      jinak je zákazník potká až jako chybovou hlášku při zvaní.
- [ ] **`service_billing`** – jeden řádek na servis: `service_id` (unique),
      `plan_key`, `billing_period` (`monthly`/`yearly`),
      `stripe_customer_id`, `stripe_subscription_id`, `status`
      (`trialing`/`active`/`past_due`/`canceled`), `current_period_end`,
      `cancel_at_period_end`, `max_members_override` (kdyby ses s někým
      domluvil individuálně), `created_at`, `updated_at`.
      RLS: členové servisu čtou, zapisuje jen `service_role`. Stejný
      vzor jako `service_entitlements`.
- [ ] **`billing_events`** – log přijatých webhooků: `stripe_event_id`
      (**UNIQUE** – tohle je celá idempotence), `type`, `payload jsonb`,
      `processed_at`, `error`. Bez tohohle přijde jednou dvakrát táž
      událost a uděláš dvakrát servis nebo dvakrát fakturu.
- [ ] **`discount_codes`** – vlastní evidence slev (viz sekce 5):
      `code` (unique, uppercase), `stripe_promotion_code_id`, `kind`
      (`percent`/`amount`), `value`, `duration` (`once`/`repeating`/`forever`),
      `duration_months`, `max_redemptions`, `redemptions_count`,
      `valid_from`, `valid_until`, `plan_keys text[]` (na které plány
      platí, NULL = na všechny), `active`, `note`.
- [ ] **`discount_redemptions`** – kdo kterým kódem kdy zaplatil:
      `code_id`, `service_id`, `stripe_invoice_id`, `amount_off`, `created_at`.
      Potřebuješ to k tomu, abys věděl, kolik tě která kampaň stála.
- [ ] **Doplnit `plan_key` stávajícím servisům.** Stejný krok jako v
      `20260902200000_service_entitlements.sql`: bez toho zavedeš
      předplatné a všem, kdo dnes aplikaci používají zdarma, se to
      rozbije. Rozhodni, jestli dostanou nějaký plán natvrdo, nebo
      speciální `plan_key = 'legacy'` bez limitů.
- [ ] **Odlišit placené nároky od darovaných.** V `service_entitlements`
      přidat `source` (`subscription`/`manual`). Webhook pak sahá jen na
      `subscription` řádky a nezruší omylem to, co jsi někomu dal ručně.
- [ ] **Funkce `service_seat_count(p_service_id uuid)`** – kolik míst je
      obsazeno (členové + nepřijaté pozvánky). Jedno místo pravdy,
      volané z kontrol při zvaní.
- [ ] **Funkce `has_active_subscription(p_service_id uuid)`** – vedle
      `has_entitlement()`, stejný styl: `SECURITY DEFINER`, `STABLE`,
      **a hned v další migraci `REVOKE` pro `anon` a `authenticated`** –
      viz `20260902210000_has_entitlement_lockdown.sql`, jinak si zvenčí
      kdokoli přečte, kdo platí a kdo ne.

---

## 2. Edge funkce

- [ ] **`billing-checkout`** – přihlášený uživatel si vybere plán,
      funkce vytvoří Stripe Checkout Session (`mode: "subscription"`) a
      vrátí URL.
  - Ověření identity zkopíruj z `entitlements-manage`, ale místo root
    ownera kontroluj: buď je uživatel `owner` existujícího servisu
    (upgrade), nebo zakládá nový (viz sekce 6).
  - Do session dej `client_reference_id = user.id` a `metadata`:
    `service_id` (u upgradu), `plan_key`, `billing_period`,
    `service_name` (u nového servisu).
  - `allow_promotion_codes: true` – tím se zapíná pole pro slevový kód.
  - `verify_jwt` zůstává **true**, volá se z přihlášené aplikace.
- [ ] **`stripe-webhook`** – jádro celé věci.
  - V `config.toml` dát `verify_jwt = false` (stejně jako
    `sms-incoming` a `public-*`), protože Stripe žádné JWT neposílá.
    **Místo toho ověřuj podpis** hlavičky `stripe-signature`. V Denu
    musíš použít `constructEventAsync`, ne synchronní `constructEvent` –
    synchronní varianta tam neprojde.
  - Nejdřív zápis do `billing_events` s `ON CONFLICT (stripe_event_id)
    DO NOTHING`; když nic nevloží, událost už proběhla → vrátit 200 a
    skončit.
  - Zpracovat: `checkout.session.completed` (první platba – tady vzniká
    servis), `customer.subscription.updated` (změna plánu, obnova),
    `customer.subscription.deleted` (zrušení),
    `invoice.paid` (posunout `valid_until`), `invoice.payment_failed`
    (nastavit `past_due`, poslat mail).
  - Výsledkem každé úspěšné platby je upsert do `service_entitlements`
    se **`valid_until = current_period_end + 3 dny odkladu`** pro každý
    modul z plánu. Logika vypnutí už existuje – když platba nedojde,
    `valid_until` prostě uplyne.
  - Vracet 200 i u události, které nerozumíš. Non-200 znamená, že to
    Stripe bude zkoušet znovu, a zbytečné retry ti zaplní log.
- [ ] **`billing-portal`** – vrátí odkaz do Stripe Customer Portalu
      (změna karty, faktury, zrušení). Ušetří ti to většinu supportu,
      je to ~30 řádků kódu.
- [ ] **`billing-status`** – co má servis zaplaceno, do kdy, kolik má
      volných míst. Pro obrazovku Předplatné v Nastavení.
- [ ] **Limit členů do `invite_create`.** Před vytvořením pozvánky
      zkontrolovat `service_seat_count() < max_members`. **Tohle je
      povinné na serveru**, ne v UI – ze stejného důvodu, jaký je
      popsaný v komentáři u `service_entitlements`: kdo si otevře
      vývojářské nástroje, zavolá edge funkci přímo.
- [ ] **Limit členů i do `invite-accept`.** Mezi vytvořením a přijetím
      pozvánky uběhne čas a limit se mohl mezitím naplnit.
- [ ] **`entitlements-manage` nechat funkční** pro ruční udělení, jen
      psát `source = 'manual'`.

---

## 3. Frontend

- [ ] **Ceník / výběr plánu** – nová obrazovka, po registraci a v
      Nastavení. Ukazovat limit členů a moduly u každého plánu.
- [ ] **Pole na slevový kód** – buď vlastní (validace přes edge funkci
      před checkoutem, ať uživatel nezjistí až na Stripu, že kód
      nefunguje), nebo nechat na Stripe Checkoutu. *Doporučení: vlastní
      pole s validací*, protože „neplatný kód" na cizí stránce je
      místo, kde lidi odcházejí.
- [ ] **Sekce Předplatné v Nastavení** – plán, stav, datum další platby,
      obsazená místa (`5 / 10`), tlačítka Změnit plán a Spravovat platbu.
- [ ] **Návrat z platby** – Stripe přesměruje zpátky dřív, než dorazí
      webhook. Stránka „zpracováváme platbu" musí pár sekund dotazovat
      `billing-status`, ne rovnou tvrdit, že se nic nestalo.
- [ ] **`useEntitlements` – zavolat `refresh()`** po návratu z platby.
      Jinak zákazník zaplatí a moduly se objeví až po restartu.
- [ ] **`useSubscription` hook** – stav předplatného pro aplikaci
      (read-only režim, varovné hlášky).
- [ ] **Varování před vypršením** – 7 dní předem, a hlavně při
      `past_due` (karta odmítnuta). Tady se dá zachránit většina
      nechtěných odchodů.
- [ ] **Read-only režim** po vypršení – zablokovat zakládání zakázek,
      nechat čtení a export.
- [ ] **V Tým a přístupy ukázat obsazenost** a při plném limitu
      místo chybové hlášky nabídnout upgrade.
- [ ] **Admin obrazovka pro tebe** – přehled předplatných, tržeb a
      slevových kódů. Vedle stávající správy nároků.

---

## 4. Automatické obnovování

- [ ] Obnovu řeší Stripe sám, ty jen zpracováváš `invoice.paid`. **Nedělej
      si vlastní cron na strhávání plateb.**
- [ ] **Nastavit Smart Retries** ve Stripu (opakované pokusy při
      odmítnuté kartě) a e-maily o expiraci karty.
- [ ] **Odklad (grace period)** – `valid_until` dávat o pár dní dál než
      `current_period_end`. Bez toho vypneš servisu SMS uprostřed
      pracovního dne kvůli kartě, které den předtím vypršela platnost.
- [ ] **Záchranný cron** (`pg_cron`) jednou denně: najít předplatná,
      kde `current_period_end` dávno uplynulo a webhook nedorazil, a
      nahlásit ti to. Webhooky se ztrácejí, hlavně při výpadku funkce.

---

## 5. Slevové kódy

- [ ] **Zdroj pravdy jsou Stripe Promotion Codes**, ne vlastní logika.
      Vlastní počítání slev znamená vlastní počítání proraci, DPH a
      vratek – to nechceš.
- [ ] **`discount_codes` v databázi je zrcadlo** kvůli přehledu,
      omezením navíc (platnost jen na některé plány) a kvůli tomu, abys
      mohl kód uznat i u platby převodem.
- [ ] Podporovat: procentuální i pevnou slevu, jednorázově / prvních N
      měsíců / navždy, omezený počet použití, platnost do data, vazbu
      na konkrétní plány.
- [ ] **Validační endpoint** – ověří kód dřív, než uživatel odejde na
      Stripe.
- [ ] **Kód `ZDARMA100`, tedy 100% sleva navždy:** ohlídat, že Stripe
      u nulové částky nechce kartu a subscription se chová jinak. Buď to
      otestuj, nebo takové případy řeš ručním nárokem přes
      `entitlements-manage` (`source = 'manual'`).
- [ ] **Doživotní / partnerské kódy** evidovat s poznámkou, komu a proč.
      Za rok si nevzpomeneš.
- [ ] Zapisovat každé uplatnění do `discount_redemptions`.

---

## 6. Zaplacení založí nový servis a platícího udělá ownerem

Ano, tohle jde – a máš na to hotový vzor. `invite_create` s
`mode = "stock"` (řádky 128–150) přesně tohle dělá: založí `services`,
vloží `service_memberships` s `role = "owner"`. Rozdíl bude jen v tom,
kdo to smí spustit – dnes root owner, nově úspěšná platba.

**Pořadí kroků je důležité:**

- [ ] **Uživatel se musí zaregistrovat před platbou.** Bez `user_id`
      nemáš koho udělat ownerem. `signUp` v `AuthProvider` už existuje,
      takže flow je: registrace → výběr plánu → checkout → webhook
      založí servis → návrat do aplikace.
- [ ] Webhook na `checkout.session.completed` **v jedné transakci**:
  1. založit `services`,
  2. vložit `service_memberships` s `role = "owner"` (ne `admin` – owner
     je chráněný triggery z `20250109000000_add_owner_protection_triggers.sql`
     a je to jediná role, kterou nelze omylem sebrat),
  3. založit `service_billing`,
  4. udělit nároky z plánu do `service_entitlements`,
  5. **založit výchozí statusy** – zkopírovat `DEFAULT_STATUSES` z
     `statuses-init-defaults`. Bez toho dostane platící zákazník servis
     bez jediného stavu zakázky a napíše ti první den.
- [ ] **Ošetřit, že webhook přijde dvakrát** – jinak vzniknou dva servisy
      za jednu platbu. Řeší `billing_events.stripe_event_id UNIQUE` plus
      kontrola, jestli k `stripe_subscription_id` už servis existuje.
- [ ] **Rozlišit nové předplatné od upgradu** přes `metadata.mode` –
      u upgradu se nový servis zakládat nesmí.
- [ ] **Název servisu** vzít z metadat checkoutu (zeptat se na něj před
      platbou), ne generovat „Stock service".
- [ ] **Co když platba projde, ale založení selže:** zalogovat do
      `error_logs` a upozornit sebe. Zákazník má strženo a nemá servis –
      tohle musíš vědět do minuty, ne z reklamace.
- [ ] **Uvítací e-mail** přes Resend, stejným způsobem jako pozvánky.

---

## 7. Limity členů podle plánu

- [ ] `plans.max_members` je zdroj pravdy, `service_billing.max_members_override`
      výjimka pro individuální domluvu.
- [ ] Kontrola **na serveru** v `invite_create` i `invite-accept`.
- [ ] **Downgrade s více členy, než nový plán dovoluje:** nikoho
      automaticky nevyhazovat. Zablokovat nové pozvánky a nechat stav
      doběhnout. Automatické odebírání přístupů lidem, kteří zrovna
      pracují, je nejjistější způsob, jak přijít o zákazníka.
- [ ] Nezapomenout, že aplikaci používá i root owner napříč servisy –
      ten se do limitu počítat nesmí (v týmu se stejně nezobrazuje).
- [ ] **Doplňková místa za +99 Kč/měs**, na Starteru se stropem (A3).
      Ve Stripu jako `quantity` u položky předplatného, ne jako další
      předplatné – změna počtu pak umí proraci sama.

### Sdílení jednoho účtu: neblokovat zařízení

Nabízí se bránit sdílení tím, že uživatel smí být přihlášený jen na
jednom zařízení. **Nedoporučuju**, ze tří důvodů:

1. **Trestá to platící zákazníky.** Jobi běží na desktopu (Tauri), na
   webu a časem na iOS. Technik má běžně appku na dílenském počítači i
   na notebooku v kanceláři. Vzájemné odhlašování dvou zařízení je
   nejotravnější druh chyby – uživatel neví, co se děje, a napíše ti.
2. **Řeší to špatnou páku.** Cíl je, aby tříčlenná dílna nejela na
   jednom účtu za 590 Kč. Na to jsou **místa**, která se od teď hlídají
   na serveru (`invite_create`, `invite-accept`). Zamykání zařízení
   proti tomu nic nezmůže – tři lidi se stejně vystřídají na jednom
   počítači.
3. **Sdílený účet škodí hlavně zákazníkovi, ne tobě.** V repu je
   `ticket_history` s plným diffem, `customer_history` i evidence, kdo
   zakázku smazal. Pod jedním sdíleným účtem je tenhle audit
   bezcenný. To je argument *pro zákazníka*: „každý svůj účet, ať víš,
   kdo co udělal" prodává líp než „zakázali jsme druhé zařízení".

Pokud se sdílení účtů někdy ukáže jako reálný problém, jde to řešit
mírněji a v tomhle pořadí:

- [ ] **Vidět, ne blokovat** – v Nastavení ukázat aktivní relace
      („Tomáš: 3 zařízení"). Majitel servisu si to pořeší sám.
- [ ] **Měkký strop** – povolit 3 zařízení na uživatele, nejstarší
      relace se odhlásí. Model, který používají streamovací služby.
      Supabase Auth má na omezení relací vlastní nastavení – **ověřit,
      jestli je v tvém plánu**, ať to nepíšeš ručně.
- [ ] **Upozornit sebe, ne uživatele** – souběžná aktivita z různých
      IP na jednom účtu jako signál do admin obrazovky.

**Teď nedělat nic z toho.** Je to preventivní řešení problému, který
jsi zatím neviděl. Až přijde první servis, kde na jednom účtu jede
zjevně víc lidí, budeš vědět, jak často se to děje a jestli se to vůbec
vyplatí řešit.

---

## 8. Testování

- [ ] Celé to postavit **ve Stripe test mode** s testovacími kartami.
- [ ] `stripe listen --forward-to` proti lokálním funkcím – jinak
      webhook neodladíš.
- [ ] Projít scénáře: první platba, obnova, změna plánu nahoru i dolů,
      zrušení, odmítnutá karta, vypršení, slevový kód, dvojitý webhook,
      webhook mimo pořadí, platba bez návratu do aplikace.
- [ ] **Testovací karta pro selhání** (`4000 0000 0000 0341`) – ověřit,
      že `past_due` opravdu vede k varování a ne k tichému vypnutí.
- [ ] Ověřit, že po vypršení **serverové kontroly opravdu drží** –
      zavolat `sms-send` přímo, s propadlým nárokem.

---

## 9. Právní a účetní

- [ ] **Obchodní podmínky** – automatická obnova, výpovědní podmínky,
      dostupnost služby, omezení odpovědnosti, co se stane s daty po
      ukončení.
- [ ] **Zpracovatelská smlouva (GDPR)** – v Jobi jsou jména, telefony a
      adresy zákazníků těch servisů. Vůči servisům jsi **zpracovatel**.
      Součástí musí být seznam subdodavatelů: Supabase, Twilio, Resend,
      nově Stripe.
- [ ] **Fakturace vlastním modulem** (rozhodnuto v B6). Stripe český
      doklad nevystaví. Použije se stávající fakturační modul – jako
      neplátce DPH jde o jednoduchý doklad bez daně. **Pozor na
      samostatnou číselnou řadu a vlastní firemní údaje**, ten modul je
      psaný pro fakturaci servisu jeho zákazníkům. K revizi (Fakturoid),
      až se staneš plátcem DPH.
- [ ] **Autorská práva neregistruješ** – k softwaru vznikají automaticky
      okamžikem vytvoření, žádný rejstřík v ČR neexistuje. Co ale ohlídat:
      pokud ti na kódu dělal externista/OSVČ, práva zůstávají **jemu**,
      dokud nemáš licenční smlouvu. U zaměstnance je to zaměstnanecké
      dílo a je to v pořádku. Provalí se to až při prodeji firmy.
- [ ] **Ochranná známka „Jobi"** u ÚPV – autorské právo název nechrání,
      jen kód. Nejdřív rešerše, jestli je volný.
- [ ] **Licence závislostí** – React, Tauri i Supabase klient jsou
      MIT/Apache, ke komerčnímu prodeji v pořádku. Hlídat, ať do
      `package.json` nepřistane GPL/AGPL. Přiložit soubor s licencemi
      třetích stran.
- [ ] **Identifikovaná osoba k DPH** – viz sekce Daně níž. Tohle je u
      neplátce nejčastěji přehlédnutá povinnost.

---

## 10. iOS – zatím se neřeší

**iOS appka je mockup a není veřejná (C4), takže tahle sekce je
neaktuální.** Platí od chvíle, kdy by měla jít do App Store – a pak je
to největší past celého předplatného, proto zůstává sepsaná.

- [ ] **Apple u digitálního předplatného odemykaného v iOS aplikaci
      obecně vyžaduje in-app purchase** a bere si podíl (30 %, resp.
      15 % v Small Business Program).
- [ ] **Obrana:** prodávat výhradně na webu a v desktopu, iOS appka jen
      přihlašuje – žádné ceny, žádné tlačítko koupit, žádný odkaz na
      ceník. Standardní postup u B2B nástrojů.
- [ ] Pravidla se v poslední době měnila (EU/DMA, odkazy ven).
      **Ověřit aktuální znění App Store Review Guidelines před submitem** –
      tohle je nejčastější důvod zamítnutí u aplikací s předplatným.
- [ ] Desktop (Tauri) a web žádný podíl neplatí, tam jde Stripe napřímo.

---

## 11. Verze Jobi pro další obory (zubaři, mechanici, …)

Záměr: prodávat Jobi i mimo servis elektroniky – autoservisům,
zubařům, servisům kol, elektrikářům. Datový model je totiž pořád stejný:
**přijmu zakázku od zákazníka, něco na ní udělám, vydám doklad.**

### Jak to udělat

Tři cesty, dvě z nich jsou slepé:

- ❌ **Samostatná aplikace na každý obor.** Každá oprava se dělá
  třikrát, každý obor se rozejde. Při jednom vývojáři neudržitelné.
- ❌ **Úplně obecný stavitel vlastních polí.** Maximum flexibility,
  maximum práce, a zákazník dostane prázdnou appku, kterou si musí sám
  nastavit. Přesně to, čím se Jobi liší od konkurence, by zmizelo.
- ✅ **Obor jako data, ne jako kód.** Jedna aplikace, jedna codebase.
  Obor je profil: slovník názvů + přednastavená pole + statusy +
  šablony dokumentů + ceník. Nový obor = nový řádek v konfiguraci,
  ne nová větev v Gitu.

### Co se podle oboru mění a co ne

Tohle je to hlavní rozhodnutí. „Jedna appka, která se mění podle oboru"
zní jednoduše, ale záleží na tom, **co přesně** se mění:

| Mění se (data – levné) | Nemění se (kód – drahé) |
|---|---|
| Názvy (zakázka / návštěva) | Rozložení obrazovek |
| Která pole se ukazují | Navigace a sidebar |
| Statusy | Workflow – přijmu, udělám, vydám doklad |
| Sady dokumentů | Komponenty |
| Ceník a přednastavené úkony | Moduly a jejich chování |
| Landing page a screenshoty | |

**Rozložení se podle oboru měnit nemá.** Každý obor s vlastním layoutem
znamená N× UI na údržbu a testování – a ty layouty by se stejně skoro
nelišily. Formulář zakázky je formulář zakázky, ať do něj píšeš iPhone
nebo Octavii. Liší se popisky a pole, ne uspořádání.

Pozor, tohle **neplatí pro velké oborové funkce**, které ostatní obory
vůbec nemají (zubní kříž) – ty jsou samostatný modul a mají vlastní
podsekci níž. Pravidlo se týká sdílených obrazovek: ty se neforkují.

**Funkce podle oboru nezapínat vůbec.** Tu osu už řeší
`service_entitlements` – moduly zapíná *plán*. Kdyby je zapínal i obor,
vznikne kombinatorika („co má dental + profi?"), která se nedá
rozumně otestovat. Obor určuje jen to, co je při založení předvybrané.

**Seedovat, ne odkazovat.** Statusy, dokumenty a ceník se při založení
servisu **zkopírují** do jeho vlastních tabulek – přesně jak to dnes
dělá `statuses-init-defaults`. Zákazník si je pak upraví po svém a ty
můžeš předlohu později změnit, aniž bys komukoli přepsal nastavení.
Slovník názvů se naopak čte živě z konfigurace, protože ten zákazník
needituje a překlep chceš opravit všem naráz.
**Pravidlo: co zákazník upravuje, se kopíruje. Co neupravuje, se čte živě.**

**Sloupec recykluj jen tehdy, když sedí význam, ne tvar:**

| Sloupec | Autoservis | Proč |
|---|---|---|
| `device_brand` | Značka (Škoda) | stejný význam ✅ |
| `device_model` | Model (Octavia) | stejný význam ✅ |
| `device_serial` | VIN | VIN *je* výrobní číslo ✅ |
| `device_imei` | skrýt | IMEI je telekom, SPZ není sériové číslo ❌ |
| `device_passcode` | skrýt | ❌ |
| `custom_fields` | SPZ, stav tachometru | nová pole |

SPZ se do `device_imei` vejde, ale mění se v čase a není to identifikátor
vozu. Vrátí se to při prvním filtru nebo exportu přes veřejné API.

### Co tomu dnes stojí v cestě

Prošel jsem repo, tohle jsou konkrétní místa, která je potřeba rozmotat:

- [ ] **~400 natvrdo napsaných českých názvů v `.tsx`** („Zakázka",
      „Zařízení", „Servis"). Pro zubaře je to „Návštěva" a „Pacient",
      pro autoservis „Zakázka" a „Vozidlo". Potřebuje to slovníkovou
      vrstvu – hook `useTerms()` a slovník na obor. **Tohle je největší
      kus práce z celé sekce.**
- [ ] **`tickets.device_brand / device_model / device_serial /
      device_imei / device_passcode`** jsou sloupce ušité na elektroniku.
      Autoservis potřebuje SPZ, VIN a stav tachometru.
      **⚠️ Nepoužívej `device_imei` na SPZ.** Je to lákavé a ušetří to
      migraci, ale za rok nikdo nebude vědět, co v tom sloupci je, a
      rozbije se to při prvním exportu, filtru nebo veřejném API.
      Správně: nechat `device_*` pro elektroniku a přidat
      `custom_fields jsonb` s definicí polí na obor.
- [ ] **`document_profiles.doc_type` má CHECK jen na tři hodnoty**
      (`zakazkovy_list`, `zarucni_list`, `diagnosticky_protokol`) – viz
      `20260208100000_create_document_profiles.sql`. Stejný výčet je
      podruhé v `DocTypeKey` v `jobidocs/src/documentToHtml.ts`. Každý
      nový dokument znamená sáhnout na obě místa.
- [ ] **Dokumenty samotné jsou oborové.** Záruční list a diagnostický
      protokol zubař nepotřebuje – potřebuje informovaný souhlas.
      Autoservis chce protokol o převzetí vozidla a zakázkový list s VIN.
- [ ] **`DEFAULT_STATUSES` v `statuses-init-defaults`** („Diagnostika",
      „Oprava", „Testování") – zubař má objednán / ošetření / kontrola.
      Tohle je naštěstí ta snadná část: statusy už jsou data v databázi
      per servis, stačí jiná výchozí sada.
- [ ] **Ceník a `deviceOptions`** – přednastavené úkony a stavy zařízení
      na obor.

### Kroky

- [ ] **Přidat `services.vertical`** (`repair` / `auto` / `dental` / …)
      a `plans.vertical` (NULL = plán platí pro všechny obory).
      **Tohle udělej hned v první migraci předplatného**, i když
      slovníkovou vrstvu odložíš – přidat sloupec dopředu stojí nic,
      doplňovat obor tisícovce servisů zpětně stojí odpoledne.
- [ ] **Tabulka `verticals`** nebo konfigurační soubor v kódu: název
      oboru, slovník názvů, výchozí statusy, definice polí, sady
      dokumentů, výchozí ceník. *Doporučení: začít souborem v kódu*,
      dokud jsou obory dva tři. Databáze až ve chvíli, kdy budeš chtít
      obor přidávat bez releasu. Zhruba:

      ```ts
      // src/lib/verticals.ts
      export type VerticalKey = "repair" | "auto" | "bike";

      type Vertical = {
        key: VerticalKey;
        name: string;                    // "Autoservis"
        terms: { ticket: string; device: string; /* … */ };
        hiddenFields: string[];          // ["device_imei", "device_passcode"]
        fieldLabels: Record<string, string>;  // { device_serial: "VIN" }
        customFields: FieldDef[];        // SPZ, stav tachometru
        defaultStatuses: StatusDef[];    // seed při založení
        documents: DocTypeKey[];         // seed při založení
        catalogPreset: CatalogItem[];    // seed při založení
      };
      ```
- [ ] **`useTerms()` hook** a postupné nahrazování natvrdo psaných
      názvů. Nedělej to najednou – projdi obrazovku po obrazovce.
- [ ] **Výběr oboru při registraci** → do `metadata.vertical` v
      checkoutu (sekce 6) → webhook podle něj nasype statusy, profily
      dokumentů a ceník. Zákazník tak dostane appku, která jeho oboru
      rozumí od první minuty.
- [ ] **Rozšířit CHECK u `doc_type`** a `DocTypeKey` o dokumenty
      nových oborů.
- [ ] **Landing page na obor.** Prakticky nejdůležitější bod celé
      sekce: autoservis nekliká na „software pro servisy", klikne na
      „software pro autoservisy". Stejná aplikace, jiný nadpis a jiné
      screenshoty. Tady se rozhoduje, jestli se to prodá.
- [ ] **Sub-značky JobiAuto / JobiDent** (D2) – jako marketingové
      názvy nad jedním produktem, ne jako tři samostatné produkty.
      Landing page na doméně oboru vede do téže aplikace, která se
      v hlavičce představí podle `services.vertical`.

### Co když obor potřebuje velkou vlastní funkci (zubní kříž)

Pravidlo „nemění se rozložení" výš neznamená, že obor nesmí mít vlastní
funkci. **Zubní kříž není varianta existující obrazovky – je to nová
funkce, kterou ostatní obory nemají.** To je jiná kategorie a je v
pořádku. Rozdíl:

- ✅ **Oborový modul** – samostatná obrazovka nebo sekce, vlastní složka,
  vlastní data. Zubní kříž, parodontogram.
- ❌ **Fork sdílené obrazovky** – `if (vertical === "dental")` rozeseté
  po `Orders.tsx`. Tudy vede cesta ke třem aplikacím v jedné.

**Mechanismus na to už existuje.** V `src/App.tsx` (řádky 731 a 783) se
celá stránka Faktury schovává podle `invoicesAvailable`, což je nárok ze
`service_entitlements`. Zubní kříž je přesně totéž: `module =
'dental_chart'`, který uděluje jen dentální plán. Žádná nová vrstva.

Na co si dát pozor:

- [ ] **Zubní kříž patří k pacientovi, ne k zakázce.** Stav chrupu je
      longitudinální – žije napříč návštěvami a každá návštěva do něj
      zapíše změnu. Vlastní tabulka vázaná na zákazníka plus historie
      zásahů, **ne `jsonb` sloupec v `tickets`**. Současný model věší
      všechno na zakázku a přesně tady to přestává platit. Opravovat
      se to bude draho.
- [ ] **Lazy loading.** V `src` dnes není jediný `React.lazy`, všechno
      je v jednom bundlu. U jedné oborové funkce navíc to nevadí, u tří
      stahuje autoservis půl megabajtu zubařiny. První takový modul ať
      je rovnou `React.lazy` + `Suspense`.
- [ ] **Slot, ne podmínka.** Detail zakázky vystaví pojmenované
      rozšiřující body, obor si do nich zaregistruje komponentu.
      Hranice: `vertical` se smí objevit ve složce oboru a při montáži
      slotů, **ne ve sdíleném kódu**.

### Test, jestli je to ještě obor, nebo už druhý produkt

Architektura velkou oborovou funkci unese. Důležitější otázka je, jestli
se vyplatí – a tady je jednoduché měřítko:

**Kolik obrazovek je sdílených?**

- **nad ~70 %** → je to obor Jobi, udělej to jako modul
- **pod ~50 %** → není to obor, ale **druhý produkt sdílející backend**;
  plánuj a oceňuj ho tak, místo aby ses ho snažil vecpat do jedné appky

**Cykloservis vyjde kolem 98 %, autoservis kolem 95 %** – proto padla
volba na cykloservisy (D1). Zároveň platí, že tak blízký obor
slovníkovou vrstvu skoro neprověří: je to levný test, že koncept
funguje, ne test, že je navržený dobře.

U zubařů to po započtení všeho vypadá spíš na to druhé:

- zubní kříž a parodontogram = týdny práce, prodejné jednomu oboru,
- **vyúčtování pojišťovnám** (VZP a spol.) = nejspíš větší subsystém
  než ten kříž,
- k tomu právní režim zdravotních dat (níž).

Objednávkový kalendář naopak máš (`src/pages/Calendar.tsx`), ten je
sdílený.

### ⚠️ Zubaři jsou jiná liga

Tohle není detail, který se dořeší cestou:

- **Zdravotní údaje jsou zvláštní kategorie osobních údajů** podle čl. 9
  GDPR. Režim je výrazně přísnější než u jmen a telefonů, které v Jobi
  jsou dnes – jiný právní titul, jiné zabezpečení, jiné dopady průšvihu.
- **Zdravotnická dokumentace je regulovaná zákonem** (372/2011 Sb.):
  povinný obsah, skartační lhůty, pravidla pro nahlížení a předávání.
  Není to „zakázka s jiným názvem".
- **Prakticky to znamená** zvážit, kde data leží (Supabase region),
  šifrování, auditní log přístupů, smlouvy – a nejspíš právníka na
  zdravotnické právo, ne jen na obchodní podmínky.

**Doporučení: začni řemesly, ne zubaři.** Autoservis, servis kol,
elektrikář, opravna spotřebičů – ty jsou strukturálně totožné s tím, co
Jobi umí dneska, a ověříš na nich celý koncept oborů za zlomek práce.
Zdravotnictví si nech až na dobu, kdy budeš mít z předplatného příjem,
ze kterého zaplatíš právní část.

### Kdy do toho jít

**Ne teď.** Nejdřív předplatné, protože bez příjmu je jedno, kolik máš
oborů. A hlavně: nestav abstrakci pro druhý obor, který zatím
neexistuje – slovníková vrstva postavená bez skutečného druhého oboru
bude skoro jistě špatně navržená.

Co udělat hned, protože je to zadarmo:

1. `services.vertical` a `plans.vertical` do první migrace předplatného.
2. Přestat přidávat nové natvrdo psané názvy – u nového kódu rovnou
   slovník.

Zbytek až ve chvíli, kdy budeš mít prvního reálného zájemce z jiného
oboru. Ten ti taky řekne, co doopravdy potřebuje – líp než jakýkoli
odhad dopředu.

---

## Kolik ti z předplatného zůstane

Stripe v ČR, orientačně (**ceny ověř na aktuálním ceníku, mění se**):

| Položka | Sazba |
|---|---|
| Karta vydaná v EHP | ~1,4 % + 6 Kč |
| Karta mimo EHP | ~2,9 % + 6 Kč |
| Stripe Billing (opakované platby) | +0,5 % |
| Převod měny | +2 % |
| Chargeback | ~400 Kč |

**Modelový výpočet, evropská karta:**

| Cena plánu | Poplatek | Zůstane ti | % |
|---|---|---|---|
| 290 Kč / měsíc | 11,51 Kč | 278,49 Kč | 96,0 % |
| 490 Kč / měsíc | 15,31 Kč | 474,69 Kč | 96,9 % |
| 990 Kč / měsíc | 24,81 Kč | 965,19 Kč | 97,5 % |
| 9 900 Kč / rok | 194,10 Kč | 9 705,90 Kč | 98,0 % |

Zhruba tedy **96–98 %**. Dvě věci z té tabulky stojí za pozornost:

1. **Fixních 6 Kč bolí u levných plánů.** U 290 Kč je fixní část polovina
   poplatku. Čím nižší cena, tím horší poměr.
2. **Roční platba je výrazně lepší.** Jedna transakce místo dvanácti =
   ušetříš 11× fixní poplatek. U 990 Kč měsíčně zaplatíš za rok 298 Kč na
   poplatcích, u roční platby 194 Kč. Plus žádné odmítnuté karty během roku.

Pro představu: **10 servisů po 990 Kč měsíčně = 118 800 Kč ročně hrubě,
po poplatcích ~115 800 Kč.**

---

## Když to budeš mít na živnost jako neplátce DPH

Tohle si nech potvrdit od účetní, ale tady jsou body, které tě čekají:

- **Živnost volná**, obor č. 56 (poskytování software a poradenství v
  oblasti IT). Nic speciálního.
- **Zákazníkům fakturuješ bez DPH.** Vystavuješ doklad, ne daňový
  doklad. Pro tvoje zákazníky (většinou plátci) to není nevýhoda – cenu
  zaplatí stejnou, jen si nic neodečtou, protože tam žádné DPH není.
- **Limit pro povinné plátcovství** je od roku 2025 **2 000 000 Kč** za
  kalendářní rok (a při překročení ~2 536 500 Kč se stáváš plátcem
  okamžitě). Ověř aktuální čísla, měnila se nedávno.
- **⚠️ Staneš se identifikovanou osobou k DPH.** Tohle je ta přehlížená
  věc: Stripe fakturuje z Irska (Stripe Payments Europe). Jakmile
  přijmeš službu od firmy z jiného členského státu, musíš se do **15 dnů**
  registrovat jako **identifikovaná osoba** a odvést 21 % DPH z těch
  poplatků (reverse charge) – **bez nároku na odpočet**.
  - Identifikovaná osoba **není plátce DPH.** Svým zákazníkům dál
    fakturuješ bez DPH. Odvádíš jen DPH z přijatých zahraničních služeb.
  - **Spouští to i Supabase, Twilio, Resend a Apple** – takže tuhle
    povinnost s velkou pravděpodobností máš už dneska, i bez Stripu.
    Za tohle se dávají pokuty, stojí za to to prověřit hned.
  - Prakticky: z poplatku 24,81 Kč odvedeš dalších ~5,21 Kč. Z 990 Kč ti
    tak zůstane ~960 Kč místo 965 Kč. **Zhruba 97 %.**
  - Přiznání k DPH podáváš jen za měsíce, kdy nějaké plnění nastalo –
    u Stripu tedy každý měsíc.
- **Prodej do zahraničí:** firmě v EU s platným VAT ID = reverse charge
  a povinné **souhrnné hlášení**. Spotřebiteli v EU = režim **OSS**
  (limit 10 000 EUR ročně napříč EU).
- **Paušální daň** by měla jít i pro identifikovanou osobu, ale tohle si
  ověř s účetní – je to podmínka, která se měnila.
- **EET neřešíš**, evidence tržeb je zrušená.

---

## Doporučené pořadí prací

1. Dorozhodnout zbytek sekce 0 – hlavně **limity členů (A3)**, protože
   bez nich nemá `plans` co obsahovat.
2. Migrace: `plans`, `service_billing`, `billing_events`, `source` u
   nároků – a rovnou `services.vertical` + `plans.vertical` (sekce 11),
   i když se obory budou dělat až později.
3. `stripe-webhook` + `billing-checkout` v test mode. Nejdřív jen
   upgrade existujícího servisu – jednodušší než zakládání nového.
4. Sekce Předplatné v Nastavení a napojení `useEntitlements`.
5. Limity členů (server i UI).
6. Samoobslužné založení servisu po platbě.
7. Slevové kódy.
8. Fakturace (Fakturoid), obchodní podmínky, DPA.
9. Teprve pak ostrý provoz.

Body 1–4 jsou minimum, se kterým se dá začít prodávat. Zbytek se dá
dodělávat za pochodu – kromě sekce 9, kterou je potřeba mít hotovou
dřív, než přijde první platba.

Sekce 11 (obory) je záměrně až za tím vším. Výjimkou jsou dva sloupce
`vertical` z bodu 2 – ty stojí nic a ušetří pozdější migraci.
