# Den D: spuštění plateb

Návod pro člověka, který Stripe nikdy neviděl. Kód na platby je hotový
a otestovaný (70 testů v `src/lib/billingWebhook.test.ts`), edge funkce jsou
nasazené a do spuštění odpovídají „Platby zatím nejsou spuštěné“. Chybí jediné:
**účet u Stripe a nastavení v něm.**

Počítejte s půlhodinou klikání a další půlhodinou na zkoušku. Nic z toho se
nedělá v kódu.

- Postup nastavení: kapitoly 1–7.
- Zkouška v testovacím režimu, včetně návratu zpět: kapitola 8.
- Přepnutí naostro: kapitola 9.
- Co se stane, když zákazník nezaplatí, zruší, chce fakturu…: kapitola 10.

Souvislosti (co je `service_entitlements`, proč se nikde neopisují ceny) jsou
v `docs/STRIPE.md`. Tady je jen postup.

---

## 0. Co rozhodnout, než otevřete Stripe

Tohle za vás nikdo neudělá a bez toho se ceny do Stripe zadat nedají.

| # | Otázka | Proč to nejde odložit |
|---|---|---|
| 1 | **Roční cena balíčku SMS** (`jobi_sms_addon_yearly`) | Ceník na webu uvádí jen měsíční 199 Kč. Sleva 15 % z 12 × 199 dává 2 029,80 Kč, tedy nejspíš **2 030 Kč**. Bez rozhodnutí nejde roční Starter s SMS vůbec koupit – Checkout vrátí chybu „chybí cena s lookup key“. |
| 2 | **Roční cena pobočky navíc** (`jobi_branch_addon_yearly`) | Totéž: měsíčně 490 Kč, po slevě **4 998 Kč**. Bez ní se nedá koupit roční Business ani Enterprise s pobočkou navíc. |
| 3 | **Enterprise „od 2 490 Kč“** | Ve Stripe musí být konkrétní číslo. Doporučení: založit cenu na 2 490 Kč a větším sítím dávat individuální cenu vlastní cenou nebo slevovým kódem (Checkout je má zapnuté). Web pak nelže. |
| 4 | **DPH** | Ceník na webu tvrdí „nejsme plátci DPH, ceny jsou konečné“. Obchodní podmínky mají na tom místě `[je / není – doplňte]`. Buď se doplní „není“, nebo se musí přepsat ceník i zapnout Stripe Tax. |
| 5 | **Kdo vystaví fakturu za předplatné** | Stripe umí doklad sám (viz kapitola 3), nebo se předplatné bude fakturovat z Fakturoidu/iDokladu ručně. Ovlivňuje to jen vaše účetnictví, ne aplikaci. |
| 6 | **Co má Stripe udělat, když platba po opakování neprojde** | Volba je „zrušit předplatné“ nebo „nechat jako nezaplacené“. Aplikace se zachová stejně (přístup zamkne, data nechá), ale první varianta znamená, že se zákazník musí znovu proklikat Checkoutem. Nastavuje se v kapitole 3. |
| 7 | **Platba převodem** | Stripe Checkout je nastavený na kartu. Kdo bude chtít fakturu a převod, vystavíte mu ji ručně a modul zapnete v Owner → Placené moduly. Rozhodněte, jestli to vůbec nabízet. |

---

## 1. Účet u Stripe

1. `dashboard.stripe.com` → registrace, firma, IČO, bankovní účet.
2. Nechte přepínač vlevo nahoře v poloze **Test mode**. Všechno v kapitolách
   2–8 se dělá v testovacím režimu; naostro se přepíná až v kapitole 9.
3. Nastavte měnu účtu na **CZK** (Settings → Business → Bank accounts and
   currencies). Ceny v jiné měně by aplikace zobrazila, ale ceník na webu by
   pak nesouhlasil.

---

## 2. Produkty a ceny

Product catalog → **Add product**. U každého produktu se zakládá cena
(Add price → Recurring). U ceny je pole **Lookup key** – rozklikněte
„More options“, pokud ho nevidíte.

