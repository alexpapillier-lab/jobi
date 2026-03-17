# Release Notes v0.2.3

Zmeny od v0.2.2. Zlepseni UX v Zakazkach a Skladu, stabilita synchronizace skladu s DB, rychlejsi dark theme, vylepseny flow prijimacich fotek pres QR bez nutnosti vytvorit zakazku.

---

## Zakazky

### Sticky akce v modalu a detailu
- V detailu zakazky je horni akcni lista sticky a obsah scrolluje pod ni.
- V modalu nove zakazky je sticky horni i spodni lista akci.
- Zavirani detailu je tlacitkem `x` (upraveno odsazeni, aby nezasahovalo mimo panel).

### Prijimaci fotky (pred vytvorenim zakazky)
- Tlacitko **"Udelat prijimaci fotky"** ted umi vytvorit QR **bez vytvoreni zakazky** (draft rezim).
- Fotky nafocene na telefonu se po zavreni QR modalu nacitaji do sekce **"Fotky pri prijmu"** v rozpracovane zakazce.
- V QR modalu je live pocet nafocenych fotek + tlacitko zavrit zobrazuje pocet (napr. `Zavrit (3 fotky)`).
- Po vytvoreni zakazky se draft fotky automaticky claimnou do `diagnostic_photos_before`.

### Export PDF
- Uspesny export ukazuje persistent toast s nazvem souboru.
- V toastu je akce **"Otevrit slozku"**.

### Zobrazeni "Podle statusu"
- Reklamace se zobrazuji i v "Podle statusu" mezi zakazkami (kdyz je zapnute zobrazovani reklamaci v seznamu).
- Uvnitr kazde status skupiny jsou zakazky i reklamace serazene podle data (nejnovejsi nahore).

---

## Sklad

### UX formulare
- Tlacitko `+` u kategorii je neaktivni, dokud neni vyplneny nazev.
- Tlacitko **"Pridat produkt"** je neaktivni, dokud neni vyplneny nazev produktu.
- U importu je text tlacitka zpet **"Zpet na Sklad"**.
- Jeden flow pro produkt s checkboxem **"Neprirazovat k zarizeni"**.

### Stabilita DB synchronizace
- Opravena smycka `save -> realtime reload -> save`, ktera delala zaplavu requestu.
- Ukladani skladu je debouncovane.
- Realtime reload je debouncovany a po vlastnim save se kratce ignoruje.
- Pri chybe loadu se stav neprepisuje prazdnymi daty.
- Mazani odstraneneho obsahu ve skladu je batch (`delete ... in (...)`) misto N jednotlivych volani.
- Omezene error toasty pri opakovanych sitovych chybach.

---

## Vykon / vzhled

### Dark theme
- Omezena globalni transition, snizeny blur a tezsi panelove pozadi.
- Lepsi chovani pri `prefers-reduced-motion`.

---

## Backend / Supabase

### Migrace
- `20260230100000_capture_draft_tokens.sql`
  - `capture_tokens.ticket_id` je nullable (podpora draft tokenu).
  - nova tabulka `draft_capture_photos`.

### Edge functions
- `capture-create-token` - podpora draft tokenu (`draft` + `serviceId`), QR pro foceni pred vytvorenim zakazky.
- `capture-upload` - robustnejsi validace tokenu, podpora uploadu do draftu.
- `capture-claim-draft` - presun draft fotek do vytvorene zakazky.
- `capture-list-draft` - vraceni draft fotek pro nahled ve formulari.
- `sms-send` - pri chybe „combination of To/From“ vracena napoveda: kdy jde o konkretni cislo (opt-out, operátor) a kdy o potrebu ceskeho Twilio cisla pro odesilani na +420.

---

## Sidebar

### Preteceni a scroll
- **Horizontální sidebar (dole):** pri vetsim poctu polozek se menu horizontalne scrolluje (gap a padding zuzeny), polozky se neorezou.
- **Vertikalni sidebar (vlevo/vpravo):** scrolluje jen stredni cast (navigace + JobiDocs); logo nahore a uzivatel dole zustavaji na miste. Koren sidebaru ma `height: 100%` a `minHeight: 0`.

### SMS chaty jen pri aktivnich SMS
- Polozka **„SMS chaty“** je v sidebaru zobrazena jen kdyz ma aktualni servis aktivni SMS cislo (`service_phone_numbers`, active).
- Kdyz SMS pro servis nejsou aktivovane a uzivatel je na strance SMS chaty, presmeruje se na Zakazky (stejne jako u Faktur pri vypnutem fakturovani).

---

## SMS chaty

### Chat primo na strance
- Na strance **SMS chaty** se konverzace zobrazuje primo (seznam vlevo, vybrana konverzace vpravo). Neni nutne otevirat zakazku.
- Klik na konverzaci otevře chat na te same strance. Volitelny odkaz **„Otevrit zakazku &lt;kod&gt;“** v hlavicce chatu, pokud je konverzace navazana na zakazku.
- Komponenta `SmsChat` podporuje volitelne `conversationId` a `ticketId` pro zobrazeni chatu bez nutnosti hledat konverzaci podle telefonu.

### Hlavicka chatu: jmeno, zakazka, telefon
- V hlavicce SMS chatu (panel u Zakazek i stranka SMS chaty) se krome telefonu zobrazuje **jmeno zakaznika** (nebo „Zakaznik“) a **cislo zakazky** (Zakazka &lt;kod&gt;). Telefon je na druhem radku.

