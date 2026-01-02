# Mentální model: Kopie dokumenty + vazby na Servis a Zakázky

## 1) Nastavení – Kopie dokumenty

### 1.1 Jak uživatel vybírá typy dokumentů

**UI cesta:** `Nastavení → Zakázky → Kopie dokumenty`

Uživatel vidí:
- **Výběr typu dokumentu** (dropdown/picker):
  - Zakázkový list (`ticketList`)
  - Diagnostický protokol (`diagnosticProtocol`)
  - Záruční list (`warrantyCertificate`)

**Aktuální implementace:**
- Výběr je v komponentě `DocumentTypePicker` v `Settings.tsx`
- Každý typ dokumentu má vlastní sadu nastavení
- Uživatel přepíná mezi typy a upravuje každý zvlášť

### 1.2 Co může uživatel zapnout/vypnout u každého dokumentu

#### **Zakázkový list (`ticketList`):**
- **Sekce:**
  - `includeServiceInfo` - Údaje o servisu (expandovatelné s pod-options)
  - `includeCustomerInfo` - Údaje o zákazníkovi
  - `includeDeviceInfo` - Údaje o zařízení (expandovatelné s pod-options)
  - `includeRepairs` - Provedené opravy (s cenami)
  - `includeDiagnostic` - Diagnostika (text)
  - `includePhotos` - Diagnostické fotografie
  - `includeDates` - Datum vytvoření
  - `includeStamp` - Razítko servisu v footeru

#### **Diagnostický protokol (`diagnosticProtocol`):**
- **Sekce:**
  - `includeServiceInfo` - Údaje o servisu
  - `includeCustomerInfo` - Údaje o zákazníkovi
  - `includeDeviceInfo` - Údaje o zařízení
  - `includeDiagnosticText` - Výsledky diagnostiky (text)
  - `includePhotos` - Diagnostické fotografie
  - `includeDates` - Datum vytvoření protokolu

#### **Záruční list (`warrantyCertificate`):**
- **Sekce:**
  - `includeServiceInfo` - Údaje o servisu
  - `includeCustomerInfo` - Údaje o zákazníkovi
  - `includeDeviceInfo` - Údaje o zařízení
  - `includeRepairs` - Provedené opravy
  - `includeWarranty` - Záruční podmínky
  - `includeDates` - Datum opravy

#### **Granulární kontrola (expandovatelné sekce):**

**Údaje o servisu (`serviceInfoConfig`):**
- `abbreviation` - Zkratka
- `name` - Název
- `ico` - IČO
- `dic` - DIČ
- `addressStreet` - Ulice
- `addressCity` - Město
- `addressZip` - PSČ
- `phone` - Telefon
- `email` - E-mail
- `website` - Web

**Údaje o zařízení (`deviceInfoConfig`):**
- `deviceLabel` - Zařízení
- `serialOrImei` - SN/IMEI
- `devicePasscode` - Heslo/kód (zda zobrazit)
- `devicePasscodeVisible` - Heslo jako text nebo skrýt (křížky)
- `deviceCondition` - Popis stavu
- `requestedRepair` - Požadovaná oprava
- `deviceNote` - Poznámka
- `handoffMethod` - Předání/převzetí
- `externalId` - Externí ID

### 1.3 Vizuální nastavení

**Globální (sdílené pro všechny typy dokumentů):**
- `logoUrl` - Logo servisu (Base64 nebo URL)
- `stampUrl` - Razítko/podpis (Base64 nebo URL)
- `logoSize` - Velikost loga (procenta, default: 100)
- `stampSize` - Velikost razítka (procenta, default: 100)
- `colorMode` - Barevný režim: `"color"` | `"bw"` (černobílý)
- `qrCodeSize` - Velikost QR kódu (pixely, default: 120)

**QR kód pro recenze:**
- `reviewUrl` - URL pro recenzi (custom link)
- `reviewUrlType` - Typ: `"custom"` | `"google"`
- `googlePlaceId` - Google Place ID (pokud `reviewUrlType === "google"`)
- `reviewText` - Text u QR kódu (default: "Budeme rádi za Vaši recenzi")

