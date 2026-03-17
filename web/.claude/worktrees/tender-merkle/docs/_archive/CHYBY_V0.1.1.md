# Chyby v0.1.1

Seznam zjištěných problémů po vydání v0.1.1.

---

## DMG a instalace

### [ ] V DMG Jobi chybí pozadí a „Přetáhněte do Aplikací“
- **Stav:** V distribuovaném DMG není fialové pozadí ani layout s textem „Přetáhněte do Aplikací“ (fancy DMG).
- **Poznámka:** Skript `create-jobi-dmg.sh` používá `create-dmg` (brew), pokud je nainstalovaný; jinak fallback na jednoduchý `hdiutil`. Ověřit, zda se při release buildu volá create-dmg a zda jsou k dispozici `scripts/dmg-assets/dmg-background.png` a správný layout. Stejný vzhled jako u login screenu Jobi (fialové pozadí).

---

## Registrace a pozvánky

### [x] Po přijetí pozvánky: nejdřív přesměrování na hlavní stránku, až po ručním Reload „Pozvánka přijata“
- **Stav:** Uživatel zadal token, vyplnil email, hesla; aplikace ho hodila na hlavní stránku servisu. Musel kliknout Reload, teprve pak se zobrazilo „Pozvánka přijata“.
- **Opraveno:** Po přihlášení s pending invite tokenem se hlavní app nezobrazí, dokud neproběhne `invite-accept`. Zobrazí se obrazovka „Přijímám pozvánku…“, po úspěchu „Pozvánka přijata“ + toast, provedou se `refreshServices()` a `setActiveServiceId(serviceId)`, po cca 1,4 s se zobrazí hlavní app už v cílovém servisu.
- **Související:** CHYBY_V0.1.0.md – „Po registraci účtu A přes kód…“ (částečně stále platí).

---

## JobiDocs – UI a branding

### [x] JobiDocs: uvnitř aplikace nalevo od „JobiDocs“ se nezobrazuje logo
- **Stav:** V aplikaci JobiDocs (v hlavičce / sidebaru) chybí logo nalevo od nápisu „JobiDocs“.
- **Opraveno:** V hlavičce už byl `<AppLogo>`, ale cesta k obrázku byla absolutní (`/logos/jdlogo.png`). V Electronu (file://) to selhávalo. Změna na relativní cestu `logos/jdlogo.png` (kvůli Vite `base: "./"`) a fallback na `logos/logopicjobidocs.svg` při chybě načtení PNG.

### [x] JobiDocs tray: špatná ikona a obří velikost
- **Stav:** V systémové liště (tray) se u JobiDocs zobrazuje ikona jako **jdlogo.png** místo určené **tray ikony**. Ikona navíc zabírá přibližně 2/3 celého tray.
- **Opraveno:** (1) Při buildu se `tray-icon.png` zmenší na 22×22 pomocí `sips -z 22 22` (macOS). (2) V Electronu `main.ts` se před předáním do Tray vždy zmenší ikona na 22×22, pokud je větší – takže i starý build zobrazí ikonu ve správné velikosti.

### [x] JobiDocs: tiskárna zobrazena jako „žádná“, přitom tisk funguje
- **Stav:** V UI JobiDocs se u tiskárny zobrazuje „žádná“ (nebo ekvivalent), ale tisk normálně probíhá.
- **Opraveno:** (1) Při otevření záložky „Tiskárna“ se znovu načtou nastavení a seznam tiskáren (`fetchSettings` + `fetchPrinters`), takže se vždy zobrazí aktuální uložená tiskárna. (2) Zobrazení „Uloženo: …“ se řídí podle `settingsLoadedForService` (zobrazí se až po načtení pro daný servis), takže je jasné, co je uloženo. (3) Po uložení tiskárny se lokálně nastaví i `preferredPrinter`, aby dropdown zůstal v souladu.

---

## Vylepšení / backlog

### [ ] Aplikace „Release“ – jedno tlačítko: notarizace, export Jobi + JobiDocs, nahrání na GitHub
- **Cíl:** Jednoduchá UI aplikace (nebo nástroj), která na jedno spuštění / jedno tlačítko: zbuildí a notarizuje Jobi i JobiDocs, vytvoří DMG, případně OTA artefakty, a nahraje je na GitHub Release (nová verze, tag, assets). Credentials (Apple, GitHub token) uložené lokálně (keychain / .env). Alternativa: rozšířit release skript o krok s `gh release create`.

---

## OTA updaty

Chyby lze opravit a vydat jako **v0.1.2** (nebo patch). OTA funguje nezávisle na těchto chybách: po opravách uděláš nový universal build, notarizaci, `pack-notarized-ota.sh`, nahraješ na GitHub Release nové **latest.json**, **jobi.app.tar.gz** a **jobi.app.tar.gz.sig**. Uživatelé s v0.1.1 pak při příštím startu (nebo při kontrole aktualizací) uvidí nabídku updatu a ověří tak funkčnost OTA. Opravy chyb a test OTA tedy jdou dohromady v jednom dalším release.
