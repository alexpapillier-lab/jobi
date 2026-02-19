# JobiDocs – přepracování (TODO a návrhy)

## Stav implementace (průběžně)

- **1.1 Ukládání configu do DB – hotovo.** Jobi načítá `documentsConfig` z DB (`loadDocumentsConfigRawFromDB`) a posílá ho v kontextu do JobiDocs spolu s Supabase auth (url, anon key, access token). JobiDocs v PUT `/v1/context` ukládá tyto credentials; v PUT `/v1/documents-config` po zápisu do lokálního souboru zapisuje celý config i do Supabase (`service_document_settings`). JobiDocs je tak zdrojem pravdy; config se sdílí v rámci servisu na všech zařízeních.
- **1.4 Práva (read-only v JobiDocs) – hotovo.** Jobi posílá v kontextu `canManageDocuments` (podle role a capability `can_manage_documents`). JobiDocs API v PUT `/v1/documents-config` vrací 403, pokud `canManageDocuments === false`. V JobiDocs UI se při nedostatečném oprávnění zobrazí banner a tlačítko „Uložit nastavení dokumentů“ je disabled. RLS v DB (can_manage_documents) zůstává beze změny.
- **1.2 Logo a razítko do Storage – hotovo.** Base64 logo/razítko se při uložení nahrají do bucketu `service-document-assets` a v configu zůstanou URL. Bucket je třeba vytvořit v Supabase Dashboard (veřejný pro čtení).
- **1.3 „Naposledy upraveno“ – hotovo.** API vrací `updated_at` z DB (GET z Supabase při auth, PUT po sync). V UI zobrazeno u tlačítka Uložit.
- **Kap. 2.1 Paleta sekcí.** Přetahování sekcí z palety do náhledu, drop zóny, ✓ u přidaných; **šířka sekce** (Celá / Polovina) a **styl sekce** (Výchozí, S rámečkem, S linkami, Karty, Jen podtržené nadpisy, S levým pruhem) u každé sekce. Změna velikosti tažením zatím ne.
- **Kap. 2.2 Vlastní text (A + B + C).** Paleta „Vlastní text“, „Vlastní nadpis“, „Oddělovač“, „Prázdný řádek“; customBlocks s typy text | heading | separator | spacer; náhled a PDF. **Proměnné {{…}}:** kompletní sada (ticket_code, order_code, customer_*, device_*, service_*, repair_date, repair_completion_date, total_price, warranty_until, diagnostic_text, note) – při tisku z Jobi (API /v1/print-document s parametrem variables) se nahradí; v náhledu ukázkové hodnoty. **2.2 B – hotovo:** Vlastní nadpis, Oddělovač, Prázdný řádek (s výškou v px).
- **Kap. 3 – hotovo.** Levý sidebar s ikonami; **sidebar lze zavřít** (tlačítko v panelu / hamburger v hlavičce), aby byl na stránce víc místa. horní podtaby u Dokumentů; split view se sticky panelem a accordiony; indikátor připojení k Jobi v hlavičce. **Potvrzení před opuštěním:** při neuložených změnách v nastavení dokumentů a přepnutí záložky nebo typu dokumentu se zobrazí dialog „Chcete uložit změny?“ (Uložit / Neukládat / Zrušit). **Responzivita:** na šířce ≤768px je sidebar skrytý, v hlavičce je hamburger menu; po kliknutí se sidebar zobrazí jako overlay, po výběru položky nebo kliknutí na overlay se zavře.

---

## Zásady (nerozbít)

- **JobiDocs vytváří vzor dokumentu.** Tisk probíhá tak, že **Jobi pošle data**, JobiDocs je **vloží do tohoto vzoru** a pošle na tiskárnu. Tento flow musí zůstat zachován.
- Všechny níže uvedené změny musí být kompatibilní s tím, že „náhled“ = vzor, do kterého Jobi při tisku doplňuje reálná data (zakázka, zákazník, zařízení, opravy, datum…).

