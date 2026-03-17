# Instalace klientům – podepisování a distribuce

Jak budou klienti instalovat Jobi a JobiDocs a jestli je potřeba je podepisovat.

---

## Možnosti (macOS)

### 1. Bez podpisu (aktuální stav)

- **Build** vyjde normálně (Tauri i Electron).
- **Klient** stáhne např. `.dmg` nebo `.app` v zipu a otevře ho.
- **macOS zobrazí varování:** „Aplikace od neidentifikovaného vývojáře“ a blokuje spuštění.
- **Klient to obejde:** Klik pravým na aplikaci → **Otevřít** (ne dvojklik), nebo v **Předvolby systému → Zabezpečení a soukromí** povolit spuštění. Po prvním povolení už to jde normálně.
- **Nevýhody:** Působí to nedůvěryhodně, někteří uživatelé nevědí, jak na to, na striktně nastavených Macích může admin zakázat nepodepsané aplikace.

**Shrnutí:** Jde to bez podpisu, ale instalace je pro běžného uživatele nepohodlná a méně důvěryhodná.

---

### 2. S podpisem (doporučeno pro „normální“ distribuci)

Potřebuješ **Apple Developer účet** (cca 99 USD/rok): https://developer.apple.com

- V **Certificates, Identifiers & Profiles** si vytvoříš certifikát **Developer ID Application** (pro distribuci mimo App Store).
- V **Tauri:** V `src-tauri/tauri.conf.json` v `bundle.macOS` nastavíš `signingIdentity` na název certifikátu (např. `"Developer ID Application: Tvé Jméno (TEAM_ID)"`). Volitelně zapneš `hardenedRuntime: true` (potřebné pro notarizaci).
- V **Electron (JobiDocs):** electron-builder umí podepisovat – v konfiguraci nastavíš `CSC_NAME` nebo env s názvem certifikátu; v `mac.identity` můžeš uvést identitu.
- **Výsledek:** Aplikace je podepsaná. macOS ji neoznačí jako „nepocházející od vývojáře“, ale na **novějších macOS (10.15+)** Apple stejně může zobrazit upozornění, dokud aplikaci **nenotarizuješ** (viz níže).

---

### 3. Podpis + notarizace (nejpohodlnější pro klienty)

**Notarizace** = Apple aplikaci proskenuje a „schválí“. Po stažení pak macOS neukáže žádné varování a instalace proběhne hladce.

- Potřebuješ Apple Developer účet + **App-specific password** (pro notarizační nástroje).
- **Tauri:** Po buildu podepsané aplikace ji nahraješ k Apple (`xcrun notarytool submit jobi.app.zip ...`), počkáš na schválení, pak „připíchneš“ notarizační lístek k aplikaci (`xcrun stapler staple ...`). Dá se zautomatizovat skriptem.
- **Electron (JobiDocs):** electron-builder umí notarizaci sám, když nastavíš `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` a `APPLE_TEAM_ID`. Používá pod kapotou např. `@electron/notarize` nebo `electron-notarize`.

**Výsledek:** Klient stáhne .dmg / .app, otevře a používá – žádné ruční povolování.

---

## Co z toho vybrat

| Situace | Doporučení |
|--------|------------|
| Interní / pár známých uživatelů | **Bez podpisu** – stačí jim říct „pravý klik → Otevřít“ nebo povolit v Systémových předvolbách. |
| Běžní klienti, profesionální dojem | **Podpis** (Developer ID). Jednorázová práce s certifikátem a nastavením konfigu. |
| Maximum pohodlí pro klienty, žádná varování | **Podpis + notarizace.** Roční poplatek Apple + nastavení notarizace v buildu. |

**Windows:** Tam má smysl podpis „code signing“ certifikátem (od Comodo, DigiCert atd.) – jinak SmartScreen může varovat. Není to nutné pro funkčnost, jen pro důvěru a méně varování.

---

## Shrnutí

- **Nepodepsané aplikace** klientům nainstalovat jdou – musí ale jednou povolit „neidentifikovaného vývojáře“ (pravý klik → Otevřít nebo Systémové předvolby).
- **Podpis** (Apple Developer ID na Macu) zlepší důvěru a sníží varování; pro hladkou instalaci na současných Macích je ideální i **notarizace**.
- **Nemusíš** mít nic podepsané, aby OTA fungovalo – OTA podepisování (Tauri updater) je nezávislé na tom, jestli je samotná .app podepsaná Apple certifikátem.

---

## Notarizace Jobi – konkrétní kroky

Notarizace = pošleš Apple podepsanou .app (v zipu), Apple ji proskenuje a vrátí „schváleno“. Ty pak k .app připíchneš notarizační lístek. Na cizích Macích pak Gatekeeper aplikaci neblokuje.

### 1. App-specific heslo (jednou)

- Jdi na **https://appleid.apple.com** → přihlášení → **Sign-In and Security** → **App-Specific Passwords**.
- Vytvoř nové heslo (název např. „Notarization Jobi“) a **ulož si ho** – zobrazí se jen jednou.

