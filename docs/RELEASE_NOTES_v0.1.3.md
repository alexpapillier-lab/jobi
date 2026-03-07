# Release v0.1.3

Úpravy release pipeline a JobiDocs: release vždy staví z aktuálního kódu, JobiDocs API vrací správnou verzi.

---

## Opravy a vylepšení

### Release pipeline (Jobi Release App)
- **JobiDocs z aktuální verze** – při kroku „Build JobiDocs“ se před buildem vždy smažou složky `dist`, `dist-electron` a `release`. Release tak vždy používá nejnovější kód a verzi z `package.json`, ne staré cache z předchozího buildu.
- Release App tedy staví Jobi i JobiDocs ze stavu repa v nastavené cestě k Jobi; pro „nejnovější z gitu“ je vhodné před spuštěním release udělat v repu `git pull`.

### JobiDocs
- **API verze** – endpoint `/v1/health` vrací verzi načtenou z `package.json` místo pevně zadané `0.1.0`, takže stav služby odpovídá skutečné verzi aplikace.

---

## Technické

- Jobi Release App: `src-tauri/src/lib.rs` – krok `build_jobidocs` volá `rm -rf dist dist-electron release` před `npm run electron:build:universal`.
- JobiDocs: `api/server.ts` – funkce `getAppVersion()` čte `package.json`, `/v1/health` ji používá pro pole `version`.

---

## Stažení

- **Jobi** – `jobi-0.1.3.dmg` (universal, notarizovaný)
- **JobiDocs** – `JobiDocs-0.1.3.dmg` (universal, notarizovaný) v příloze nebo v sekci Assets

Uživatelé s v0.1.2 mohou aktualizovat přes OTA (kontrola při startu) nebo stáhnout nové DMG.
