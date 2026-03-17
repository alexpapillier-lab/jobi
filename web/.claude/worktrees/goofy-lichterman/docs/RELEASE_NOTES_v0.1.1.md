# Release v0.1.1

První update po v0.1.0: vylepšení průvodce, nastavení, klávesové zkratky, tisk přes JobiDocs a příprava na OTA updaty.

---

## Novinky a vylepšení

### Průvodce aplikací
- Průvodce má nový vzhled: karty s ikonami kroků, progress indikátor, přehledné tlačítka (Zpět, Další, Hotovo) a odkaz „Přeskočit průvodce“.
- Přidány kroky: úvodní uvítání, navigace v postranním panelu, nová reklamace, Nastavení – Povinná pole u zakázky, Nastavení – Tým, Dokumenty a tisk, Reklamace, Klávesové zkratky, Můj profil.
- V úvodu průvodce je zmínka o klávese **?** (Shift+?) pro nápovědu zkratek.
- Texty kroků upraveny (JobiDocs šablony v JobiDocs, admin přidává/odebírá členy, atd.).

### Nastavení
- V záložce **Zakázky** nová sekce **Povinná pole u zakázky**: nastavení povinnosti telefonu zákazníka u nové zakázky a při úpravě (přesun z Vzhled a chování).
- Nastavení – Vzhled a rozhraní: doplněn text o počet zakázek na stránku a odkaz na Povinná pole v Zakázkách.

### Zakázky – seznam a stránkování
- Seznam zakázek a reklamací je vždy řazen od nejnovějších; stránkování je konzistentní (první stránka = nejnovější položky).
- Nové stránkování: čísla stránek (1, 2, 3…), tlačítka ‹ ›, zvýraznění aktuální stránky a přehled „Zobrazeno X–Y z N“.

### Toast notifikace
- Toast lze zavřít **najetím myší** nebo **kliknutím** (dříve jen po 3 s).

### Klávesové zkratky
- Výchozí zkratka **Nová zakázka** změněna na **Tab** (jedna klávesa), aby nekolidovala s Cmd+C / Cmd+V.
- Navigace (Zakázky, Sklad, Zařízení, Zákazníci) a režim úprav používají malá písmena (q, s, d, c, e) – zkratky fungují i bez Shiftu.
- Zobrazení zkratek: na Macu se „Meta“ zobrazuje jako ⌘ (bez matoucího „⌘+Meta“).

### JobiDocs a tisk
- Před každým tiskem nebo exportem do PDF se znovu kontroluje dostupnost JobiDocs; při odpojení se zobrazí srozumitelná hláška.
- U chyb typu „not found“ od JobiDocs se zobrazí návod: zkontrolovat vybraný servis a šablonu dokumentu, případně restartovat JobiDocs.

### Release a distribuce
- Připraven **notarizovaný DMG** pro Jobi i JobiDocs (bez varování Gatekeeperu na Macu).
- **Všechny buildy Jobi i JobiDocs musí být universal** (Intel + Apple Silicon) – viz `docs/RELEASE_DMG_NOTARIZED.md`.
- **OTA updaty**: aplikace Jobi umí kontrolovat nové verze a nabídnout stažení updatu (latest.json + podepsaný jobi.app.tar.gz na GitHub Releases).

---

## Technické

- Skript `scripts/release-dmg-notarized.sh` pro build, notarizaci a DMG obou aplikací.
- Dokumentace: `docs/RELEASE_DMG_NOTARIZED.md`, `docs/PRUVODCE_NAVRHY.md`, úpravy v `docs/INSTALACE_KLIENTUM.md` a build readme.

---

## Stažení

- **Jobi** – `jobi-0.1.1.dmg` (universal, notarizovaný)
- **JobiDocs** – `JobiDocs-0.1.1.dmg` (universal, notarizovaný) v příloze nebo v sekci Assets

Po instalaci v0.1.1 budou budoucí updaty dostupné přímo v aplikaci (kontrola při startu).
