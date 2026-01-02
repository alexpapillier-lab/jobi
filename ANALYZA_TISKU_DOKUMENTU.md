# Analýza tisku dokumentu v Tauri aplikaci

## 1) Kontext: co přesně chceš tisknout

### 1. Kde přesně v aplikaci je „Nastavení → úprava dokumentu“?

**Route/Komponenta:** `src/pages/Settings.tsx`

**Struktura:**
- **Hlavní komponenta:** `Settings` (default export)
- **Subsection:** `"orders_documents"` (původní "Dokumenty") a `"orders_documents_copy"` (nová "Kopie dokumenty")
- **Lokace v kódu:**
  - `orders_documents`: řádky ~4817-5838
  - `orders_documents_copy`: řádky ~5849-6850

**Navigace:**
- Sidebar → "Nastavení" → "Zakázky" → "Dokumenty" nebo "Kopie dokumenty"
- URL parametry: `?section=orders&subsection=orders_documents` nebo `orders_documents_copy`

### 2. Co je výstup „dokumentu“: HTML šablona, PDF, nebo něco jiného?

**Výstup je HTML šablona** (string), která se generuje pomocí funkcí:
- `generateTicketHTML()` - řádky ~1103-1577 v `src/pages/Orders.tsx`
- `generateDiagnosticProtocolHTML()` - v `src/pages/Orders.tsx`
- `generateWarrantyHTML()` - v `src/pages/Orders.tsx`

**Struktura HTML:**
- Kompletní `<!DOCTYPE html>` dokument
- Všechny CSS styly jsou inline v `<style>` tagu
- Obsahuje data z mock ticketu (`createMockTicket()`)
- Podporuje různé designy: `classic`, `modern`, `minimal`, `professional`
- Podporuje barevný/černobílý režim (`colorMode: "color" | "bw"`)

**Příklad z kódu:**
```typescript
// Řádek 1454 v Settings.tsx
htmlContent = generateTicketHTML(mockTicket, true, config, false);
// Parametr `true` = forPrint (přidá @media print CSS)
```

### 3. Když uživatel klikne na „Tisk“, co je cílový stav?

**Cílový stav:** Otevřít nativní macOS print dialog s dokumentem připraveným k tisku.

**Aktuální implementace (v "Kopie dokumenty"):**
- Vytvoří se skrytý iframe (width: 0, height: 0, opacity: 0)
- Do iframe se zapíše HTML obsah pomocí `iframeDoc.write(htmlContent)`
- Z iframe se volá `iframe.contentWindow.print()`
- **Problém:** Print dialog se otevře, ale dokument je prázdný/bílý

**Původní implementace (v "Dokumenty"):**
- Používá existující iframe s preview (`iframeRef.current`)
- Přepíše obsah iframe na print verzi (`printHtmlContent`)
- Z iframe okna volá `iframeWindow.print()`
- Po tisku obnoví původní preview obsah

### 4. Má být tisk identický s tím, co je v editoru (WYSIWYG), nebo je to separátní print template?

**Je to separátní print template**, ale měl by být vizuálně identický.

**Rozdíly:**
- Preview: `generateTicketHTML(mockTicket, false, config, false)` - `forPrint: false`
- Print: `generateTicketHTML(mockTicket, true, config, false)` - `forPrint: true`

**Když `forPrint: true`:**
- Přidá se `@media print { @page { size: A4; margin: 20mm; } }`
- Upraví se padding/margin pro tisk
- Přidají se print-specifické CSS pravidla

**V React komponentách ("Kopie dokumenty"):**
- Preview: React komponenty (`TicketDocumentReact`, `DiagnosticDocumentReact`, `WarrantyDocumentReact`)
- Print: Používá stejné HTML generátory jako "Dokumenty" sekce (řádek 1454-1458)

---

## 2) Architektura tisku: kde se to spouští a v jakém okně

### 5. Tisk se má spouštět v:

**Aktuální stav ("Kopie dokumenty"):**
- **Skrytý iframe** vytvořený dynamicky v `handlePrint()` (řádek 1465-1475)
- Iframe není viditelný (width: 0, height: 0, opacity: 0)
- Přidá se do `document.body`, po tisku se odstraní

**Původní stav ("Dokumenty"):**
- **Existující iframe** s preview (`iframeRef.current`)
- Iframe je viditelný a zobrazuje preview dokumentu
- Při tisku se do něj zapíše print verze, po tisku se obnoví preview

