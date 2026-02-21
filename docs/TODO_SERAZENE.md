# TODO – seřazeno podle priority a složitosti

---

## 🟠 Vysoká priorita – relativně snadné

- [x] v Tým a přístupy zobrazit fotku a nick uživatelů (teď jen email)
- [ ] pridat dropdown pod status zakazky „print“, ktery rovnou vytiskne nejaky z vybranych dokumentu – je potreba dodelat u reklamaci, a jeste reklamace at maji v tech ruznych stylech zobrazenich stejne velikosti jak klasicke zakazky
- [ ] debug v nastaveni – zobrazovat serviceId, ticketId atd. – castecne myslim

---

## 🟡 Stredni priorita – stredni narocnost

- [ ] ve smazanych zakazkach ukazat, jaky user zakazku smazal – to mame?
- [ ] umoznit presunuti / zmenu pozice sidebaru
- [ ] reseni kdyz se ztrati pripojeni

---

## 🟢 Dalsi – vetsi scope

### Registrace a pristupy

- [ ] zkontrolovat login, registracni logiku a zvani novych clenu

### Zakazky a dokumenty

- [ ] Pridani dalsiho zarizeni pri zakladani zakazky
- [ ] duvod slevy

### Sklad a zarizeni

- [ ] historie produktu – u jake zakazky, kdo manualne vzal nebo naskladnil
- [ ] tisk stavu skladu
- [ ] api na opravy a sklad

### Komunikace a hodnoceni

- [ ] sms komunikace se zakaznikem
- [ ] pridani QR na hodnoceni servisu
- [ ] pridat ke QR kodu otaznik s navodem, jak vytvorit QR kod firmy – to uz mame? v jobidocs

### Infrastruktura a dokumentace

- [ ] jake jsou limity aplikace
- [ ] Jak vyresit 2 a vice pobocek
- [ ] na jakych verzich macOS ma appka fungovat
- [ ] Projit komplet vse co se tyka db – aby servisy neprisly o data pri zmene – to by melo byt ok.

### UX a obecne

- [ ] po prvnim prihlaseni – nastaveni UI vzhledu – ano, rovnou v pruvodci idealne?

### Mobil / foto

- [ ] Nahravat fotky do diagnostiky z telefonu

### Specialni

- [ ] Vykup s checkerem SN

---

## 🔵 Inspirace MyRepair.app – chybi v Jobi

*(Podle [myrepair.app](http://myrepair.app) – co maji oni navic)*

- [ ] **Online sledovani zakazky** – zakaznik zada kod (napr. J-28A99Z) a vidi aktualni stav
- [ ] **Online rezervacni system** – zakaznik si vybere termin, typ opravy; servis potvrdi
- [ ] **Vlastni fakturace + pokladna** – vystavovani faktur, evidencia prijmu/vydaju
- [ ] **Kalendarovy pohled** – zakazky barevne podle stavu, denni/prehled
- [ ] **Planovani smen a dochazka** – kdy kdo pracuje, prirazeni zakazek technikum
- [ ] **Foceni pred servisem** – standardni foto dokumentace pri prevzeti (Jobi ma diag fotky – rozsirit/formalizovat)
- [ ] **Hlidani terminu** – upozorneni na blizici se deadline
- [ ] **Sklad napric pobockami** – jednotny pohled na sklad vice pobocek

---

## 🟣 Jobi jako aplikace – vyhody nad webem

*(Funkce, ktere desktop appka zvladne lip nez web – konkurencni vyhoda)*

- [ ] **Widget na macOS** – widget na plochu / Notification Center (pocet zakazek, rychly prehled)
- [ ] **Offline rezim** – plna funkcnost bez internetu, sync po pripojeni (zaklad uz je, rozsirit)
- [ ] **Rychly tisk** – natisknout zakazkovy list jedním klikem bez prohlizece
- [ ] **Drag & drop fotek** – tahnout fotky z finderu primo do diagnostiky
- [ ] **System tray** – mini ikona, rychly pristup, notifikace o novych zakazkach
- [ ] **Klavesove zkratky** – napr. Cmd+N nova zakazka, Cmd+K vyhledat
- [ ] **Vicerozakazkovy tisk** – vybrat nekolik zakazek a vytisknout vse najednou
- [ ] **Lokální cache dokumentu** – rychlejsi otevreni, funguje i offline
