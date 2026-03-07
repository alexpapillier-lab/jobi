# Stav zálohy projektu (backup disk)

**Datum:** 16. 2. 2026  
**Účel:** Záznam stavu projektu na disku „backup“ v okamžiku odpojení. Slouží jako reference, co tato záloha obsahuje.

---

## Verze a commit

| Co | Hodnota |
|----|--------|
| **Jobi (npm)** | 0.1.0 (`package.json`) |
| **Jobi (Tauri)** | 0.1.0 (`src-tauri/tauri.conf.json`) |
| **Git branch** | main |
| **Poslední commit** | 34e97cf – Refactor: Rozdělení Customers na CustomerList a CustomerDetail, přidání useCustomerActions hooku, opravy print CSS pro single-page dokumenty |

*Pozn.: Na disku jsou i necommitnuté změny (viz níže). Pro zálohu do gitu před odpojením disku doporučujeme `git add` a `git commit`.*

---

## Co tato záloha obsahuje (aktuální stav)

### Funkce a úpravy (včetně necommitnutých)
- **Root owner** – záložka Owner v Nastavení (jen pro root ownera), seznam všech servisů v sidebaru i v Tým/Přístupy. V Owner tabu: seznam servisů vlevo (název, shortId, badge Aktivní/Deaktivovaný), vpravo detail (UUID, Kopírovat ID, Deaktivovat / Znovu aktivovat, Smazat), TeamSettings. **service-manage** (deactivate, activate, hardDelete), **team-set-capabilities**.
- **services-list** – Edge Function s `--no-verify-jwt`, ROOT_OWNER_ID; root owner vidí všechny servisy včetně `active`; pro ne-root vrací jen servisy s `active = true` (deaktivované se v sidebaru nezobrazují).
- **JWT** – všechny Edge Functions nasazené s `--no-verify-jwt`; explicitní JWT v hlavičce pro services-list v App.tsx
- **Tým a přístupy** – moderní dropdown pro výběr servisu, root owner se v seznamu členů nezobrazuje, Owner zobrazen jako „Vlastník“ bez tlačítek Změnit roli / Odebrat. Capabilities (dialog s popisy a skupinami), výchozí vše zapnuté pro nové členy.
- **Capabilities v UI** – can_manage_documents: záložky „Kontaktní údaje“ a „Dokumenty“ v Nastavení jsou skryté pro membery bez této capability. can_print_export (tisk/export v Zakázkách), can_adjust_inventory_quantity (Sklad).
- **JobiDocs** – integrace (status, push kontextu), jobidocs jako podadresář
- **Dokumentace** – ROOT_OWNER_SETUP.md (včetně deploy service-manage, team-set-capabilities), TYM_A_PRISTUPY_OTAZKY.md, TODO_2026-02-16.md, TESTOVANI.md, TEST_VERSION_PLAN.md, INSTALL_TEST.md, MIGRATIONS_SAFETY.md, scripts/list-services.sql, atd.
- **Skripty** – build-universal, build-test-release, build-jobi-and-jobidocs, run-built-apps

### Necommitnuté změny (stav k datu výše)
- Řada změněných souborů (App.tsx, Settings, TeamSettings, Sidebar, services-list, atd.) a nové soubory (docs, hooks useIsRootOwner, useUserProfile, JobiDocsStatus, jobidocs.ts, migrace, …).
- Několik smazaných starých .md souborů (audity, analýzy).
- Před odpojením disku: buď vše commitnout, nebo nechat jako lokální zálohu (disk obsahuje aktuální stav).

---

## Bezpečné odpojení disku

1. **Žádný proces by neměl psát na disk** – ukonči dev servery (`npm run tauri dev`, JobiDocs), Cursor/IDE s otevřeným projektem z tohoto disku může zůstat otevřený, ale neukládej velké soubory během odpojení.
2. **Odpojení na macOS:** vysouň disk v Finderu nebo v Terminálu (`diskutil eject /Volumes/backup`) až po dokončení I/O.
3. Tento soubor (`docs/BACKUP_STAV.md`) je součástí projektu; po případném commitu bude v repozitáři jako záznam stavu zálohy.
