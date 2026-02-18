# Chyby v0.1.0 (test notarizované verze)

Seznam zjištěných problémů z testu první notarizované verze + navržená řešení a otevřené otázky.

---

## DMG a instalace

### [ ] Logo aplikace v DMG je ošklivé, není zaoblené a neodpovídá dohodnutému vzhledu; nemění se
- **Navrhované řešení:** Upravit ikonu v Tauri (ikony pro .app a pro DMG). DMG zobrazuje ikonu z .app bundle – tedy upravit `src-tauri/icons/` (všechny rozměry), aby logo bylo zaoblené a odpovídalo finálnímu designu. Případně použít vlastní DMG layout (skript vytváří DMG přes `hdiutil create -volname -srcfolder`; pro vlastní pozadí a ikonu by bylo potřeba složitější DMG layout s .DS_Store a složkou Aplikace).
- **Otázka:** Máte připravený finální návrh ikony (zaoblené, v jakém poměru / stylu), nebo mám vycházet z aktuálního `logos/logopic.svg` a jen ji zaoblit a exportovat do všech rozměrů? tady mas nova loga, jlogo pro jobi a jdlogo pro jobidocs: /Volumes/backup/jobi/logos. a jejich barvy pozadi / pismene se meni podle toho, jake logo uzivatel nastavi v Barvy loga Jobi a Barvy loga JobiDocs v nastaveni jobi. 

### [ ] Po otevření Jobi DMG: hezké pozadí + „Přesunout do Aplikací“ + ikona Aplikací; to samé u JobiDocs
- **Navrhované řešení:** Vytvořit „fancy“ DMG: pozadí (obrázek), složku Aplikace (symlink), text/ikona „Přesunout do Aplikací“. To znamená nepoužívat jen `hdiutil create -srcfolder`, ale připravit dočasnou složku s pozadím, symlinkem na /Applications a zkopírovanou .app, nastavit .DS_Store pro rozložení, a z té složky vytvořit DMG. Stejný postup pro JobiDocs – buď upravit electron-builder DMG šablonu (background, layout), nebo post-build skript, který z výsledného DMG vytvoří „fancy“ verzi.
- **Otázka:** Chcete jednotný vzhled DMG pro Jobi i JobiDocs (stejné pozadí, stejný text), nebo může být každý jiný? ano stejny, a at je to podobne fialove pozadi jako u login screenu jobi

---

## Login a branding

### [ ] Na login obrazovce je staré logo; má být nové Jobi logo fialové
- **Navrhované řešení:** Najít v kódu komponentu přihlášení (Login), vyměnit obrázek/logo za nové Jobi logo a nastavit barvu na fialovou (nebo použít SVG s `currentColor` / CSS variable pro téma).
- **Otázka:** Konkrétní odstín fialové (hex/kód) nebo použít stávající accent barvu z tématu? stávající, ale musí sedět s tím logem co bude v tom "Vytvořit „fancy“ DMG: pozadí (obrázek), složku Aplikace (symlink), text/ikona „Přesunout do Aplikací“. To znamená nepoužívat jen `hdiutil create -srcfolder`, ale připravit dočasnou složku s pozadím, symlinkem na /Applications a zkopírovanou .app, nastavit .DS_Store pro rozložení, a z té složky vytvořit DMG.", proste instalacni logo jobi a jobidocs bude nejake takove fialove, nez to uzivatel pak sam zmeni v tom nastaveni jak jsem psal vyse.

### [ ] Logo Jobi v sidebaru nesedí s aktuálním tématem
- **Navrhované řešení:** Sidebar používá pravděpodobně jedno logo – upravit tak, aby se barvilo podle tématu (dark/light/accent), např. přes `currentColor` v SVG nebo dynamickou výměnou fill podle `theme`. ano, to uz by tak melo fungovat, ale v te exportovane verzi jsem mel svetle tema a to logo v sidebaru bylo tmave.

### [ ] JobiDocs taky nemá své logo
- **Navrhované řešení:** Zkontrolovat, kde se v JobiDocs zobrazuje branding (okno, tray, about) a doplnit/opravit logo JobiDocs (stejný zdroj jako v Jobi nastavení – variant „jobidocs“).

---

## Registrace a pozvánky

