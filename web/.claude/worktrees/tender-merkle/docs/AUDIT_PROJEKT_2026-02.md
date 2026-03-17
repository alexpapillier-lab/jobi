# Audit projektu Jobi – únor 2026

Kompletní audit kódu, struktury a potenciálních problémů. **Aktualizováno po provedených opravách** (únor 2026).

---

## 1. Struktura projektu

| Složka | Účel |
|--------|------|
| `src/` | React (Vite) frontend – hlavní aplikace Jobi |
| `src/pages/` | Stránky: Orders, Customers, Devices, Inventory, Settings, Statistics, Preview |
| `src/components/` | UI komponenty (Toast, Login, ConfirmDialog, AppTourOverlay, JobiDocsStatus, …) |
| `src/layout/` | Layout (AppLayout, Sidebar) |
| `src/lib/` | Utility: Supabase client, devicesDb, inventoryDb, jobidocs, documentSettings, … |
| `src/hooks/` | React hooky: useActiveRole, useUserProfile, useCheckForAppUpdate |
| `src/auth/` | AuthProvider – autentizace |
| `src/state/` | StatusesStore |
| `src/mock/` | Mock data a typy (tickets, statuses) |
| `supabase/` | Migrace SQL, Edge Functions, config |
| `jobidocs/` | Samostatná Electron/Vite aplikace – tisk/export dokumentů |
| `scripts/` | Build, notarizace, DMG, release skripty |
| `docs/` | Dokumentace (41 .md souborů) |

**Typecheck:** ✅ OK (exit 0)  
**Build (bez lint):** ✅ OK (`npm run build:prod`)

---

## 2. Lint – chyby a důležitá varování

### Chyby (errors) – ✅ všechny opraveny

1. ~~**AppTourOverlay** – rules-of-hooks~~ → **opraveno** (hook před return)
2. ~~**Orders.tsx** – zbytečné escapování `<\/script>`~~ → **opraveno**
3. ~~**DeletedTicketsSettings** – prefer-const~~ → **opraveno**

### Často opakovaná varování (~369 celkem)

- **@typescript-eslint/no-explicit-any** – velký počet `any` v Supabase dotazech
- **react-hooks/set-state-in-effect** – synchronní `setState` v effectu (App.tsx, AuthProvider, AppTourOverlay, ConfirmDialog, JobiDocsStatus, Sidebar, useActiveRole, StatusesStore)
- **react-hooks/exhaustive-deps** – chybějící nebo nadbytečné dependency v `useEffect` / `useCallback`
- **react-refresh/only-export-components** – soubory exportují i nekomponentní věci (Login, Toast, AuthProvider)

---

## 3. Nepoužívaný kód a soubory

### ✅ Odstraněno

| Položka | Stav |
|--------|------|
| **`src/layout/TopBar.tsx`** | Smazáno |
| **`supabase/functions/invite-create/`** | Smazáno (+ sekce z config.toml) |
| **`PRIMARY_STATUSES`** v mock/statuses.ts | Odstraněno, ponechán typ `PrimaryStatusKey` |

---

## 4. TODO, FIXME, zastaralé komentáře

- **`src/types/supabase.ts:421`** – `// TODO: Přidat další tabulky po vygenerování správných typů`
- **`jobidocs/TODO.md`** – samostatný TODO soubor v jobidocs

---

## 5. Bezpečnost a best practices

### Tajemství a klíče

- ✅ Žádné hardcoded API klíče ani hesla v kódu.
- Supabase URL a anon key z `import.meta.env.VITE_*`.
- V docs a skriptech jen placeholdery (`ghp_xxxx`, `xxxx-xxxx`).

### Console.log v produkci

**✅ Částečně vyřešeno:** Přidán `src/lib/devLog.ts` – `devLog()` a `devWarn()` logují jen při `import.meta.env.DEV`. Debug logy nahrazeny v: supabaseClient, Orders, Customers, useOrderActions, TeamSettings, Sidebar. `console.error` pro skutečné chyby zůstává.

---

## 6. Soubory k případnému odstranění

### ✅ Provedeno

- **audit_queries.sql** – přesunuto do `docs/`
- **notarize-log.txt** – přidáno do `.gitignore`

### Nelze smazat

