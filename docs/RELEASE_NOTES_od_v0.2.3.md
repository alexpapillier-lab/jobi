# Změny od v0.2.3

Souhrn změn oproti **v0.2.3** – zahrnuje **commity na `main` po tagu v0.2.3** i připravované úpravy v aplikaci (SMS, realtime, nastavení). Verze cílového release si doplň podle `package.json` / tagu.

---

## Web (marketing / Cloudflare Pages)

- **Ceník:** plány Starter / Business / Enterprise, přepínač měsíčně / ročně, tabulka funkcí, motto.
- **Sekce „Co umí Jobi“:** rozšířeno o 8 doporučených funkcí.
- **Stahování:** dvě tlačítka (Jobi + JobiDocs), odkaz JobiDocs na appjobi.com; programatické stažení obou DMG.
- **Loading screen:** přepracování (orby, animace), jeden interval místo závodů stavů.
- **Dark theme** na landing stránce, **nový favicon** (J, modré pozadí, vycentrování), úpravy hero / parallax / přehlednosti.

---

## SMS – sdílené Twilio číslo (pool)

- Více **servisů může sdílet jedno Twilio číslo** (odstraněn unikát na `twilio_number`, sloupec **`is_pool_primary`** – u neznámého odesílatele se routuje na primární servis v poolu).
- Sloupec **`country_code`** (výchozí `CZ`) u `service_phone_numbers`.
- **Edge `sms-provision`:** automatické zapojení do sdíleného čísla bez ručního zásahu tam, kde to dává smysl (sdílený pool).
- **Edge `sms-incoming`:** routování příchozích zpráv podle konverzací a poolu (včetně nových kontaktů na sdíleném čísle).
- **Edge `sms-send`:** úpravy v souladu se sdílenými čísly a odesíláním.

### Migrace (Supabase)

- **`20260321000000_sms_shared_numbers.sql`** – sdílená čísla, `is_pool_primary`, index `(twilio_number, active)`.
- **`20260322000000_service_phone_numbers_delete.sql`** – **DELETE** na `service_phone_numbers` pro **owner/admin** (umožní odebrat vazbu servisu na číslo a znovu provisionovat).
- **`20260323000000_realtime_sms_messages.sql`** – tabulka **`sms_messages`** v publikaci **`supabase_realtime`** (živý badge a toast u příchozích zpráv).

### Dokumentace

- **`docs/SMS_TWILIO_SECRETS.md`** – doplnění k sdíleným číslům / poolu a provozu.

---

## SMS – aplikace Jobi

### Přehled zakázek (Orders)

- **Badge nepřečtených SMS** u řádků zakázek (realtime přes `sms_messages` INSERT/UPDATE).
- Počítání konverzací podle **`ticket_id`** nebo **stejného telefonu** jako u zakázky (sdílený thread).
- V detailu zakázky: přepočet badge v hlavičce při příchozí / přečtené zprávě; ref **`smsDoNotNotifyRef`** potlačí rušení, když je otevřený SMS panel u dané zakázky.

### SMS chaty (stránka)

- **Archiv konverzací** (archivovat / vyjmout), přepínač aktivní vs. archivované.
- Obohacení jmen zákazníků (DB, zákazníci, zakázky).
- Intent **`conversationId`** – otevření konkrétní konverzace (včetně z archivu po přepnutí záložky).
- Lepší doplnění seznamu po vytvoření nové konverzace.

### Toast při příchozí SMS

- Toast **„Nová SMS · jméno / telefon“** s **náhledem textu** (cca 120 znaků).
- **Klik na toast** otevře **SMS chaty** a **danou konverzaci**.
- Logika je svázaná se stejným realtime handlerem jako **globální počet nepřečtených** (spolehlivější než samostatný kanál vázaný jen na „SMS zapnuté“).
- Toast se **nezobrazí**, pokud uživatel **čte ten chat** nebo má **SMS panel** u stejného čísla v detailu zakázky.

### Zákazníci

- U zákazníka s telefonem (a zapnutými SMS): tlačítko **„SMS“** → otevře SMS chaty s tímto číslem.

### Komponenty

- **`SmsChat`**, **`Toast`** (subtitle, `onNavigate`), **`Sidebar`** – drobné úpravy v kontextu SMS.

---

## Nastavení – O aplikaci / aktualizace (desktop)

- Sekce **Nastavení → O aplikaci → Aktualizace**: stav kontroly, stažení, **Restartovat** po aktualizaci (Tauri updater).
- **Červený badge** na Nastavení a na „O aplikaci“, když je dostupná nová verze (bez rušivého globálního dialogu hned po startu).
- Propojení s toasty aktualizace (**„Jít do nastavení“** otevře podsekci Aktualizace).

---

## Technické poznámky

- **`useGlobalSmsUnreadCount`** – kromě počtu nepřečtených zpracovává INSERT pro toast a navigaci.
- **`useSmsNotifications`** – zjednodušeno (OS notifikace dříve vypnuté); **`smsDoNotNotifyRef`** zůstává pro badge / toast / panel.
- Pro **živé SMS** v projektu musí běžet migrace realtime na **`sms_messages`** (viz výše).

---

