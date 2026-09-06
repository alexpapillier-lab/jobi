# TODO – seřazeno podle priority a složitosti

---

## 🔴 Jen pro majitele – tohle za tebe nikdo neudělá (6. 9. 2026)

Tři věci z revizí, na které nemá programátor dosah, protože potřebují buď
tvoje údaje, nebo tvůj účet.

- **Doplnit údaje provozovatele do právních textů.** Všechny tři stránky jsou
  živé na appjobi.com a mají v sobě nevyplněné hranaté závorky i redakční
  poznámku „Než texty zveřejníte…“, kterou vidí každý návštěvník. Servis,
  který zvažuje předplatné, tak nezjistí, s kým uzavírá smlouvu, a
  zpracovatelská smlouva neidentifikuje zpracovatele.
  - `web/obchodni-podminky.html` – datum účinnosti; jméno nebo obchodní firma,
    IČO, sídlo; rejstřík; a **„Poskytovatel [je / není] plátcem DPH“** (ceník
    na hlavní stránce už tvrdí, že nejsi plátce – musí to sedět).
  - `web/ochrana-osobnich-udaju.html` – datum, jméno/firma, IČO, sídlo, rejstřík.
  - `web/zpracovani-udaju.html` – totéž. Navíc doplnit, že se při úkonech na
    portálu ukládá IP adresa a prohlížeč zákazníka (dnes se ukládají, ale
    v textech nejsou), a stanovit dobu uchování.
  - Po doplnění smazat žlutý redakční rámeček nahoře na všech třech stránkách.
  - Obchodní podmínky mají v čl. 7 větu o prioritní podpoře, ale ta se z ceníku
    vypustila (v produktu ji nedrží nic). Buď větu smazat, nebo podporu
    definovat konkrétní lhůtou a vrátit ji do ceníku.

- **Vydat instalátory.** Poslední vydání na GitHubu neobsahuje ani jeden
  instalátor, jen aktualizační balík Tauri a doprovodné soubory. Tlačítka
  „Stáhnout“ na webu proto nemají co nabídnout (od 6. 9. to aspoň řeknou
  nahlas místo tichého přesměrování na GitHub).
  - **Jobi / macOS** – `.dmg`, název začínající „jobi“ a bez „jobidocs“.
  - **Jobi / Windows** – `.exe` (NSIS). Pozor: `src-tauri/tauri.conf.json` má
    `bundle.targets: "app"`, takže build dnes `.dmg` ani Windows instalátor
    nevyrábí. Samotné `.msi` web nenajde, hledá `.exe`.
  - **JobiDocs / macOS** – `JobiDocs-<verze>-universal.dmg` (dnes se do vydání
    nahrály jen `.blockmap` bez samotného `.dmg`).
  - **JobiDocs / Windows** – `JobiDocs-Setup-<verze>.exe`.
  - Web hledá soubory v posledním **ne**-předvydání; `jobidocs-v0.3.5` je
    předvydání, takže ho `/releases/latest` přeskakuje.

- **Přenasadit Cloudflare Worker `jobi-api-worker`.** Nasazená verze nezná
  cestu `/v1/booking`, kterou zdroj v `infra/cloudflare/jobi-api-worker.js`
  má. Rezervační formulář proto tluče přímo na origin: každé zobrazení
  stránky s widgetem = dva dotazy do databáze, bez limitu a bez cache. Je to
  jediné veřejné rozhraní bez stropu (viz `docs/ZATEZ.md`). Při té příležitosti
  zvednout `X-Jobi-Verze`, ať se příště pozná, že nasazená verze neodpovídá
  zdrojáku.

---

## 🟠 Vysoká priorita – relativně snadné