> **Lookup key je jediné, co aplikace zná.** Neopisuje se žádné `price_…` id.
> Když později změníte částku, založíte novou cenu, dáte jí stejný lookup key
> (Stripe nabídne „transfer lookup key“) a v aplikaci se nemění nic.

Doporučené rozdělení: tři produkty (Jobi Starter, Jobi Business, Jobi
Enterprise) po dvou cenách, a dva produkty na příplatky po dvou cenách.

| Produkt | Cena | Období | Lookup key |
|---|---|---|---|
| Jobi Starter | 590 Kč | měsíčně | `jobi_starter_monthly` |
| Jobi Starter | 6 018 Kč | ročně | `jobi_starter_yearly` |
| Jobi Business | 1 490 Kč | měsíčně | `jobi_business_monthly` |
| Jobi Business | 15 198 Kč | ročně | `jobi_business_yearly` |
| Jobi Enterprise | 2 490 Kč | měsíčně | `jobi_enterprise_monthly` |
| Jobi Enterprise | 25 398 Kč | ročně | `jobi_enterprise_yearly` |
| Balíček 100 SMS | 199 Kč | měsíčně | `jobi_sms_addon_monthly` |
| Balíček 100 SMS | rozhodnutí č. 1 (2 030 Kč) | ročně | `jobi_sms_addon_yearly` |
| Pobočka navíc | 490 Kč | měsíčně | `jobi_branch_addon_monthly` |
| Pobočka navíc | rozhodnutí č. 2 (4 998 Kč) | ročně | `jobi_branch_addon_yearly` |

Částky tarifů jsou opsané z ceníku na `web/index.html` (sekce Ceník) a sedí se
slevou 15 % u ročních. Ověří to skript z kapitoly 7 – ten je porovná znovu,
ať se překlep nedostane až k zákazníkovi.

Co který lookup key zapíná, je v `supabase/functions/_shared/stripe.ts`
(tabulky `PLANS` a `ADDONS`). Do Stripe se to nezadává, jen to musí souhlasit
s ceníkem na webu:

| Tarif | Moduly | Poboček v ceně | SMS v ceně |
|---|---|---|---|
| Starter | zakázky, faktury | 1 | 0 (balíček za příplatek) |
| Business | + účetnictví, SMS, pobočky | 1 | 300 |
| Enterprise | + veřejné API, přehled přes servisy | 2 | 600 |

**U obou příplatků zapněte množství** (cena → Advanced → *Allow customers to
adjust quantity*, a k tomu v portálu, viz kapitola 3):

- **Pobočka navíc** – bez toho si servis nekoupí druhou a třetí pobočku.
- **Balíček 100 SMS** – ceník na webu slibuje, že „balíček jde kdykoli
  zvětšit“. Obrazovka Předplatné umí v Checkoutu přidat jen jeden balíček
  (a jen tarifu, který SMS v ceně nemá), takže **druhý a další balíček si
  zákazník přidá jedině v zákaznickém portálu**. Když tam množství nepovolíte,
  slib z ceníku neplatí a musíte ho z webu smazat.

**Nedávejte cenám zkušební období (trial).** Zkušebních 30 dní řeší Jobi samo
při založení servisu; trial ve Stripe by je jen zdvojil.

---

## 3. Zákaznický portál

Settings → Billing → **Customer portal**. Zapnout a povolit:

- **Update payment method** – změna karty.
- **Invoice history** – zákazník si stáhne doklady sám (viz rozhodnutí č. 5).
- **Cancel subscription** – zrušení. Doporučené nastavení *at end of billing
  period*: zákazník dochodí zaplacené období. Aplikace obojí zvládne.
- **Update subscription** – jen pokud chcete, aby si zákazník sám přecházel
  mezi tarify. Když to zapnete, vyberte v seznamu produktů všech šest cen
  tarifů, ať se dá přejít i mezi měsíčním a ročním. **Změnu množství povolte
  u „Pobočka navíc“ i u „Balíček 100 SMS“** – je to jediná cesta, jak si
  zákazník přikoupí další balíček SMS (viz kapitola 2).
- Odkazy na obchodní podmínky (`appjobi.com/obchodni-podminky.html`) a zásady
  ochrany údajů.

