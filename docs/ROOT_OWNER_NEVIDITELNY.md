# Majitel aplikace je pro členy servisů neviditelný

Zadání majitele (9. 10. 2026): *„Ověř, zda se owner v servisech někde
zobrazuje, kdekoliv, v chatu atd. Já jako owner musím být pro všechny
neviditelný.“*

Majitel aplikace (root owner, id v `app_nastaveni.root_owner_id`,
`VITE_ROOT_OWNER_ID`, `ROOT_OWNER_ID` u edge funkcí) je členem všech servisů:

| Servis | Role | Členství |
| --- | --- | --- |
| iSwap Repair Point Praha, MajkaPajka, TEST2 | owner | **viditelné** (`skryty = false`) |
| ostatní (5 servisů) | admin | skryté (`skryty = true`, od 20260910150000) |

Skryté členství už dřív schovávalo tým, počty a chat. Díra byla ve vlastních
dílnách majitele – tam byl vidět všude, i když v iSwap Praha pracuje pod
druhým účtem („Aleki“, ten zůstává normálně viditelný). A v celém systému
se jeho **akce** (historie, komentáře, stopky, přidělení, odměny, statistiky)
ukazovaly pod jeho jménem.

## Pravidlo

* Majitele aplikace vidí jen on sám. Pro ostatní členy, zákazníky
  i server bez přihlášení (e-mailové reporty) neexistuje.
* Jeho akce jsou pro ostatní akce **„Systém“** – stejně jako import ze ZL
  nebo automatika (`changed_by = null`).
* V chatu podepisuje zprávy do kanálu servisu/pobočky **„Podpora Jobi“**.
  Proč ne skrýt i zprávy: když podpora odpoví v kanálu, kolegové na zprávu
  reagují – bez ní by konverzace neměla smysl, a „Systém“ by vypadal jako
  automat, kterému nemá cenu odpovídat. Jeho *přítomnost* (seznam lidí,
  soukromé zprávy, online, „píše“) skrytá je.
* Do obsazených míst a limitu tarifu se nepočítá **nikdy**, ani jemu samému.
* O neviditelnosti rozhoduje **id majitele**, ne příznak `skryty`.
  `skryty = true` znamená „členství přes podporu“ a podle něj
  `service-manage leave` dovolí členství odebrat – nastavit ho i na vlastní
  dílny by je šlo omylem opustit. Data členství se proto nemění.

Databáze: `public.je_root_owner_id(uuid)` (ano/ne, pro RLS, EXECUTE pro
authenticated) a `public.root_owner_skryty_id()` (id, které volající nesmí
vidět; null pro majitele samotného; **bez** EXECUTE pro klienta – vracela by
id). Klient: `src/lib/rootOwner.ts` (`skrytyRootOwner`, `autorProOstatni`,
`technikPrace`, `JMENO_SYSTEM`, `JMENO_PODPORA`).

## Co bylo opraveno