- **SMS nefungují – Twilio číslo už není platné** (2. 9. 2026)
  - Zařídit nové číslo přes `sms-provision`, nebo obnovit stávající u Twilia.
  - **Pozor na nesoulad dat:** `service_phone_numbers.active` je nejspíš
    pořád `true`, i když číslo u Twilia neexistuje. Aplikace tak SMS modul
    ukazuje jako funkční a chyba se projeví až při odeslání. Při řešení
    ověřit, že stav v DB odpovídá skutečnosti.
  - Do té doby nejde ověřit, že edge funkce dosáhne na `has_entitlement()`
    pod `service_role`. Stejnou cestou jde ale **odeslání faktury e-mailem**
    (`invoice-send-email`), které používá tutéž kontrolu.

- v Tým a přístupy zobrazit fotku a nick uživatelů (teď jen email)
- pridat dropdown pod status zakazky „print“, ktery rovnou vytiskne nejaky z vybranych dokumentu – je potreba dodelat u reklamaci, a jeste reklamace at maji v tech ruznych stylech zobrazenich stejne velikosti jak klasicke zakazky
- debug v nastaveni – zobrazovat serviceId, ticketId atd. – castecne myslim

---

## ✅ Hotovo 6.–7. 9. 2026

Kvůli přehledu, ať se to nezkouší podruhé. Podrobnosti jsou v historii commitů.

- **Ztráta dat mezi aplikací a databází**: fronta neuložených změn, sloučení
  souběžných úprav, opakování zápisů u zakázek, zákazníků, reklamací, nabídky,
  kalendáře, skladu a ceníku. Fronta si dřív odškrtávala i zápisy, které se
  nikdy nestaly (PostgREST vrací 204 i na update, který nesedl na žádný řádek).
- **Výkon**: seznam zakázek u servisu se 4 800 zakázkami 2 505 → 520 ms do
  prvního řádku, 6 444 → 2 044 ms do konce; pět indexů; sklad četl produkty
  bez stránkování a nad 1 000 položkami o zbytek tiše přišel.
- **Testy**: 867 jednotkových, ~150 E2E (Chromium), 8 v Safari a Firefoxu,
  38 nad spuštěným JobiDocs, 158 sond na oprávnění. Databáze jde postavit
  od nuly (`npm run test:migrace`).
- **Platby**: osm oprav ve webhooku a checkoutu (viz `src/lib/billingWebhook.test.ts`).
- **Přístupy**: majitel aplikace je skrytým členem každého servisu; servis bez
  členství se už netváří jako prázdný.

---

## 🟡 Stredni priorita – stredni narocnost

- ve smazanych zakazkach ukazat, jaky user zakazku smazal – to mame?
- umoznit presunuti / zmenu pozice sidebaru
- ~~reseni kdyz se ztrati pripojeni~~ – **hotovo 6.–7. 9. 2026**: neuložené
  změny čekají ve frontě (`src/lib/frontaZapisu.ts`), samy se odešlou a je
  o nich vidět proužek i na přihlašovací obrazovce; pokryto sadami
  `e2e/spolehlivost.spec.ts` a `e2e/vypadky.spec.ts`.

---

## 🟢 Dalsi – vetsi scope

### Registrace a pristupy

- zkontrolovat login, registracni logiku a zvani novych clenu

### Zakazky a dokumenty

- Pridani dalsiho zarizeni pri zakladani zakazky
- duvod slevy

### Sklad a zarizeni

- historie produktu – u jake zakazky, kdo manualne vzal nebo naskladnil
- tisk stavu skladu
- api na opravy a sklad

### Komunikace a hodnoceni

- sms komunikace se zakaznikem
- pridani QR na hodnoceni servisu
- pridat ke QR kodu otaznik s navodem, jak vytvorit QR kod firmy – to uz mame? v jobidocs

### Infrastruktura a dokumentace

- jake jsou limity aplikace
- Jak vyresit 2 a vice pobocek
- na jakych verzich macOS ma appka fungovat
- Projit komplet vse co se tyka db – aby servisy neprisly o data pri zmene – to by melo byt ok.

### UX a obecne