**V Orders.tsx (previewDocument):**
- **Separátní Tauri WebviewWindow** s label "preview"
- Otevře se nové okno s URL `/preview?ticketId=...&docType=...`
- V tom okně se volá `window.print()` z hlavního okna (řádek 170 v Preview.tsx)

### 6. Pokud se používá separátní okno: jak se vytváří?

**V Orders.tsx (`previewDocument`):**
```typescript
// Řádky 816-839
const WebviewWindow = await getWebviewWindow();
const win = new WebviewWindow("preview", {
  url: previewUrl,  // `${origin}/preview?ticketId=...&docType=...`
  title: "Náhled dokumentu",
  width: 900,
  height: 700,
  center: true,
  closable: true,
});
```

**URL struktura:**
- `previewUrl = ${origin}/preview?ticketId=${ticketId}&docType=${docType}&autoPrint=${autoPrint ? '1' : ''}`
- `origin = window.location.origin` (v dev: `http://localhost:1420`)

**V Settings.tsx:**
- **NEPOUŽÍVÁ se separátní okno** - vše se děje v hlavním okně

### 7. Jak vypadá současný flow: „klik → vygeneruju HTML → zobrazím preview → print"?

**Flow v "Kopie dokumenty" (ReactDocumentPreview):**

1. **Klik na "Tisknout"** → `handlePrint()` (řádek 1447)
2. **Generování HTML:**
   ```typescript
   htmlContent = generateTicketHTML(mockTicket, true, config, false);
   // Nebo generateDiagnosticProtocolHTML / generateWarrantyHTML
   ```
3. **Vytvoření skrytého iframe:**
   ```typescript
   const iframe = document.createElement('iframe');
   iframe.style.width = '0'; iframe.style.height = '0';
   document.body.appendChild(iframe);
   ```
4. **Zápis HTML do iframe:**
   ```typescript
   iframeDoc.open();
   iframeDoc.write(htmlContent);
   iframeDoc.close();
   ```
5. **Čekání na načtení iframe:**
   ```typescript
   iframe.onload = () => {
     setTimeout(() => {
       iframe.contentWindow?.print();
     }, 250);
   };
   ```
6. **Fallback timeout** (500ms) pokud `onload` neproběhne
7. **Vyčištění:** iframe se odstraní po 1 sekundě

**Flow v "Dokumenty" (DocumentPreview):**

1. **Klik na "Tisknout"** → inline handler (řádek 3163)
2. **Použití existujícího iframe:**
   ```typescript
   const iframe = iframeRef.current; // Preview iframe
   const iframeDoc = iframe.contentDocument;
   ```
3. **Přepsání obsahu iframe:**
   ```typescript
   iframeDoc.open();
   iframeDoc.write(printHtmlContent); // Print verze HTML
   iframeDoc.close();
   ```
4. **Tisk:**
   ```typescript
   setTimeout(() => {
     iframeWindow.print();
   }, 500);
   ```
5. **Obnovení preview:**
   ```typescript
   setTimeout(() => {
     iframeDoc.write(htmlContent); // Původní preview
   }, 1000);
   ```

---

## 3) Co už bylo zkoušeno (a jak to selhalo)

### 8. Které konkrétní varianty jste zkoušeli pro tisk?

**Historie pokusů (podle konverzace):**

1. **`window.open()` s HTML stringem**
   - **Výsledek:** "Nelze otevřít okno pro tisk. Zkontrolujte nastavení blokování vyskakovacích oken."
   - **Důvod:** Popup blocker blokuje `window.open()` v Tauri

2. **Skrytý iframe s `document.write()`**
   - **Výsledek:** Bílý/prázdný tisk
   - **Důvod:** Iframe se možná nenačte správně nebo CSS se neaplikuje

3. **Blob URL pro iframe `src`**
   - **Výsledek:** Stále bílý tisk
   - **Důvod:** Blob URL možná nefunguje správně v Tauri webview

4. **Přepsání existujícího preview iframe**
   - **Výsledek:** Design dokumentu se změnil před tiskem + bílý tisk
   - **Důvod:** Přepsání obsahu iframe způsobilo vizuální změnu

