# OTA – co udělat, když ještě nemáš klíče ani URL

Níže jsou **konkrétní kroky**. Detailní návod je v jednotlivých sekcích; tato stránka obsahuje i **checklist před prvním releasem**.

---

## Před prvním releasem – checklist

Udělej to **před tím**, než poprvé vydáš Jobi a JobiDocs uživatelům. Do buildu se „zapeče“ konfigurace – když první verze vyjde s placeholdery, nikdy nebude umět stáhnout update.

**Můžeš to udělat už teď** – klidně i v průběhu dalšího vývoje. Vygenerované klíče a nastavený pubkey/endpoint/publish se nemění při každé změně kódu. Až budeš chtít opravdu vydat první verzi, stačí při tom buildu nastavit `TAURI_SIGNING_PRIVATE_KEY` (a u JobiDocs např. `GH_TOKEN`) a nahrát výstupy na server. Mezitím můžeš normálně vyvíjet a buildit bez těchto env proměnných (dev build nebo „bez podpisu“ jen nebude mít OTA artefakty).

### Jobi (Tauri)

1. [ ] **Vygenerovat klíče** – v terminálu spustit `npm run tauri signer generate -- --write-keys ~/.tauri/jobi.key` (viz Krok 1 níže).
2. [ ] **Vložit pubkey** do `src-tauri/tauri.conf.json` (nahradit `REPLACE_AFTER_TAURI_SIGNER_GENERATE`) – viz Krok 2.
3. [ ] **Nastavit endpoint** v `src-tauri/tauri.conf.json` v `plugins.updater.endpoints` – reálná URL (GitHub Releases nebo vlastní server). Pro GitHub např. `https://github.com/TVUJ_ORG/TVUJ_REPO/releases/latest/download/latest.json` – viz Krok 3.
4. [ ] **Při buildu prvního releasu** (a každého dalšího) nastavit `TAURI_SIGNING_PRIVATE_KEY` – viz Krok 4.
5. [ ] Po buildu **nahrát na endpoint** soubor `latest.json` + instalátor a `.sig` (z `src-tauri/target/release/bundle/...`) dle [Tauri Static JSON](https://v2.tauri.app/plugin/updater/#static-json-file).

### JobiDocs (Electron)

1. [ ] **Nastavit `publish`** v `jobidocs/electron-builder.json` – buď GitHub (`provider: "github"`, `owner`, `repo`) nebo generic URL. Při buildu s GitHubem nastavit `GH_TOKEN` – viz sekce JobiDocs níže.
2. [ ] Při prvním (a každém dalším) buildu **nahrát výstupy** na zvolené místo; u GitHubu to electron-builder může dělat sám s `GH_TOKEN`.

Až budeš mít vše zaškrtnuté, první vydaná verze bude umět v budoucnu stahovat updaty. Pak můžeš normálně vydávat další verze a uživatelé je dostanou přes OTA.

---

## Jobi (Tauri)

### Krok 1: Vygenerovat klíče (jednou, na svém počítači)

V **běžném terminálu** (ne v CI), v kořeni projektu:

```bash
cd /Volumes/backup/jobi
mkdir -p ~/.tauri
npm run tauri signer generate -- --write-keys ~/.tauri/jobi.key
```

- Program se zeptá na **heslo** k privátnímu klíči (můžeš nechat prázdné Enterem, nebo heslo zadat a zapamatovat si ho).
- Vytvoří se soubory:
  - **`~/.tauri/jobi.key`** – privátní klíč (nikdy nikomu neposílej, necommituj).
  - **`~/.tauri/jobi.key.pub`** – veřejný klíč (ten vložíš do konfigurace).

### Krok 2: Vložit pubkey do tauri.conf.json

1. Otevři soubor **veřejného** klíče a zkopíruj **celý** jeho obsah (včetně řádků `-----BEGIN PUBLIC KEY-----` a `-----END PUBLIC KEY-----`):

   ```bash
   cat ~/.tauri/jobi.key.pub
   ```

2. Otevři **`src-tauri/tauri.conf.json`** a v sekci `plugins.updater` nahraď řetězec `REPLACE_AFTER_TAURI_SIGNER_GENERATE` tímto obsahem.  
   V JSONu musí být klíč na **jednom řádku** s odřádkováním nahrazeným za `\n`, např.:

   ```json
   "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----"
   ```

   (Jednotlivé řádky z `.pub` souboru spoj do jednoho řetězce a mezi ně vlož `\n`.)

### Krok 3: Nastavit endpoint pro updaty (až budeš mít kam nahrávat)

V **`src-tauri/tauri.conf.json`** v `plugins.updater.endpoints` nahraď placeholder reálnou URL. Možnosti:

- **GitHub Releases** (máš-li repozitář):
  - URL např.: `https://github.com/TVUJ_ORG/TVUJ_REPO/releases/latest/download/latest.json`
  - Při každém releasu nahraješ do Releases soubor **`latest.json`** ve formátu podle [Tauri – Static JSON](https://v2.tauri.app/plugin/updater/#static-json-file) (version, platforms s url a signature).

- **Vlastní server**  
  Nastavíš URL svého endpointu, který vrací JSON podle [Tauri updater](https://v2.tauri.app/plugin/updater/) (např. dynamický server).

**Zatím nic nemusíš mít** – v konfigu může zůstat placeholder; aplikace se zbuildí a při kontrole updatu jen nic nenajde (žádná chyba uživateli).

### Krok 4: Build s podpisem (až budeš vydávat instalátor s OTA)

Při buildu, který má generovat updater artefakty (`.sig` soubory), nastav privátní klíč:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/jobi.key)"
npm run tauri build
```

Nebo (pokud má klíč heslo):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/jobi.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="tvoje_heslo"
npm run tauri build
```

- **Lokálně:** příkazy spusť v terminálu.
- **CI (GitHub Actions atd.):** ulož obsah `jobi.key` (nebo cestu a heslo) do **Secret** a v jobu nastav `TAURI_SIGNING_PRIVATE_KEY` (a volitelně `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

---

## JobiDocs (Electron)

V **`jobidocs/electron-builder.json`** je v `publish` placeholder URL. Až budeš mít místo, kam nahrávat buildy:

1. Otevři **`jobidocs/electron-builder.json`**.
2. V `publish` nastav reálnou konfiguraci. Příklady:

   **GitHub Releases (doporučeno, máš-li repo):**

   ```json
   "publish": {
     "provider": "github",
     "owner": "TVUJ_GITHUB_USER_NEBO_ORG",
     "repo": "jobidocs"
   }
   ```

   Při buildu pak nastav env **`GH_TOKEN`** (token s právy pro zápis do repo). electron-builder sám nahrává do Releases a vytvoří `latest-mac.yml` atd.

   **Vlastní server (generic):**

   ```json
   "publish": {
     "provider": "generic",
     "url": "https://tvuj-server.cz/releases/jobidocs/"
   }
   ```

   Na ten server pak při každém releasu nahráš výstupy z `jobidocs/release/` (včetně souborů typu `latest-mac.yml`).

**Zatím** může v konfigu zůstat placeholder – JobiDocs se zbuildí a běží; kontrola updatu jen nic nenajde, dokud tam žádné buildy nebudou.

---

## Shrnutí

| Co | Kdy to udělat |
|----|----------------|
| Jobi: `tauri signer generate` + vložit pubkey do `tauri.conf.json` | **Před prvním releasem** – jinak první verze nebude umět ověřit budoucí updaty. |
| Jobi: nastavit `endpoints` na reálnou URL | **Před prvním releasem** – první verze musí mít v konfigu cílovou URL. |
| Jobi: při buildu `TAURI_SIGNING_PRIVATE_KEY` | Při každém buildu releasu (lokálně i v CI). |
| JobiDocs: upravit `publish` v `electron-builder.json` | **Před prvním releasem** – první verze musí vědět, odkud stahovat updaty. |

Vše z tabulky je zahrnuto v **checklistu „Před prvním releasem“** nahoře na této stránce.
