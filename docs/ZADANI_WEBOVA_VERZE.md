# Zadání: webová verze Jobi

Tenhle soubor je **zadání pro samostatnou větev**. Text níž se dá předat
tak, jak je.

---

## Cíl

Jobi běžící v prohlížeči jako **záložní cesta**: když desktopová aplikace
zlobí, jde přesto zadat a vytisknout zakázku. Není to náhrada desktopu,
je to pojistka.

## Co už platí (nemusí se řešit)

Zjištěno průzkumem, ověřeno v kódu:

- **Aplikace v prohlížeči už dnes běží.** `npm run dev` + `localhost:1420`,
  přihlašovací obrazovka se vykreslí, konzole čistá.
- **Volání Tauri jsou ošetřená.** Všechna jsou v `await import(...)` uvnitř
  `try/catch` s fallbackem, nebo za kontrolou `window.__TAURI_INTERNALS__`.
  Nic nespadne, jen se to neprovede.
- **Konfigurace dokumentů není v JobiDocs.** Leží v Supabase v tabulce
  `service_document_settings` a Jobi si ji umí načíst sám
  (`src/lib/documentSettings.ts`).
- **Generátor HTML poběží v prohlížeči.** `jobidocs/src/documentToHtml.ts`
  (865 řádků) má jen dva lokální importy – `documentDesign` a `richText`.
  Žádný Node, žádný Electron.
- **Logo, razítko a podpisy** jsou veřejné URL v Supabase Storage
  (bucket `service-document-assets`), v prohlížeči se načtou.
- **Vzor stubů** pro Tauri moduly už existuje v `ios aplikace/tauri-stub.js`
  + `resolve.alias` ve vite configu.

## Úkoly

### 1. Web build

Vytvořit `vite.config.web.ts` se stuby na Tauri moduly (vzor viz výše)
a build skript `build:web`. Desktopový build se nesmí změnit.

### 2. Degradace funkcí

| Funkce | Ve webu |
|---|---|
| Uložení PDF na disk | Stažení přes Blob + `<a download>` místo nativního dialogu |
| „Zobrazit ve složce“ | Skrýt |
| Aktualizace aplikace | Skrýt celou sekci v Nastavení |
| Spuštění JobiDocs | Skrýt |

### 3. Tisk bez JobiDocs

Sdílet `documentToHtml.ts` (přesunout do sdíleného umístění, nebo
importovat napříč – ať nevznikne třetí kopie) a tisknout přes
`window.print()` ze skrytého iframu.

Konfiguraci brát ze Supabase, tedy stejnou jako v desktopu – vzhled
nastavený v JobiDocs musí zůstat zachovaný.

**Známé omezení:** hlavičkový papír jako PDF (`letterheadPdfUrl`) se takhle
nesloučí – JobiDocs to dělá přes pdf-lib nad skutečným PDF, ale
`window.print()` žádné PDF nevyrábí. Buď vyřešit přes pdf.js (rasterizovat
hlavičku jako podklad), nebo v UI poctivě napsat, že ve webu není.

Otestovat okraje přes `@page` a `-webkit-print-color-adjust: exact`.
HTML už je psané pro tisk (JobiDocs používá `preferCSSPageSize`).

### 4. Nasazení

Cloudflare Pages – marketingový web tam už běží. Oddělená doména nebo
podcesta, ať se to neplete s `web/`.

### 5. Bezpečnost

Anon klíč bude veřejný stejně jako v desktopu, takže **všechno stojí a padá
na RLS**. Před spuštěním projít znovu; stav a metodu popisuje
`docs/AUDIT_2026-09.md`, včetně toho, jak se ověřuje anon přístup curlem.

## UI

Laťka je vysoká: **má to vypadat a chovat se jako Jobi**, ne jako
odbytá webová verze. Vycházet z `src/` – stejné komponenty, stejný
design systém, stejná typografie a barvy (`src/theme/`, `src/styles/`).

Rozdíl proti desktopu má být v tom, co chybí, ne v tom, jak to vypadá.

Počítat s tím, že se poběží i na menších obrazovkách – responzivní layout
řešit rovnou, ne dodatečně.

## Co nerozbít

- **Desktopová aplikace** musí fungovat úplně stejně. Žádná změna
  v `src-tauri/`, v release skriptech ani v tom, jak Jobi mluví s JobiDocs.
- **`jobidocs/api/print.ts` a `printers.ts`** – odladěná macOS cesta přes
  `lp`, nesahat.
- `npm run build`, `npm run test:run` a CI musí zůstat zelené.