Naprogramovat se na tom nemusí nic, aplikace na portál jen odkazuje tlačítkem
v **Nastavení → Firma → Předplatné**.

Ve stejné sekci (Settings → Billing → **Subscriptions and emails**) nastavte:

- **Retries** – kolikrát a kdy zkusit neúspěšnou platbu znovu.
- **Co udělat, když ani poslední pokus neprojde** – rozhodnutí č. 6.
- **E-maily zákazníkovi** o neúspěšné platbě a o končící kartě. Jobi žádné
  upomínky neposílá; když je nezapnete, zákazník se o problému nedozví.

---

## 4. Webhook

Bez webhooku se zaplacené předplatné nikdy nepromění v přístup do aplikace.
Je to jediné místo, kde nároky vznikají.

Developers → **Webhooks** → Add endpoint.

- **Endpoint URL:**
  `https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/billing-webhook`
- **Events to send** – zaškrtnout přesně tyhle čtyři:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Ostatní události nechte být. `checkout.session.completed` funkce jen zaloguje
  (přístup z něj nevzniká, ještě nezná položky předplatného); zaškrtnout ji
  můžete kvůli klidu, nic tím nezískáte ani nepokazíte.
- Po uložení klikněte na **Reveal** u *Signing secret* a zkopírujte hodnotu
  `whsec_…`. Patří do Supabase (kapitola 5) a nikam jinam.

---

## 5. Tajemství do Supabase

Dvě hodnoty, jedno místo. Nikam jinam se neopisují – ani do `.env`, ani do
GitHubu, ani do poznámek.

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_…
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
```

| Proměnná | Kde ji vzít | Kam patří |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → *Secret key* | secrets edge funkcí v Supabase |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → váš endpoint → *Signing secret* | tamtéž |

Funkce `billing-checkout`, `billing-portal`, `billing-prices`
a `billing-webhook` už nasazené jsou (ověřeno 7. 9. 2026: všechny čtyři
odpovídají 503 „Platby zatím nejsou spuštěné“). Když po nastavení tajemství
funkce pořád hlásí 503, přenasaďte je:

```bash
npx supabase functions deploy billing-checkout billing-portal billing-prices
npx supabase functions deploy billing-webhook
```

V aplikaci se nemění nic. Žádná migrace, žádné vydání nové verze: tabulky
`service_billing` i `service_entitlements` existují a obrazovka Předplatné se
sama přepne z „platby zatím nejsou spuštěné“ na ceník, jakmile jí funkce
odpoví cenami.

---

## 6. Klíč pro kontrolu (nepovinné, ale doporučené)

Skript z další kapitoly umí číst ceny a webhooky ze Stripe. Nedávejte mu plný
tajný klíč – Stripe umí **restricted key**:

Developers → API keys → *Create restricted key* → práva **Read** u „Prices“,
„Products“ a „Webhook endpoints“, všechno ostatní *None*. Vznikne klíč
`rk_test_…`, který nic nesvede, ani kdyby unikl.

---

## 7. Kontrola: sedí to?

```bash
npm run platby:kontrola                                  # co jde bez klíče
STRIPE_SECRET_KEY=rk_test_… npm run platby:kontrola      # úplná kontrola
npm run platby:kontrola -- --offline                     # jen soubory, bez sítě
```

Skript **jen čte** – do Stripe pošle dva dotazy (ceny, webhooky), do databáze
nesahá vůbec. Tajemství nikdy nevypíše, ověřuje jen jejich tvar.

Zkontroluje:

1. ceník na webu proti tarifům v kódu (částky, sleva 15 %, počty poboček a SMS
   v ceně);
2. že ve Stripe existuje aktivní cena pro **každý** lookup key, v CZK, ve
   správném období a s částkou z ceníku na webu;
3. že webhook míří na správnou adresu, je zapnutý a má všechny čtyři události;
4. že tajemství existují a mají správný tvar – a hlavně že je vidí i **nasazená
   funkce** (pozná se to podle toho, že `billing-webhook` odmítne nepodepsané
   volání chybou 400 místo 503 „chybí tajemství“).

Bez klíče od Stripe si ceník přečte přes nasazenou funkci `billing-prices`,
takže i tak pozná chybějící cenu. Co ověřit nejde, vypíše jako „?“ i s tím, co
k tomu chybí. Návratový kód 1 znamená nalezený rozpor.

---

## 8. Zkouška naostro (v testovacím režimu Stripe)

Projděte si nákup sám, dřív než ho projde první zákazník. Ve zkušebním režimu
neteče žádné peníze.

> **Nikdy na ostrém servisu.** Zkoušejte na testovacím (`TEST2`,
> `bbc926bd-25ba-4da1-b528-92b6f1dee24d`, nebo vlastní nově založený servis).
> Servisy `d9762a27-…` (iSwap Repair Point) a
> `9a34c559-2af7-4537-9d0e-ce87e5936c4b` (MajkaPajka) jsou ostré – tam se
> nezkouší nic.

### 8.1 Nákup

1. Otevřete **webovou** verzi `https://appjobi.com/servis/` a přihlaste se.
   (Z desktopové aplikace se návrat z Checkoutu chová hůř – Checkout se otevře
   v okně aplikace.)
