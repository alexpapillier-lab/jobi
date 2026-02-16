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

Když budeš chtít konkrétní kroky pro Tauri (signingIdentity, notarize skript) nebo pro JobiDocs (CSC_*, notarize), můžeme je doplnit do tohoto návodu nebo do OTA_SETUP_KROKY.