**Per-dokument design:**
- `design` - Design: `"classic"` | `"modern"` | `"minimal"` | `"professional"`
- `legalText` - Právní text (customizovatelný pro každý typ)

### 1.4 Datový model nastavení

**Typ:** `DocumentsConfig` (TypeScript interface)

**Ukládání:**
1. **localStorage** (primární, pro offline/backward compatibility):
   - Klíč: `STORAGE_KEYS.DOCUMENTS_CONFIG` (aktuálně `"jobsheet_documents_config_v1"`)
   - Formát: JSON string
   - Funkce: `saveDocumentsConfig(config)` a `safeLoadDocumentsConfig()`

2. **Supabase DB** (cloud sync):
   - Tabulka: `service_document_settings`
   - Struktura:
     ```sql
     {
       id: UUID,
       service_id: UUID (FK na services),
       config: JSONB,  // Celý DocumentsConfig objekt
       created_at: TIMESTAMPTZ,
       updated_at: TIMESTAMPTZ
     }
     ```
   - RLS: Pouze členové servisu mohou číst/zapisovat
   - Funkce: `loadDocumentsConfigFromDB(serviceId)` a `saveDocumentsConfigWithDB(serviceId, config)`

**Priorita:**
- **DB wins rule:** Pokud je DB dostupná, použije se konfigurace z DB
- **Fallback:** Pokud DB není dostupná nebo chybí, použije se localStorage
- **Sync:** Při změně se ukládá do obou (localStorage + DB)

**Struktura JSON:**
```typescript
{
  // Globální nastavení
  logoUrl?: string,
  stampUrl?: string,
  reviewUrl?: string,
  reviewUrlType?: "custom" | "google",
  googlePlaceId?: string,
  reviewText?: string,
  colorMode?: "color" | "bw",
  logoSize?: number,
  stampSize?: number,
  qrCodeSize?: number,
  
  // Granulární kontrola
  serviceInfoConfig?: { abbreviation?: boolean, name?: boolean, ... },
  deviceInfoConfig?: { deviceLabel?: boolean, ... },
  
  // Per-dokument nastavení
  ticketList: { includeServiceInfo: boolean, design: "classic", ... },
  diagnosticProtocol: { includeServiceInfo: boolean, design: "classic", ... },
  warrantyCertificate: { includeServiceInfo: boolean, design: "classic", ... }
}
```

### 1.5 Scope nastavení

**Globální pro celý servis:**
- ✅ Všechna nastavení dokumentů jsou **per-servis**
- ✅ Všichni uživatelé jednoho servisu vidí stejné dokumenty
- ✅ Změna nastavení se projeví pro všechny uživatele servisu

**Per-uživatel:**
- ❌ **Žádná** nastavení dokumentů nejsou per-uživatel
- ✅ Pouze UI preference (scale, display mode) jsou per-uživatel

**Per-dokument:**
- ✅ Každý **typ dokumentu** má vlastní nastavení (ticketList, diagnosticProtocol, warrantyCertificate)
- ❌ Ale **ne** per-instance dokumentu (všechny zakázkové listy mají stejné nastavení)

## 2) Nastavení – Servis

### 2.1 Jaké informace o servisu si uživatel nastavuje

**UI cesta:** `Nastavení → Servis → Základní údaje` a `Kontaktní údaje`

**Typ:** `CompanyData` (TypeScript interface)

**Základní údaje:**
- `abbreviation` - Zkratka servisu
- `name` - Název servisu
- `ico` - IČO
- `dic` - DIČ
- `language` - Jazyk (default: "cs")
- `defaultPhonePrefix` - Výchozí telefonní předvolba

**Kontaktní údaje:**
- `addressStreet` - Ulice
- `addressCity` - Město
- `addressZip` - PSČ
- `phone` - Telefon
- `email` - E-mail
- `website` - Web

**Ukládání:**
- **localStorage:** `STORAGE_KEYS.COMPANY` (cache)
- **Supabase DB:** Tabulka `service_settings` (source of truth)
- **Funkce:** `safeLoadCompanyData()` a `saveCompanyData()`

### 2.2 Automatické propisování do dokumentů