5. **CSS `@media print` přímo na hlavní stránce**
   - **Výsledek:** Tisk celého okna aplikace místo jen dokumentu
   - **Důvod:** CSS pravidla skryla špatné elementy

6. **`window.print()` z hlavního okna s `beforeprint`/`afterprint` eventy**
   - **Výsledek:** Tisk celé aplikace
   - **Důvod:** CSS selektory nebyly dostatečně specifické

7. **Aktuální stav: Skrytý iframe s `document.write()` a `iframe.contentWindow.print()`**
   - **Výsledek:** Print dialog se otevře, ale dokument je prázdný/bílý
   - **Důvod:** Neznámý - možná iframe se nenačte nebo CSS se neaplikuje

### 9. Kdy přesně to „hází zkontrolování, zda nejsou blokovana vyskakovaci okna":

**Hláška se zobrazuje:**
- **Kdy:** Při pokusu o `window.open('', '_blank')` v `handlePrint()`
- **Kde:** V UI aplikace jako toast notifikace (řádek 1467 v Settings.tsx)
- **Text:** `"Nelze otevřít okno pro tisk. Zkontrolujte nastavení blokování vyskakovacích oken."`

**Kód:**
```typescript
const printWindow = window.open('', '_blank');
if (!printWindow) {
  showToast("Nelze otevřít okno pro tisk...", "error");
  return;
}
```

**Poznámka:** Tato hláška se aktuálně NEzobrazuje, protože kód používá iframe místo `window.open()`.

### 10. Je to hláška přímo v UI aplikace (toast/dialog), nebo systémové hlášení v prohlížeči?

**Toast notifikace v UI aplikace** (pomocí `showToast()` funkce)

**Kód:**
```typescript
showToast("Nelze otevřít okno pro tisk. Zkontrolujte nastavení blokování vyskakovacích oken.", "error");
```

**Lokace:** `src/components/Toast.tsx` (pravděpodobně)

### 11. Co se stane po potvrzení/odmítnutí hlášky – otevře se něco, nebo nic?

**Nic se neotevře** - funkce se ukončí (`return`) a tisk se nespustí.

### 12. Když jste dali tisk přes iframe, psal jsi: „soubor k tisku byl bily".

**Bylo bílé:**
- **Preview:** Ne, preview zůstalo normální (React komponenty se zobrazují správně)
- **Výsledný tisk/PDF:** Ano, print dialog se otevřel, ale obsah byl prázdný/bílý

**HTML, které se do iframe vkládá:**

```typescript
// Řádek 1454-1458
let htmlContent = "";
if (documentType === "ticketList") {
  htmlContent = generateTicketHTML(mockTicket, true, config, false);
} else if (documentType === "diagnosticProtocol") {
  htmlContent = generateDiagnosticProtocolHTML(mockTicket, companyData, true, config, false);
} else if (documentType === "warrantyCertificate") {
  htmlContent = generateWarrantyHTML(mockTicket, companyData, true, config, false);
}
```

**Struktura HTML (z `generateTicketHTML`):**
- Kompletní `<!DOCTYPE html>` dokument
- `<head>` s `<meta charset="UTF-8">` a `<title>`
- `<style>` tag s inline CSS (včetně `@media print`)
- `<body>` s kompletním obsahem dokumentu

**Příklad HTML (zkráceno):**
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Zakázkový list - ...</title>
    <style>
      @media print {
        @page { size: A4; margin: 20mm; }
      }
      body { font-family: system-ui; ... }
      /* ... další CSS ... */
    </style>
  </head>
  <body>
    <div class="document-content">
      <!-- Kompletní obsah dokumentu -->
    </div>
  </body>
</html>
```

---

## 4) Tauri-specifika (kritické pro Cursor)

### 13. Je to Tauri v2? Jaká verze Tauri a jaký OS (macOS verze)?

**Tauri v2:** Ano

**Důkazy:**
- `package.json`: `"@tauri-apps/api": "^2"`
- `Cargo.toml`: `tauri = { version = "2", features = [] }`
- `tauri.conf.json`: `"$schema": "https://schema.tauri.app/config/2"`

**OS:** macOS (darwin 25.0.0) - podle user_info

**macOS verze:** 25.0.0 (pravděpodobně macOS Sequoia nebo novější beta)

### 14. Jaký webview runtime (WKWebView) a je to tauri nebo @tauri-apps/api v2 balíčcích?

**Webview runtime:** WKWebView (výchozí pro macOS v Tauri)

**Balíčky:**
- `@tauri-apps/api`: `^2` (v2)
- `@tauri-apps/plugin-opener`: `^2`
- `@tauri-apps/plugin-dialog`: `^2.4.2`
- `@tauri-apps/plugin-fs`: `^2.4.4`
- `@tauri-apps/cli`: `^2` (dev dependency)

**Detekce Tauri:**
```typescript
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```

### 15. Je tisk volaný z user gesture (onClick), nebo až async po renderu (setTimeout / promise)?

**Volaný z user gesture (onClick):**

```typescript
// Řádek 1633
<button onClick={handlePrint}>
  🖨️ Tisknout
