# Dokumentace: Print Layout - Aktuální stav

## A) HTML Skeleton tiskového dokumentu

### Struktura:
```html
<body>
  <div class="page">
    <div class="content">         <!-- nebo <div class="document-content"> -->
      <!-- Obsah dokumentu -->
    </div>
    <div class="footer">
      <div class="document-footer">
        <div class="signatures">
          <div class="signature-box">
            <!-- Podpisy -->
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
```

### Reálné class names používané v aplikaci:
- `.page` - hlavní kontejner pro stránku
- `.content` - obsah pro ticket list
- `.document-content` - obsah pro diagnostic protocol a warranty (může být uvnitř `.content`)
- `.footer` - footer kontejner
- `.document-footer` - wrapper pro footer obsah
- `.signatures` - sekce s podpisy
- `.signature-box` - jednotlivý podpis
- `.signature-line` - čára pro podpis

---

## B) Kompletní CSS pro print window

### @page
```css
@media print {
  @page { 
    size: A4; 
    margin: 0; 
  }
}
```

### html, body
```css
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }
  
  body {
    min-height: auto !important;
  }
}
```

### .page
```css
@media print {
  .page {
    box-sizing: border-box !important;
    width: 210mm !important;
    height: 297mm !important;
    padding: 12mm !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: visible !important;
    margin: 0 !important;
  }
  
  body > .page {
    margin: 0 !important;
    overflow: visible !important;
  }
}
```

### .content, .document-content
```css
@media print {
  .content, .document-content {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }
}
```

### .footer a podpisy
```css
@media print {
  .footer {
    flex: 0 0 auto !important;
    overflow: visible !important;
    z-index: 10 !important;
    position: static !important;
    bottom: auto !important;
    left: auto !important;
    right: auto !important;
    margin-top: 0 !important;
  }
  
  .document-footer {
    overflow: visible !important;
    position: relative !important;
  }
  
  .signatures {
    overflow: visible !important;
  }
  
  .signature-box {
    overflow: visible !important;
    position: relative !important;
  }
}
```

### page-break rules
```css
@media print {
  /* Single-page (allowMultiPage = false) */
  .page {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    page-break-after: avoid !important;
    page-break-before: avoid !important;
  }
  
  /* Multi-page (allowMultiPage = true) */
  .page {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }
  
  .content {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }
  
  .section {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }
}
```

### Border-box enforcement
```css
@media print {
  *, *::before, *::after {
    box-sizing: border-box !important;
  }
  
  .page, .page * {
    box-sizing: border-box !important;
  }
}
```

---

## C) Aktuální log z print window

```javascript
console.log("[PrintWindow] Layout heights:", {
  page_client: pageElement.clientHeight,
  page_scroll: pageElement.scrollHeight,
  content_client: contentElement.clientHeight,
  content_scroll: contentElement.scrollHeight,
  footer_client: footerElement.clientHeight,
  footer_scroll: footerElement.scrollHeight,
  pageFits: pageScrollHeight <= pageClientHeight,
  contentOverflow: contentScrollHeight > contentClientHeight
});
```

**Umístění:** `src/pages/Settings/DocumentsSettings.tsx`, řádky 1594-1603

---

## Shrnutí problémů

1. **Flexbox layout**: `.page` má `display: flex` a `height: 297mm`, což může způsobovat problémy s výpočtem výšky
2. **Footer v flow**: Footer je v normálním flow (`position: static`), což může přidávat výšku
3. **Overflow visible**: `overflow: visible` na `.page` umožňuje obsah přetékat na druhou stránku
4. **Height vs min-height**: `.page` má `height: 297mm` místo `min-height: 297mm`, což může způsobovat problémy s zaokrouhlováním

