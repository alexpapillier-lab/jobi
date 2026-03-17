# Jak testovat Jobi a JobiDocs

Tři způsoby podle toho, co zrovna potřebuješ.

---

## 1. Vývoj (nejrychlejší, bez buildu)

**Kdy:** Během vývoje, chci okamžitě vidět změny.

- **Jobi:**
  ```bash
  cd /Volumes/backup/jobi && npm run tauri dev
  ```
- **JobiDocs** (druhý terminál):
  ```bash
  cd /Volumes/backup/jobi/jobidocs && npm run electron:dev
  ```

Hot reload, žádný build. Tisk z Jobi na JobiDocs funguje (JobiDocs API běží v Electronu).

---

## 2. Test „jako produkce“ (build, ale bez instalátoru)

**Kdy:** Chci otestovat sestavenou verzi – chování v .app, tisk, integrace – ale nepotřebuji zip na plochu.

- **Jednorázový build** (až změníš kód):
  ```bash
  cd /Volumes/backup/jobi && bash scripts/run-built-apps.sh --build
  ```
- **Jen spustit už sestavené:**
  ```bash
  cd /Volumes/backup/jobi && bash scripts/run-built-apps.sh
  ```

Skript otevře `jobi.app` a `JobiDocs.app` z `src-tauri/target/...` a `jobidocs/release/...`. Žádné zipování ani kopírování.

---

## 3. Instalační balíček (pro předání na test)

**Kdy:** Chceš dát build někomu jinému nebo na jiný počítač.

- **Rychlejší** (jedna architektura):
  ```bash
  cd /Volumes/backup/jobi && bash scripts/build-test-release.sh
  ```
  → `jobi-test-release.zip` v kořeni (obsahuje jobi.app + JobiDocs.app).

- **Univerzální Mac** (Intel + Apple Silicon):
  ```bash
  cd /Volumes/backup/jobi && bash scripts/build-jobi-and-jobidocs.sh
  ```
  → `jobi-export.zip`.

Zip pak zkopíruješ kam potřebuješ (např. na Plochu), rozbalíš a .app přetáhneš do Aplikací.

---

## Shrnutí

| Cíl                         | Příkaz |
|----------------------------|--------|
| Denní vývoj Jobi            | `cd /Volumes/backup/jobi && npm run tauri dev` |
| Denní vývoj JobiDocs       | `cd /Volumes/backup/jobi/jobidocs && npm run electron:dev` |
| Test buildu bez zipu       | `cd /Volumes/backup/jobi && bash scripts/run-built-apps.sh` (příp. `--build`) |
| Balíček pro někoho jiného  | `cd /Volumes/backup/jobi && bash scripts/build-test-release.sh` nebo `build-jobi-and-jobidocs.sh` |

Instalační balíček tedy vytvářej jen když ho opravdu potřebuješ; pro vlastní testování stačí dev režim nebo `run-built-apps.sh`.