---

## 1. Ukládání customizace do DB

**Požadavek:** Customizovaný vzor dokumentu a všechny jeho podrobnosti se musí ukládat do DB (včetně loga, QR, razítka atd.). Když někdo nastaví vzhled, strukturu a obsah dokumentů, má se to aplikovat **všem ostatním uživatelům v tom servisu**.

### Návrhy implementace

- **1.1** Už teď existuje endpoint `documents-config` (GET/PUT) a kontext z Jobi. Ověřit, že se do payloadu ukládá **celý** config: `logoUrl` (base64 nebo URL), `stampUrl`, `qrPosition`, `qrCodeSize`, `reviewUrl`, všechny `sectionOrder`, `sectionWidths`, design, barvy, právní texty, viditelné sekce – a že Jobi na straně servisu tyto nastavení sdílí (např. přes `service_document_settings` nebo podobnou tabulku). Pokud něco chybí, doplnit do schématu a API.  
  **Pozn.:** Není to starý documents-config z Jobi (když nastavování dokumentů bylo tam)? Teď by se mělo nahrávat a načítat do/z DB **přímo z JobiDocs** – ověřit a případně upravit flow tak, aby JobiDocs byl zdrojem pravdy a ukládal/četl z DB.
- **1.2 Logo a razítko do Storage – hotovo.** Při uložení configu (PUT documents-config) s Supabase auth: pokud `logoUrl` nebo `stampUrl` jsou data URL (base64), nahrají se do Supabase Storage (bucket **service-document-assets**, cesty `{service_id}/logo.{ext}`, `{service_id}/stamp.{ext}`) a v configu se uloží jen veřejná URL. Migrace proběhne automaticky při prvním uložení. **Nutné:** V Supabase Dashboard → Storage vytvořit bucket `service-document-assets` a nastavit ho jako veřejný (Public) pro čtení; pro zápis slouží RLS / oprávnění uživatele (JWT).
- **1.3** Verzování configu: ukládat `version` nebo `updated_at` u document settings, aby Jobi/JobiDocs mohly zobrazit „naposledy upraveno“ a případně nabídnout rollback. **Hotovo:** GET `/v1/documents-config` vrací `updated_at` (z Supabase při auth). PUT po sync vrací `updated_at` a `version`. V JobiDocs UI u tlačítka Uložit: „Naposledy upraveno: DD.MM.YYYY, HH:MM“ (cs-CZ).
- **1.4** Práva: pouze určitá role (majitel, admin servisu) může měnit document settings, nebo změny schvalovat; ostatní jen čtou. Implementovat v RLS a v UI (disable edit pro „jen čtenáře“). **Hotovo:** Jobi posílá `canManageDocuments`, JobiDocs API vrací 403 při PUT bez oprávnění, UI zobrazuje banner a disabled tlačítko Uložit. RLS v DB již byl.

---

## 2. Customizace – nic neodebírat, jen přepracovat

**Požadavek:** Při přepracování nic nechybí (všechny funkce – sekce, design, logo, QR, razítko atd. – zůstanou dostupné). **Strukturu toho, jak to funguje, můžeme úplně změnit** (nejde o to „jen přeladit“ stávající UI).

### 2.1 Viditelné sekce – „+“ a nové sekce

