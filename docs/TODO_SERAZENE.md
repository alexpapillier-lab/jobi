# TODO – seřazeno podle priority a složitosti

---

## 🟠 Vysoká priorita – relativně snadné

- v Tým a přístupy zobrazit fotku a nick uživatelů (teď jen email)
- pridat dropdown pod status zakazky „print“, ktery rovnou vytiskne nejaky z vybranych dokumentu – je potreba dodelat u reklamaci, a jeste reklamace at maji v tech ruznych stylech zobrazenich stejne velikosti jak klasicke zakazky
- debug v nastaveni – zobrazovat serviceId, ticketId atd. – castecne myslim

---

## 🟡 Stredni priorita – stredni narocnost

- ve smazanych zakazkach ukazat, jaky user zakazku smazal – to mame?
- umoznit presunuti / zmenu pozice sidebaru
- reseni kdyz se ztrati pripojeni

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

## 🎮 Achievements (gamifikace)

- **Systém achievementů** – odemykatelné odznaky, zobrazení v Nastavení nebo profilu
- **Achievements pro servis i pro uživatele zvlášť** – servis má své (celkový počet zakázek…), každý uživatel má své (moje zakázky, moje reklamace…)
- Prvních 10 zakázek – *„Deset zakázek. A pořád jste nezrušili živnost. Respekt.“*
- Prvních 50 zakázek – *„Padesát zakázek. Teď už to chce jen nervy a účetní.“*
- Prvních 100 zakázek – *„Stovka: zvládnete to opravit i poslepu. A někdy to tak i děláte.“*
- 500 zakázek – *„500 zakázek. Gratulujeme, jste servisní NPC.“*
- 1000 zakázek – *„1000 zakázek. Už nejste člověk, jste mašina.“*
- První zákazník založen – *„Zákazník vytvořen. Odteď už máte komu poslat ‚jen se připomínám‘.“*
- 10 zákazníků – *„Desítka. Už vás někdo doporučil. Nevíme komu.“*
- První reklamace – *„Alespoň přišli zpět k vám. To je taky úspěch.“*
- První fotka z mobilu (capture) – *„Diagnostika dostala oči. Gratulujeme.“*
- První tisk dokumentu – *„Tisk: úspěch. Teď už jen aby to někdo podepsal správně.“*
- Týden v kuse (denní používání) – *„7 dní v kuse. Gratulujeme — doma už máte status ‚vzácná návštěva‘?“*
- Rychlý start (zakázka hotová do hodiny) – *„Zakázka hotová do hodiny. Gratulujeme — teď čekejte, že to budou chtít vždycky.“*
- Zakázka hotová do 24 hodin – *„Do 24 hodin. Teď už jen, aby to vydrželo aspoň 25.“*
- Do 24 hodin od registrace – *„Do 24 hodin od registrace: někdo vás našel. A hned něco chce.“*
- Týmový hráč (3+ členové v servisu) – *„Týmový režim. Odteď se chyby dělí férově.“*

