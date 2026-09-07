

## Pád ve WebKitu při silném kliknutí (force click) – 7. 9. 2026

Aplikace spadla po 17 minutách běhu se `SIGSEGV` v systémovém WebKitu:

```
0  libobjc.A.dylib  objc_retain + 16
1  WebKit  -[WKImmediateActionController _defaultAnimationController]
2  WebKit  -[WKImmediateActionController _updateImmediateActionItem]
3  WebKit  -[WKImmediateActionController didPerformImmediateActionHitTest:…]
```

To je cesta **náhledu při silném kliknutí** na trackpadu (force click, případně
tříprsté ťuknutí na „Vyhledat“). macOS se webview zeptá, co pod prstem je,
a WebKit sáhne na už uvolněný objekt. V zásobníku není ani řádka našeho kódu –
Jobi jen hostí `WKWebView`. Prostředí: macOS 27.0 beta (26A5353q), tedy
i WebKit je předběžná verze.

Obejít to jde z naší strany: v `tauri.conf.json` je u okna
`"allowLinkPreview": false`, což u `WKWebView` vypne `allowsLinkPreview`
a celá ta cesta se v systému nezavolá. Aplikace tím nic neztrácí – náhled
odkazu při silném kliknutí v dílenském programu k ničemu není, zatímco pád
uprostřed práce stojí rozdělanou zakázku.

**Když se to objeví znovu** (jiná cesta ve `WKImmediateActionController`),
další krok je vypnout detektory dat (telefon, adresa, datum – Jobi jich má
plno) přes `WKWebViewConfiguration.dataDetectorTypes`; ve wry se k tomu jde
dostat přes `with_data_detector_types`.

## Velikost rozhraní: desktop zvětšuje webview, web CSS zoomem – 7. 9. 2026

CSS `zoom` na `<html>` je past. Míchá dvě soustavy souřadnic
(`getBoundingClientRect()` vrací jiné jednotky, než jaké se zapisují do CSS)
a jednotky `vh`/`dvh` o něm vůbec nevědí. V kódu proto vzniklo sedm obezliček
`calc(100dvh / var(--ui-scale))` a jedna chyba (nedosažitelná poslední položka
v Nastavení) stála dvě kola oprav – první oprava fungovala při 100 % a při
125 % přetekla o 140 px.

Od 7. 9. platí:

| kde | jak | proč |
|---|---|---|
| desktop (Tauri) | `getCurrentWebview().setZoom(m)` | totéž co ⌘+ v prohlížeči: zvětší se i `vh` a souřadnice, žádný přepočet netřeba |
| web | CSS `zoom` + `--ui-scale` | stránka si zoom prohlížeče nastavit nesmí |

Rozhodování je v `src/lib/velikostRozhrani.ts` (6 testů). Na desktopu se
`--ui-scale` drží na 1, takže stará `calc(100dvh / var(--ui-scale))` se
chovají, jako by tam nebyla – nemusela se hned všechna přepisovat.

**Zbývá:** až se ověří, že zoom webview v desktopu sedí, dají se ty obezličky
postupně smazat (jsou v `BottomNav`, `Devices`, `CustomerDetail`, `Orders` 3×,
`InventoryDialog`). V prohlížeči musí zůstat.

