# Audit před prvním releasem – Jobi

Kontrola projektu k datu auditu. Položky rozdělené na: **opraveno**, **doporučení před releasem**, **po releasu / vylepšení**.

---

## ✅ Už opraveno / doplněno v rámci auditu

- **README** – přepsáno z Tauri šablony na popis Jobi a první kroky (viz `README.md`).
- **index.html** – titul „Jobi“, `lang="cs"`; favicon `/tauri.svg` (pro vlastní branding lze později nahradit vlastní ikonou).
- **Konzistence localStorage** – v `Orders.tsx` nahrazeny hardcoded `"jobsheet_documents_config_v1"` za `STORAGE_KEYS.DOCUMENTS_CONFIG`.
- **Tauri HTTP scope** – do `default.json` přidán `https://github.com/*` kvůli stahování OTA updatů z GitHub Releases.

---

## 🔴 Důležité před prvním releasem

1. **OTA při prvním releasu (Jobi)**  
   Build s `TAURI_SIGNING_PRIVATE_KEY` a heslem, nahrát na GitHub Releases: `latest.json`, `jobi.app.tar.gz`, `.sig`. Viz `docs/OTA_SETUP_KROKY.md`, `docs/OTA_SIGNING_SECRETS.md`.

2. **OTA při prvním releasu (JobiDocs)**  
   Při buildu `GH_TOKEN`, nebo ruční upload z `jobidocs/release/` na Releases. Viz `docs/OTA_UPDATES.md`.

3. **Instalace klientům**  
   Rozhodnout: zůstat u „pravý klik → Otevřít“, nebo Apple Developer ID + notarizace. Viz `docs/INSTALACE_KLIENTUM.md`.

4. **Ověření OTA**  
   Po prvním releasu na GitHubu ověřit v zabalené aplikaci: Nastavení / kontrola updatu → stáhnutí a instalace (popř. že se zobrazí rozumná chyba, pokud release ještě není).

5. **Min. macOS**  
   V `tauri.conf.json` je `minimumSystemVersion: "10.15"`. Otestovat na této verzi a případně dokumentovat v README / `docs/INSTALACE_KLIENTUM.md`.

---

## 🟡 Doporučení (není blokér)

- **Stránkování v Orders** – při velkém počtu zakázek zvážit stránkování místo nekonečného scrollu (v TODO).
- **Local storage audit** – `STORAGE_KEYS` a `ADDITIONAL_KEYS` v `storageInvalidation.ts` jsou konzistentní; několik klíčů je mimo (Login: `jobsheet_remember_me`, `jobsheet_last_email`; Orders: `NEW_ORDER_DRAFT_KEY`, `COMMENTS_STORAGE_KEY`; Inventory/Statistics/Devices vlastní klíče). Pro release OK, později sjednotit pod centrální konstanty.
- **Console.log** – v kódu zůstává řada `console.log`/`console.error` (Orders, useOrderActions, TeamSettings, App, …). Pro produkci zvážit odstranění nebo bránu přes `import.meta.env.DEV` (neblokuje release).
- **TODO v kódu** – jediné: `src/types/supabase.ts` – „Přidat další tabulky po vygenerování správných typů“; neblokuje release.

---

## 🟢 Po releasu / vylepšení

- Stránkování zakázek, rozšířené statistiky, další body z `docs/TODO_2026-02-16.md`.
- Limity aplikace (počet zákazníků, zakázek, servisů) – dokumentovat podle Supabase plánu a zkušeností.
- Hardcoded jména – v projektu nejsou (pouze příklady typu Jan Novák, example.com).

---

## Shrnutí

- **Linter/TypeScript:** bez chyb.
- **Bezpečnost:** žádné hesla/tokeny v kódu; Resend/Supabase přes env/Secrets.
- **Zpětná kompatibilita:** diagnostické fotky – staré base64 v DB fungují, nové jdou do Storage.
- **Dokumentace:** OTA, zálohy DB, instalace, TODO – pokryto v `docs/`.

Před prvním releasem stačí dokončit body v sekci „Důležité před prvním releasem“ a podle potřeby projít „Doporučení“.
