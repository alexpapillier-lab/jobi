# Reklamace – plán a specifikace (po odpovědích)

Reklamace se zakládají **z dokončených zakázek** (nebo ručně pro migraci). Dva dokumenty: **Přijetí reklamace** a **Vydání reklamace**. Customizace v JobiDocs včetně QR pro recenze.

---

## 1. Shrnutí odpovědí

### Vytvoření reklamace
- **„Vytvořit reklamaci“** na hlavní stránce Zakázek (Orders); po kliknutí **vyhledání zakázky** (podle čísla zakázky, SN, zákazníka atd.).
- **Ruční založení** bez propojení na zakázku možné (migrace ze starého programu, staré zakázky).
- **Jedna zakázka → více reklamací** (po vyřízení jedné může přijít další). Vše v historii.

### Statusy
- **Konfigurovatelné** jako u zakázek – stejné statusy (nebo samostatná sada v Nastavení, ale stejný princip). Uživatel si může přidat např. Zamítnuto (s důvodem), Čeká na díly, V opravě atd.

### Dokumenty
- **Přijetí reklamace:** kód reklamace, kód původní zakázky, zákazník, zařízení, stav při převzetí, doprovod, datum, podpis, razítko, logo – **vše customizovatelné v JobiDocs**. Stejný vizuál (design) jako ostatní dokumenty. **QR kód s recenzí** jako u ostatních dokumentů.
- **Vydání reklamace:** kód reklamace, zákazník, zařízení, souhrn provedeného zákroku, datum vydání, podpis – opět customizace v JobiDocs. **Jedna šablona** pro všechny výsledky (opraveno / vyměněno / zamítnuto).

### Automatický tisk
- Do **nastavení** přidat volby:
  - **Zakázkový list:** při vytvoření zakázky automaticky tisknout ano/ne; případně „tisknout při přepnutí do stavu: [výběr statusu]“.
  - **Přijetí reklamace:** při vytvoření reklamace automaticky tisknout ano/ne; **a/nebo** tisknout při přepnutí do stavu: [výběr].
  - **Vydání reklamace:** tisknout při přepnutí do stavu: [výběr] (např. „Vydána“ nebo „Připraveno k převzetí“).
- Tj. u každého dokumentu možnost zvolit **při přepnutí do jakého stavu** se má automaticky tisknout.

### UI
- Reklamace jako **filtr / zobrazení v Zakázkách** (ne samostatná sekce v menu). V **Nastavení** volba: reklamace mezi zakázkami, ale **vizuálně odlišené** (na první pohled poznat, že jde o reklamace).
- V **detailu původní zakázky** odkaz / sekce **„Reklamace k této zakázce“** (seznam reklamací vzniklých z této zakázky).
- **Historie:** u reklamace historie změn (jako `ticket_history`); v historii **původní zakázky** záznamy typu „byla založena reklamace č. R-2026-001“.

### Práva a historie
- **Práva** zatím neřešit – stejná jako u zakázek.
- **Historie změn** u reklamace ano (kdo vytvořil, kdo změnil status, kdy).

---

## 2. Finální specifikace

### 2.1 Data reklamace
- `id`, `service_id`
- `source_ticket_id` (FK na zakázku, nullable pro ruční reklamace)
- `code` (např. R-2026-001)
- `status` (stejné klíče jako u zakázek z `service_statuses`, nebo vlastní sada – dle rozhodnutí „stejné jako u zakázek“)
- `received_at`, `released_at` (datum přijetí / vydání – odvozené z historie nebo při změně statusu)
- Kopie / odkaz na zákazníka a zařízení: `customer_id` nebo `customer_*`; `device_*` (převzato z původní zakázky, editovatelné)
- `notes` / `reason` (důvod reklamace, poznámka)
- `resolution_summary` (provedený zákrok po vyřízení)
- `created_at`, `updated_at`
- Historie: tabulka `warranty_claim_history` (nebo rozšíření `ticket_history` o typ „reklamace“) – kdo vytvořil, kdo změnil status, kdy.

### 2.2 Dokumenty (obsah)
- **Přijetí reklamace:** kód reklamace, kód původní zakázky, údaje servisu (logo), zákazník, zařízení, stav při převzetí, doprovod, datum, podpis zákazníka, razítko servisu, QR recenze (volitelně v JobiDocs).
- **Vydání reklamace:** kód reklamace, zákazník, zařízení, souhrn provedeného zákroku, datum vydání, podpis při vyzvednutí, logo/razítko/QR dle JobiDocs.

