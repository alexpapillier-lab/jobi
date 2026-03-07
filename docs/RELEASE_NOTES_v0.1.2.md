# Release v0.1.2

Opravy a vylepšení po v0.1.1: instalátor Jobi s pozadím, flow pozvánky, JobiDocs logo a tray, zobrazení tiskárny.

---

## Opravy a vylepšení

### Instalátor Jobi (DMG)
- **Fancy DMG** – instalátor Jobi má znovu fialové pozadí a text „Přetáhněte do Aplikací“. Skript `create-jobi-dmg.sh` vyžaduje `create-dmg` (brew install create-dmg); bez něj build končí chybou, takže se už nevyrobí DMG bez pozadí.
- Pozadí se vždy vygeneruje před vytvořením DMG (`gen-dmg-background.js`).

### Registrace a pozvánky
- **Flow po přijetí pozvánky** – po přihlášení s kódem pozvánky se nejdřív zobrazí obrazovka „Připravuji váš servis“ (ne hned hlavní app). Provede se `invite-accept`, zobrazí se „Pozvánka přijata“, načtou se služby a teprve pak přechod do servisu. Odstraněna nutnost ručního Reload.
- Efekt pro pozvánku se spouští podle **session** (ne authenticated), takže funguje i když Login nevolá onLogin po registraci.
- **Automatický retry** – při chybě `invite-accept` se až 3× zopakuje pokus s pauzou 2 s; pokud backend nevrátí `serviceId`, zkusí se ještě načtení seznamu služeb a nastavení prvního servisu.

### JobiDocs – UI a branding
- **Logo v aplikaci** – logo nalevo od „JobiDocs“ v hlavičce se znovu zobrazuje. Opravena cesta k obrázku (relativní `logos/jdlogo.png` kvůli Electronu a Vite `base: "./"`), přidán fallback na `logos/logopicjobidocs.svg` při chybě načtení PNG.
- **Tray ikona** – v menu baru se používá výhradně **logos/tray-icon.png** (44×44). Při buildu se kopíruje do `electron/tray-icon.png`; v runtime se před zobrazením zmenší na 22×22. Ikony `electron/tray-icon.png` a `electron/icon.png` jsou v `.gitignore`, zdroj je vždy z `logos/`.

### JobiDocs – tiskárna
- **Zobrazení uložené tiskárny** – při otevření záložky „Tiskárna“ se znovu načtou nastavení a seznam tiskáren, takže se vždy zobrazí aktuální uložená tiskárna (ne „žádná“ při funkčním tisku). Řádek „Uloženo: …“ se zobrazí až po načtení nastavení pro daný servis.
- **Načítání seznamu tiskáren** – na macOS se pro `lpstat` používá absolutní cesta `/usr/bin/lpstat`, aby to fungovalo i při minimálním PATH (Electron z Finderu). Chování je stejné na Intel i Apple Silicon (CUPS).

---

## Technické

- Jobi: `src/App.tsx` – stav `resolvingInvite` / `inviteAcceptStatus`, efekt závislý na `session`, retry a fallback v `handleInvite`.
- JobiDocs: `src/components/AppLogo.tsx` – relativní cesta, fallback SVG; `electron/main.ts` – tray ikona 22×22; `api/printers.ts` – `LPSTAT_BIN` na darwin.
- Skripty: `create-jobi-dmg.sh` – create-dmg povinný, vždy generování pozadí; `gen-dmg-background.js` – text „Přetáhněte do Aplikací“.

---

## Stažení

- **Jobi** – `jobi-0.1.2.dmg` (universal, notarizovaný)
- **JobiDocs** – `JobiDocs-0.1.2.dmg` (universal, notarizovaný) v příloze nebo v sekci Assets

Uživatelé s v0.1.1 mohou aktualizovat přes OTA (kontrola při startu) nebo stáhnout nové DMG.
