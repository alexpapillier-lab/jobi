# JobiDocs

Separatni aplikace pro tisk a export dokumentu z Jobi. Pouziva vestaveny Chromium v Electronu pro spolehliv render PDF – neni potreba Chrome ani Puppeteer.

## Architektura

- **Electron** – desktop app s React UI (editor sablon)
- **Localhost API** (port 3847) – Jobi vola JobiDocs pres HTTP
- **Supabase** – cloud sync document config a profilu (kdyz je k dispozici JWT z Jobi)

## Vyvoj

```bash
cd jobidocs
npm install
npm run electron:dev
```

- Vite dev server bezi na http://localhost:5173
- Electron okno nacita dev URL
- API server startuje v Electron main process na http://127.0.0.1:3847

## Build

```bash
npm run electron:build
```

## API Reference (http://127.0.0.1:3847)

### GET /v1/health

Zdravotni check. Vraci `{ ok: true, app: "jobidocs", version: "x.y.z" }`.

### GET /v1/activity

Posledni operace (tisk/export) – max 20 zaznamu.

### GET /v1/context

Vraci aktualni kontext z Jobi (services, activeServiceId, documentsConfig, companyData, jobidocsLogo, canManageDocuments).

### PUT /v1/context

Aktualizuje kontext. Jobi posila kazdy 5 s.

Body:
```json
{
  "services": [{ "service_id": "...", "service_name": "...", "role": "owner" }],
  "activeServiceId": "uuid",
  "documentsConfig": { ... },
  "companyData": { ... },
  "jobidocsLogo": { "background": "#...", "jInner": "#...", "foreground": "#..." },
  "canManageDocuments": true,
  "supabaseUrl": "https://xxx.supabase.co",
  "supabaseAnonKey": "...",
  "supabaseAccessToken": "jwt-token"
}
```

### GET /v1/printers

Seznam dostupnych tiskaren (macOS: `lpstat -p`).

### GET /v1/settings?service_id=...

Nastaveni pro servis (preferovana tiskarna).

### PUT /v1/settings?service_id=...

Aktualizace nastaveni. Body: `{ "preferred_printer_name": "..." }`.

### GET /v1/documents-config?service_id=...

Konfigurace dokumentu pro servis. Kdyz je k dispozici Supabase auth, cte z DB; jinak z lokalniho souboru.

### PUT /v1/documents-config?service_id=...

Ulozi konfiguraci. Body: `{ "config": { ... } }`. Pokud je Supabase auth, zapisuje i do DB.

### GET /v1/profiles?service_id=...&doc_type=...

Profil dokumentu pro servis a typ (zakazkovy_list, zarucni_list, diagnosticky_protokol). Supabase-first s lokalnim fallbackem.

### PUT /v1/profiles?service_id=...&doc_type=...

Ulozi profil. Body: `{ "profile_json": { ... } }`. Pri Supabase auth se syncuje i do DB.

### POST /v1/render

Renderuje HTML na PDF (vraci base64). Body: `{ "html": "...", "letterhead_pdf_url": "..." }`. Vyzaduje Electron (503 bez nej).

### POST /v1/print-document

Tisk dokumentu pres sablonu JobiDocs. Body:
```json
{
  "doc_type": "zakazkovy_list",
  "service_id": "uuid",
  "company_data": { ... },
  "sections": { "header": "...", "customer": "..." },
  "repair_date": "2025-06-01",
  "variables": { "ticket_code": "Z25000001", "customer_name": "..." }
}
```
Mozne `doc_type`: `zakazkovy_list`, `zarucni_list`, `diagnosticky_protokol`, `prijemka_reklamace`, `vydejka_reklamace`.

### POST /v1/export-document

Export do PDF souboru. Stejny body jako `/v1/print-document` + `"target_path": "/path/to/file.pdf"`.

### POST /v1/print

Legacy: posle surove HTML z Jobi do tisku. Body: `{ "html": "...", "printer": "...", "service_id": "..." }`.

### POST /v1/export

Legacy: posle surove HTML z Jobi jako PDF soubor. Body: `{ "html": "...", "target_path": "...", "letterhead_pdf_url": "..." }`.

## Komunikace Jobi <-> JobiDocs

1. Jobi posila kontext (PUT /v1/context) kazdych 5 s s aktualni session, servisy a konfiguraci.
2. Pri tisku/exportu Jobi posila data do /v1/print-document nebo /v1/export-document.
3. JobiDocs generuje HTML ze sablony, renderuje do PDF pres Chromium a tiskne/uklada.
4. Fallback: pokud JobiDocs nebezi, Jobi muze zobrazit nahled z vlastniho generateTicketHTML (omezene, bez JobiDocs sablony).

## Struktura DocumentsConfig

```typescript
interface DocumentsConfig {
  ticketList?: DocumentSectionConfig;
  diagnosticProtocol?: DocumentSectionConfig;
  warrantyCertificate?: DocumentSectionConfig & WarrantyCertificateExtras;
  autoPrint?: AutoPrintConfig;
  colorMode?: "color" | "bw";
  designAccentColor?: string;
  logoUrl?: string;
  stampUrl?: string;
  letterheadPdfUrl?: string;
  logoSize?: number;
  stampSize?: number;
}
```

Typ je definovan v `src/lib/documentHelpers.ts` (Jobi) a pouziva se i v JobiDocs.