</button>
```

**Ale pak je async delay:**
```typescript
iframe.onload = () => {
  setTimeout(() => {
    iframe.contentWindow?.print();
  }, 250); // 250ms delay
};
```

**Problém:** V WKWebView může být problém, že `print()` není volán přímo z user gesture handleru, ale až po async operacích (iframe.onload + setTimeout).

**WKWebView omezení:** `window.print()` musí být volán **přímo** z user gesture handleru, ne z async callbacku.

### 16. Pokud se otevírá nové okno pro preview/tisk: je to URL v rámci app, nebo data:/blob:?

**V Orders.tsx (`previewDocument`):**
- **URL v rámci app:** `${origin}/preview?ticketId=...&docType=...`
- `origin = window.location.origin` (v dev: `http://localhost:1420`)

**V Settings.tsx:**
- **NEPOUŽÍVÁ se URL** - používá se `document.write()` do iframe
- **NEPOUŽÍVÁ se blob URL** (bylo zkoušeno, ale nefungovalo)

### 17. Je někde nastavené CSP, sandbox atributy na iframe, nebo allow-popups?

**CSP v tauri.conf.json:**
```json
"security": {
  "csp": null
}
```
**CSP je vypnutý** - žádná omezení.

**Iframe atributy:**
```typescript
// Řádek 1465-1473
const iframe = document.createElement('iframe');
iframe.style.position = 'fixed';
iframe.style.right = '0';
iframe.style.bottom = '0';
iframe.style.width = '0';
iframe.style.height = '0';
iframe.style.border = 'none';
iframe.style.opacity = '0';
iframe.style.pointerEvents = 'none';
```

**Žádné `sandbox` nebo `allow-popups` atributy** - iframe má výchozí oprávnění.

**V DocumentPreview (původní "Dokumenty"):**
```typescript
// Řádek 3124-3139
<iframe
  ref={iframeRef}
  srcDoc={htmlContent}
  style={{ ... }}
  title="Náhled dokumentu"
/>
```
**Používá `srcDoc`** - inline HTML, žádné sandbox omezení.

---

## 5) Konkrétní kód, který Cursor musí vidět

### 18. Ukaž přesně:

**Komponenta s tlačítkem "Tisk":**
- **Soubor:** `src/pages/Settings.tsx`
- **Komponenta:** `ReactDocumentPreview` (řádek 1335)
- **Tlačítko:** Řádek 1632-1654

```typescript
<button
  onClick={handlePrint}
  className="no-print"
  style={{ ... }}
>
  🖨️ Tisknout
</button>
```

**Funkce, která generuje HTML/PDF:**
- **Soubor:** `src/pages/Orders.tsx`
- **Funkce:**
  - `generateTicketHTML()` - řádek 1103
  - `generateDiagnosticProtocolHTML()` - v Orders.tsx
  - `generateWarrantyHTML()` - v Orders.tsx

**Místo, kde se volá print():**
- **Soubor:** `src/pages/Settings.tsx`
- **Funkce:** `handlePrint()` v `ReactDocumentPreview` (řádek 1447)
- **Print volání:** Řádek 1494 a 1517
```typescript
iframe.contentWindow?.print();
```

**Definice iframe / preview okna:**
- **Skrytý iframe (pro tisk):** Řádek 1465-1475
```typescript
const iframe = document.createElement('iframe');
iframe.style.position = 'fixed';
iframe.style.width = '0';
iframe.style.height = '0';
// ...
document.body.appendChild(iframe);
```

- **Preview iframe (v DocumentPreview):** Řádek 3124-3139
```typescript
<iframe
  ref={iframeRef}
  srcDoc={htmlContent}
  style={{ width: "240mm", height: "327mm", ... }}
/>
```

