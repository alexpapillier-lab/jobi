# Updates over the air (OTA)

Cíl: klienti s nainstalovanou aplikací **Jobi** a **JobiDocs** nemusí při nové verzi nic ručně přeinstalovávat – aplikace sama zjistí, že je k dispozici update, nabídne ho uživateli a po schválení ho stáhne a nainstaluje.

---

## Co je implementované

### Jobi (Tauri 2)

- **Plugin** `tauri-plugin-updater` a `tauri-plugin-process` (Cargo + npm), zaregistrované v `lib.rs`.
- **Konfigurace** v `src-tauri/tauri.conf.json`: `bundle.createUpdaterArtifacts: true`, `plugins.updater` s `pubkey` a `endpoints` (placeholdery – viz níže).
- **Capabilities** v `src-tauri/capabilities/desktop.json`: `updater:default`, `process:allow-relaunch`.
- **UI:** Při načtení aplikace (po přihlášení) se jednou zavolá kontrola updatu (`useCheckForAppUpdate` v App). Pokud je k dispozici nová verze, zobrazí se dialog; po potvrzení se update stáhne, nainstaluje a aplikace se restartuje.

### JobiDocs (Electron)

- **Závislost** `electron-updater` v `jobidocs/package.json`.
- **Konfigurace** v `jobidocs/electron-builder.json`: `publish` s placeholder URL (viz níže).
- **Logika** v `jobidocs/electron/main.ts`: po startu (jen v zabalené aplikaci) se volá `autoUpdater.checkForUpdates()`. Při `update-available` se zobrazí hláška, stahování probíhá na pozadí. Při `update-downloaded` se nabídne „Restartovat nyní?“ a po potvrzení `quitAndInstall()`.

---

## Co je potřeba doplnit před prvním OTA releasem

**Nemáš ještě klíče ani URL?** → Postup krok za krokem je v **[docs/OTA_SETUP_KROKY.md](OTA_SETUP_KROKY.md)** (co spustit v terminálu, kam vložit pubkey, kdy nastavit endpoint a TAURI_SIGNING_PRIVATE_KEY).

### 1. Jobi – signing keys a konfigurace

1. **Vygenerovat klíče** (jednou, uložit privátní klíč v bezpečí):
   ```bash
   cd /Volumes/backup/jobi
   npm run tauri signer generate -- -w ~/.tauri/jobi.key
   ```
   Výstup: privátní klíč do souboru, **veřejný klíč** zobrazí v terminálu (nebo v `.pub` souboru).

2. **V `src-tauri/tauri.conf.json`** v `plugins.updater`:
   - **`pubkey`:** vložit **celý obsah** veřejného klíče (ne cestu k souboru). Např. obsah souboru `~/.tauri/jobi.key.pub`.
   - **`endpoints`:** nahradit placeholder skutečnou URL. Možnosti:
     - **Statický JSON** (např. GitHub Releases): např. `https://github.com/VASEREPO/jobi/releases/latest/download/latest.json`. Do Releases při každém vydání přidat soubor `latest.json` ve [formátu Tauri](https://v2.tauri.app/plugin/updater/#static-json-file) (version, platforms.darwin-x86_64 / darwin-aarch64 / windows-x86_64 s url a signature).
     - **Dynamický server:** vlastní endpoint, který podle `{{target}}`, `{{arch}}`, `{{current_version}}` vrací 204 (žádný update) nebo 200 + JSON (url, version, signature).

3. **Při buildu** (CI nebo lokálně) nastavit env:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/jobi.key)"
   npm run tauri build
   ```
   (Nebo `TAURI_SIGNING_PRIVATE_KEY="cesta/k/souboru"`.) Bez toho se updater artefakty (.sig) negenerují.

### 2. JobiDocs – publish URL

V **`jobidocs/electron-builder.json`** v `publish.url` nahradit `https://YOUR_UPDATE_SERVER_OR_GITHUB_RELEASES/` skutečnou základní URL, kam budete nahrávat buildy (např. GitHub Releases, S3, vlastní server). electron-updater odtud stáhne `latest.yml` (nebo obdobný soubor) a instalátor.

Pro **GitHub Releases** lze použít např.:
```json
"publish": { "provider": "github", "owner": "VASE_ORG", "repo": "jobidocs" }
```
a při buildu nastavit `GH_TOKEN`. Viz [electron-builder publish](https://www.electron.build/configuration/publish).

### 3. Otestování

- **Jobi:** Nainstalovat starou verzi (nebo aktuální), na serveru mít novější verzi v `latest.json`. Spustit aplikaci → měl by se zobrazit dialog s updatem → po potvrzení stáhnout a restartovat.
- **JobiDocs:** Obdobně – stará verze, nový build na publish URL, po startu by měla přijít hláška a po stažení nabídka restartu.

---

## Odkazy

- [Tauri 2 – Updater plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri – Signing updates](https://v2.tauri.app/plugin/updater/#signing-updates)
- [electron-builder – Auto Update a Publish](https://www.electron.build/auto-update), [Publish config](https://www.electron.build/configuration/publish)
