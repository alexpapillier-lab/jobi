# Release v0.1.8

Export PDF přes JobiDocs, tisk a export reklamace přes JobiDocs, vylepšení náhledu a šablon dokumentů.

---

## Novinky a vylepšení

### Jobi – Export a tisk dokumentů

- **Export ze zakázky** – při exportu zakázkového listu, diagnostického protokolu nebo záručního listu se PDF generuje **přes JobiDocs** (stejná šablona jako u tisku). Pokud JobiDocs nezná nový endpoint (`Not Found`), aplikace automaticky použije původní způsob (vygenerované HTML + `/v1/export`), takže export funguje i se starší verzí JobiDocs.
- **Tisk a export u reklamace** – u dokumentu **Přijetí reklamace** se tisk i export provádějí **přes JobiDocs** (šablona Příjemka reklamace). Odpadá závislost na vyskakovacím okně prohlížeče a hláška „Povolte v prohlížeči vyskakovací okna pro tisk“. Pokud JobiDocs neběží, tisk zobrazí náhled v novém okně, export uloží PDF přes `/v1/export`.

### JobiDocs – API a šablony

- **Endpoint `/v1/export-document`** – stejná data jako u tisku (`doc_type`, `service_id`, `company_data`, `sections`, `variables`), ale PDF se uloží do zvolené cesty místo odeslání na tiskárnu.
- **Podpora příjemky a výdejky reklamace** – typy `prijemka_reklamace` a `vydejka_reklamace` lze použít v `/v1/print-document` i `/v1/export-document` (šablony z JobiDocs, vzhled jako v aplikaci).
- **Base šablony** – výchozí nastavení pro Příjemku reklamace (např. sekce vpravo/vlevo, šířky sekcí) a Výdejku reklamace (pořadí sekcí: service, customer, dates, device, repairs; sekce device/dates vedle sebe) upraveny dle požadavků.

### JobiDocs – Náhled a paleta

- **Kód reklamace v hlavičce** – v náhledu dokumentu se u Příjemky a Výdejky reklamace v hlavičce zobrazuje kód reklamace (stejný styl jako kód zakázky u zakázkového listu).
- **Provedené opravy v tisku ukázky** – při „Tisk ukázky“ u dokumentů s provedenými opravami se zobrazí tabulka položek a řádek **Celková cena** se částkou (jako v běžném náhledu).
- **Názvy vlastních bloků v paletě** – sekce typu „Řádek na podpis“ (signature) se v paletě sekcí a při přetahování zobrazují podle textu bloku (např. **Razítko / podpis servisu**) místo surového ID (`custom-5bbd72cc-...`).
- **Tlačítko u úpravy sekce** – text změněn na **Odebrat z dokumentu**.

---

## Opravy

- Export ze zakázky vracel „JobiDocs: Not Found“ u starších nebo bez nového endpointu – přidán fallback na původní export do PDF.
- Tisk u reklamace vyžadoval vyskakovací okna – tisk a export nyní běží přes JobiDocs API.

---

## Technické

- Jobi: `exportDocumentViaJobiDocs`, `exportViaJobiDocs` (fallback), rozšíření `DocTypeForPrint` o `prijemka_reklamace` a `vydejka_reklamace`, `buildClaimVariablesForJobiDocs`, volání API pro příjemku reklamace v `DocumentActionPicker`.
- JobiDocs API: `DOC_TYPE_TO_SECTION_KEY` (včetně prijemkaReklamace, vydejkaReklamace), endpoint `/v1/export-document`, rozšíření těla requestu o `variables` u print-document a export-document.
- JobiDocs: `getSectionDragLabel` s podporou `content` u custom bloků, `SectionPaletteItem` s `docConfig`, řádek „Celková cena“ v generovaném HTML sekce repairs, ukázkové `repair_items` a `complaint_code` v `getSampleVariablesForPreview`.

---

## Stažení

- **Jobi** – `jobi-0.1.8.dmg` (universal, notarizovaný)
- **JobiDocs** – `JobiDocs-0.1.8.dmg` (universal, notarizovaný) v příloze nebo v sekci Assets

Uživatelé s v0.1.7 (nebo starší) mohou aktualizovat přes OTA (Nastavení → O aplikaci → Aktualizace) nebo stáhnout nové DMG.
