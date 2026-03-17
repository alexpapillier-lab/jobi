# Jak dostat Jobi a JobiDocs na jiný Mac přes GitHub

Jeden release na GitHubu: nahraješ tam Jobi .dmg (a OTA soubory) a JobiDocs .dmg. Na druhém Macu uživatel stáhne Jobi z release, nainstaluje; JobiDocs si stáhne buď taky z release, nebo přes odkaz v Jobi.

---

## Rychlá cesta: už mám signed jobi.app

Pokud máš v `src-tauri/target/release/bundle/macos/jobi.app` už hotovou (podepsanou) aplikaci:

```bash
./scripts/create-jobi-dmg.sh
```

V kořeni projektu se objeví `jobi-<verze>.dmg` (např. `jobi-0.1.0.dmg`). Ten nahraj na GitHub → Releases (vytvoř release, např. tag v0.1.0, a přidej .dmg jako asset). Na druhém Macu stačí stáhnout .dmg a nainstalovat.

*(Pokud .app není notarizovaná, uživatel při prvním spuštění udělá pravý klik → Otevřít. Chceš-li bez varování, musíš jednou projít notarizaci – viz níže.)*

---

## Na tvém Macu (před prvním releasem)

### 1. Příprava (jednou)

- **Apple Developer účet** + certifikát Developer ID Application.
- **Tauri signing key** pro OTA: `~/.tauri/jobi.key` (nebo env `TAURI_SIGNING_PRIVATE_KEY`). Vygeneruješ: `npx tauri signer generate -w ~/.tauri/jobi.key`.
- V **tauri.conf.json**: `signingIdentity`, `hardenedRuntime: true`, v updateru `endpoints` na tvůj GitHub (např. `https://github.com/alexpapillier-lab/jobi/releases/latest/download/latest.json`).
- V **jobidocs/electron-builder.json**: už je `identity`, `hardenedRuntime`, `publish` na GitHub.

### 2. Build a notarizace Jobi

V kořeni projektu (`/Volumes/backup/jobi`):

```bash
# Build podepsané universal .app
npm run tauri:build:universal:signed
```

Notarizace (nahraď hodnoty):

```bash
export NOTARY_APPLE_ID="tvuj@email.com"
export NOTARY_APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific z appleid.apple.com
export NOTARY_TEAM_ID="8ZC264M873"

./scripts/notarize-jobi.sh
```

Po „Done“:

```bash
# OTA artefakty + podpis
./scripts/pack-notarized-ota.sh

# Jobi .dmg pro přímé stažení
./scripts/create-jobi-dmg.sh
```

Výstupy:
- **Kořen:** `latest.json`, `jobi-<verze>.dmg`
- **src-tauri/target/release/bundle/macos/:** `jobi.app.tar.gz`, `jobi.app.tar.gz.sig`

### 3. Build JobiDocs (s notarizací)

```bash
cd jobidocs

export APPLE_ID="tvuj@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="8ZC264M873"

npm run electron:build:universal
```

Výstupy v **jobidocs/release/**:  
`JobiDocs-0.1.0-universal.dmg`, `JobiDocs-0.1.0-universal-mac.zip`, `latest-mac.yml` atd.

### 4. Vytvoř release na GitHubu a nahraj soubory

1. Na **github.com/alexpapillier-lab/jobi** → **Releases** → **Create a new release**.
2. Tag např. **v0.1.0** (shodný s verzí v tauri.conf.json / jobidocs/package.json).
3. Nahraj tyto soubory:

   **Jobi (OTA + přímý download):**
   - `latest.json` (z kořene projektu)
   - `jobi.app.tar.gz` (z `src-tauri/target/release/bundle/macos/`)
   - `jobi.app.tar.gz.sig` (tamtéž)
   - `jobi-<verze>.dmg` (z kořene, např. `jobi-0.1.0.dmg`)

   **JobiDocs:**
   - Z `jobidocs/release/`: **JobiDocs-0.1.0-universal.dmg** (a volitelně .zip, **latest-mac.yml** – kvůli OTA v JobiDocs)

4. Release ulož (Publish release).

---

## Na druhém Macu (uživatel)

### Instalace Jobi

1. Otevři stránku release:  
   `https://github.com/alexpapillier-lab/jobi/releases/latest`
2. Stáhni **jobi-0.1.0.dmg** (nebo aktuální verzi).
3. Otevři .dmg, přetáhni Jobi do Aplikací.
4. Spusť Jobi. (Po notarizaci žádné varování.)

### Instalace JobiDocs

- **Možnost A:** Na stejném release stáhni **JobiDocs-0.1.0-universal.dmg**, otevři, nainstaluj.
- **Možnost B:** V Jobi klikni na „Stáhnout JobiDocs“ (dialog po průvodci nebo při tisku) – otevře se odkaz na ten samý release, tam si stáhneš JobiDocs .dmg.

Hotovo: na druhém Macu máš Jobi i JobiDocs z jednoho GitHub release.

---

## Shrnutí kroků (tvůj Mac)

| Krok | Příkaz / akce |
|------|----------------|
| 1 | `npm run tauri:build:universal:signed` |
| 2 | `export NOTARY_...` + `./scripts/notarize-jobi.sh` |
| 3 | `./scripts/pack-notarized-ota.sh` |
| 4 | `./scripts/create-jobi-dmg.sh` |
| 5 | `cd jobidocs` + `export APPLE_...` + `npm run electron:build:universal` |
| 6 | GitHub → Releases → nový release (tag v0.1.0) → nahát všechny soubory |

Podrobnosti: **docs/INSTALACE_KLIENTUM.md**, **docs/JOBIDOCS_OTA_A_RELEASE.md**.