2. Přepněte se na testovací servis → **Nastavení → Firma → Předplatné**.
   Musí být vidět ceník s částkami; když píše „platby zatím nejsou spuštěné“,
   chybí `STRIPE_SECRET_KEY` (kapitola 5).
3. Vyberte třeba **Business měsíčně** a přidejte **jednu pobočku navíc** – ať
   se zkontroluje i příplatek s množstvím.
4. V Checkoutu zaplaťte testovací kartou `4242 4242 4242 4242`, libovolné datum
   v budoucnu, libovolné CVC a PSČ. Adresu i IČO klidně vyplňte, ověří se tím
   sběr údajů na fakturu.
5. Po zaplacení vás Stripe vrátí zpátky do aplikace s `?predplatne=hotovo`.

### 8.2 Co má být vidět v databázi

Supabase → SQL Editor. Oboje jsou jen dotazy, nic nemění (`SERVIS` nahraďte id
testovacího servisu):

```sql
select status, plan, branches_quantity, current_period_end, cancel_at_period_end,
       stripe_customer_id is not null as ma_zakaznika,
       stripe_subscription_id is not null as ma_predplatne
  from service_billing where service_id = 'SERVIS';
```

Očekává se: `status = active`, `plan = jobi_business_monthly`,
`branches_quantity = 1`, `current_period_end` za měsíc, obojí „má…“ true.

```sql
select module, active, quota, valid_until, note
  from service_entitlements where service_id = 'SERVIS' order by module;
```

Očekává se pět aktivních modulů Business – `access`, `invoices`, `accounting`,
`sms`, `branches` – u všech `active = true` a `valid_until` = konec období
**plus tři dny hájení** (`GRACE_DAYS`). U `branches` musí být `quota = 2`
(jedna v tarifu + jedna dokoupená), u `sms` `quota = 300`.

V aplikaci: na obrazovce Předplatné zmizí proužek zkušebního období a objeví se
„Aktivní · Business“ a datum další platby.

### 8.3 Jak ověřit, že webhook dorazil

1. **Stripe** → Developers → Webhooks → váš endpoint → záložka s událostmi.
   U `customer.subscription.created` musí být odpověď **200**. Když je tam 400
   („Neplatný podpis“), sedí ve Supabase jiné `STRIPE_WEBHOOK_SECRET`, než
   ukazuje tenhle endpoint. Když 503, tajemství tam není vůbec. Tlačítko
   **Resend** událost pošle znovu, až to opravíte – nic se tím nezdvojí,
   webhook jen přepíše nároky na stejnou hodnotu.
2. **Supabase** → Edge Functions → `billing-webhook` → Logs. Řádky
   `[billing-webhook]` ukazují, co se nepovedlo; chyba zápisu vrací schválně
   5xx, aby Stripe událost zopakoval.
3. Nejspolehlivější důkaz je samotná tabulka `service_entitlements` z 8.2 –
   ta se jinak než webhookem nezmění.

### 8.4 Vyzkoušejte i zrušení