**Co se automaticky propisuje:**
- ✅ Všechny údaje ze `CompanyData` se propisují do dokumentů
- ✅ Pokud je v dokumentu zapnutá sekce "Údaje o servisu" (`includeServiceInfo === true`)
- ✅ Zobrazí se pouze ty údaje, které jsou zapnuté v `serviceInfoConfig`

**Priorita:**
1. **Nastavení dokumentu (`serviceInfoConfig`)** - rozhoduje, **co** se zobrazí
2. **Data ze servisu (`CompanyData`)** - poskytuje **hodnoty**

**Příklad:**
- Pokud `serviceInfoConfig.name === true` → zobrazí se `companyData.name`
- Pokud `serviceInfoConfig.name === false` → `companyData.name` se nezobrazí (i když existuje)

### 2.3 Vztah mezi "Servis" a "Kopie dokumenty"

**Logo a razítko:**
- Logo a razítko se ukládají v `DocumentsConfig` (ne v `CompanyData`)
- Jsou součástí vizuálního nastavení dokumentů
- Můžou být různé pro různé typy dokumentů (ale aktuálně jsou globální)

**Priorita:**
1. **DocumentsConfig** - rozhoduje o **vizuálním vzhledu** a **co se zobrazí**
2. **CompanyData** - poskytuje **obsahové údaje** (název, adresa, IČO, atd.)

**Žádné přepisování:**
- Dokument **nemůže** přepsat údaje ze servisu
- Dokument může pouze **skrýt** některé údaje (přes `serviceInfoConfig`)

## 3) Použití v praxi – Zakázky

### 3.1 Flow při otevření zakázky a tisku dokumentu

**Krok 1: Uživatel otevře zakázku**
- Zobrazí se detail zakázky s daty: zařízení, zákazník, opravy, diagnostika, fotky, ceny, atd.

**Krok 2: Uživatel chce vytisknout dokument**
- V detailu zakázky je tlačítko pro tisk (např. "Tisknout zakázkový list")
- Nebo: `Nastavení → Kopie dokumenty` → výběr typu → náhled → tisk

**Krok 3: Generování dokumentu**

**Funkce:** `generateTicketHTML()`, `generateDiagnosticProtocolHTML()`, `generateWarrantyHTML()`

**Vstupní parametry:**
```typescript
generateTicketHTML(
  ticket: TicketEx,        // Data ze zakázky
  forPrint: boolean,       // true pro tisk, false pro preview
  config?: DocumentsConfig, // Nastavení dokumentu (volitelné, fallback na localStorage)
  _includeActions: boolean // Zda zahrnout akční tlačítka (deprecated)
)
```

**Proces:**
1. **Načtení nastavení:**
   - `config || safeLoadDocumentsConfig()` - nastavení dokumentu
   - `safeLoadCompanyData()` - údaje o servisu

2. **Aplikace nastavení:**
   - Design (classic/modern/minimal/professional)
   - Color mode (color/bw)
   - Logo, razítko, QR kód
   - Které sekce zobrazit (podle `include*` flags)

3. **Naplnění daty ze zakázky:**
   - `ticket.customerName`, `ticket.customerPhone`, ... → sekce "Zákazník"
   - `ticket.deviceLabel`, `ticket.serialOrImei`, ... → sekce "Zařízení"
   - `ticket.performedRepairs` → sekce "Provedené opravy" (s cenami)
   - `ticket.diagnosticText` → sekce "Diagnostika"
   - `ticket.diagnosticPhotos` → sekce "Diagnostické fotografie"
   - `ticket.code`, `ticket.createdAt` → hlavička dokumentu

4. **Aplikace údajů o servisu:**
   - `companyData.name`, `companyData.addressStreet`, ... → sekce "Servis"
   - Pouze pokud `config.serviceInfoConfig.* === true`

5. **Generování HTML:**
   - Vytvoří se kompletní HTML string s inline CSS
   - Aplikují se design-specific styles
   - Aplikují se print-specific CSS (A4 layout, fit-to-page, atd.)

**Krok 4: Zobrazení/Tisk**
- **Preview:** HTML se zobrazí v React komponentě (`ReactDocumentPreview`)
- **Tisk:** HTML se otevře v novém Tauri `WebviewWindow` s auto-print scriptem

