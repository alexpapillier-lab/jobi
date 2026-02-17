# JobiDocs – OTA updaty, podpis a notarizace

JobiDocs už má v kódu **electron-updater** a **publish na GitHub** (repo `alexpapillier-lab/jobi`). Při buildu s příslušnými env proměnnými se aplikace podepíše, případně notarizuje a může nahrát artefakty do Releases.

---

## Co je nastavené

- **electron-builder.json:** `publish`: GitHub, owner `alexpapillier-lab`, repo `jobi`.  
  **mac:** `identity` (Developer ID Application), `hardenedRuntime: true` pro notarizaci.
- **electron/main.ts:** `autoUpdater` – kontrola při startu, autoDownload, dialog „Restartovat“ po stažení.

---

## Build a release (macOS)

V adresáři **jobidocs/** spusť:

```bash
cd /Volumes/backup/jobi/jobidocs

# Volitelně: nahrání do GitHub Releases (vyžaduje GH_TOKEN)
export GH_TOKEN="ghp_xxxx..."

# Volitelně: notarizace (stejné heslo jako pro Jobi)
export APPLE_ID="alex.papillier@icloud.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="8ZC264M873"

npm run electron:build
```

Pro **universal** (Intel + Apple Silicon v jednom .app), místo `electron:build` spusť:

```bash
npm run electron:build:universal
```

- **Bez GH_TOKEN:** výstupy jsou v `jobidocs/release/` (JobiDocs.dmg, JobiDocs.zip, latest-mac.yml atd.). Release na GitHubu musíš vytvořit a soubory nahrát ručně.
- **S GH_TOKEN:** electron-builder vytvoří/aktualizuje release (tag podle `version` v package.json, např. `v0.1.0`) a nahraje tam artefakty. OTA pak bude fungovat (aplikace stáhne z `latest-mac.yml` atd.).
- **S APPLE_*:** build se podepíše a po buildu proběhne notarizace (zabere několik minut). Notarizovaný .app bude uvnitř .dmg/.zip.

---

## Verze a stejný repo jako Jobi

Repo je jeden (**jobi**). Tag releasu je odvozen od `version` v **jobidocs/package.json**. Pokud má Jobi v tauri.conf.json `0.1.0` a JobiDocs v package.json taky `0.1.0`, oba můžou sdílet jeden release **v0.1.0** (v jednom release budou jak Jobi soubory, tak JobiDocs soubory). Pokud chceš oddělené tagy, nastav v JobiDocs jinou verzi nebo použij vlastní publish konfiguraci (např. vlastní repo).

---

## Shrnutí

| Cíl | Co udělat |
|-----|-----------|
| OTA updaty | Build s **GH_TOKEN** (nebo ručně nahrát obsah `release/` na GitHub). |
| Podpis .app | V **electron-builder.json** je už **identity** (Developer ID Application). |
| Notarizace | Před buildem nastav **APPLE_ID**, **APPLE_APP_SPECIFIC_PASSWORD**, **APPLE_TEAM_ID**. |

Po prvním úspěšném buildu s GH_TOKEN a (volitelně) notarizací budou uživatelé JobiDocs dostávat updaty přes aplikaci a instalace bez varování od Gatekeeperu.