Stripe → Customers → váš testovací zákazník → Subscription → **Cancel
subscription** → *immediately*. Do minuty musí být v `service_entitlements`
u všech modulů `active = false` a v aplikaci se objeví zamykací obrazovka
„Zkušební období skončilo“. Data zůstanou; čtení funguje dál, zapisovat nejde
(hlídá to databáze, ne jen aplikace).

### 8.5 Jak to vrátit zpět

1. Ve Stripe zrušte testovací předplatné (pokud ještě běží).
2. **Smažte testovací řádek v `service_billing`.** Tohle nepřeskakujte:
   `stripe_customer_id` z testovacího režimu v ostrém režimu neexistuje, takže
   by servisu přestal fungovat zákaznický portál a Checkout by se pořád vracel
   k neexistujícímu zákazníkovi.

   ```sql
   delete from service_billing where service_id = 'SERVIS';  -- jen testovací servis!
   ```

3. Nároky testovacího servisu vraťte do zkušebního stavu v aplikaci:
   **Owner → Placené moduly** → u servisu udělit `access` (a co potřebujete)
   s datem platnosti. Nebo servis smažte a založte znovu – dostane čerstvých
   30 dní.
4. Testovací data ve Stripe se mazat nemusí, s ostrým režimem nemají nic
   společného.

---

## 9. Přepnutí naostro

1. Ve Stripe dokončete aktivaci účtu (ověření identity, bankovní účet).
2. Přepněte dashboard do ostrého režimu a **znovu založte** produkty a ceny
   z kapitoly 2 – se **stejnými lookup key**. Testovací a ostré ceny jsou dva
   oddělené světy, ale aplikace pozná jen lookup key, takže se nic nepřepisuje.
3. Znovu zapněte zákaznický portál (kapitola 3) – nastavení se z testu
   nepřenáší.
4. Založte ostrý webhook na stejnou adresu se stejnými čtyřmi událostmi
   a zkopírujte nové `whsec_…`.
5. Nastavte ostrá tajemství:

   ```bash
   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_…
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
   ```

6. Ověřte: `STRIPE_SECRET_KEY=rk_live_… npm run platby:kontrola`.
   Skript v souhrnu vypíše, že je klíč v **OSTRÉM** režimu – to je jediná
   kontrola, že jste nezapomněli přepnout.
7. Poslední zkouška: koupit nejlevnější tarif skutečnou kartou na testovacím
   servisu, ověřit podle 8.2, pak ve Stripe vrátit peníze (Refund) a zrušit
   předplatné. Nezapomeňte pak na úklid podle 8.5.

---

## 10. Co se stane, když…

Chování je popsané v testech (`src/lib/billingWebhook.test.ts`), ne odhadnuté.

### Platba selže

- **Aplikace:** Stripe pošle `invoice.payment_failed`, v `service_billing` se
  přepne `status` na `past_due`. **Přístup se nebere** – opožděná platba není
  důvod zavřít dílnu. Na obrazovce Předplatné svítí červené „Po splatnosti“.
  Nároky dál platí do konce zaplaceného období plus tři dny hájení.
- **Vy:** nic. Stripe zkouší platbu znovu podle nastavení z kapitoly 3
  a e-mailuje zákazníkovi. Zavolat mu je slušnost, ne povinnost systému.

### Zákazník zruší předplatné

- **Ke konci období** (výchozí v portálu): přijde
  `customer.subscription.updated` s příznakem `cancel_at_period_end`, uloží se
  do `service_billing`. Do konce zaplaceného období se nemění nic. V den konce
  přijde `customer.subscription.deleted` a přístup končí.
- **Okamžitě:** `customer.subscription.deleted` dorazí hned. Všechny nároky
  z předplatného se vypnou (`active = false`), `plan` a `branches_quantity` se
  vynulují. Ručně udělené nároky z Owner panelu zůstávají – ty patří vám, ne
  Stripu.
- **Data zůstávají.** Aplikace ukáže zamykací obrazovku, čtení a export
  fungují, zápis ne.
- **Vy:** nic. Kdybyste chtěl zákazníka podržet, zapněte mu `access` v Owner →
  Placené moduly s datem platnosti.

### Přechod na nižší tarif