### 3.2 Jak se propisují data ze zakázky

**Mapování dat:**
- `ticket.customerName` → "Jméno:" v sekci Zákazník
- `ticket.customerPhone` → "Telefon:" v sekci Zákazník
- `ticket.deviceLabel` → "Zařízení:" v sekci Zařízení
- `ticket.performedRepairs[]` → seznam oprav s cenami
- `ticket.diagnosticText` → text diagnostiky
- `ticket.diagnosticPhotos[]` → grid obrázků
- `ticket.code` → kód zakázky v hlavičce
- `ticket.createdAt` → datum v hlavičce

**Podmíněné zobrazení:**
- Sekce se zobrazí pouze pokud:
  1. `config.ticketList.include* === true` (nastavení dokumentu)
  2. A data existují (např. `ticket.performedRepairs.length > 0`)

### 3.3 Aplikace nastavení z "Kopie dokumenty"

**Design:**
- `config.ticketList.design` → aplikuje se design-specific CSS (barvy, border-radius, atd.)

**Sekce:**
- `config.ticketList.includeServiceInfo` → zobrazí/skryje sekci "Servis"
- `config.serviceInfoConfig.name` → zobrazí/skryje konkrétní pole "Název"

**Vizuální:**
- `config.logoUrl` → logo v hlavičce
- `config.stampUrl` → razítko v footeru
- `config.colorMode` → černobílý/barevný režim
- `config.reviewUrl` + `config.googlePlaceId` → QR kód pro recenze

### 3.4 Aplikace informací ze "Servis"

**Automatické:**
- `companyData.name` → "Název:" v sekci Servis
- `companyData.addressStreet` → "Adresa:" v sekci Servis
- `companyData.phone` → "Telefon:" v sekci Servis
- atd.

**Podmíněné:**
- Zobrazí se pouze pokud `config.serviceInfoConfig.* === true`

## 4) Co je dnes lokální vs. co plánujeme do cloudu

### 4.1 Aktuální stav

**Čistě lokální (per zařízení/per uživatel):**
- ❌ **Žádná** nastavení dokumentů nejsou čistě lokální
- ✅ Pouze UI preference (`UI_SETTINGS`) jsou lokální

**Sdílené v rámci servisu:**
- ✅ **Všechna** nastavení dokumentů (`DocumentsConfig`) jsou per-servis
- ✅ Údaje o servisu (`CompanyData`) jsou per-servis
- ✅ Ukládají se v Supabase DB v tabulkách:
  - `service_document_settings` (config JSONB)
  - `service_settings` (company data)

**Hybridní přístup:**
- ✅ **localStorage jako cache** - pro rychlý přístup a offline režim
- ✅ **DB jako source of truth** - pro sync mezi uživateli
- ✅ **DB wins rule** - pokud je DB dostupná, přepíše localStorage

### 4.2 Ideální cloudový model

**Doporučení:**

1. **Všechna nastavení dokumentů → DB (per-servis)**
   - ✅ Už implementováno
   - ✅ Všichni uživatelé servisu vidí stejné dokumenty
   - ✅ Změna se okamžitě projeví všem

2. **Role a práva:**
   - **Owner/Admin:** Může měnit všechna nastavení
   - **Member:** Může měnit nastavení (aktuálně všichni mohou)
   - **Read-only:** Pouze čtení (není implementováno)

3. **Výjimky a override:**
   - ❌ **Nedoporučuji** per-uživatel override (bylo by matoucí)
   - ✅ **Doporučuji** per-role práva (kdo může měnit)
   - ✅ **Doporučuji** "locked" flag pro kritická nastavení (logo, razítko)

4. **Verzování:**
   - ✅ Už implementováno (suffix `_v1`, `_v2`)
   - ✅ Při změně struktury se bump verze

5. **Sync a konflikty:**
   - ✅ **Last-write-wins** (aktuální přístup)
   - ⚠️ **Problém:** Pokud dva uživatelé mění současně, jeden přepíše druhého
   - 💡 **Řešení:** Optimistic locking (version field) nebo real-time sync (Supabase Realtime)

