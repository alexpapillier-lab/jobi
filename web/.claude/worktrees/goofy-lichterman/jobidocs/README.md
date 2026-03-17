# JobiDocs

Separátní aplikace pro tisk a export dokumentů z Jobi. Používá vestavěný Chromium v Electronu pro spolehlivý render PDF – není potřeba Chrome ani Puppeteer.

## Architektura

- **Electron** – desktop app s React UI
- **Localhost API** (port 3847) – Jobi volá JobiDocs přes HTTP
- **Endpointy:** `/v1/health`, `/v1/printers`, `/v1/print`, `/v1/export` atd.

## Vývoj

```bash
cd jobidocs
npm install
npm run electron:dev
```

- Vite dev server běží na http://localhost:5173
- Electron okno načítá dev URL
- API server startuje v Electron main process na http://127.0.0.1:3847

## Build

```bash
npm run electron:build
```