- **Aplikace:** přijde `customer.subscription.updated`, zapíšou se moduly
  nového tarifu a **moduly navíc se vypnou hned**, ne až na konci období.
  Z ročního Enterprise na měsíční Starter tedy znamená, že veřejné API, SMS
  i pobočky přestanou fungovat okamžitě. Kvóty se přepočítají (pobočky na to,
  co dává nový tarif plus dokoupené).
- **Vy:** rozhodnout ve Stripe o poměrné částce (proration). Aplikace na tom
  nezávisí, je to jen otázka, jestli zákazník dostane dobropis.
- **Pozor u poboček:** když má servis založené tři pobočky a přejde na tarif
  s jednou, kvóta klesne. Založené pobočky nezmizí, ale nové nepřibudou.

### Nezaplatí a skončí mu období

- **Aplikace:** předplatné přejde do `unpaid` (nebo `canceled` podle
  rozhodnutí č. 6). Nároky se vypnou **k dnešnímu dni**, tři dny hájení se
  v tomhle stavu nepočítají. Aplikace se zamkne obrazovkou „Zkušební období
  skončilo“ s nabídkou vybrat tarif.
- **Vy:** nic. Když zaplatí později, Stripe pošle `updated` a přístup se
  obnoví sám.

### Chce fakturu

- **Aplikace:** doklady za předplatné nevystavuje a nezná je. Zákazník je
  najde přes tlačítko **Spravovat předplatné** (zákaznický portál Stripe),
  když je v kapitole 3 zapnutá *Invoice history*. Checkout sbírá adresu i IČO,
  takže na dokladu je firma, ne jméno.
- **Vy:** podle rozhodnutí č. 5 – buď stačí doklad ze Stripe, nebo mu
  vystavíte fakturu ve svém účetnictví. **Faktury zákazníků servisu s tímhle
  nemají nic společného**, ty vystavuje Jobi dál a Stripe do nich nevidí.

### Chce vrátit peníze

- **Aplikace:** o vrácení peněz se **nedozví**. Refund posílá události, na
  které webhook není přihlášený, takže nároky zůstanou zapnuté do konce
  zaplaceného období.
- **Vy:** vrácení se dělá ručně ve Stripe (Payments → platba → Refund).
  Když s ním má skončit i přístup, musíte **zvlášť zrušit předplatné** –
  jinak zákazník dostane peníze a aplikaci používá dál. Obchodní podmínky
  přitom říkají, že se poměrná část nevrací; refund je tedy vstřícnost, ne
  nárok.

### Ceny se změní

- **Aplikace:** nikde si je nepamatuje. Založte ve Stripe novou cenu, přeneste
  na ni lookup key, a obrazovka Předplatné i ceník se změní samy. Stávající
  předplatná běží dál za starou cenu, dokud je ve Stripe nepřevedete.
- **Vy:** změnit ceník na webu (`web/index.html`), spustit
  `npm run platby:kontrola` a podle obchodních podmínek oznámit změnu
  30 dní předem.

---

## 11. Když něco nesedí

| Příznak | Kde se dívat |
|---|---|
| Obrazovka Předplatné píše „platby zatím nejsou spuštěné“ | Chybí `STRIPE_SECRET_KEY`, nebo funkce nebyla po nastavení přenasazená. Ověří `npm run platby:kontrola`. |
| Checkout hlásí „Ve Stripe chybí cena s lookup key…“ | Cena neexistuje, není aktivní, nebo má překlep v lookup key. |
| Zaplaceno, ale aplikace zamčená | Webhook. Stripe → Webhooks → poslední události: 200? Když ne, koukněte na kód odpovědi (400 = jiné tajemství, 503 = žádné, 5xx = chyba zápisu, Stripe zkusí znovu). |
| Zrušeno, ale aplikace jde dál | Nároky bez `valid_until` (ručně udělené v Owner panelu) zrušení nevypíná. Odeberte je tam. |
| Servis má dvě předplatná | Vznikly mu dva zákazníci u Stripe. Zrušte jedno předplatné a v `service_billing` nechte to `stripe_customer_id`, které zůstalo. |

Logy: Supabase → Edge Functions → `billing-webhook` / `billing-checkout` →
Logs. Hledejte řádky začínající `[billing-…]`.