| Místo | Kde se majitel zobrazoval | Oprava |
| --- | --- | --- |
| `service_memberships` přes REST | správce/owner své dílny viděl jeho řádek (role owner) | restriktivní politika `service_memberships_skryte_jen_svoje`: cizí řádek jen `skryty = false` **a** není majitel aplikace |
| `profiles` přes REST | přezdívka a fotka (sdílený servis) | nová restriktivní politika `profiles_root_owner_skryty` (+ výš schované členství) |
| `clenove_servisu` (výběr technika, chat, odměny, konflikt úprav) | ve vlastních dílnách v seznamu | filtr `root_owner_skryty_id()`; sám sebe vidí |
| Nastavení → Tým a oprávnění (`team-list`) | server ho vracel (klient filtroval) | edge funkce filtruje i pro správce; DB politika navíc |
| `team-update-role`, `team-set-capabilities`, `team-remove-member` | správce mohl podle id z dat (historie) měnit roli/práva | majitel aplikace jako cíl → 404 „není členem“ |
| `service_seat_count`, trigger `members_enforce_quota` | zabíral místo v tarifu ve vlastních dílnách | nepočítá se nikdy |
| `services-list` (pohled majitele) | počet lidí v servisu ho započítal | nepočítá se |
| Onboarding „kolik nás tu je“ | majiteli se započítal sám | `.neq(user_id, root)` |
| `statistiky_technici` (+ e-mailový report `statistics-report-send`) | řádek s jeho jménem (přijal, dokončil, stopky, hodinová práce) | pro ostatní a pro server jde do „Bez technika (portál, automat)“, součty sedí; sám se vidí |
| `odmeny_prehled` (`lide`, `radky`, `mesice`, ruční odměny, výplaty, automatické schvalování) | jako příjemce odměny, autor/schvalovatel ruční odměny | příjemce → „Nepřiřazeno“, autor/schválil → „Systém“ (id null), z `jmena`, výplat a `autoSchvaleni` vypadne |
| Chat – seznam lidí (`chat_kanaly`) | DM kanál „Aleki“ | není v něm; sám majitel nemá DM kanály |
| Chat – soukromé zprávy | šlo mu napsat a on mohl psát | `chat_kanal_viditelny`: DM s majitelem neexistuje pro nikoho (politiky, `chat_smi_psat`, nepřečtené, hledání) |
| Chat – zprávy v kanálu, upozornění, připnuto | jméno přes `clenove_servisu` („Kolega“) | klient: „Podpora Jobi“ (`useChat.jmeno`) |
| Chat – zmínky @ | byl v nabídce | `clenove_servisu` + klientský filtr |
| Presence servisu (zelená tečka v Týmu, bubliny u zakázky) | online jako kolega | klient majitele kanál jen poslouchá, `track` nevolá; ostatní klienti jeho klíč zahodí (pojistka pro starší verze) |
| „Otevřeno / Upravuje“ v detailu (`useEditaceZakazky`) | jako kolega | totéž (bez `track`, filtr) |
| Konfliktní dialog úprav (`nactiAutoraZmen`) | „kolega“ | změna majitele = bez autora („Zákazník nebo automatika“) |
| Historie zakázky a reklamace | jeho přezdívka (profil) / „Kolega bez přezdívky“ | `changed_by` → null → „Systém“ |
| Přidělený technik (karta Technik, štítek na kartě, Dnes, historie) | „Bývalý člen“ / nic | `useClenoveServisu.jmeno` → „Systém“; v rozbalovacím seznamu „Systém“ |
| Komentáře k zakázce | přezdívka a fotka uložená v řádku | trigger `trg_ticket_comments_root_owner`: autor „Systém“ bez přezdívky a fotky; tři existující komentáře přepsány migrací (`author_id` zůstává); klient totéž pro starší data |
| Úseky práce / stopky (`CasNaOprave`) | „Kolega“ | „Systém“; do hodinové práce z naměřeného času se majitel jako technik nezapíše |
| Hodinová práce – předvyplněný technik | jeho přezdívka → šla na doklad zákazníkovi | majiteli se technik nepředvyplní |
| Hodinová práce – doklady (JobiDocs `documentData`), faktura z detailu, souhrnná faktura, karta opravy, export pro AI | „Práce technika (Aleki)“ | `technikPrace()`: u `technikUserId` majitele bez jména (v produkci 2 starší položky) |
| Smazané zakázky (Nastavení) | „smazal“ – kvůli chybě v přednosti operátorů se vždy ukázal začátek id (i jeho `f3b27eb3…`) | opravená podmínka, majitel = „Systém“ |
| Protokol GDPR anonymizace (`anonymizace_protokol`) | „ručně (Aleki)“ | „ručně (Systém)“ |
| GDPR export servisu (`service-manage export`) | jeho členství ve vlastních dílnách, profil, id v historii, komentář s přezdívkou, hodinová práce | členství a profil vypadnou, každá hodnota rovná jeho id → null, komentář „Systém“, hodinová práce bez jména |

## Co se ověřilo a není potřeba měnit

* **Zákaznický portál** (`portal-ticket`, `_shared/portalPayload.ts`): technika
  ani historii nevydává – z oprav jde jen název a cena.
* **JobiDocs**: proměnná `{{technik}}` ani „kdo přijal/vydal“ neexistuje;
  jediné jméno na dokladu je technik u hodinové práce (opraveno výš).