- **`src/mock/statuses.ts`** – používá se pro typ `PrimaryStatusKey` (import v `mock/tickets.ts` → Orders)
- **`src/mock/tickets.ts`** – používá se pro typ `Ticket` (Orders)

---

## 7. Doporučené úpravy (priorita)

### ✅ Provedeno

1. ~~Opravit podmíněný hook v AppTourOverlay~~  
2. ~~Odstranit escapování v Orders.tsx~~  
3. ~~prefer-const v DeletedTicketsSettings~~  
4. ~~Odstranit TopBar.tsx~~  
5. ~~Odstranit invite-create~~  
6. ~~Console.log – devLog podmíněný na DEV~~
7. ~~Unit testy – přidán Vitest (errorNormalizer, statusColors, phone)~~

### Zbývá (nižší priorita)

- **react-hooks/set-state-in-effect** – synchronní setState v effectech (App, AuthProvider, ConfirmDialog, …)
- **@typescript-eslint/no-explicit-any** – typovat Supabase dotazy

---

## 8. Testování

- ✅ **Unit testy (Vitest)** – `npm run test` / `npm run test:run`
- Testované moduly: `errorNormalizer`, `statusColors`, `phone` (22 testů celkem)
- V docs je `TESTOVANI.md`, `TEST_VERSION_PLAN.md`, `INSTALL_TEST.md`.

---

## 9. Shrnutí

| Oblast | Stav |
|--------|------|
| Typecheck | ✅ OK |
| Build (typecheck + vite) | ✅ OK |
| Lint | 0 chyb, ~369 varování |
| Kritické problémy | ✅ Všechny opraveny |
| Nepoužívaný kód | ✅ Odstraněno (TopBar, invite-create, PRIMARY_STATUSES) |
| Bezpečnost | ✅ Žádné hardcoded secrets |
| Console.log | ✅ devLog – debug logy jen v DEV |
| Realtime | ✅ Zařízení, sklad, reklamace, statusy |
| Testy | ✅ Unit testy (Vitest, 22 testů) |

---

## 10. Dokumentace (docs/)

### Archivované soubory (přesunuty do `docs/_archive/`)

V únoru 2026 byly do `docs/_archive/` přesunuty tyto zastaralé dokumenty:

- **CHYBY_V0.1.0.md**, **CHYBY_V0.1.1.md** – historické seznamy chyb
- **TODO_2026-02-16.md** – TODO snapshot (většina položek dokončena)
- **STORAGE_KEYS_AUDIT.md** – starší audit localStorage (částečně zastaralé)
- **RELEASE_READY_AUDIT.md** – audit před prvním releasem
- **BACKUP_STAV.md** – snapshot zálohy z 16. 2. 2026

### Stále aktuální dokumenty

- **AUDIT_PROJEKT_2026-02.md** – tento audit
- **RELEASE_NOTES_v0.1.x.md** – release notes (historické, ale užitečné)
- **SUPABASE_*** – nastavení, migrace, diagnostika
- **OTA_*** – OTA updaty
- **INVITE_EMAIL_RESEND.md** – Resend pro pozvánky
- **INSTALACE_KLIENTUM.md**, **RELEASE_NA_GITHUB.md** – instalace a release
- Ostatní návody a plány (MIGRATIONS_SAFETY, TESTOVANI, atd.)

---

## 11. Realtime (doplněno únor 2026)

**Již má Realtime:** tickets, customers, service_document_settings  
**Přidáno:** device_brands, device_categories, device_models, repairs, inventory_products, inventory_product_categories, warranty_claims, service_statuses

Migrace: `20260227100000_realtime_devices_inventory_claims_statuses.sql`

**Není Realtime (a pravděpodobně ani není potřeba):** service_settings (používá event `jobsheet:ui-updated`), company cache, dokumenty.

---

*Audit proveden 2026-02. Provedeny opravy: AppTourOverlay (hook), Orders, DeletedTicketsSettings; odstraněny TopBar, invite-create, PRIMARY_STATUSES; archivováno 6 zastaralých docs; přidán Realtime pro zařízení, sklad, reklamace, statusy; úklid audit_queries, notarize-log; devLog pro console.log (jen DEV); přidány unit testy (Vitest). Migrace Realtime nasazena.*