- po prvnim prihlaseni – nastaveni UI vzhledu – ano, rovnou v pruvodci idealne?
- **„Tabs“ pro otevřené zakázky** – při kliknutí mimo (ne Zavřít/uložit) minimalizovat do záložek jako v prohlížeči; místo na okně pro „otevřené zakázky“, přepínání mezi nimi
- **Potvrzení při zavření s neuloženými změnami** – jednodušší varianta: klik mimo + dirty = „Zahodit změny?“ confirm
- **Tmavý režim** – přepínač v Nastavení
- **Rychlé přidání ze schránky** – Cmd+V do pole IMEI/SN
- **Kopírovat odkaz na zakázku** – pro sdílení mezi kolegy (jobiapp://order/xxx)

### Produktivita

- **Štítky na zakázkách** – urgentní, čeká na díly, VIP
- **Interní poznámky** – komentáře jen pro tým (ne pro zákazníka)
- **Checklist u zakázky** – odškrtávací úkoly (záloha dat, kontrola IMEI…)
- **Čas u zakázky** – čas zahájen/dokončen nebo stopky

### Zákazníci

- **Historie zákazníka** – všechny zakázky, celková částka
- **Export zákazníků** – CSV/Excel pro mailingu

### Hromadné operace

- **Vícenásobný výběr** – změna stavu, tisk, mazání více zakázek najednou
- **Tisk vybraných** – vybrané zakázky na jeden dokument

### Mobil / foto

- Nahravat fotky do diagnostiky z telefonu
- **Offline fronta fotek** – nahrají se po připojení
- **Skenování čárového kódu** – na mobilu skenovat SN/IMEI, předvyplnit zakázku

### Specialni

- Vykup s checkerem SN

---

## 🔵 Inspirace MyRepair.app – chybi v Jobi

*(Podle [myrepair.app](http://myrepair.app) – co maji oni navic)*

- **Online sledovani zakazky** – zakaznik zada kod (napr. J-28A99Z) a vidi aktualni stav
- **Online rezervacni system** – zakaznik si vybere termin, typ opravy; servis potvrdi
- **Vlastni fakturace + pokladna** – vystavovani faktur, evidencia prijmu/vydaju
- **Kalendarovy pohled** – zakazky barevne podle stavu, denni/prehled
- **Planovani smen a dochazka** – kdy kdo pracuje, prirazeni zakazek technikum
- **Foceni pred servisem** – standardni foto dokumentace pri prevzeti (Jobi ma diag fotky – rozsirit/formalizovat)
- **Hlidani terminu** – upozorneni na blizici se deadline
- **Sklad napric pobockami** – jednotny pohled na sklad vice pobocek

---

## 🟣 Jobi jako aplikace – vyhody nad webem

*(Funkce, ktere desktop appka zvladne lip nez web – konkurencni vyhoda)*

- **Widget na macOS** – widget na plochu / Notification Center (pocet zakazek, rychly prehled)
- **Offline rezim** – plna funkcnost bez internetu, sync po pripojeni (zaklad uz je, rozsirit)
- **Rychly tisk** – natisknout zakazkovy list jedním klikem bez prohlizece
- **Drag & drop fotek** – tahnout fotky z finderu primo do diagnostiky
- **System tray** – mini ikona, rychly pristup, notifikace o novych zakazkach
- **Klavesove zkratky** – napr. Cmd+N nova zakazka, Cmd+K vyhledat
- **Vicerozakazkovy tisk** – vybrat nekolik zakazek a vytisknout vse najednou
- **Lokální cache dokumentu** – rychlejsi otevreni, funguje i offline
- **Notifikace** – nová zakázka, blížící se termín
- **Globální zkratka** – Cmd+Shift+J pro rychlé otevření

---

## 📊 Reporting

- **Mini dashboard** – zakázky za den/týden, průměrná doba vyřízení
- **Export pro účetnictví** – strukturovaný export pro Pohoda/účetní

---