## 5) Known issues / edge cases

### 5.1 Problémy při více uživatelích v jednom servisu

**Problém 1: Současné změny nastavení**
- **Scénář:** Uživatel A a B mění nastavení současně
- **Důsledek:** Last-write-wins → jeden přepíše druhého
- **Řešení:** Optimistic locking nebo real-time sync

**Problém 2: Cache invalidation**
- **Scénář:** Uživatel A změní nastavení, uživatel B má starou verzi v localStorage
- **Důsledek:** Uživatel B vidí staré nastavení, dokud neobnoví stránku
- **Řešení:** Real-time subscription na změny nebo periodické refresh

**Problém 3: Offline režim**
- **Scénář:** Uživatel je offline, změní nastavení
- **Důsledek:** Změna se uloží jen do localStorage, ne do DB
- **Řešení:** Queue změn a sync při připojení (není implementováno)

### 5.2 Problémy při změně nastavení dokumentu

**Problém 1: Staré zakázky**
- **Scénář:** Uživatel vytiskne zakázku, pak změní nastavení dokumentu
- **Důsledek:** Staré vytištěné dokumenty mají starý vzhled (OK, je to snapshot)
- **Problém:** Pokud uživatel znovu vytiskne stejnou zakázku, bude mít nový vzhled
- **Řešení:** ✅ Toto je **správné chování** - dokumenty se generují vždy aktuálně

**Problém 2: Historická konzistence**
- **Scénář:** Uživatel chce vidět, jak dokument vypadal v době vytištění
- **Důsledek:** Není možné - dokumenty se vždy generují s aktuálním nastavením
- **Řešení:** 💡 Uložit snapshot nastavení do zakázky při prvním tisku (není implementováno)

### 5.3 Problémy při tisku, exportu, sdílení

**Problém 1: Tisk z různých zařízení**
- **Scénář:** Uživatel A nastaví logo, uživatel B tiskne na jiném zařízení
- **Důsledek:** ✅ Funguje správně - logo se načte z DB
- **Problém:** Pokud logo je Base64, může být velké a pomalé
- **Řešení:** 💡 Ukládat logo jako URL (S3/Cloudinary) místo Base64

**Problém 2: Export do PDF**
- **Scénář:** Uživatel exportuje dokument do PDF
- **Důsledek:** ✅ Funguje správně - PDF obsahuje aktuální nastavení
- **Problém:** PDF se generuje na klientovi (pomalejší)
- **Řešení:** 💡 Server-side PDF generování (není implementováno)

**Problém 3: Sdílení se zákazníkem**
- **Scénář:** Uživatel chce poslat dokument zákazníkovi e-mailem
- **Důsledek:** ❌ Není implementováno
- **Řešení:** 💡 Export do PDF + e-mail attachment nebo shareable link

**Problém 4: Offline tisk**
- **Scénář:** Uživatel je offline, chce tisknout
- **Důsledek:** ✅ Funguje - použije se localStorage cache
- **Problém:** Pokud cache není aktuální, může být staré nastavení
- **Řešení:** ✅ Toto je akceptovatelné - offline režim má limity

## 6) Vlastní názor (z pohledu uživatele)

### 6.1 Co by v UI chybělo

**1. Preview změn v reálném čase**
- ✅ Už implementováno v "Kopie dokumenty"
- 💡 Ale chybí preview při změně nastavení v "Dokumenty" (stará sekce)

**2. Snadné resetování na default**
- ❌ Není tlačítko "Resetovat na výchozí"
- 💡 Přidat "Obnovit výchozí nastavení" pro každý typ dokumentu

**3. Export/Import nastavení**
- ❌ Není možné exportovat/importovat konfiguraci
- 💡 Přidat "Exportovat nastavení" a "Importovat nastavení" (JSON)

**4. Template dokumentů**
- ❌ Není možné vytvořit šablony dokumentů
- 💡 Přidat "Uložit jako šablonu" a "Načíst šablonu"

**5. Verze nastavení**
- ❌ Není historie změn nastavení
- 💡 Přidat "Historie změn" a "Vrátit se na verzi X"