### 19. Pokud existuje Preview.tsx / Orders.tsx / nebo analogický soubor pro „Nastavení → úprava dokumentu":

**Soubory:**
1. **`src/pages/Settings.tsx`** - hlavní soubor s nastavením
   - `ReactDocumentPreview` (řádek 1335) - "Kopie dokumenty"
   - `DocumentPreview` (řádek 3007) - "Dokumenty"
2. **`src/pages/Orders.tsx`** - HTML generátory
   - `generateTicketHTML()` (řádek 1103)
   - `generateDiagnosticProtocolHTML()`
   - `generateWarrantyHTML()`
   - `previewDocument()` (řádek 798) - otevírá separátní okno
3. **`src/pages/Preview.tsx`** - separátní preview okno
   - `Preview` komponenta (řádek 14)
   - `handlePrint()` (řádek 154) - tisk z preview okna

### 20. Jak se do preview dostává obsah: srcDoc, document.write, postMessage, innerHTML?

**V "Kopie dokumenty" (ReactDocumentPreview):**
- **Preview:** React komponenty přímo v DOM (řádek 1620-1628)
- **Print:** `document.write()` do skrytého iframe (řádek 1485-1487)

**V "Dokumenty" (DocumentPreview):**
- **Preview:** `srcDoc` atribut na iframe (řádek 3126)
- **Print:** `document.write()` do existujícího iframe (řádek 3181)

**V Preview.tsx:**
- **Preview:** `srcDoc` atribut na iframe (řádek 324)

---

## 6) Symptomy, které už znáš (a Cursor je má potvrdit)

### 21. Nativní macOS print dialog se „neukáže" – potvrď:

**Print dialog SE UKÁŽE**, ale dokument je prázdný/bílý.

**Kdy:**
- Vždy, když se klikne na "Tisknout" v "Kopie dokumenty"
- Print dialog se otevře správně
- Ale obsah je prázdný

**V dev vs build:**
- **Neznámé** - uživatel nezmínil rozdíl mezi dev a build

### 22. Když jste v minulých pokusech řešili „tisk dokumentu okno" a tlačítko Zavřít:

**V Preview.tsx:**
```typescript
// Řádek 178-189
const handleClose = async () => {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  } catch (err) {
    window.close(); // Fallback
  }
};
```

**Label okna:** `"preview"` (řádek 832 v Orders.tsx)

**Zavírání:** Používá Tauri API `appWindow.close()`, fallback na `window.close()`

### 23. Pokud máte logy typu „preview HTML generated" (dřív u Orders): máte ekvivalent logů i tady v Nastavení?

**Ano, logy existují:**

```typescript
// Řádek 1449
console.log("[ReactDocumentPreview] Starting print, document type:", documentType);

// Řádek 1503
console.error("[ReactDocumentPreview] Print error:", printError);

// Řádek 1532
console.error("[ReactDocumentPreview] Print error:", error);
```

**V DocumentPreview (původní "Dokumenty"):**
```typescript
// Řádek 3022
console.error("[DocumentPreview] Error generating HTML:", err);

// Řádek 3038
console.error("[DocumentPreview] Error generating print HTML:", err);
```

**V Preview.tsx:**
```typescript
// Řádek 133, 138, 143
console.log("[Preview] Auto-print: Window focused");
console.log("[Preview] Auto-print: Attempting print via main window");
console.log("[Preview] Auto-print: Print triggered via main window");
```

---

## 7) Kontrolní otázky: styling, fonty, assets

### 24. Má HTML pro tisk externí fonty/obrázky/CSS odkazy?

**Ne, vše je inline:**

- **Fonty:** `font-family: system-ui, -apple-system, sans-serif;` (systémové fonty)
- **CSS:** Všechny styly jsou v `<style>` tagu v HTML stringu
- **Obrázky:** 
  - Logo: Base64 data URL (pokud je logo nastavené)
  - QR kód: SVG inline v HTML
  - Razítko: Base64 data URL (pokud je nastavené)

**Příklad z kódu:**
```typescript
// V generateTicketHTML - logo jako base64
<img src="${logoBase64}" class="logo" ... />
```

### 25. Když je „bílý tisk", je CSS načtené? Nejsou tam @media print pravidla, která skryjí obsah?