### [ ] Po registraci účtu A přes kód: otevřel se servis, ale zobrazila se chyba o připojení k Supabase; owner viděl „pozvánka nebyla přijata“. Účet A musel po přihlášení aplikaci refreshnout, až pak „pozvánka přijata“
- **Navrhované řešení:** Po úspěšném `invite-accept` / přihlášení s kódem na frontendu znovu načíst stav služeb a členství (např. `refreshServices` + přepnout na nový servis) a případně zobrazit „Pozvánka přijata“ bez nutnosti ručního refresh. Na straně owner: po přijetí pozvánky jiným uživatelem nemusí být real-time update – buď polling, nebo krátké zpoždění a automatické znovunačtení seznamu pozvánek/členů po zobrazení Nastavení týmu.
- **Otázka:** Stačí po přihlášení účtu A ihned volat refresh služeb a ukázat toast „Pozvánka přijata“, nebo má přijít i notifikace ownerovi v reálném čase? ano, ale at je to hned po uspesne registraci, at napred projde tahle registrace, pozvanka prijata a pak to cloveka teprve hodi do toho servisu. ptz kdyz ho to hodi do servisu pred timto, tak to tam bude ukazovat chyby o tom, ze neni pripijene supabase atd.

### [ ] Účet A je admin a v Nastavení nevidí Tým/Přístupy. Owner když se přepne do toho servisu vidí jen záložky Základní údaje a Owner
- **Navrhované řešení:** Zkontrolovat podmínky zobrazení záložek v Nastavení: záložka „Tým“ / „Přístupy“ by měla být viditelná pro roli `admin` i `owner`. Podobně záložka „Owner“ jen pro root ownera; ostatní záložky (Základní údaje, Tým, …) podle rolí. Projít `Settings.tsx` (nebo ekvivalent) a opravit `role === 'owner' || role === 'admin'` pro zobrazení týmu.
- **Otázka:** Má admin vidět úplně stejné položky jako owner (kromě „Owner – správa servisů“), nebo má mít admin omezenou verzi (např. bez mazání servisu)? ma videt vse krome owner a nemuze mazat, pridavat servis atd. tom uze jen owner

### [x] Po založení nového servisu má owner dojem, že „pozvánka není potvrzená“ – chyba při načítání statusů (cloudová funkce tým)
- **Hotovo:** Backend při vytvoření servisu přidá tvůrce (root ownera) do memberships jako owner; frontend po create nastaví activeServiceId a refreshne kontext, takže owner je v novém servisu hned bez chyb.

---

## Nastavení – Základní údaje

### [ ] V Základní údaje v řádcích dát nějaké random/basic příklady, ne tak konkrétní
- **Navrhované řešení:** Změnit placeholder / příkladové texty u polí (název servisu, IČ, adresa, …) na obecné příklady (např. „Název servisu“, „12345678“, „Ulice 123, Město“) místo reálných konkrétních údajů. tohle prosim udelej uplne vsude, kde jsou takova data, projdi i jobidocs.

### [ ] V Základní údaje u všech údajů ukazuje hvězdičku jako že je to povinné
- **Navrhované řešení:** Buď odstranit hvězdičku u nepovinných polí, nebo zobrazovat hvězdičku jen u polí, která jsou skutečně povinná (podle validace / schématu). ja myslim, ze zadna data zde nejsou povinna a klidne bych to tak nechal

### [ ] Při zakládání zakázky odstranit „volitelné“ u heslo/kód; vše by mělo být volitelné
- **Navrhované řešení:** U formuláře zakázky (heslo, kód, …) odstranit štítky „volitelné“ a mít všechna tato pole jako volitelná bez zvláštního označení, nebo je neoznačovat vůbec. ano

---

## Onboarding a průvodce

### [ ] Nenabídlo instalaci JobiDocs ani „návod“ (průchod aplikací a ukázka funkcí)
- **Navrhované řešení:** Zkontrolovat podmínky zobrazení: (1) dialogu „Stáhnout JobiDocs“ po prvním přihlášení / po průvodci (např. `JOBIDOCS_DOWNLOAD_PROMPT_SEEN`); (2) spuštění tour / návodu (tutorial) – zda se spouští po první návštěvě a zda není podmínka příliš omezující (např. jen pro určitou roli nebo jen když už je JobiDocs). Upravit tak, aby se průvodce i nabídka JobiDocs zobrazily vhodně po prvním použití.
- **Otázka:** Má se průvodce spouštět vždy po prvním přihlášení (do aplikace), nebo až po výběru konkrétního servisu? A má se dialog JobiDocs zobrazit hned po průvodci, nebo až při prvním pokusu o tisk? po prvnim prihlaseni cloveka co zrovna prijal pozvanku. dialog jobidocs zobrazit hned po pruvodci. a nejde nejak dmg jobidocs pridat do aplikace jobi, at se stahne fakt primo z jobi a nemusi se jit na web atd.?