### 6.2 Co by bylo matoucí

**1. Dvě sekce pro dokumenty**
- ⚠️ Existují **dvě** sekce: "Dokumenty" (HTML) a "Kopie dokumenty" (React)
- 💡 **Sloučit** do jedné sekce nebo jasně označit rozdíl

**2. Nekonzistentní názvy**
- ⚠️ "Kopie dokumenty" vs "Dokumenty" - není jasné, co je rozdíl
- 💡 Přejmenovat na "Náhled dokumentů" a "Tisk dokumentů" nebo sloučit

**3. Skryté závislosti**
- ⚠️ Pokud uživatel vypne "Údaje o servisu", ale neví, že data jsou z "Nastavení → Servis"
- 💡 Přidat tooltip nebo link "Údaje se načítají z Nastavení → Servis"

**4. Logo a razítko v dokumentech, ne v servisu**
- ⚠️ Logo a razítko se nastavují v "Kopie dokumenty", ne v "Servis"
- 💡 Přesunout do "Servis" nebo přidat link "Nastavit v Servis"

**5. Granulární kontrola je skrytá**
- ⚠️ Expandovatelné sekce (Údaje o servisu, Údaje o zařízení) nejsou na první pohled viditelné
- 💡 Přidat indikátor, že sekce je expandovatelná (chevron, badge)

### 6.3 Co by mělo být "zamčené"

**1. Kritická nastavení (pro majitele servisu)**
- 🔒 **Logo a razítko** - pouze Owner/Admin může měnit
- 🔒 **Právní texty** - pouze Owner/Admin může měnit
- ✅ Ostatní nastavení - všichni členové mohou měnit

**2. Design a barvy**
- ✅ Všichni mohou měnit (je to preference)
- 💡 Ale možná přidat "Zamknout design" pro konzistenci

**3. Granulární kontrola**
- ✅ Všichni mohou měnit (je to preference)
- 💡 Ale možná přidat "Zamknout strukturu dokumentu" pro konzistenci

**4. Výchozí nastavení**
- 🔒 **Default hodnoty** - pouze systém může měnit
- ✅ Uživatel může přepsat, ale nemůže změnit default

### 6.4 Doporučení pro zlepšení UX

**1. Wizard pro první nastavení**
- 💡 Při prvním otevření "Kopie dokumenty" zobrazit wizard:
  - Krok 1: Vyberte typ dokumentu
  - Krok 2: Nahrajte logo
  - Krok 3: Nahrajte razítko
  - Krok 4: Vyberte design
  - Krok 5: Zkontrolujte náhled

**2. Side-by-side preview**
- 💡 Při změně nastavení zobrazit náhled vedle formuláře (ne pod ním)

**3. Undo/Redo**
- 💡 Přidat "Zpět" a "Znovu" pro změny nastavení

**4. Validace**
- 💡 Validovat, že logo a razítko jsou správný formát (obrázek)
- 💡 Validovat, že URL pro recenze je platná

**5. Nápověda a tooltips**
- 💡 Přidat tooltips u každého nastavení s vysvětlením
- 💡 Přidat "Nápověda" tlačítko s dokumentací

**6. Testovací tisk**
- 💡 Přidat "Testovací tisk" tlačítko, které vytiskne dokument s testovacími daty

---

## Shrnutí

**Aktuální stav:**
- ✅ Nastavení dokumentů jsou per-servis (cloud)
- ✅ Hybridní přístup (localStorage cache + DB source of truth)
- ✅ Granulární kontrola sekcí a polí
- ✅ Vizuální customizace (design, barvy, logo, razítko)
- ⚠️ Dvě sekce pro dokumenty (matoucí)
- ⚠️ Chybí role a práva
- ⚠️ Chybí historie změn

**Doporučení:**
1. Sloučit "Dokumenty" a "Kopie dokumenty" do jedné sekce
2. Přidat role a práva (Owner/Admin/Member/Read-only)
3. Přesunout logo a razítko do "Servis" nebo přidat link
4. Přidat export/import nastavení
5. Přidat real-time sync pro změny nastavení
6. Přidat wizard pro první nastavení
7. Přidat validaci a nápovědu

