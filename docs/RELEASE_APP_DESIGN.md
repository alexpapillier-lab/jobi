# Release aplikace – design a pravidla

Aplikace pro jedno-tlačítkové vydání Jobi + JobiDocs: build (universal), notarizace, DMG s pozadím, OTA artefakty, nahrání na GitHub.

---

## Pořadí artefaktů na GitHub Release

**OTA artefakty musí jít nahoru až jako poslední.** Důvod: aplikace (Jobi / JobiDocs) kontrolují dostupnost nové verze (latest.json resp. electron-updater). Pokud by byl `latest.json` na release dřív než DMG, uživatel by mohl dostat hlášku „Je nová verze“ a po potvrzení by stahoval z release, kde by DMG ještě nebylo.

**Správné pořadí uploadu:**

1. **Nejprve DMG:** `jobi-<verze>.dmg`, `JobiDocs-<verze>.dmg` (nebo dle výstupu electron-builderu)
2. **Potom OTA pro Jobi:** `latest.json`, `jobi.app.tar.gz`, `jobi.app.tar.gz.sig`

Tím je zajištěno, že když updater nabídne novou verzi, na release už jsou všechny soubory.

---

## Formát pro OTA

- **Jobi (Tauri):** Zůstává **.tar.gz** + **.sig**. Tauri updater stáhne, rozbalí a nahradí .app. DMG je jen pro ruční instalaci.
- **JobiDocs (Electron):** electron-updater používá stejný release (DMG/zip z electron-builderu). DMG na release stačí pro OTA i pro ruční stažení.

Od uživatele je u obou aplikací vyžadováno jen **potvrzení** („Ano, nainstalovat“); stahování a instalace dělá aplikace sama.

---

## Co posílat na GitHub

- Vytvořit **release** s tagem `vX.Y.Z`
- **Release notes** z UI aplikace
- **Assets** v pořadí: nejdřív oba DMG, pak OTA soubory (viz výše)
- „Latest“ release se na GitHubu určí automaticky, nic dalšího posílat není potřeba

---

## Checklist (kroky) v aplikaci

1. Aktualizovat verzi v `src-tauri/tauri.conf.json` a `jobidocs/package.json`
2. Git commit + push („Release vX.Y.Z“)
3. Build Jobi (universal signed) – `build-universal-signed.sh`
4. Notarizace Jobi – `notarize-jobi.sh`
5. DMG Jobi (s pozadím) – `create-jobi-dmg.sh`
6. Build JobiDocs (universal) – `npm run electron:build:universal` v jobidocs/
7. Zkopírovat JobiDocs DMG do Releases/
8. OTA artefakty – `pack-notarized-ota.sh` → latest.json, jobi.app.tar.gz, jobi.app.tar.gz.sig
9. GitHub: vytvořit release (tag vX.Y.Z), nahrát **nejdřív oba DMG**, pak **OTA soubory**

---

## Požadavky pro krok „GitHub release + upload“

Krok **GitHub release + upload** v release aplikaci volá **GitHub CLI (`gh`)**. Bez něj dostaneš `bash: gh: command not found`.

- **Instalace:** `brew install gh`
- **Přihlášení:** `gh auth login` (vyber GitHub.com, HTTPS, přihlášení prohlížečem nebo tokenem)
- Po přihlášení můžeš v release app spustit krok znovu. Pokud spouštíš aplikaci z Docku/Finderu, `gh` musí být v PATH (Homebrew obvykle přidá `/opt/homebrew/bin` nebo `/usr/local/bin` do shellu; u aplikací spuštěných z GUI může být PATH omezený – v tom případě spusť release app z terminálu: `open /path/to/jobi-release-app.app`, aby zdědila PATH).

**Ruční upload:** Pokud `gh` nechceš používat, nahraj soubory na GitHub Release ručně: vytvoř release s tagem `v0.1.2`, pak přetáhni DMG a OTA soubory do Assets (nejdřív oba DMG, pak latest.json, jobi.app.tar.gz, jobi.app.tar.gz.sig).

---

## Umístění release aplikace

Aplikace žije na stejném disku jako projekt Jobi, např. `/Volumes/backup/jobi-release-app` (samostatná složka). Cestu k projektu Jobi lze v aplikaci nastavit (výchozí `/Volumes/backup/jobi`).

---

## Verze

Jobi a JobiDocs mají vždy **stejné číslo verze** v rámci jednoho release.