---

## UI a chování

### [x] Velikost UI nefunguje
- **Opraveno:** Místo `fontSize` na rootu (které nic neškálovalo, protože UI používá px) se teď aplikuje **zoom** na `document.documentElement`. Zoom škáluje celý obsah – seznamy, tlačítka, dropdowny. Rozsah 85 %–135 % z Nastavení → Vzhled a chování → Velikost UI.

### [ ] Když je Jobi ve fullscreenu a zavřu zakázku Escapem, zavře to celý fullscreen
- **Navrhované řešení:** Při zpracování klávesy Escape nejdřív zavřít otevřený modal/detail zakázky; pokud nic takového není otevřené, teprve pak opustit fullscreen (nebo neřešit Escape pro fullscreen). Tj. v handleru Escape zkontrolovat stav (je otevřený detail zakázky?) a podle toho buď zavřít jen detail, nebo nic. idealne zakazat escape pro fullscreen. 

### [x] Vytvořit v Jobi vysvětlení, že je potřeba nastavit JobiDocs: vybrat tiskárnu, přidat logo, „právní texty“, razítko atd.
- **Hotovo:** Po prvním připojení JobiDocs k Jobi (indikátor „JobiDocs ✓“) se jednou zobrazí modál „Nastavení JobiDocs“ s krátkým návodem: vybrat tiskárnu, nastavit logo, právní texty, razítko. Po odkliknutí „Rozumím“ se návod znovu nezobrazí (klíč `JOBIDOCS_FIRST_CONNECT_GUIDE_SEEN`). 

---

## Tisk a JobiDocs

### [ ] JobiDocs nenabízí tiskárnu, která je připojená k Macu; ale tisk z ní jde, jen ji to nenabízí
- **Navrhované řešení:** V JobiDocs zkontrolovat, jak se načítá seznam tiskáren (Electron `webContents.getPrinters()` nebo systémové API) a zda se správně zobrazuje v UI. Možná filtr/skrytí některých tiskáren nebo jiný formát výběru – upravit tak, aby připojená tiskárna byla v seznamu a vybraná. klidne udelat vic zpusobu ktere pobezi zaroven a vybrat ten, ktery nacte nejlepe disponible tiskarny, at mame jistotu, ze je to zobrazi, co na tohle rikas?

### [x] U automatického tisku při založení zakázky: „Povolte v prohlížeči vyskakovací okna.“ Při ručním kliknutí na tisk zakázkového listu to vytisklo normálně
- **Hotovo:** Automatický tisk (po vytvoření zakázky a po změně statusu) teď volá stejné funkce jako ruční tlačítka: `printTicket` a `printWarranty` → tisk jde přes JobiDocs API (`printDocumentViaJobiDocs`), bez otevírání okna a bez nutnosti povolovat vyskakovací okna. Reklamace (přijetí reklamace) zatím zůstává na `openPreviewWindowWithPrint`, dokud nebude v JobiDocs podpora.

### [ ] U zakázky nemám vyplněné žádné provedené opravy, ale i tak se vytiskly provedené opravy z ukázkového náhledu v JobiDocs
- **Navrhované řešení:** Při tisku zakázkového listu (a dalších dokumentů) předávat z Jobi do JobiDocs skutečná data zakázky. Pokud pro „provedené opravy“ nejsou žádné položky, JobiDocs by neměl vykreslovat celý blok „Provedené opravy“ (odstavec) – tedy podmínka v šabloně/náhledu: pokud `sections.repairs` nebo ekvivalent je prázdný, daný odstavec vůbec nevykreslit. Upravit šablonu i generování HTML/sections v Jobi tak, aby prázdné sekce nebyly posílány nebo aby JobiDocs nezobrazoval placeholder/ukázkový obsah, když data chybí.
- **Shrnutí:** Chápeme – žádné „provedené opravy“ v konkrétní zakázce → v tištěném dokumentu žádný odstavec „Provedené opravy“.

---

## Zakázky a funkce