### 2.3 Nastavení (nové položky)
- Reklamace v seznamu zakázek: zapnuto (reklamace mezi zakázkami, vizuálně odlišné) / vypnuto.
- **Automatický tisk:**
  - Zakázkový list: tisk při vytvoření zakázky [ano/ne]; tisk při přepnutí do stavu [dropdown statusů / žádný].
  - Přijetí reklamace: tisk při vytvoření reklamace [ano/ne]; tisk při přepnutí do stavu [dropdown].
  - Vydání reklamace: tisk při přepnutí do stavu [dropdown].

### 2.4 JobiDocs
- Nové typy dokumentů: **Přijetí reklamace** (`prijeti_reklamace`), **Vydání reklamace** (`vydani_reklamace`).
- Stejná customizace jako u zakázkového listu (sekce, logo, razítko, design, QR recenze). Profily per servis per doc_type.

---

## 3. Implementační plán (kroky)

1. **DB**
   - Tabulka `warranty_claims` (nebo `reklamace`) s poli podle 2.1.
   - Tabulka historie reklamací (např. `warranty_claim_history` s action, status_from, status_to, user_id, created_at).
   - V `ticket_history` (nebo v historii zakázky) záznam při založení reklamace („založena reklamace R-xxx“).

2. **Backend / RLS**
   - CRUD pro reklamace, použití `service_statuses` pro statusy (sdílené s zakázkami).
   - Edge function nebo trigger pro zápis historie reklamace a pro zápis do historie původní zakázky.

3. **Jobi – nastavení**
   - Nové položky: reklamace v seznamu zakázek (checkbox); automatický tisk – zakázkový list (při vytvoření + volitelný status); přijetí reklamace (při vytvoření + volitelný status); vydání reklamace (při přepnutí do stavu). Ukládání např. do `service_settings` nebo `service_document_settings`.

4. **Jobi – Orders**
   - Tlačítko „Vytvořit reklamaci“ (hlavní stránka); po kliknutí dialog/stránka s vyhledáním zakázky (podle kódu, SN, zákazníka). Možnost „Reklamace bez zakázky“ (ruční).
   - Filtr / přepínač „Reklamace“ v seznamu zakázek; karty reklamací vizuálně odlišené. Nastavení zobrazit reklamace mezi zakázkami.
   - Detail reklamace (nebo detail „zakázky“ s `is_warranty_claim`): údaje z původní zakázky, údaje reklamace, změna statusu, historie, Tisk/Export → Přijetí reklamace / Vydání reklamace.
   - V detailu původní zakázky sekce „Reklamace k této zakázce“ (seznam odkazů na reklamace).
   - Při vytvoření reklamace / změně statusu volání logiky „automatický tisk“ dle nastavení.

5. **Jobi – generování HTML**
   - Funkce `generatePrijetiReklamaceHTML`, `generateVydaniReklamaceHTML` (nebo jeden modul s oběma šablonami). Data z reklamace + původní zakázky. Volání JobiDocs pro tisk/export (jako u zakázkového listu).

6. **JobiDocs**
   - Nové doc typy `prijeti_reklamace`, `vydani_reklamace` v API a v `documentToHtml.ts` (šablony s bloky: servis, zákazník, zařízení, kód reklamace, kód zakázky, datum, podpisy, QR atd.).
   - V UI záložka Dokumenty: výběr typu dokumentu včetně Přijetí reklamace a Vydání reklamace; customizace sekcí a vzhledu jako u ostatních.

7. **Historie**
   - Zobrazení historie reklamace v detailu reklamace.
   - V historii původní zakázky položky „Založena reklamace R-2026-001“ s odkazem na reklamaci.

---

## 4. Původní dotazy (archiv)

- **2.1** Ruční založení možné; jedna zakázka může mít více reklamací; vše v historii.
- **2.2** Statusy konfigurovatelné (jako u zakázek); zamítnuto s důvodem – uživatel si vybírá.
- **2.3** Dokument přijetí: položky OK + logo, customizace v JobiDocs; stejný vizuál; nastavení pro automatický tisk (při vytvoření + při přepnutí do zvoleného stavu). Totéž přidat i k zakázkovému listu.
- **2.4** Dokument vydání: obsah OK, jedna šablona; automatický tisk dle nastavení (při přepnutí do zvoleného stavu).
- **2.5** Reklamace jako filtr v Zakázkách; v detailu zakázky „Reklamace k této zakázce“.
- **2.6** Práva zatím neřešit; historie změn u reklamace ano.
