# Jobi

Desktop aplikace pro servisní evidenci: zakázky, zákazníci, tým, tisk dokumentů (záruční list, diagnostický protokol, zakázkový list). Backend: [Supabase](https://supabase.com).

- **Jobi** – hlavní aplikace (Tauri 2 + React).
- **JobiDocs** – doplňková aplikace pro tisk/PDF (Electron), běží vedle Jobi na portu 3847.

## Požadavky

- Node.js 18+
- npm
- (Pro desktop build) Rust, Tauri 2 CLI

## Vývoj

```bash
# Závislosti
npm install

# Web (Vite) – prohlížeč
npm run dev

# Desktop (Tauri) – okno s hot reload
npm run tauri dev

# Kontrola typů a lint
npm run typecheck
npm run lint
```

## Konfigurace

1. Zkopíruj `.env.example` do `.env`.
2. Vyplň `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY` z Supabase Dashboardu (Project Settings → API).
3. (Volitelně) Nastav `VITE_ROOT_OWNER_ID` – UUID uživatele z Auth, který má přístup ke všem servisům.

Migrace databáze: `npx supabase db push` (projekt musí být napojený přes `supabase link`).

## Build pro produkci

- **Jobi (Tauri):** `npm run tauri:build` (výstupy v `src-tauri/target/release/bundle/`).
- **JobiDocs (Electron):** z adresáře `jobidocs/` viz `jobidocs/README.md` nebo `scripts/build-jobi-and-jobidocs.sh`.

OTA updaty: viz `docs/OTA_UPDATES.md`, `docs/OTA_SETUP_KROKY.md`.

## Dokumentace

- `docs/OTA_UPDATES.md` – updaty přes vzduch (Jobi + JobiDocs)
- `docs/OTA_SETUP_KROKY.md` – nastavení OTA a prvního releasu
- `docs/ZALOHY_DATABAZE.md` – zálohy Supabase
- `docs/INSTALACE_KLIENTUM.md` – instalace a podepisování (macOS)
- `docs/RELEASE_READY_AUDIT.md` – audit před releasem
- `docs/TODO_2026-02-16.md` – backlog a plán

## Licence

Privátní projekt.