### [ ] Číslo zakázky na zakázkovém listu
- V tištěném zakázkovém listu přidat **číslo zakázky** nahoru k nápisu „Zakázkový list“, hodně výrazně, aby bylo na první pohled dobře vidět.

### [ ] Při zadávání zakázky nemáme „Načíst z ARES“
- **Navrhované řešení:** Přidat tlačítko/funkci „Načíst z ARES“ (IČ → dotaz na ARES API), které předvyplní údaje zákazníka (firma, adresa, …) do formuláře zakázky. Implementace: volání ARES API (např. podle IČ), parsování odpovědi a mapování do polí formuláře.

### [x] Vytvořit v Jobi vysvětlení o nastavení JobiDocs (tiskárna, logo, právní texty, razítko)
- *Viz výše – návod se zobrazí po prvním připojení JobiDocs.*

---

## Shrnutí odpovědí

- **Loga:** Nová loga jsou v `logos/JLOGO.svg` (Jobi) a `logos/JDLOGO.svg` (JobiDocs). Barvy pozadí/písmen se mění podle nastavení „Barvy loga Jobi“ / „Barvy loga JobiDocs“ v Nastavení Jobi. Pro DMG a instalaci použít „nějaké takové fialové“, sjednocené s login screenem a fancy DMG pozadím.
- **DMG:** Jednotný vzhled pro Jobi i JobiDocs; fialové pozadí podobné login screenu; „Přesunout do Aplikací“ + ikona Aplikace.
- **Login / instalace:** Logo na loginu a v DMG má být v jednotné fialové, až pak si uživatel barvy změní v Nastavení.
- **Sidebar logo:** Mělo by se barvit podle tématu; v exportované verzi při světlém tématu bylo logo tmavé → opravit (bug v buildu/tématu).
- **Pozvánka po registraci:** Po úspěšné registraci nejdřív dokončit flow (toast „Pozvánka přijata“), až pak hodit uživatele do servisu, aby se nezobrazovaly chyby Supabase.
- **Admin:** Vidí vše kromě záložky Owner; nemůže mazat servis, přidávat servis atd. – to jen owner.
- **Placeholdery:** Všude (včetně JobiDocs) dát obecné příklady, ne konkrétní data.
- **Hvězdičky:** Žádné pole v Základní údaje není povinné; nechat bez povinných označení.
- **Zakázka:** Odstranit „volitelné“ u hesla/kódu; vše volitelné.
- **Průvodce:** Spustit po prvním přihlášení uživatele, který právě přijal pozvánku. Dialog „Stáhnout JobiDocs“ hned po průvodci.
- **Velikost UI:** Opravit tak, aby nic nerozbilo (seznam zakázek, tlačítka, dropdowny).
- **Escape:** Ideálně zakázat Escape pro výstup z fullscreenu – Escape jen zavře detail zakázky.
- **Návod JobiDocs (tiskárna, logo, razítko…):** Zobrazit v Jobi po tom, co se uživateli poprvé „v životě“ připojí JobiDocs k Jobi.
- **Tiskárny v JobiDocs:** Použít víc způsobů načtení (paralelně) a vybrat ten, který vrátí nejlepší seznam dostupných tiskáren.
- **Automatický tisk:** Stejný způsob jako při kliknutí na „Tisknout zakázkový list“. (hotovo)
- **Provedené opravy:** Když v zakázce žádné nejsou, v dokumentu celý blok nevykreslovat.

---

## Doplňující otázky (pro upřesnění)

1. **Stažení JobiDocs přímo z Jobi:** Dát DMG fyzicky do instalace Jobi by zvětšilo Jobi o desítky MB a každá aktualizace JobiDocs by vyžadovala novou verzi Jobi. **Navrhuju:** v Jobi tlačítko „Stáhnout JobiDocs“ otevře přímo odkaz na stažení souboru (např. `https://github.com/…/releases/download/…/JobiDocs-0.1.0-universal.dmg`), takže jeden klik = stáhne se DMG bez prohlížení stránky Releases. Je to takhle v pořádku, nebo opravdu potřebujete DMG „uvnitř“ Jobi (např. pro offline instalaci)? ano, udelal bych to tak. idealne at se v jobi i spusti instalace jobidocs a sama se presune i do aplikaci.a kdyz bude potreba updatovat jobidocs, tak se proste bude updatovat jobi i jobidocs zaroven.i kdyz to se nemusi, protoze jobi i jobidocs pak na aktualizace se budou aktualizovat samy pres ota, ne? a to mi pripomina - jak je vpravo nahore v jobi ten status jobidocs, tak kdyz neni jobidocs zapnute a ten status to ukazuje, bylo by super, kdyby kliknutim na ten status se jobidocs otevrelo. a dalsi vec cos jeste nedodelal - jobidocs by melo mit jen ikonku v hornim radku macos (tam jak je wifi, datum atd.). az po kliknuti na tu ikonku to otevre moznost otevrit a otevre to full jobidocs. pujde to?