* **PIN přepínání účtů**: seznam účtů je jen v `localStorage` zařízení
  (`jobi_zaparkovane_ucty_v1`); server (`ma_pin`, `over_pin`) žádný seznam
  nevrací. Majitel se v přepínači objeví jen na zařízení, kde se sám
  přihlásil a účet zaparkoval.
* **Provize**: jen pro majitele aplikace; `provize_clenove` ho už vynechával.
* **`error_logs`**: členové nečtou (politika `error_logs_no_select`).
* **`customer_history.changed_by`**: aplikace autora nezobrazuje.
* **`statistiky_prehled`**: nemá údaje po lidech.
* **E-maily servisu** (faktury, rezervace, automatizace): jméno člověka
  neobsahují; komentář automatizace má autora „Automatizace“.
* **Kalendář, Dnes**: Dnes bere jména přes `clenove_servisu` (opraveno výš),
  kalendář jména lidí nemá.

## Co záměrně ne (a proč)

* **Majitel sám sebe vidí** – v týmu (jeho vlastní dílny), ve statistikách,
  v odměnách, svůj komentář pod svým jménem. Zadání je „pro ostatní“;
  bez toho by nešlo poznat, co svým účtem udělal.
* **Provozní a auditní pohledy pro majitele** (Owner panel, chybové logy,
  provize, platby servisů) – vidí je jen on, není před kým se skrývat.
* **Id v datech zůstává** (`ticket_history.changed_by`, `tickets.assigned_to`,
  `ticket_work_sessions.user_id`, `chat_messages.sender_id`,
  `ticket_comments.author_id`, `odmeny_rucni.vytvoril` …). Je to auditní
  stopa a mazat ji by znamenalo ztratit, kdo co udělal. Přes REST tak
  člen uvidí neznámé UUID, ale ne jméno, profil ani členství. Kdo zná
  UUID, může se funkcí `je_root_owner_id` zeptat „je tohle majitel?“
  (jen ano/ne) – politika RLS potřebuje funkci s EXECUTE pro přihlášené.
* **Text „technik“ ve starých položkách hodinové práce** zůstává v
  `performed_repairs` (2 položky v produkci); zobrazení a doklady ho podle
  `technikUserId` vynechávají. Přepsat JSON zakázek migrací by šlo proti
  optimistickému zamykání a frontě zápisů.
* **Staré soukromé zprávy s majitelem** (3 v produkci) zmizí oběma stranám –
  DM s majitelem pro nikoho neexistuje, ani pro něj.
* **Pozvánka na e-mail majitele** (`invite_create`): odpověď může prozradit,
  že účet existuje nebo je členem. Okrajové (správce by musel znát jeho
  e-mail), neřešeno.
* **Starší verze aplikace u majitele** se do presence dál hlásí – nové verze
  u kolegů ho zahodí, starší verze u kolegů ho ještě uvidí, dokud se
  neaktualizují.
* **`TeamSettings` u ne-majitelů schovává všechny s rolí owner** (dřívější
  obezlička „owner = majitel aplikace“). Teď je zbytečná, ale skrývá i
  skutečné majitele zákaznických servisů před jejich správci – změna chování
  pro zákazníky, nechávám na rozhodnutí.

## Nasazení

1. Migrace `supabase/migrations/20261009160000_root_owner_neviditelny.sql`
   (staging → sonda → produkce, viz docs/MIGRATIONS_SAFETY.md).
2. Edge funkce: `team-list`, `team-update-role`, `team-set-capabilities`,
   `team-remove-member`, `services-list`, `service-manage`.
3. Sondy 1600–1618 v `scripts/rls-probe.sql`.
4. Klient (nová verze aplikace) – presence, „Systém“/„Podpora Jobi“,
   doklady.

## Ověření

* `scripts/test-migrace-na-cisto.sh` – 187/187 migrací od nuly.
* Lokální SQL test (servis, kde je majitel owner s viditelným členstvím,
  historie, stopky, hodinová práce, komentář, chat): 35 kontrol – správce,
  technik, majitel sám, server bez přihlášení; migrace podruhé bez chyby.
* Neověřeno: sondy proti produkci, běžící aplikace (presence, chat, doklady).
