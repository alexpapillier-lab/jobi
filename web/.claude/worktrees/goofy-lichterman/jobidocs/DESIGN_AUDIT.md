# Audit designů dokumentů (JobiDocs)

## Přehled

Existují **4 designy**: **Klasický**, **Moderní**, **Minimální**, **Profesionální**. Každý mění barvy, rámečky, zaoblení a typografii hlavičky a sekcí. Design se ukládá v `docConfig.design` (per typ dokumentu). Barva designu se může přepsat přes **Barva designu** (`config.designAccentColor`) – platí jen v barevném režimu a u designů kromě Minimálního.

---

## 1. Kde se design používá

| Místo | Soubor | Popis |
|------|--------|--------|
| Generování PDF/HTML | `documentToHtml.ts` | `getDesignStyles(design, colorMode, accentOverride)` + podmínky `design === "minimal"` / `"modern"` v šabloně |
| Náhled v UI | `App.tsx` | Stejná funkce `getDesignStyles` (duplikovaná) + stejné podmínky v `DocumentPreview` |
| Výběr designu | `App.tsx` | Sekce „Design“, tlačítka z `DESIGN_OPTIONS` → `updateDocConfig(["design"], opt.value)` |
| Barva designu | `App.tsx` | Presety + vlastní barva; zobrazí se jen když `colorMode === "color"` a `design !== "minimal"` |

**Duplikace:** `getDesignStyles` je v `documentToHtml.ts` i v `App.tsx`. Logika by měla zůstat shodná; při změně jednoho je potřeba změnit i druhý.

---

## 2. Co každý design mění (getDesignStyles)

### Klasický (classic)
- **Barvy:** primary `#1f2937`, secondary `#4b5563`, headerBg `#f9fafb`, headerText `#1f2937`
- **Sekce:** border `1px solid #e5e7eb`, radius `8px`, header border `2px solid #d1d5db`
- **Vzhled:** světle šedá hlavička, šedé rámečky sekcí, mírně zaoblené

### Moderní (modern)
- **Barvy:** primary `#0c4a6e`, secondary `#0284c7`, headerBg gradient `#f0f9ff → #e0f2fe`, headerText `#0c4a6e`
- **Sekce:** border `1px solid #bae6fd`, radius `12px`, header border `2px solid #38bdf8`
- **Vzhled:** modrá škála, gradient v hlavičce, větší radius, „moderňák“
- **Typografie navíc:** nadpis sekce 14px (ostatní 13px), název servisu v hlavičce 16px/800 (ostatní 14px/700), hlavička má `border-radius: 8px`

### Minimální (minimal)
- **Barvy:** primary/secondary černé/šedé, headerBg **transparent**, headerText `#171717`
- **Sekce:** border **none**, radius **0**, header border `1px solid #d4d4d4`
- **Vzhled:** bez pozadí hlavičky, bez rámečků a radius u sekcí
- **Typografie:** nadpisy sekcí font-weight 500 (ostatní 700), padding sekcí 0 (ostatní 12px)
- **Barva designu:** presety/vlastní barva se u tohoto designu v UI nezobrazují

### Profesionální (professional)
- **Barvy:** primary `#1e3a5f`, secondary `#334155`, headerBg gradient `#f8fafc → #f1f5f9`, headerText `#1e3a5f`
- **Sekce:** border `1px solid #cbd5e1`, radius `6px`, header border `2px solid #94a3b8`
- **Vzhled:** tmavě modro-šedá, jemný gradient, střední zaoblení

---

## 3. Režim Barva / Černobílý (colorMode)

- **Barva:** použijí se barvy designu (příp. `designAccentColor`).
- **Černobílý:**  
  - headerBg `#f5f5f5`, headerText a primary `#171717`, secondary `#525252`  
  - sectionBorder `1px solid #e5e5e5`, headerBorder `2px solid #a3a3a3`  
  - `designAccentColor` se v BW ignoruje (všechny designy vypadají stejně šedě).

---

## 4. Přepsání barvy (designAccentColor)

- Když je vyplněné a režim je **Barva** a design **není** Minimální:
  - primary/headerText = accent
  - headerBg = `{accent}08`
  - sectionBorder = `1px solid {accent}40`
  - headerBorder = `2px solid {accent}`
  - sectionRadius se nastaví na 8 (v documentToHtml; v App náhledu zůstává z base).
- V **Černobílém** režimu se accent ignoruje.

---

## 5. Kde se design přímo zmiňuje v šabloně (documentToHtml)

| Prvek | Podmínka | Efekt |
|-------|----------|--------|
| Sekce – padding | `design === "minimal"` | 0, jinak 12px |
| Sekce – border, radius | `design === "minimal"` | none, 0; jinak ze styles |
| Nadpis sekce – font-size | `design === "modern"` | 14px, jinak 13px |
| Nadpis sekce – font-weight | `design === "minimal"` | 500, jinak 700 |
| Hlavička – border-radius | `design === "modern"` | 8px, jinak 0 |
| Hlavička – padding | podle headerBg | pokud není transparent, padding 8px 12px 10px 0 |
| Název servisu v hlavičce – font-size | `design === "modern"` | 16px, jinak 14px |
| Název servisu – font-weight | `design === "modern"` | 800, jinak 700 |
| Právní text (legal) | – | používá `styles.sectionRadius` a `styles.sectionBorder` |

---

## 6. Náhled v App.tsx (DocumentPreview)

- Volá `getDesignStyles(design, colorMode, designAccentColor)` – vlastní kopie funkce s rozšířeným výstupem (`borderColor`, `accentColor`, `borderWidth` pro komponenty).
- Stejné podmínky: `design === "minimal"` (padding 0, bez border/radius), `design === "modern"` (větší font v hlavičce, radius hlavičky 8).
- **Pozor:** V náhledu je u nadpisu sekce `fontSize: design === "modern" ? 12 : 11` – v PDF je 14 : 13. To je **nesoulad** oproti documentToHtml (v PDF jsou nadpisy sekcí už sjednocené na 13/14px).

---

## 7. Doporučení

1. **Sjednotit velikost nadpisů sekcí v náhledu** s PDF: v `DocumentPreview` použít pro nadpis sekce 13px (nebo 14px pro modern), aby odpovídalo `documentToHtml.ts`.
2. **Jedna getDesignStyles:** zvážit export z `documentToHtml.ts` (nebo sdíleného modulu) a v App.tsx jen importovat a případně rozšířit o pole pro UI (borderColor atd.), aby se předešlo rozbíjení při změnách.
3. **Dokumentace v kódu:** u `getDesignStyles` krátce popsat, že výstup řídí jak PDF, tak náhled, a že „minimal“ a „modern“ mají v šabloně zvláštní pravidla.

---

## 8. Shrnutí

- Designy fungují konzistentně pro **generování PDF** i **náhled**; rozdíl je v nadpisech sekcí (menší v náhledu).
- **Minimální** = bez dekoru (bez pozadí hlavičky, bez rámečků a radius), **Moderní** = větší fonty a zaoblení, **Klasický** a **Profesionální** = střední styl s různou paletou.
- **designAccentColor** mění barvy jen v barevném režimu a ne u Minimálního designu.
- **Černobílý** režim sjednotí vzhled všech designů na šedou škálu.