2. **Fialová pro DMG a login:** Mám použít jednu konkrétní barvu z kódu (např. `var(--accent)` nebo konkrétní hex z tématu), nebo připravíte jeden přesný odstín (hex) pro „instalační fialovou“, který bude stejný na DMG i na login obrazovce? 
v nastaveni jobi ve vyberu loga mame fialove, pouzij to.

---

## Komentář k proveditelnosti (nové / doplněné body)

### Stažení a „spuštění instalace“ JobiDocs z Jobi
- **Otevřít přímý odkaz na .dmg (jedno kliknutí = stáhne se):** ✅ **Possible.** Tlačítko v Jobi otevře URL na `releases/download/…/JobiDocs-x.x.x-universal.dmg`; systém stáhne soubor. Po stažení můžeme (volitelně) otevřít stažený soubor, takže se namountuje DMG a uživatel uvidí okno „Přesunout do Aplikace“.
- **„Sama se přesune do Aplikací“:** ⚠️ **Částečně.** Automaticky otevřít DMG po stažení – ano. Automaticky zkopírovat .app do /Applications bez zásahu uživatele by vyžadovalo skript s vyššími oprávněními; na macOS je to nestandardní (Gatekeeper). Běžná praxe: uživatel po otevření DMG přetáhne aplikaci do Aplikací. **Doporučení:** v Jobi zajistit stáhnutí + otevření DMG (jedno kliknutí), zbytek (přetažení) nechat na uživateli; v dialogu lze napsat krátký návod.

### Kliknutí na status JobiDocs v Jobi → spustit JobiDocs
- ✅ **Possible.** Když JobiDocs není spuštěné a uživatel klikne na indikátor (✗), Jobi může spustit JobiDocs přes `open -a JobiDocs` nebo cestu k `/Applications/JobiDocs.app`. V Tauri to jde (shell/process). Pokud JobiDocs není nainstalované, zobrazit toast a nabídnout stažení.

### JobiDocs jen ikona v menu bar; po kliknutí „Otevřít“ → plné okno
- ✅ **Possible.** V Electronu standardní: **Tray** ikona (menu bar), při startu nezobrazit hlavní okno (nebo skrýt), hlavní okno zobrazit až po položce „Otevřít“ v menu u tray ikony. JobiDocs tedy startuje jen do tray; plné okno jen na vyžádání.

### Fialová z výběru loga v Nastavení
- ✅ **Possible.** V kódu najít preset „fialové“ v nastavení barev loga (LOGO_PRESETS), vzít z něj barvu (hex/CSS) a použít pro login a pro pozadí DMG.

### OTA Jobi vs. JobiDocs
- Oba mohou mít nezávislé OTA; nemusí se aktualizovat zároveň.

---

## OTA aktualizace – jak to běží

**Jobi (Tauri):** Po startu se zkontroluje `latest.json` na GitHubu. Pokud je nová verze, **vyskočí nativní dialog** (ne okno uvnitř aplikace): „Je k dispozici nová verze X. Chcete ji nainstalovat? Aplikace se po instalaci restartuje.“ Tlačítka: **„Ano, nainstalovat“** / **„Později“**. Po kliknutí na „Ano, nainstalovat“ se stáhne nová verze, nainstaluje a aplikace se restartuje. Takže ano – jedno okno/dialog, tlačítko stáhne, nainstaluje a restartuje.

**JobiDocs (Electron):** electron-updater stahuje na pozadí. Nejdřív dialog **„Je k dispozici nová verze X. Stahování proběhne na pozadí. Po dokončení můžete aplikaci restartovat.“** [OK]. Po stažení druhý dialog **„Nová verze je připravena. Restartovat nyní?“** [Restartovat] [Později]. Po „Restartovat“ se aplikace ukončí a nainstaluje nová verze. Chování je tedy stejné v tom smyslu: dialog → uživatel potvrdí → stáhne/ nainstaluje/restartuje.