- **Návrh A – Přidat tlačítko „+ Sekce“:** Vedle stávajícího seznamu viditelných sekcí (zaškrtávací políčka) přidat tlačítko **„+ Přidat sekci“**. Po kliknutí se zobrazí **dropdown** s typy: Údaje o servisu, Údaje o zákazníkovi, Údaje o zařízení, Provedené opravy, Diagnostika, Fotky, Data, Záruka (u záručního listu), atd. Uživatel vybere typ → sekce se přidá do pořadí a zobrazí v náhledu. Sekce v náhledu zůstávají **přetahovatelné** (pořadí měnitelné). Data z Jobi se pak do těchto sekcí mapují stejně jako dnes (podle klíče sekce).
- **Návrh B – Drag & drop z palety:** Levý panel má „paletu“ bloků (Servis, Zákazník, Zařízení, …). Uživatel přetáhne blok do náhledu dokumentu → sekce se vloží na vybrané místo. Pokud nějaká sekce v náhledu chybí, v paletě je označena jako „přidaná“. Duplicity povolit (např. dvakrát „Data“) nebo zakázat – podle produktového rozhodnutí.
- **Návrh C – Inline „+“ v náhledu:** V náhledu dokumentu mezi každými dvěma sekcemi malé tlačítko „+“. Klik → dropdown s výběrem typu sekce → vloží se mezi ně. Jednodušší pro uživatele, který vidí přímo stránku.

**Rozhodnuto: varianta B** (drag & drop z palety). Doplňující požadavky:
- **Změna velikosti sekce:** Šířka sekce (Celá / Polovina) – **hotovo.** Tažení rohem pro libovolnou velikost zatím ne.
- **Styl sekce:** U každé sekce výběr vizuálního stylu – **hotovo** (Výchozí, S rámečkem, S linkami, Karty, Jen podtržené nadpisy, S levým pruhem). Barvy prvků v sekci dědí z designu dokumentu.
- **Paleta – rozbalitelné sekce – hotovo.** U položek „Údaje o servisu“, „Údaje o zákazníkovi“ a „Údaje o zařízení“ v paletě je tlačítko ▼; rozkliknutím se zobrazí výběr zobrazených polí. Servis: Název, IČO, DIČ, Adresa, Telefon, E-mail, Web. Zákazník: Jméno, Telefon, E-mail, Adresa. Zařízení: Název/model, Sériové číslo, IMEI, Stav, Problém. Nastavení se ukládá do `sectionFields.service` / `sectionFields.customer` / `sectionFields.device` a aplikuje v náhledu i v PDF.

### 2.2 Vlastní textové boxy

- **Návrh A – Nový typ sekce „Vlastní text“:** V dropdownu (nebo paletě) přibude položka **„Vlastní text“**. Po přidání se v náhledu zobrazí blok s placeholderem „Sem napište text…“. Uživatel klikne a napíše libovolný text. Text se ukládá do configu (např. `customBlocks: [{ id: "uuid", type: "text", content: "…", order: 3 }]`). Při tisku z Jobi se tento blok vykreslí s uloženým obsahem (Jobi nemění vlastní texty, jen datové sekce).
- **Návrh B – Více typů vlastních bloků:** Kromě „Vlastní text“ i „Vlastní nadpis“ (větší font), „Oddělovač“, „Prázdný řádek“. Každý má v configu svůj obsah a styl.
- **Návrh C – Šablony vlastního textu s proměnnými:** Uživatel může do vlastního textu vložit placeholder, např. `{{ticket_code}}` nebo `{{customer_name}}`, které Jobi při tisku nahradí. Rozšíření API a documentToHtml o substituce.

**Rozhodnuto: A, B i C** (vlastní text, více typů bloků, i šablony s proměnnými typu `{{ticket_code}}`).

### 2.3 Další návrhy funkcí v customizaci

- **Podmíněná viditelnost sekce:** Ano. Např. „Zobraz sekci Záruka jen pokud je vyplněno datum opravy.“ Config: `sectionVisibility: { warranty: "when_repair_date_set" }`.
- **Opakovatelné bloky z Jobi:** Ano. Sekce „Položky oprav“ jako tabulka s konfigurovatelnými sloupci (název, cena, množství, …).
- **Pozice a velikost obrázků (logo, razítko, QR):** Ano. **Hotovo:** QR, logo i razítko lze v náhledu chytit a přetáhnout; pozice se ukládají do configu (`qrPosition`, `logoPosition`, `stampPosition`). Tlačítka „Vrátit logo do hlavičky“ / „Vrátit razítko do řádku podpisů“ obnoví výchozí umístění.
- **Více stránek vzoru:** Zatím ne (není potřeba).
- **Předtištěné PDF jako pozadí:** Možnost nahrát PDF (hlavičkový papír) a na něj rendit sekce. Vyžaduje sloučení PDF v backendu nebo v Electronu.

