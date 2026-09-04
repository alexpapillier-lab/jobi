# JobiDocs 2.0 – návrh přepracování (3. 9. 2026)

## Stav realizace (3. 9. 2026 večer)

Návrh níže je **realizovaný** v pracovním stromu (necommitnuto):

- `jobidocs/core/` – jádro s jediným rendererem, výchozí šablony podle referenčních dokumentů ze Zakázkového listu, migrace v1 → v2, 15 testů.
- `jobidocs/api/` – v2 endpointy (`/v2/documents|html|pdf|print|export`), v1 přes adaptér, Supabase `config.v2` s kontrolou verze (ověřeno: uložení, 409 při konfliktu).
- `jobidocs/electron/main.ts` – čeká na doměření stránky před PDF; Node přepnutý na IPv4 (`dns.setDefaultResultOrder`), bez toho na této síti padal fetch na Supabase i fonty.
- `jobidocs/src/` – nový editor (osnova | dokument | inspektor, Značka, Tiskárna, Aktivity, O aplikaci). Starý App.tsx a duplicitní náhled smazány.
- Roboto přibalené v `core/fonts.ts`: PDF vzniká za ~0,3 s (dřív 5–11 s kvůli stahování písma při každém tisku).
- Jobi: `src/lib/documentData.ts`, v2 klient v `src/lib/jobidocs.ts`, `Orders.tsx`, `Invoices.tsx`, web tisk přes jádro. Typecheck, lint i 237 testů prošly.
- Verze JobiDocs 0.3.0; zbývá vydat (electron:build → GitHub Release s `latest-mac.yml`).

- **Druhá fáze (4. 9. v noci):** vzhled dokumentů záměrně odlišný od referenčních PDF (logo + servis vlevo, typ s velkým číslem vpravo, údaje v mřížce, právní text ve dvou sloupcích, podpisy dole; tři motivy), právní texty přepsané vlastními slovy a editovatelné. Editor „upravuj přímo v dokumentu“: klik = výběr s lištou, další klik = psaní s čipy proměnných, plus mezi bloky, lišta u řádků, klávesy, tažení; osnova a inspektor jen doplněk. Náhled na skutečné zakázce ze Supabase, záloha rozdělané práce, ErrorBoundary. Opravena duplicitní historie Zpět ve StrictMode.

Podrobnosti k API a struktuře: `jobidocs/README.md`.

Plná verze s důkazy a náčrtem editoru je publikovaná jako artifact (odkaz v konverzaci).
Tohle je zkrácený zápis, aby návrh žil i v repu.

## Zjištění (měřeno na 0.2.7 proti živému API)

1. **Náhled ≠ tisk.** Editor kreslí dokument v Reactu (`DocumentPreview`), tisk jde přes
   `generateDocumentHtml`. Výchozí hodnoty (`defaultDocumentsConfig()`) žijí jen v editoru;
   server pro servis bez uložené šablony tiskne prázdný config. Ověřeno: editor ukazuje podpisy
   a právní text, `/v1/render-pdf` pro tentýž servis vrátí dokument bez nich a s vytištěným
   rámečkem „LOGO“. Print path čte lokální soubor, GET config čte Supabase.
2. **Stránka je pevný obrázek 794×1123 px**, `overflow: hidden`, jedna strana, přetečení se ořízne.
   Podpisy, QR, logo, razítko jsou `position: absolute` na souřadnicích. Font Inter není embedovaný.
3. **Konfigurace bez modelu**: include* booleany i sectionOrder (dvě pravdy o viditelnosti),
   sectionWidths + sectionSide + sectionStyles + sectionFields + customBlocks + signaturePositions,
   dvě sady názvů (zakazkovy_list / ticketList), dvě tabulky v DB, Jobi přepisuje celý JSON
   při ukládání autoPrint.
4. **Data jako řetězce**: `variables: Record<string,string>`, JSON ve stringu (repair_items, photo_urls),
   bez schématu (inv_vat vs inv_vat_amount).
5. **Editor zrcadlí config**: App.tsx 4 900 řádků, 60+ stavů, 4 designy × 2 režimy × 8 presetů ×
   6 stylů per sekce × šířka × strana.

## Princip

- **Jeden renderer** (šablona + data → HTML) pro editor i PDF; editor zobrazuje totéž HTML v iframu.
- **Jedno schéma**: verzovaný JSON (zod), výchozí šablony v jádru, ne v editoru.
- **Jeden zdroj pravdy**: Supabase `document_templates`, ukládání s kontrolou verze, lokální soubor jen cache.

Nový balíček `docs-core` (čisté TS): schema, defaults, migrace v1→v2, renderer, katalog proměnných,
ukázková data, snapshot testy. Používá ho Electron, editor i web Jobi.

## Model

- **Brand** (per servis): logo, razítko, barva, písmo, letterhead, kontakt do zápatí, review URL.
- **Theme** (per servis): 4 startovní motivy, tokeny (akcent, text, linky, radius, hustota, styl nadpisů).
- **Template** (per typ dokumentu): header varianta, uspořádaný seznam bloků, signatures (sloty, ukotvené dole), footer.
  Bloky: party, device, items, dates, warranty, photos, text, richtext, heading, divider, spacer, columns,
  invoice-summary, payment, qr, image. Každý blok `when: always | notEmpty | editorOnly`.
- **DocumentData** (per tisk): typovaný objekt (čísla jako čísla, data ISO), formátování dělá renderer.
  Adaptér `variables → DocumentData` pro starší Jobi.

## Tisk

`@page A4` v mm, obsah teče, `break-inside: avoid`, thead se opakuje, hlavička/zápatí na každé straně,
letterhead na každé straně, podpisy ukotvené na konec, volitelné „vejít se na jednu stranu“ zmenšením
hustoty (měření před printToPDF), embedované písmo, žádné placeholdery v tisku, snapshot testy krátká/dlouhá data.

## Editor

Osnova vlevo (pořadí, + přidat blok) · dokument uprostřed (skutečný render, klik vybere blok) ·
inspektor vpravo (vlastnosti bloku; bez výběru = Značka a Motiv). Přepínač ukázkových dat
(krátká / dlouhá / prázdná) místo tří režimů náhledu. Zkušební tisk tiskne přesně plochu.
QR/logo/razítko ve slotech místo souřadnic.

## API

`POST /v2/print`, `/v2/pdf`, `/v2/html` s `{docType, data}`; `GET/PUT /v2/templates/:docType` (ifVersion → 409);
`GET/PUT /v2/brand`; `/v1/print-document` zachován přes adaptér. DB: `document_templates`, `document_brand`;
`document_profiles` zaniká; autoPrint zůstává v `service_document_settings` jako jediný obsah.

## Fáze

1. Jádro (schema, defaults, renderer, migrace, testy) – bez zásahu do běžící aplikace.
2. Tisk v2 v Electronu + Jobi posílá DocumentData.
3. Nový editor (osnova / dokument / inspektor, Značka, ukládání s verzí), starý vedle za přepínačem.
4. Úklid: smazat DocumentPreview, getDesignStyles, starý config, document_profiles; web Jobi přes docs-core.

## Otevřená rozhodnutí

1. Vícestránkové dokumenty – doporučeno ano, s volbou „na jednu stranu“ per typ.
2. Volné tažení QR/loga/razítka – doporučeno nahradit sloty.
3. Styl per sekce – doporučeno jeden motiv pro dokument.

Potřebné podklady: PDF/skeny reálných dokumentů ze Zakázkového listu (ZL, záruční list, příjemka, výdejka, faktura).