---

## Tray ikona JobiDocs

- **Potřeba SVG?** Pro **menu bar (Tray)** v Electronu se používá **PNG**, ne SVG – Electron Tray bere cestu k obrázku (PNG). Takže SVG jako takové do Tray dát nejde.
- **Postup:** Můžete **vytvořit SVG** (logo Jobi/JobiDocs bez pozadí – např. z `logos/JDLOGO.svg`) a z něj **exportovat PNG** v rozměrech vhodných pro menu bar (např. 16×16 a 32×32 pro Retina). Tím PNG pak v JobiDocs nahradíte `electron/tray-icon.png`. Skript `copy-tray-icon` už kopíruje `electron/tray-icon.png` do buildu.
- **Shrnutí:** Logo „jobisheet bez pozadí“ je vhodné – použijte ho (JDLOGO bez pozadí), exportujte na PNG a dejte ho do `jobidocs/electron/tray-icon.png`. Pokud chcete jen připravit SVG, dá se z něj v build kroku nebo ručně vygenerovat PNG.

**Rozměr: 16×16 nebo 32×32? Stačí jeden?**  
- **Stačí jeden soubor 32×32 px.** Electron/macOS ikonu zmenší pro menu bar; na Retina displejích se často používá 22×22 logických bodů = 44×44 px, ale 32×32 většinou vypadá v pohodě.  
- **Pro nejostřejší vzhled:** mít 16×16 (nebo 22×22) pro běžný display a 32×32 (nebo 44×44) pro Retina – Electron umí vzít větší obrázek a zmenšit, takže **jen 32×32 je v praxi dostačující** a bude fungovat i tam, kde by systém chtěl 16×16 (prostě se zmenší). **Doporučení: udělej jednu PNG 32×32** (nebo 22×22 / 44×44, chcete-li „natívní“ velikost pro macOS); druhou velikost dělat nemusíš.

---

## OTA – doplňující požadavky a odpovědi

### Co udělá „Později“?
- Dialog se zavře a **nic se neinstaluje**. Aplikace běží dál ve staré verzi. Při **dalším startu** Jobi se znovu stáhne `latest.json` a pokud je stále nová verze, dialog s aktualizací se znovu nabídne. (Případně můžeme přidat periodickou kontrolu – viz níže.)

### Kontrolovat latest.json častěji?
- **Ano, jde to.** ~~Teď se kontroluje **jednou po startu** (při prvním mountu).~~ Dá se přidat např. kontrola **periodicky** (např. každých 6 h, nebo 24 h), nebo při **znovu zobrazení okna** (když se uživatel vrátí k aplikaci).
- **[x] Kontrola při znovu zobrazení okna** – implementováno: v `useCheckForAppUpdate` se kontrola spouští i na `document.visibilitychange` (když je aplikace znovu „visible“), s cooldownem 5 min.

### Oznamovat aktualizace JobiDocs v Jobi?
- **Ano, jde to.** Jobi může (např. při startu nebo periodicky) stáhnout soubor, který popisuje nejnovější verzi JobiDocs – např. **latest-mac.yml** z téhož GitHub release, nebo endpoint `releases/latest` – a porovnat s lokálně uloženou/známou verzí. Když je nová verze JobiDocs, v Jobi zobrazit dialog: „Je k dispozici nová verze JobiDocs (X.Y.Z). Stáhnout?“ a tlačítko otevře přímý odkaz na .dmg. Uživatel tak nemusí do JobiDocs chodit; hlavní je Jobi, tam se dozví o updatu. ne, odkaz na dmg nechceme, chceme, aby si jobi i jobidocs aktualizace stahli a instalovali sami. od uzivatele pouze potvrznei, ze chteji aktualizovat, nic jineho. 

### Instalace po odsouhlasení plně automatická
- **Už to tak je.** Po kliknutí „Ano, nainstalovat“ v Jobi proběhne `downloadAndInstall()` a pak `relaunch()` – žádné další kroky od uživatele. U JobiDocs po „Restartovat“ proběhne `quitAndInstall()`. Po odsouhlasení je instalace a restart plně automatické.