---

## 3. Celkové UI – modernější a intuitivnější

**Požadavek:** Projít celé UI JobiDocs a navrhnout, jak ho udělat modernější a intuitivnější. Níže návrhy po oblastech.

### 3.1 Obecné principy

- **Návrh 1 – Jedna hlavní „pracovní plocha“:** Ano. Boční panel, Dokumenty = hlavní obsah, Tiskárna a O aplikaci v nastavení, Aktivity jako tenký pruh/panel dole.
- **Návrh 2 – Krokový průvodce pro nové uživatele – hotovo.** Při prvním spuštění (localStorage) se zobrazí banner „První spuštění? [Průvodce nastavením] [Přeskočit]“. Průvodce: 3 kroky (Servis → Tiskárna → Vzor dokumentu), po „Další“ v kroku 2 přepne na záložku Nastavení, po „Dokončit“ na Dokumenty. Zavření nebo Přeskočit nastaví `jobidocs_wizard_dismissed` v localStorage.
- **Návrh 3 – Konzistentní vizuální jazyk:** Ano. Jedna sada komponent, design tokeny v theme.css. **Checkboxy, dropdowny atd. musí být moderní a fungovat správně** (nekolidovat s jinými prvky, přístupnost). 
### 3.2 Záložky / navigace

- **Návrh 4 – Sidebar s ikonami a popisem:** Levý sidebar s ikonami: Dokumenty, Tiskárna, Aktivity, O aplikaci. Při hover/aktivní zobrazit název. Úspora místa a přehlednost.
- **Návrh 5 – Horní tab bar s podtaby u Dokumentů:** Hlavní tab „Dokumenty“ s podtaby: Zakázkový list, Záruční list, Diagnostický protokol, Příjemka reklamace, Výdejka reklamace. Přepínání typu dokumentu bez scrollu.
- **Návrh 6 – Breadcrumbs – hotovo.** „Dokumenty > [typ dokumentu]“, „Nastavení > Tiskárna“, „Aktivity“, „O aplikaci“. Uživatel ví, kde je.

### 3.3 Sekce Dokumenty (customizace)

- **Návrh 7 – Split view: nastavení vlevo, náhled vpravo:** Ano. **Sidebar i levý panel Nastavení při scrollování připevněné k oknu (sticky) – hotovo.** Ideálně: okno JobiDocs otevřít přes celou obrazovku (ne fullscreen), aby byl náhled a přesouvání prvků jednodušší.
- **Návrh 8 – Skupiny nastavení v accordionech:** „Logo a razítko“, „Design a barvy“, „QR kód“, „Viditelné sekce a pořadí“, „Podpisy“ – každá skupina sbalitelná. **Hotovo:** Pod nadpisem „Nastavení“ je vždy viditelný řádek „Logo a razítko: [Nahrát logo] [Nahrát razítko]“ (bez rozkliknutí accordionu).
- **Návrh 9 – Náhled v reálném čase, plynulé tažení:** Ano. **Vylepšeno:** Drop zóny jsou vyšší (24/48 px), při najetí zobrazí „Pustit zde“ a zvýrazní se; při tažení z palety se zobrazí DragOverlay (plovoucí karta s názvem sekce).
- **Návrh 10 – Přepínač „Náhled / Šablona“ – hotovo.** Nad náhledem dokumentu je přepínač „Náhled“ | „Šablona“. Náhled = ukázková data, Šablona = placeholdery typu {{customer_name}}, {{ticket_code}} v sekcích (respektuje výběr polí u servisu/zákazníka/zařízení). Tisk ukázky a PDF respektují zvolený režim.

### 3.4 Tiskárna a nastavení