**CSS by mělo být načtené** - je inline v `<style>` tagu.

**@media print pravidla:**
```css
@media print {
  @page {
    size: A4;
    margin: 20mm;
  }
  /* ... další CSS ... */
}
```

**Možný problém:** Pokud iframe se nenačte správně, CSS se nemusí aplikovat.

**Diagnostika:** Přidat logy do iframe `onload` a zkontrolovat, zda se CSS skutečně načetlo.

### 26. Používáš position: fixed/overflow layout, který může v print režimu zmizet?

**Ano, v HTML generátorech:**

```css
/* V generateTicketHTML */
body {
  ${forPrint ? `
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  ` : ""}
}
.document-footer {
  ${forPrint ? `
    margin-top: auto;
  ` : ""}
}
```

**V React komponentách (preview):**
```css
.document-preview {
  position: relative;
  width: 210mm;
  min-height: 297mm;
  /* ... */
}
```

**Možný problém:** `position: fixed` a flexbox layout může v print režimu způsobit problémy.

### 27. Pokud se používají obrázky: jsou to file:// cesty, asset: protokol, nebo base64?

**Base64 data URL:**

```typescript
// Příklad z generateTicketHTML
const logoBase64 = documentsConfig.logoBase64 || "";
if (logoBase64) {
  // <img src="${logoBase64}" ... />
}
```

**Všechny obrázky jsou base64:**
- Logo: `documentsConfig.logoBase64`
- Razítko: `documentsConfig.stampBase64`
- QR kód: SVG inline (ne obrázek)

---

## 8) Co má Cursor dodat jako výstup (a jak pracovat)

### 28. Ať Cursor nejdřív popíše „jak to teď funguje" (flow + okna + kde se renderuje obsah) – z kódu, ne domněnky.

**Aktuální flow v "Kopie dokumenty":**

1. **Uživatel otevře:** Settings → Zakázky → Kopie dokumenty
2. **Renderování preview:**
   - `ReactDocumentPreview` se renderuje (řádek 1335)
   - React komponenty (`TicketDocumentReact`, `DiagnosticDocumentReact`, `WarrantyDocumentReact`) se renderují přímo v DOM (řádek 1620-1628)
   - Preview je viditelné v `<div className="document-preview">` (řádek 1603-1629)

3. **Klik na "Tisknout":**
   - `handlePrint()` se spustí (řádek 1447)
   - Vygeneruje se HTML string pomocí `generateTicketHTML(mockTicket, true, config, false)` (řádek 1454)
   - Vytvoří se skrytý iframe (řádek 1465-1475)
   - HTML se zapíše do iframe pomocí `iframeDoc.write(htmlContent)` (řádek 1485-1487)

4. **Čekání na načtení:**
   - `iframe.onload` se spustí (řádek 1490)
   - Po 250ms se volá `iframe.contentWindow?.print()` (řádek 1494)

5. **Print dialog:**
   - macOS print dialog se otevře
   - **Problém:** Dokument je prázdný/bílý

6. **Vyčištění:**
   - Po 1 sekundě se iframe odstraní (řádek 1497-1500)

**Okna:**
- **Hlavní okno:** Tauri window s label "main" (tauri.conf.json, řádek 15)
- **Skrytý iframe:** Dynamicky vytvořený v `document.body`, není viditelný

**Kde se renderuje obsah:**
- **Preview:** React komponenty přímo v DOM (ne iframe)
- **Print:** HTML string v skrytém iframe

### 29. Ať navrhne 1 jediný další krok (jeden patch), který je testovatelný během 5 minut.

**Návrh: Přidat diagnostické logy a zkontrolovat, zda se iframe skutečně načetl:**

