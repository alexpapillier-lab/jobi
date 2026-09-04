# Release aplikace – design a pravidla (v2, září 2026)

Aplikace `jobi-release-app` vydává **Jobi a JobiDocs nezávisle**, každou se svou verzí a svým kanálem.

## Model vydání

- **Verzované release** `jobi-vX.Y.Z` a `jobidocs-vX.Y.Z` – neměnné, obsahují instalátory i OTA soubory. Na GitHubu jsou označené jako pre-release, protože slouží jako úložiště; „Latest“ tím zůstává na posledním klasickém vydání `vX.Y.Z` (kvůli instalacím Jobi před 0.2.8, které ještě čtou `releases/latest`).
- **Kanálové release** `jobi-stable`, `jobi-beta`, `jobidocs-stable`, `jobidocs-beta` – pevné adresy, ze kterých aplikace čtou aktualizace:
  - Jobi: `releases/download/jobi-stable/latest.json` (v `tauri.conf.json`, jako záloha zůstává `releases/latest/download/latest.json`). `latest.json` ukazuje absolutními URL na verzovaný release.
  - JobiDocs: electron-updater `generic` provider s adresou `releases/download/jobidocs-<kanál>/`; kanál si uživatel přepne v O aplikaci.
  - V kanálu je i instalátor pod pevným jménem (`jobi.dmg`, `JobiDocs.dmg`) pro odkaz Stáhnout na webu.
- **Beta → stable** = povýšení v záložce Kanály (soubory se přesunou, nic se nestaví znovu). **Rollback** = nastavit kanál na libovolný verzovaný release.
- Volitelně jde u Jobi vytvořit i klasický společný release `vX.Y.Z` (přechod pro staré instalace).

## Kroky (každý opakovatelný, stav se ukládá do `release-state.json`)

Jobi: zvednout verzi → git commit + push → build universal (podepsaný) → notarizace (přeskočí se, když je .app už notarizovaná) → DMG → OTA balíček + `latest.json` → ověření (verze v bundlu, `stapler validate`, `spctl`) → verzovaný release → kanál → ověření kanálu (stáhne `latest.json` z GitHubu tak, jak to dělá aplikace, a HEADne soubor).

JobiDocs: zvednout verzi → git → build universal → ověření (verze v bundlu, `codesign --verify`, `hdiutil verify`, `latest-mac.yml`) → verzovaný release → kanál → ověření kanálu.

Pořadí uploadu drží kód: instalátory první, OTA soubor (`latest.json` / `latest-mac.yml`) poslední. Po chybě jde „Pokračovat od chyby“, hotové kroky se neopakují.

## Předletová kontrola

Před spuštěním: platnost a volnost verze/tagu, čistý strom, větev main, dosažitelný origin, aktuálnost proti originu, GitHub token, node/npm/git, volné místo, žádný běžící build, Apple údaje, podpisový certifikát v Keychain, OTA klíč, create-dmg, Rust target x86_64 (Jobi), node_modules (JobiDocs). Blokující položky nedovolí spuštění, varování jen upozorní.

## Zkušební běh

„Zkušební běh“ udělá vše kromě `git push` a nahrání na GitHub – výstupy zůstanou v `Releases/` a `jobidocs/release/`.

## Prostředí

- Tajemství (Apple ID, heslo, Team ID, GitHub token, OTA klíč) v Keychain, jedna položka.
- Node procesy dostávají `NODE_OPTIONS=--dns-result-order=ipv4first` (sítě bez IPv6 routy jinak shazují stahování při buildu).
- Cesta k projektu: `/Volumes/backup/backup/jobi` (nastavitelná).
