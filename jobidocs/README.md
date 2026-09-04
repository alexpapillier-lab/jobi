# JobiDocs

Aplikace pro tisk a export dokumentů z Jobi (zakázkový list, záruční list, diagnostika, příjemka a výdejka reklamace, faktura). Electron s vestavěným Chromiem dělá PDF; tisk jde přes `lp` (macOS) nebo Windows tisk.

## Jak to funguje

- **Jádro `core/`** je čisté TypeScript bez Node, Electronu i Reactu. Obsahuje schéma šablony, výchozí šablony, proměnné a formátování, ukázková data a **jediný renderer** `renderDocument(šablona, data) → HTML`. Totéž HTML vidí editor v iframu a totéž jde do Chromia na PDF. Skript v HTML dokument změří a při `fit: onePage` zmenšuje písmo a mezery, dokud se nevejde na jednu stranu.
- **Šablona** (`Template`) = nastavení stránky + pět slotů (hlavička vlevo/vpravo, dole vlevo/uprostřed/vpravo) + seznam bloků v toku (tabulka údajů, text, nadpis, položky, podpis, sloupce, fotky, záruka, rekapitulace DPH, platba). Prvky ve slotech (název, servis, logo, razítko, QR, podpis…) se dají tažením přesouvat mezi sloty a tam, kde jsou v editoru, se i vytisknou.
- **Značka a motiv** (`Brand`, `Theme`) jsou per servis, společné pro všechny dokumenty: logo, razítko, hlavičkový papír, odkaz na hodnocení, barva, písmo (Roboto je přibalené, tisk nezávisí na internetu).
- **Data dokumentu** (`DocumentData`) posílá Jobi jako typovaný objekt (čísla jako čísla, data ISO); formátování dělá renderer.
- **Uložení**: `service_document_settings.config.v2` v Supabase (sdílené v rámci servisu, kontrola verze → 409 při konfliktu), lokální cache v userData pro offline tisk. Starý v1 config se při prvním načtení automaticky převede (`core/migrate.ts`).

## Editor

Hlavní způsob úprav je přímo v dokumentu: klik vybere blok nebo prvek (objeví se lišta: táhnout, výš, níž, duplikovat, vlastnosti, odebrat), další klik nebo dvojklik otevře text k psaní přímo v dokumentu. Údaje ze zakázky se v textu zobrazují jako čipy; „＋ údaj“ vloží další. Mezi bloky se při najetí objeví „+“. Řádky tabulky údajů mají vlastní lištu (výš, níž, přidat, odebrat). Klávesy: Delete/Backspace odebere vybrané, Esc zruší výběr nebo úpravu, ⌘Z / ⇧⌘Z, ⌘D duplikuje, ⌘S uloží. Osnova vlevo a panel vlastností vpravo jsou doplněk a dají se skrýt.

Náhled se dá přepnout na ukázková data (krátká, dlouhá), na názvy polí, nebo na skutečnou zakázku / reklamaci / fakturu ze Supabase (`GET /v2/recent`). Rozdělaná práce se průběžně zálohuje do localStorage a po pádu nebo zavření se nabídne k obnovení.

Vzhled (motiv Moderní / Strohý / Formulář, barva, písmo, linky), logo, razítko, hlavičkový papír a odkaz na hodnocení se nastavují na stránce Značka a platí pro všechny dokumenty servisu.

## Vývoj

```bash
cd jobidocs
npm install
npm run electron:dev          # Vite (5173) + Electron + API na 127.0.0.1:3847
```

Bez Electronu (jen UI, PDF a tisk nejsou dostupné):

```bash
npm run api:dev               # API na 3848
# UI: http://localhost:5173/?api=http://127.0.0.1:3848
```

Kontext (servisy, údaje firmy, přihlášení k Supabase) posílá běžící Jobi na `PUT /v1/context`.

```bash
npm run typecheck             # renderer + Electron
npm test                      # testy jádra (vitest z kořene jobi)
npm run electron:build        # DMG/ZIP do release/
```

## API (http://127.0.0.1:3847)

### Základ
- `GET /v1/health` → `{ ok, app, version, api: 2 }`
- `GET /v1/context`, `PUT /v1/context` – kontext z Jobi (services, activeServiceId, companyData, documentsConfig, canManageDocuments, supabaseUrl/AnonKey/AccessToken)
- `GET /v1/printers`, `GET|PUT /v1/settings?service_id` (preferovaná tiskárna)
- `GET /v1/activity` – poslední tisky a exporty

### Šablony (v2)
- `GET /v2/recent?service_id&doc_type` → `{ items: [{ id, label, data }], online }` – poslední skutečné zakázky/reklamace/faktury pro náhled
- `GET /v2/documents?service_id` → `{ documents: DocumentsV2, version, updated_at, source: supabase|context|local|default, canManage, online }`
- `PUT /v2/documents?service_id` body `{ documents, ifVersion? }` → `{ ok, version, updated_at, documents, savedTo }`; `409` když mezitím uložil někdo jiný; `403` bez oprávnění. Data URL loga/razítka/hlavičkového PDF se nahrají do Storage (`service-document-assets`).

### Dokumenty (v2)
Body: `{ service_id, doc_type, data?: DocumentData, sample?: "short"|"long"|"empty", documents?: DocumentsV2 (neuložený návrh z editoru), printer?, target_path? }`
- `POST /v2/html` → HTML (mode `print` | `editor`)
- `POST /v2/pdf` → `application/pdf`
- `POST /v2/print` → `{ ok, status: "queued", job_id, printer }`
- `POST /v2/export` → `{ ok, path }` (vyžaduje `target_path`)

`doc_type`: `zakazkovy_list`, `zarucni_list`, `diagnosticky_protokol`, `prijemka_reklamace`, `vydejka_reklamace`, `faktura`.

### Kompatibilita (v1)
`POST /v1/print-document`, `/v1/export-document`, `/v1/render-pdf` přijímají staré `variables` (řetězce, JSON ve stringu) a převádějí je na `DocumentData`. `POST /v1/render`, `/v1/print`, `/v1/export` berou surové HTML.

## Struktura

```
core/        jádro: types, variables, defaults, sample, render, fonts, migrate (+ testy)
api/         Fastify server, documentsStore (Supabase + cache), tisk, tiskárny
electron/    main (okno, tray, PDF přes Chromium, OTA), preload
src/         editor: App, api, state/useDocuments, editor/*, pages/*
scripts/     dev-api.ts (API bez Electronu)
```
