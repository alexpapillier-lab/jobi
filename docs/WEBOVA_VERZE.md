# Webová verze – analýza proveditelnosti

Cíl: mít Jobi dostupné v prohlížeči jako **záložní cestu**, kdyby desktopová
aplikace měla chybu a zakázky bylo přesto potřeba zadávat.

Stav: **analýza, nic nenasazeno.**

---

## Dobrá zpráva: aplikace v prohlížeči běží už dnes

Ověřeno spuštěním `npm run dev` a otevřením `http://localhost:1420`:
přihlašovací obrazovka se vykreslí, konzole je čistá, Supabase klient
se inicializuje.

Není to náhoda – kód je na to připravený:

- Volání Tauri jsou všechna v `await import(...)` uvnitř `try/catch`
  s fallbackem na prohlížeč (např. `openJobiDocsDownload` spadne zpátky
  na `window.open`).
- Updater a `set_app_icon` jsou schované za kontrolou
  `window.__TAURI_INTERNALS__`, takže se v prohlížeči vůbec nespustí.
- Pro iOS už existuje vzor stubů (`ios aplikace/tauri-stub.js`
  + `resolve.alias` ve vite configu), který jde použít i pro web.

## Co v prohlížeči nebude fungovat

| Funkce | Proč | Dopad |
|---|---|---|
| **Uložení PDF na disk** | `@tauri-apps/plugin-dialog` `save()` – nativní dialog | Nahradit stažením přes `<a download>` / Blob |
| **Zobrazení souboru ve složce** | `revealItemInDir` | Vypustit |
| **Automatické aktualizace** | Tauri updater | Nepotřeba, web je vždy aktuální |
| **Ikona v Docku** | `set_app_icon` | Nepotřeba |
| **Spuštění JobiDocs** | `launch_jobidocs` volá `open -a` | Uživatel si ho spustí sám |

Žádná z nich není pro zadávání zakázek podstatná. **Základní scénář – přihlásit
se, založit a upravit zakázku, spravovat zákazníky – by fungovat měl.**

## Tisk: možná ano, ale je to nejisté

JobiDocs poslouchá na `http://127.0.0.1:3847` a jeho CORS je nastavený na
`origin: true`, tedy povoluje jakýkoli původ. Teoreticky by tedy i webová
verze mohla tisknout přes lokálně nainstalovaný JobiDocs.

Dvě věci to můžou zhatit a **obojí je potřeba vyzkoušet, ne předpokládat**:

1. **Private Network Access** – Chrome vyžaduje u požadavků z veřejné stránky
   do lokální sítě preflight s hlavičkou `Access-Control-Request-Private-Network`.
   Fastify na to nemusí odpovědět správně.
2. **Safari** je u `https://` → `http://127.0.0.1` přísnější než Chrome.

Pokud to nevyjde, webová verze prostě nebude tisknout – což je pro záložní
scénář („potřebuju zadat zakázku, i když appka zlobí“) přijatelné.

---

## 🟠 Nález při analýze: lokální API JobiDocs nemá autentizaci

Tohle není o webové verzi, ale narazil jsem na to při jejím zkoumání.

`api/server.ts` registruje CORS s `origin: true` a jediný `onRequest` hook
zapisuje jen do activity logu – **žádná autentizace tam není**. Dokud JobiDocs
běží, může na jeho API sáhnout **jakákoli webová stránka, kterou si uživatel
otevře**:

| Endpoint | Co s ním jde |
|---|---|
| `GET /v1/context` | Přečíst seznam servisů uživatele (názvy, role) a firemní údaje |
| `GET /v1/printers` | Vypsat tiskárny (dobré na otiskování prohlížeče) |
| `PUT /v1/context` | **Přepsat kontext** včetně podvržení vlastního `supabaseUrl` a `supabaseAnonKey` |
| `POST /v1/print-document` | Spustit tisk na tiskárně uživatele |

**Není to převzetí účtu.** Ověřoval jsem to: přístupový token se drží
v odděleném `supabaseAuth`, a `GET /v1/context` vrací jen `jobiContext`,
kde token není. Jde tedy o únik firemních dat, možnost přepsat nastavení
a obtěžování tiskem.

Chrome to částečně tlumí přes Private Network Access, ale spoléhat se na to nelze.

### Jak to opravit

1. **Omezit CORS** jen na původy Jobi (`tauri://localhost`, `asset://localhost`,
   `http://localhost:1420` pro vývoj) místo `origin: true`. Minimální zásah
   s největším účinkem – útok z prohlížeče padne na Origin.
2. **Sdílené tajemství** – JobiDocs při startu zapíše náhodný token do souboru
   ve svém userData adresáři, Jobi ho přečte (běží pod stejným uživatelem)
   a posílá v hlavičce. Robustnější, ale víc práce.

**Záměrně jsem to neopravil.** Varianta 1 by mohla rozbít tisk, kdybych špatně
odhadl, jaký Origin posílá Tauri webview – a to bez spuštěné aplikace neověřím.
Odladěný macOS tisk je přednější než rychlá oprava naslepo. Chce to udělat
s aplikací po ruce a hned vyzkoušet.

Pozor na souvislost: varianta 1 zároveň **znemožní tisk z webové verze**.
Buď jedno, nebo druhé – pokud má web tisknout, je správná cesta varianta 2.

---

## Doporučený postup, až na to dojde

1. Vytvořit `vite.config.web.ts` se stuby na Tauri moduly (vzor je v `ios aplikace/`).
2. Ošetřit ukládání PDF: v prohlížeči nabídnout stažení místo nativního dialogu.
3. Skrýt v UI to, co ve webu nedává smysl (aktualizace, „zobrazit ve složce“).
4. Nasadit na Cloudflare Pages – marketingový web tam už běží.
5. **Ověřit RLS z pohledu prohlížeče.** Anon klíč bude veřejný stejně jako
   v desktopu, takže bezpečnost stojí a padá na RLS. Ta je po opravě
   z `docs/AUDIT_2026-09.md` v pořádku, ale před spuštěním webu to chce
   projít znovu.