### 2. Build podepsané aplikace

- V `tauri.conf.json` máš už `signingIdentity` (Developer ID Application).
- Pro notarizaci Apple vyžaduje **Hardened Runtime**. V `tauri.conf.json` v `bundle.macOS` nastav `"hardenedRuntime": true`. (Pokud notarizace selže s chybou v logu, může být potřeba doplnit `entitlements` – pak dle chyby.)
- Spusť build:  
  `npm run tauri:build:universal:signed`  
  Výstup: `src-tauri/target/release/bundle/macos/jobi.app` (a OTA artefakty).

### 3. Odeslání k Apple (notarytool)

V terminálu (nahraď e-mail a heslo):

```bash
cd /Volumes/backup/jobi

# .app zabal do zipu (Apple chce zip)
ditto -c -k --keepParent src-tauri/target/release/bundle/macos/jobi.app jobi-notarize.zip

# Odeslat k Apple (--wait = počkat na výsledek)
xcrun notarytool submit jobi-notarize.zip \
  --apple-id "TVŮJ_APPLE_ID_EMAIL" \
  --password "APP-SPECIFIC-HESLO" \
  --team-id "8ZC264M873" \
  --wait
```

- **Apple ID** = e-mail tvého Apple účtu (stejný jako Developer).
- **Password** = app-specific heslo z kroku 1 (ne běžné heslo k účtu).
- **Team ID** = `8ZC264M873` (z certifikátu).

Pokud je vše v pořádku, ukončí to s „Accepted“.

### 4. Připíchnutí notarizačního lístku (staple)

Po „Accepted“ připoj lístek k .app:

```bash
xcrun stapler staple src-tauri/target/release/bundle/macos/jobi.app
```

Ověření:

```bash
xcrun stapler validate src-tauri/target/release/bundle/macos/jobi.app
```

### 5. Distribuce

Notarizovaná je teď **jobi.app** v `src-tauri/target/release/bundle/macos/`. Můžeš:

- Znovu zabalit do **.dmg** nebo **.zip** a dát klientům (např. na web / GitHub Releases).
- Nebo použít už existující `jobi.app.tar.gz` pro OTA – ale pro OTA updater se obvykle používá stejný podepsaný .app; pokud chceš notarizovaný i pro OTA, musíš notarizovat .app a z ní pak vytvořit .tar.gz (nebo notarizovat až výsledný .tar.gz – Apple ale notarizuje .app, .dmg, .pkg, .zip; pro .app v zipu notarizuješ zip, pak staple na .app uvnitř, jak výše).

**Jobi .dmg (jeden soubor ke sdílení):** Stačí nasdílet Jobi .dmg – klient si nainstaluje jen Jobi. JobiDocs si stáhne až v aplikaci (dialog „Stáhnout JobiDocs“ otevře odkaz na GitHub Releases). Pro vytvoření .dmg z notarizované .app spusť po notarizaci:  
`./scripts/create-jobi-dmg.sh`  
Výstup: `jobi-<verze>.dmg` v kořeni projektu; ten nahraj na release.

**Poznámka:** Skript `scripts/notarize-jobi.sh` (viz níže) to dělá za tebe, když nastavíš env proměnné.

### 6. OTA s notarizovanou .app (každý release)

Aby i updaty stažené přes aplikaci byly notarizované:

1. Build: `npm run tauri:build:universal:signed`
2. Notarizace: `export NOTARY_APPLE_ID=... NOTARY_APPLE_PASSWORD=... NOTARY_TEAM_ID=...` a `./scripts/notarize-jobi.sh`
3. Po „Accepted“ spusť **`./scripts/pack-notarized-ota.sh`** (načte klíč z `~/.tauri/jobi.key`). Skript zabalí notarizovanou .app do .tar.gz, podepíše pro OTA a vygeneruje `latest.json`.
4. Volitelně: **`./scripts/create-jobi-dmg.sh`** – vytvoří `jobi-<verze>.dmg` pro přímé sdílení (klient stáhne jeden .dmg, JobiDocs pak přes odkaz v aplikaci).
5. Nahraj na GitHub Release: `latest.json`, `jobi.app.tar.gz`, `jobi.app.tar.gz.sig`; pokud jsi vytvořil .dmg, přidej i `jobi-<verze>.dmg`.

---

## Skript pro notarizaci (volitelně)

V repozitáři je skript `scripts/notarize-jobi.sh`. Před spuštěním nastav v terminálu:

```bash
export NOTARY_APPLE_ID="tvuj@email.com"
export NOTARY_APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific heslo
export NOTARY_TEAM_ID="8ZC264M873"
```

Pak (z kořene projektu, po buildu):

```bash
./scripts/notarize-jobi.sh
```

Skript zabalí `src-tauri/target/release/bundle/macos/jobi.app` do zipu, pošle ho do notarytool, počká na výsledek a v případě úspěchu spustí `stapler staple` na .app.