### Twilio chyby
- Uzivatel vidi **detail chyby od Twilia** (ne jen „Twilio error“): v toastu se zobrazuje `detail` z odpovedi.
- Pri chybe kombinace To/From je v odpovedi doplnena napoveda: pokud na jina ceska cisla to jde, problem muze byt u konkretniho cisla (opt-out, typ linky, operátor); pokud nefunguje zadne +420, je potreba ceske Twilio cislo.

---

## Faktury (Jobi)

### Editor faktury
- Sekce **Dodavatel** je rozklikávací (sbalená ve výchozím stavu), protože údaje jsou z nastavení servisu. V hlavičce se zobrazí název dodavatele nebo „Údaje z nastavení servisu“.

### Navigace mezi zakázkou a fakturou
- V náhledu zakázky: pokud k zakázce už existuje faktura, zobrazí se **„Přejít na fakturu“** (otevře danou fakturu); jinak **„Vystavit fakturu“**.
- V náhledu faktury: pokud je faktura navázaná na zakázku (`ticket_id`), zobrazí se tlačítko **„Přejít na zakázku“** (přepne na Zakázky a otevře tu zakázku).

### UX
- Po kliku na „Vystavit fakturu“ z náhledu zakázky se náhled zakázky zavře (nepřekrývá editor faktury).
- Menu u faktury (tři tečky) se zobrazuje nad ostatními řádky (opravený z-index).

### Zapnutí/vypnutí modulu Faktury
- V **Nastavení → Vzhled → Achievementy** je přepínač **„Modul Faktury zapnutý“**. Když je vypnutý: v menu zmizí Faktury, u zakázek nejsou tlačítka „Vystavit fakturu“ / „Přejít na fakturu“, stránka Faktury se nevykresluje. Pro ty, kdo používají vlastní fakturační systém.

### Spuštění a chyby
- Při otevření Jobi se po 2 s automaticky spustí **JobiDocs do tray**, pokud neběží (pro tisk/export).
- Oprava zobrazení stránky Faktury: přidáno „invoices“ mezi stránky bez placeholderu (zmizí text „Placeholder page“).
- Pro chybu „Could not find table public.invoices“: v kořeni projektu spustit **`npm run db:migrate`** (viz **docs/FAKTURY_SETUP.md**). Připraven skript `db:migrate` a `electron:dev:fresh` v JobiDocs.

---

## JobiDocs

### Podpora faktur (doc_type)
- **doc_type „faktura“** je povolen u endpointů print-document, export-document, render-pdf i u profilů (GET/PUT). Chybové hlášky uvádějí „faktura“ v seznamu povolených typů.
- V Jobi: při chybě typu „doc_type must be …“ (bez „faktura“) se zobrazí návod, že je potřeba novější JobiDocs (ukončit a spustit z `jobidocs/` např. `npm run electron:dev:fresh`).

### Export PDF faktury
- Oprava chyby **„Cannot read properties of undefined (reading 'toLocaleString')“**: položky faktury z Jobi přicházejí se snake_case (`unit_price`, `line_total`, `vat_rate`). JobiDocs je normalizuje na camelCase a ošetří neplatné hodnoty; `fmt()` bezpečně formátuje čísla.
- Datumy: kromě `inv_date_issued` / `inv_date_due` / `inv_date_taxable` se berou i `inv_issue_date` / `inv_due_date` / `inv_taxable_date` (co posílá Jobi).
- Kolem generování tabulky položek je try-catch; při chybě se do PDF vloží text „Položky se nepodařilo zobrazit.“ místo pádu.

---

## Bezpečnost

### Role a oprávnění
- **Přiřazení role owner:** pouze owner servisu (nebo root owner) může nastavit roli **owner**; admin už nemůže nikoho povýšit na owner přes API.
- **Zařízení a sklad v DB:** zápisy do tabulek `device_brands`, `device_categories`, `device_models`, `repairs` a `inventory_*` jsou v RLS vázané na capability `can_edit_devices` resp. `can_edit_inventory`. Member bez daného oprávnění nemůže měnit data ani přes API; owner/admin mají přístup beze změny.

### Migrace
- `20260230120000_enforce_capabilities_devices_inventory.sql` – nové RLS policy pro write operace na zařízení a sklad (SELECT beze změny).

---

## Dokumentace

### Audit připojení a oprávnění
- **docs/AUDIT_AUTH_DB_CONNECTIONS.md** – audit auth/session, rolí (admin/member), pozvánek, tokenů a DB přístupů; stručný checklist oprav (P0–P2) a test plán.

### SMS a Twilio
- **docs/SMS_TWILIO_SECRETS.md** – nova sekce: pro odesilani na ceska cisla (+420) je potreba ceske (nebo evropske) Twilio cislo. Vysvetleni chyby „Message cannot be sent with the current combination of To/From“. Moznosti: znovu aktivovat SMS (kdyz jsou CZ cisla), nebo koupit ceske cislo v Twilio Console.

### Faktury
- **docs/FAKTURY_SETUP.md** – jednorázové spuštění migrací pro tabulky faktur (`npm run db:migrate` z kořene projektu). V README je odkaz na tento návod.

