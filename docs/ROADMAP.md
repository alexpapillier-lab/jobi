# Jobi – roadmapa a checklist k prodeji

Sepsáno 4. 9. 2026 po srovnání s MyRepair.app (390–6 990 Kč/měs plus příplatky)
a ZakázkovýList.cz (499 Kč/měs, jen evidence). Cíl: jeden tarif se vším,
1 490–1 990 Kč/měs za servis, bez příplatků za API, uživatele a podporu.

Stav: `[ ]` nezačato · `[~]` rozděláno · `[x]` hotovo

## A. Produkt – co Jobi potřebuje, aby bylo lepší než konkurence

Seřazeno podle toho, kolik času a peněz to servisu ušetří.

1. `[~]` **Zákaznický portál** (kód hotový 4. 9., čeká na nasazení migrace a edge funkce) – odkaz v SMS: stav zakázky, fotky z příjmu,
   cenová nabídka ke schválení jedním klikem s časovým razítkem, podpis
   příjemky prstem, platba předem (QR / brána), potvrzení vyzvednutí.
2. `[~]` **Stavebnice automatizací** (kód hotový 4. 9., čeká na nasazení migrace a funkce) – pravidla „když stav X → šablona Y“ pro
   SMS, e-mail, WhatsApp; upomínky „čeká 7 dní na vyzvednutí“, skladné,
   žádost o recenzi po vydání. Základ (SMS podle stavu) existuje.
3. `[ ]` **Cenová nabídka a schválení** jako první krok opravy – z ceníku,
   odeslat, schválit online, pak práce. Dnes jen „předschválená cena“ v textu.
4. `[~]` **Díly od dodavatele až po marži** (dodavatelé, objednávky, minimum a rezervace hotové 4. 9.; chybí marže ve Statistikách a rezervace z detailu zakázky) – objednávky dílů u dodavatelů,
   rezervace dílu na zakázku, doobjednání pod minimem, marže na opravu
   a na technika. Sklad a vazba díl↔oprava existují, chybí nákupní strana.
5. `[ ]` **Více poboček a lidé** – pobočky s vlastními sklady a číselnou
   řadou, role, čas na opravě, vytížení techniků v Kalendáři, KPI
   (počet, marže, reklamovanost).
6. `[ ]` **Online rezervace** termínu s výběrem opravy z ceníku a předběžnou
   cenou, vložitelná na web servisu (veřejný ceník přes API už je).
7. `[ ]` **Účetnictví a pokladna** – export Pohoda / Money / iDoklad /
   Fakturoid, platební terminál (SumUp, GoPay), denní uzávěrka.
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
- `[~]` Registrace a přihlášení (existuje; chybí onboarding: založení servisu,
  průvodce prvními kroky, demo data, pozvání kolegy).
- `[ ]` Zkušební období (30 dní) a jeho konec: co se stane, když neplatí.
- `[~]` Placené moduly – tabulka `service_entitlements` a Owner panel jsou;
  chybí napojení na platební bránu (Stripe / GoPay) a automatické zapnutí
  a vypnutí po platbě, faktury za předplatné.
- `[ ]` Stránka Předplatné v Nastavení: tarif, další platba, karta, faktury.

### Právní
- `[ ]` Obchodní podmínky a smlouva o zpracování osobních údajů (GDPR) –
  servis je správce, Jobi zpracovatel; seznam subdodavatelů (Supabase,
  SMS brána, e-mail).
- `[ ]` Zásady ochrany osobních údajů na webu, cookie lišta (web měří?).
- `[ ]` Export a výmaz dat servisu na žádost (GDPR) – tlačítko v Owner.
- `[ ]` Právní texty na dokumentech (příjemka, záruční list) zkontrolovat
  právníkem – jsou přepsané, ne převzaté.

### Provoz a bezpečnost
- `[~]` Zálohy DB – ruční skript existuje; potřeba automatické denní zálohy
  mimo Supabase a vyzkoušená obnova.
- `[ ]` Monitoring a alerting – chyby jdou do `error_logs`; chybí upozornění
  (e-mail / Slack) a stavová stránka.
- `[ ]` Audit RLS a edge funkcí před prvním cizím zákazníkem (zejména
  veřejné API, capture-upload, invoice-send-email).
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
- `[~]` appjobi.com – marketingový web existuje; doplnit ceník s jedním
  tarifem, srovnání s konkurencí, screenshoty nové verze, video.
- `[ ]` Nápověda: 10 krátkých článků (příjem, tisk, JobiDocs, SMS, faktury,
  import, tým, API) a odkaz „Nápověda“ v aplikaci.
- `[ ]` Podpora: e-mail, reakční doba, kdo ji drží; formulář „Nahlásit chybu“
  v aplikaci s automatickým přiložením logu.
- `[ ]` Import z konkurence jako služba při přechodu (bod A10).
- `[ ]` Pilot: 3 cizí servisy zdarma za zpětnou vazbu, teprve pak ceník.
- `[ ]` Fakturace zákazníků Jobi (kdo vystavuje, DPH, měsíční / roční).