```typescript
const handlePrint = () => {
  try {
    console.log("[ReactDocumentPreview] Starting print, document type:", documentType);
    
    let htmlContent = "";
    if (documentType === "ticketList") {
      htmlContent = generateTicketHTML(mockTicket, true, config, false);
    } else if (documentType === "diagnosticProtocol") {
      htmlContent = generateDiagnosticProtocolHTML(mockTicket, companyData, true, config, false);
    } else if (documentType === "warrantyCertificate") {
      htmlContent = generateWarrantyHTML(mockTicket, companyData, true, config, false);
    } else {
      showToast("Neznámý typ dokumentu", "error");
      return;
    }
    
    console.log("[ReactDocumentPreview] HTML generated, length:", htmlContent.length);
    console.log("[ReactDocumentPreview] HTML preview (first 500 chars):", htmlContent.substring(0, 500));
    
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    
    document.body.appendChild(iframe);
    console.log("[ReactDocumentPreview] Iframe created and appended to body");
    
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      showToast("Chyba: Nelze vytvořit iframe pro tisk.", "error");
      return;
    }
    
    console.log("[ReactDocumentPreview] Iframe document accessible");
    
    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();
    
    console.log("[ReactDocumentPreview] HTML written to iframe");
    
    // Wait for iframe to load, then print
    iframe.onload = () => {
      console.log("[ReactDocumentPreview] Iframe onload fired");
      const iframeBody = iframeDoc.body;
      console.log("[ReactDocumentPreview] Iframe body exists:", !!iframeBody);
      console.log("[ReactDocumentPreview] Iframe body innerHTML length:", iframeBody?.innerHTML?.length || 0);
      console.log("[ReactDocumentPreview] Iframe body first 500 chars:", iframeBody?.innerHTML?.substring(0, 500) || "N/A");
      
      setTimeout(() => {
        try {
          console.log("[ReactDocumentPreview] Attempting to print from iframe");
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          console.log("[ReactDocumentPreview] Print() called successfully");
          
          setTimeout(() => {
            if (iframe.parentNode) {
              document.body.removeChild(iframe);
              console.log("[ReactDocumentPreview] Iframe removed after print");
            }
          }, 1000);
        } catch (printError) {
          console.error("[ReactDocumentPreview] Print error:", printError);
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
          showToast("Chyba při tisku: " + (printError instanceof Error ? printError.message : "Neznámá chyba"), "error");
        }
      }, 250);
    };
    
    // Fallback if onload doesn't fire
    setTimeout(() => {
      if (iframe.contentWindow) {
        console.log("[ReactDocumentPreview] Fallback timeout fired, checking iframe state");
        const iframeBody = iframeDoc.body;
        console.log("[ReactDocumentPreview] Fallback - Iframe body exists:", !!iframeBody);
        console.log("[ReactDocumentPreview] Fallback - Iframe body innerHTML length:", iframeBody?.innerHTML?.length || 0);
        
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          console.log("[ReactDocumentPreview] Fallback - Print() called");
          setTimeout(() => {
            if (iframe.parentNode) {
              document.body.removeChild(iframe);
            }
          }, 1000);
        } catch (e) {
          console.error("[ReactDocumentPreview] Fallback print error:", e);
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }
      }
    }, 500);
    
  } catch (error) {
    console.error("[ReactDocumentPreview] Print error:", error);
    showToast("Chyba při tisku: " + (error instanceof Error ? error.message : "Neznámá chyba"), "error");
  }
};
```

**Co to zjistí:**
- Zda se HTML skutečně vygenerovalo
- Zda se iframe vytvořil a přidal do DOM
- Zda se HTML zapsalo do iframe
- Zda se iframe načetl (`onload` event)
- Zda má iframe body obsah
- Zda se `print()` skutečně zavolal

### 30. Ať přidá diagnostické logy na správná místa (kdy vzniká okno, kdy je DOM ready, kdy se volá print).

**Viz výše v bodě 29** - přidány logy na všechna kritická místa.

### 31. Ať explicitně zohlední WKWebView/Tauri omezení: print musí být volán v kontextu okna, které skutečně renderuje obsah, a ideálně přímo z user gesture.

**Problém:** `print()` je volán z async callbacku (`iframe.onload` + `setTimeout`), ne přímo z user gesture handleru.

**WKWebView omezení:**
- `window.print()` musí být volán **přímo** z user gesture handleru (onClick)
- Pokud je volán z async callbacku, může být blokován nebo nefungovat správně

**Možné řešení:**
1. **Použít existující iframe místo vytváření nového** (jako v "Dokumenty" sekci)
2. **Zkusit `window.print()` z hlavního okna s CSS `@media print`** (jako v Preview.tsx)
3. **Použít Tauri WebviewWindow pro print** (jako v Orders.tsx `previewDocument`)

**Doporučení:** Zkusit přístup z Preview.tsx - použít `window.print()` z hlavního okna a skrýt vše kromě dokumentu pomocí CSS `@media print`.