- **Návrh 11 – Jedna stránka „Nastavení“ – hotovo.** V sidebaru je záložka „Nastavení“ (místo jen „Tiskárna“); obsahuje Tiskárnu (výběr servisu a tiskárny, Uložit). Breadcrumb: „Nastavení > Tiskárna“. Budoucí další nastavení lze přidat pod stejnou záložku.
- **Návrh 12 – Indikátor připojení k Jobi:** V hlavičce malá ikona (zelená/červená) podle toho, zda JobiDocs dostává kontext ze servisu (services, activeServiceId). Tooltip: „Připojeno k servisu XY“ / „Nepřipojeno“.

### 3.5 Aktivity a O aplikaci

- **Návrh 13 – Aktivity jako kompaktní log – hotovo.** Tabulka s sloupci Čas, Akce, Stav, Detail; filtry „Stav: Vše / Jen chyby“ a „Období: Všechny / Posledních 24 h“; tlačítko Obnovit.
- **Návrh 14 – O aplikaci přehledně – hotovo.** Bloky: Verze (JobiDocs x.y.z), Stav API, Aktualizace (JobiDocsUpdateCard / text), Odkazy (nápověda jobi.cz, zpětná vazba podpora@jobi.cz). Licence/kredity ponecháno na později.

### 3.6 Další vylepšení UI

- **Návrh 15 – Ukládání:** Klávesové zkratky v JobiDocs nejsou potřeba. **Důležité: všude, kde je potřeba uložit, mít tlačítko Uložit**, které pošle data do DB. **Do DB se musí ukládat i pozice prvků (a vše potřebné)**, aby dokumenty stejného servisu na jiném zařízení vypadaly úplně stejně.
- **Návrh 16 – Potvrzení před opuštěním:** Ano. Při změně customizace a přepnutí bez uložení: „Chcete uložit změny?“.
- **Návrh 17 – Dark mode:** Není potřeba.
- **Návrh 18 – Responzivita:** Ano. Na menších oknech jeden sloupec nebo sidebar do hamburger menu.

---

## 4. Shrnutí priorit (návrh)

1. **Hotovo:** Ukládání celého configu do DB a sdílení v rámci servisu (kap. 1.1, 1.4).
2. **Teď:** **Nejdřív celé UI (kap. 3)** – sidebar s ikonami, podtaby u Dokumentů, split view se sticky panelem, accordiony pro skupiny nastavení, indikátor připojení k Jobi, Aktivity jako kompaktní log, O aplikaci, potvrzení před opuštěním, responzivita. Až bude nová „skořápka“ hotová, dává smysl do ní dávat menší prvky.
3. **Potom:** Drobnosti v rámci DB/ukládání: logo a razítko do storage (1.2), „naposledy upraveno“ / verzování v UI (1.3).
4. **Potom:** Přepracování customizace – paleta sekcí, vlastní textové boxy (kap. 2.1, 2.2), bez odebírání stávajících prvků.
5. **Kap. 2.1 Paleta sekcí – hotovo.** Paleta, drop zóny, ✓ u přidaných, pořadí tažením; **Šířka sekcí** (Celá / Polovina) a **Styl sekcí** (Výchozí, S rámečkem, S linkami, Karty, Jen podtržené nadpisy, S levým pruhem) u každé sekce. Změna velikosti tažením rohem zatím ne.
6. **Kap. 2.2 Vlastní text (A) – hotovo.** Paleta „Vlastní text“, přetažení vytvoří blok (customBlocks, sectionOrder). Levý panel: „Vlastní bloky“ s textarea a Odebrat. Náhled i PDF. B/C (více typů, proměnné {{…}}) zatím ne.
7. **Později:** Pokročilé funkce – podmíněná viditelnost, více stránek, předtištěné PDF (kap. 2.3).

---

*Dokument slouží jako podklad pro plánování a implementaci přepracování JobiDocs. Při změnách v kódu tento TODO průběžně aktualizovat.*
