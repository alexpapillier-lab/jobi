# Release: DMG s notarizací (Jobi + JobiDocs)

Jeden skript zbuildí obě aplikace, nechá je notarizovat u Apple a vytvoří DMG pro distribuci. Následné releasy mohou používat OTA updaty (Jobi: Tauri updater, JobiDocs: electron-updater).

---

## Pravidlo: všechny buildy musí být universal

**Jobi i JobiDocs** se vždy musí distribuovat jako **universal binary** (Intel x86_64 + Apple Silicon aarch64). Jinak na Intel Macu vznikne hláška „Aplikaci nelze otevřít, protože ji tento Mac nepodporuje.“

- **Jobi:** používej vždy `scripts/build-universal-signed.sh` (ne samotný `tauri build`). Skript zbuildí obě architektury a slije je přes `lipo`.
- **JobiDocs:** vždy `npm run electron:build:universal` v `jobidocs/` (ne `electron:build` bez universal).

Release skript `release-dmg-notarized.sh` to dodržuje. Při ručním buildu nikdy nepoužívej pouze jednu architekturu.

---

## 1. Příprava (jednou)

### Apple Developer + notarizace

- **Apple Developer účet** (Developer ID Application certifikát nainstalovaný v Keychain).
- **App-specific heslo** pro notarizaci: [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords → vytvoř (název např. „Notarization Jobi“).

### Jobi – podepisování a OTA

- **Tauri signing key** pro OTA: `npm run tauri signer generate -- --write-keys ~/.tauri/jobi.key`  
  (bez něj build-universal-signed selže; klíč slouží i pro pack-notarized-ota.sh.)

### DMG Jobi (fancy instalátor)

- **create-dmg** – pro Jobi DMG s fialovým pozadím a textem „Přetáhněte do Aplikací“ je potřeba `create-dmg`. Bez něj skript create-jobi-dmg.sh skončí chybou. Nainstaluj: `brew install create-dmg`.

### Kontrola konfigurace

- **Jobi:** `src-tauri/tauri.conf.json` – `bundle.macOS.signingIdentity` a `hardenedRuntime: true`.
- **JobiDocs:** `jobidocs/electron-builder.json` – `mac.identity` a `hardenedRuntime: true`.

---

## 2. Spuštění release

V kořeni projektu nastav credentials a spusť skript:

```bash
cd /Volumes/backup/jobi

export NOTARY_APPLE_ID="tvuj@email.com"
export NOTARY_APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific heslo
export NOTARY_TEAM_ID="8ZC264M873"

chmod +x scripts/release-dmg-notarized.sh
./scripts/release-dmg-notarized.sh
```

Skript postupně:

1. **Jobi:** build (signed universal) – `build-universal-signed.sh`
2. **Jobi:** notarizace – `notarize-jobi.sh` (zip → Apple → staple)
3. **Jobi:** vytvoření DMG – `create-jobi-dmg.sh` → `jobi-<verze>.dmg` v kořeni
4. **JobiDocs:** build + notarizace (universal) – `npm run electron:build:universal` v `jobidocs/` → DMG v `jobidocs/release/`
5. **Jobi OTA:** (volitelně) `pack-notarized-ota.sh` → `latest.json`, `jobi.app.tar.gz`, `jobi.app.tar.gz.sig`

---

## 3. Výstupy

Všechny DMG se ukládají do složky **`Releases/`** v kořeni projektu.

| Soubor | Popis |
|--------|--------|
| `Releases/jobi-0.1.0.dmg` | Notarizovaný Jobi – nahraj na GitHub Release |
| `Releases/JobiDocs-0.1.0.dmg` | Notarizovaný JobiDocs (při plném skriptu zkopírován z jobidocs/release/) – nahraj na GitHub Release |
| `latest.json`, `jobi.app.tar.gz`, `jobi.app.tar.gz.sig` | OTA artefakty pro Jobi (pokud běžel krok 5) |

Když builduješ JobiDocs zvlášť, po buildu zkopíruj DMG do Releases:  
`./scripts/copy-jobidocs-dmg-to-releases.sh`

---

## 4. Nahrání na GitHub Release

1. V repozitáři **alexpapillier-lab/jobi** vytvoř **Release** (tag např. `v0.1.0`, shodný s verzí v `tauri.conf.json` / `jobidocs/package.json`).
2. Do release nahraj:
   - **jobi-0.1.0.dmg**
   - **JobiDocs-0.1.0.dmg** (z `jobidocs/release/`)
   - Pro OTA u Jobi také: **latest.json**, **jobi.app.tar.gz**, **jobi.app.tar.gz.sig**

Uživatelé pak stáhnou oba DMG, nainstalují bez varování Gatekeeperu. Při dalších releasech budou moci používat OTA updaty v aplikaci.

---

## 5. Pouze nové Jobi DMG (universal, v0.1.1)

Když potřebuješ jen znovu vyrobit **universal** Jobi DMG (např. oprava po vydání jen pro Apple Silicon):

```bash
cd /Volumes/backup/jobi

# 1) Universal build (Intel + Apple Silicon) + podepsání
bash scripts/build-universal-signed.sh

# 2) Notarizace (nastav credentials)
export NOTARY_APPLE_ID="tvuj@email.com"
export NOTARY_APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export NOTARY_TEAM_ID="8ZC264M873"
bash scripts/notarize-jobi.sh

# 3) Vytvoření DMG
bash scripts/create-jobi-dmg.sh
```

Výstup: `Releases/jobi-0.1.1.dmg` (universal, notarizovaný). Verze se bere z `src-tauri/tauri.conf.json`.

---

## 6. Řešení problémů

- **„Signing key not found“** – vygeneruj a ulož klíč: `~/.tauri/jobi.key` (viz výše).
- **Notarizace Jobi selže** – zkontroluj v Apple Developer že certifikát „Developer ID Application“ je platný; ověř app-specific heslo.
- **JobiDocs notarizace** – electron-builder notarizuje sám při nastavených `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; skript je předává z `NOTARY_*`.
- **create-dmg** – pro „fancy“ Jobi DMG s pozadím: `brew install create-dmg`. Bez něj se vytvoří jednoduchý DMG.