### Okno „Co je nového“ po aktualizaci
- **Jde to.** Po restartu po aktualizaci můžeme zobrazit modál s textem „Co je nového v X.Y.Z“. Implementace: před `relaunch()` uložit do localStorage (nebo do souboru) např. `pendingChangelogVersion` a `pendingChangelogBody`. Po startu aplikace načíst aktuální verzi; pokud `pendingChangelogVersion` odpovídá této verzi, zobrazit modál s obsahem (z `update.body` z Tauri updateru, nebo z GitHub release notes) a pak `pendingChangelogVersion` smazat. V Tauri updateru má `update` pole `body` (release notes z GitHubu), takže ten text můžeme před restartem uložit a po startu zobrazit.

---

## PNG ikony aplikace Jobi (barvy z Nastavení)

Ikona aplikace v Docku/Finderu se má měnit podle výběru „Barvy loga Jobi“ v Nastavení. Pro každou předvolbu je potřeba jeden PNG (čtverec, doporučeně **1024×1024 px**). Složka: **stejná jako tray logo** (např. `logos/`).

- **[x] PNG náhledy v Nastavení** – v sekci Barvy loga Jobi se zobrazují náhledy z PNG ze složky `logos/logos png/` (Vite servíruje na `/logos/{id}.png`, při buildu se kopírují do `dist/logos/`).
- **[x] Okamžitá změna ikony aplikace** – po výběru barvy se ikona v Docku (macOS) změní hned; Tauri command `set_app_icon` (base64 PNG) + při startu aplikace se aplikuje uložená předvolba. **Pozn.:** Ikona ve složce Aplikace (Finder) je vždy z .app bundle (.icns) – při zavřené aplikaci se tam zvolená barva neprojeví; mění se jen ikona v Docku za běhu. Přepisovat soubory uvnitř .app (např. .icns) by zrušilo code signing. Teoreticky by šlo použít **extended attributes** (stejný mechanismus jako když uživatel v Get Info vloží vlastní ikonu – macOS uloží `Icon?`, podpis se neporuší), ale implementace by byla netriviální; některé aplikace možná něco podobného dělají (např. utilitky pro údržbu systému).
- **[x] Výběr barvy loga JobiDocs v Nastavení odstraněn** – pouze Jobi má výběr; JobiDocs vždy podle barevného tématu.

### Pojmenování souborů

- **Formát:** `jobi-icon-{id}.png`
- **Id** = přesně hodnota z tabulky (sloupec Id).

Při volbě „Podle tématu“ se použije ikona podle aktuálního barevného tématu (stejná id).

### Aktuální barvy (předvolby) a id

| Id | Label |
|----|--------|
| `light` | Světlé |
| `dark` | Tmavé |
| `blue` | Modré |
| `green` | Zelené |
| `orange` | Oranžové |
| `purple` | Fialové |
| `pink` | Růžové |
| `light-blue` | Světle modré |
| `light-green` | Světle zelené |
| `light-orange` | Světle oranžové |
| `light-purple` | Světle fialové |
| `light-pink` | Světle růžové |
| `paper-mint` | Paper Mint |
| `sand-ink` | Sand & Ink |
| `sky-blueprint` | Sky Blueprint |
| `lilac-frost` | Lilac Frost |
| `halloween` | Halloween |
| `christmas` | Vánoce |
| `tron-red` | Tron Red |
| `tron-cyan` | Tron Cyan |
| `synthwave` | Synthwave |

**Příklady názvů:** `jobi-icon-light.png`, `jobi-icon-purple.png`, `jobi-icon-tron-cyan.png`.

**JobiDocs:** Výběr barvy loga JobiDocs v Nastavení byl odstraněn – pouze Jobi má výběr. **[x] Ikona aplikace JobiDocs** – ikona .app (Dock, Finder): **`logos/jdlogo.png`**; tray (menu bar): **`logos/tray-icon.png`**. Skript `copy-app-icon` před buildem/dev zkopíruje `logos/jdlogo.png` → `jobidocs/electron/icon.png` a `logos/tray-icon.png` → `jobidocs/electron/tray-icon.png`. V Jobi se logo JobiDocs (status, AppLogo variant jobidocs) bere z `/logos/jdlogo.png`.

---

## Backlog / další

- [ ] **Achievementy** – systém odznaků / úspěchů (např. první zakázka, X zakázek, připojení JobiDocs, …).

---

*Dokument vytvořen z testu v0.1.0. Po odpovědích na doplňující otázky lze body rozepsat do úkolů a implementovat. **Při splnění/opravě/přidání bodu** u daného odstavce doplň `[x]` a případně krátkou poznámku (co je hotovo).*
