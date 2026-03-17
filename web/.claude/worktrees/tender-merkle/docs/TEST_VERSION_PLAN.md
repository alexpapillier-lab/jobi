# Plán testovací verze Jobi + JobiDocs

Cíl: **testovací verze**, ve které všechny současné funkce Jobi i JobiDocs fungují, Supabase je nastavená tak, aby budoucí změny nepoškodily zakázky vytvořené testovacími uživateli, a instalace je „normální“ (zatím nepodepsaná od Apple, ale použitelná). Tato verze se pak **updaty** posune na finální – **stejná aplikace**, ne jiná, aby data a zakázky zůstaly.

---

## 1. Strategie Supabase (ochrana dat testovacích uživatelů)

### Doporučení: jeden Supabase projekt pro test i finále

- **Jeden projekt** = jedna databáze. Testovací build i finální build na ni ukazují (stejné `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
- **Výhoda:** Žádná migrace dat. Když přejdeš z „test“ na „finální“ verzi aplikace, jen změníš branding/verzi v aplikaci – backend zůstane, zakázky a uživatelé zůstanou.
- **Nevýhoda:** Nemáš oddělené „čistě produkční“ prostředí. To lze později doplnit druhým projektem a jednorázovou migrací.

### Budoucí změny schématu nesmí ničit data

- Všechny **migrace** musí být **zpětně kompatibilní**:
  - Nové sloupce: přidávej jako `NULL` nebo s `DEFAULT`, ne „NOT NULL bez defaultu“ na existující tabulce.
  - Mazání sloupců/tabulek: nejdřív přestaň je v kódu používat, pak migrace odstranění (až po ověření).
  - Změny typů: přes nový sloupec + backfill + přejmenování, ne „ALTER COLUMN“ na velkých tabulkách bez přípravy.
- Před `supabase db push` vždy zkontroluj migraci na **kopii** nebo na testovací větvi (stejný projekt je OK, pokud migrace jen přidávají).

Pravidla jsou shrnuta v `docs/MIGRATIONS_SAFETY.md`.

### Alternativa: dva projekty (test vs prod)

- Pokud budeš chtít oddělit test a produkci:
  - **Test build** → projekt A (např. stávající `ijtvcgolsdsrquqbvjrz`).
  - **Finální build** → projekt B (nový „production“ projekt).
- Při přechodu test → finále pak musíš:
  - Buď **migrovat data** z projektu A do B (export/import, nebo skript přes Supabase API),  
  - nebo říct testerům, že finální verze začíná s čistou DB (zakázky by se vytvářely znovu).
- Pro „data se nemají vytvářet znovu“ je tedy **jeden projekt** jednodušší.

---

## 2. Build testovací verze (instalace)

### Jobi (Tauri)

- **Verze:** Ponech nebo nastav např. `0.1.0` (testovací řada 0.x).
- **Build:**  
  - `npm run tauri:build` – jedna architektura (např. aktuální Mac).  
  - Pro univerzální macOS: `./scripts/build-universal.sh` (výstup např. `jobi-universal.zip` nebo .app).
- **Výstupy:**  
  - macOS: `src-tauri/target/release/bundle/macos/jobi.app` (nebo .dmg, pokud máš v konfiguraci).  
  - Pro distribuci můžeš zabalit `.app` do .dmg (např. `hdiutil` nebo Tauri bundle targets).

### Nepodepsaná aplikace na macOS

- Bez Apple Developer ID / notarization bude macOS aplikaci blokovat („od nevývojáře“).
- **Jak ji přesto spustit (normální instalace pro testery):**
  1. Stáhnout .dmg / .zip s .app.
  2. Rozbalit / nainstalovat jobi.app.
  3. **První spuštění:** Klik pravým → **Otevřít** (ne dvojklik), nebo **Předvolby systému → Zabezpečení a soukromí → Otevřít**.
  4. Po prvním potvrzení už půjde spouštět běžně.
- Do README nebo instalačních instrukcí přidej krátkou sekci „První spuštění na Macu“.

### JobiDocs (Electron)

- Build: v adresáři `jobidocs/` např. `npm run electron:build` (nebo dle `package.json`).
- Výstup je typicky v `jobidocs/dist/` (installer .dmg / .exe dle electron-builder).
- Stejný princip: nepodepsaný build na Macu – první spuštění přes „Otevřít“ nebo Předvolby.

### Shrnutí instalace

- **Jedna „normální“ instalace** = jeden installer (Tauri .app/.dmg pro Jobi, Electron .dmg/.exe pro JobiDocs).
- Zatím bez podpisu od Apple = nutné jednorázové „Otevřít“ / povolení v Předvolbách. Aplikace pak funguje jako každá jiná.

---

## 3. Updaty: testovací verze → finální (stejná aplikace, stejná data)

- **Zásada:** Testovací a finální verze jsou **stejná aplikace** (stejný `identifier`: `com.jobsheet.online`). Rozdíl je jen verze a případně název/označení („jobi (test)“ vs „jobi“).
- **Updaty:** Aplikace bude mít zapnutý **Tauri Updater**. Po vydání nové verze (0.1.1, 0.2.0, … a nakonec 1.0.0) ji testeri dostanou jako **update**, ne jako „smaž a nainstaluj znovu“.
- **Data:** Protože používáš **jeden Supabase projekt**, po updatu z testovací na finální verzi zůstanou všechny zakázky a účty – nic se nemusí vytvářet znovu.

### Technické kroky (až budeš chtít zapnout updater)

1. V `src-tauri/tauri.conf.json` přidat plugin updater a konfiguraci (endpoint pro update server).
2. Při buildu zapnout `createUpdaterArtifacts: true` a nastavit podepisování (privátní/veřejný klíč dle Tauri docs).
3. Po každém release nahrát artifact (např. .app/.dmg + .sig) na svůj update server (nebo použít Tauri doporučený způsob).
4. V aplikaci volat např. `check()` z `@tauri-apps/plugin-updater` a nabízet „Stáhnout a nainstalovat update“.

Konkrétní konfigurace (endpoint, keys) můžeš doplnit podle [Tauri Updater](https://v2.tauri.app/plugin/updater/) a může s tím pomoct i ChatGPT („Tauri 2 updater config with custom endpoint“).

---

## 4. Co musí fungovat v testovací verzi

- Všechny **aktuální funkce Jobi** (zakázky, zákazníci, tým, nastavení, dokumenty, komentáře, profily, …).
- Všechny **aktuální funkce JobiDocs** (náhled, tisk, export PDF, fronta úloh, …).
- **Supabase:** přihlášení, služby, zakázky, zákazníci, statusy, dokumenty, profily – vše proti **témuž** projektu (aby pozdější přechod na „finální“ byl jen update aplikace).

Ověření = manuální test hlavních flow po sestavení testovacího buildu.

---

## 5. Shrnutí rozhodnutí

| Otázka | Rozhodnutí |
|--------|------------|
| Supabase | Jeden projekt pro test i finále → žádná migrace dat při přechodu. |
| Migrace DB | Vždy zpětně kompatibilní; viz `MIGRATIONS_SAFETY.md`. |
| Instalace | Jeden installer (Tauri pro Jobi, Electron pro JobiDocs); Mac bez podpisu = první spuštění přes „Otevřít“. |
| Přechod test → finální | Stejná aplikace, updaty (Tauri Updater); data zůstanou. |

Až budeš chtít konkrétně zapnout updater nebo přidat druhý Supabase projekt pro produkci, můžeš se opřít o tento plán a dle potřeby ho rozšířit (např. `docs/TAURI_UPDATER_SETUP.md`).
