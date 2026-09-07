

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

