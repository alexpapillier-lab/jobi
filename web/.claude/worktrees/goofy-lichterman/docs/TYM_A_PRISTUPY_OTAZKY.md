# Tým a přístupy – pochopení a otevřené otázky

Cíl: mít 100% jasno v tom, jak má fungovat Tým a přístupy pro tebe (owner) a pro ostatní servisy (jejich admini a členové). Níže je shrnutí toho, co z kódu a DB vyplývá, a seznam otázek k doplnění.

---

## 1. Co z kódu a DB vyplývá (shrnutí)

### Model

- **Servisy (services)** – každý servis = jeden „tenant“ (jedna firma/servis v aplikaci).
- **Členství** – tabulka `service_memberships`: `service_id`, `user_id`, `role`, `capabilities` (JSONB).
- **Role:** `owner` | `admin` | `member`.
  - **owner** – jeden per servis (v DB je trigger `prevent_last_owner_removal` = nelze odebrat posledního ownera ani mu změnit roli).
  - **admin** – může přidávat/odebírat členy, měnit role (admin ↔ member), v některých migracích může měnit capabilities jen u **memberů** (ne u jiných adminů).
  - **member** – běžný člen; co smí, určují **capabilities** (zaškrtávací oprávnění).
- **Pozvánky** – `service_invites`: pozvat lze s rolí `owner` | `admin` | `member` (v praxi asi jen admin/member).

### Capabilities (povolení pro role „member“)

V DB jsou tyto klíče (whitelist v `set_member_capabilities` a komentářích):

- `can_manage_tickets_basic`
- `can_change_ticket_status`
- `can_manage_ticket_archive`
- `can_manage_customers`
- `can_manage_statuses`
- `can_manage_documents`
- `can_edit_devices`
- `can_edit_inventory`
- `can_edit_service_settings`

Owner a admin mají v logice **všechna** oprávnění implicitně (neukládají se do `capabilities`). U membera se kontroluje `has_capability()` / `has_any_capability()`.

### Co aplikace dnes dělá

- **services-list** – vrací seznam servisů (pravděpodobně ty, kde je uživatel členem); v repu není zdroják, jen volání z frontendu.
- **Tým a přístupy (TeamSettings)** – zobrazuje se pro **jeden vybraný servis** (`activeServiceId`). Zobrazí členy + čekající pozvánky, tlačítka: Pozvat člena, Změnit roli (admin ↔ member), Odebrat.
- **Změna rolí** – pouze mezi admin a member (owner v UI není rozlišen: zobrazí se jako „Člen“ a tlačítko „Změnit roli“ by ho přepnulo na admin).
- **Capabilities** – v UI zatím **nejsou**: stav „Povolení“ pro membera (zaškrtávátka typu „může mazat zakázky“, …) je připraven jen v DB a v hooku `useActiveRole` (např. `can_manage_ticket_archive` → `canManageTickets`). Dialog pro ukládání capabilities je v kódu zakomentovaný/rezervovaný.
- **Mazání zakázek** – RPC `soft_delete_ticket` kontroluje jen „owner nebo admin“, ne capability u membera (takže member dnes nemůže mazat zakázky ani kdyby měl nějakou capability).

### „Root owner“

- V migraci je trigger `prevent_root_owner_change` s **hardcoded** `user_id` (UUID).
- Ten uživatel nemůže být ze servisu odebrán ani mu změněna role z owner.
- Předpoklad: jde o tebe jako „hlavního“ ownera platformy / prvního ownera.

---

## 2. Jak to má fungovat (tvůj popis – zkráceno)

- **Ty (owner)** – hezký interface, kde vidíš **všechny existující servisy a jejich členy**.
- **Ostatní servisy** – každý má své hlavní adminy/admina; ti si přidávají členy, mění role (admin/člen) a **každému členovi mění povolení** (např. může mazat zakázky, atd. – „všechny tyhle funkce“).

Abych to mohl dotáhnout na 100 %, potřebuji upřesnit níže.

---

## 3. Otázky k doplnění

### A) Rozhraní pro tebe (owner) – „všechny servisy“

1. **Vidění všech servisů**  
   Máš jako (root) owner vidět **všechny** servisy v systému (všechny z tabulky `services`), nebo jen ty, kde jsi ty sám v `service_memberships` (tj. kde jsi členem)?  
   – Dnes `services-list` vrací zřejmě jen servisy, kde je uživatel člen; pokud máš vidět úplně všechny, bude potřeba nový endpoint nebo rozšíření (např. „pro root ownera vrať všechny servisy“). Vsechny servisy a owner by idealne nemel byt videt jako member v servisu, ve kterem neni, ale jakoby tam je clenem vsech servisu a ma knim pristup. 

2. **Úroveň zobrazení**  
   Stačí jeden „přehled“: seznam servisů → u každého servisu seznam členů (jméno, email, role, popř. povolení)?  
   Nebo máš mít u každého servisu i akce: přidat člena, změnit roli, odebrat, měnit povolení (jako admin u „cizího“ servisu)? ano, chci i veskere akce. a k tomu jeste spravovani servisu samotnych - mazani, generovani novych servisu. treba te napadnou jeste nejake funkce. a musim mit moznost zalozit novy servis a pozvat na nej pozvanku adminovi nebo i memberovi, kteri pod ten servis budou patrit

3. **Vytváření servisů**  
   Má být v tomto rozhraní i možnost **vytvořit nový servis** (a ty být jeho owner), nebo se servisy zakládají jinak (např. přes pozvánku „vytvoř servis“)? viz predchozi odpoved.

### B) Ostatní servisy – admini a členové

4. **Kdo je „hlavní admin“ servisu**  
   Je to vždy jeden konkrétní uživatel (např. ten, kdo servis založil = owner), nebo může být v jednom servisu víc adminů a všichni mají stejná práva (přidávat členy, měnit role, měnit povolení)? muze byt vic adminu.

5. **Změna role**  
   Má admin smět měnit **pouze** member ↔ admin, nebo i např. předat roli owner jinému členovi („převod servisu“)?  
   – V DB je jeden owner a trigger brání odebrání posledního ownera; převod ownera by znamenal speciální flow (např. „já přestanu být owner, ty budeš owner“).
owner vzdy bude jen jeden a to budu ja. vsechno ostatni budou jen admin nebo member
### C) Povolení (capabilities)

6. **Přesná mapování**  
   Potřebuji potvrdit, které **akce v aplikaci** odpovídají kterému **capability klíči** (aby UI i RPC byly konzistentní). Konkrétně:
   - **Mazat zakázky** – má to být `can_manage_ticket_archive`, nebo má být zavedený nový klíč např. `can_delete_tickets`? novy klic
   - **Změna statusu zakázky** – stačí `can_change_ticket_status`? ano
   - **Úpravy zakázky** (text, ceny, atd.) – `can_manage_tickets_basic`? ano
   - **Záruční list / diagnostika / tisk** – patří pod `can_manage_documents`, nebo má být rozdělené? tohle by melo asi byt, zda ma pravo menit veci v jobidocs. 
   - Ostatní klíče (`can_manage_customers`, `can_manage_statuses`, `can_edit_devices`, `can_edit_inventory`, `can_edit_service_settings`) – máš představu, která obrazovka/akce přesně pod které spadá? (Stačí stručný seznam typu: „can_edit_devices = obrazovka Zařízení“, atd.) can_manage_customers - menit informace o existujicich zakaznicich, can_manage_statuses - modifikovat/mazat/pridavat statusy zakazek v nastaveni, can_edit_devices - menit veci na strance zarizeni, can_edit_inventory- menit veci na strance sklad, pridal bych jeste jednu - pridavat a odebirat kusy produktu na sklade. to by ale nemelo zasahovat do toho, ze kdyz se prida do zakazky oprava, ktera obsahuje produkt, tak se i tak odstrani ten kus ze skladu. can_edit_service_settings - menit nastaveni servisu. zaroven member by nemel mit pristup k jakemukoliv meneni pozic / capabilities v tym/pristupy

7. **Kdo smí měnit capabilities**  
   V jedné migraci smí capabilities měnit jen **owner**, v jiné (remote_schema) **owner i admin** (admin jen pro membery). Co je záměr: jen owner, nebo owner + admin (admin jen u memberů)? capabilities muze clenum servisu menit admin/admini toho servisu a owner

8. **Výchozí hodnoty pro nového membera**  
   Když admin pozve někoho jako „člen“, mají být všechny capabilities **vypnuté** (zaškrtávátka prázdná) a admin je zapne podle potřeby, nebo má být nějaká výchozí sada zapnutá (např. základní úpravy zakázek)? asi bych dal vsechno z tech capabilities zapnute, admin to pak muze povypinat.

### D) UI a chování

9. **Zobrazení role „owner“**  
   Dnes se v Tým a přístupy u řádku člena zobrazuje jen „Administrátor“ nebo „Člen“ (owner se zobrazí jako „Člen“). Má se u ownera zobrazovat výslovně např. „Vlastník“ a nemít u něj tlačítka „Změnit roli“ / „Odebrat“ (nebo je skrýt aspoň pro aktuálně přihlášeného ownera)? ano

10. **Jedno místo vs. přepínač servisů**  
    Pro tebe (přehled všech servisů) – má to být jedna stránka „Tým a přístupy“ s výběrem servisu (dropdown / seznam vlevo) a vpravo členové toho servisu + pozvánky + povolení?  
    Pro běžného admina – zůstane současné chování (jeden vybraný servis v sidebaru a Tým a přístupy jen pro ten servis)? pro admina presne tak, pro ownera to udelej nejak fakt hezky a intuitivne

### E) Technické / edge cases

11. **Root owner a „všechny servisy“**  
    Má root owner (tvůj hardcoded user_id) mít v `services-list` (nebo v novém endpointu) vráceny **všechny** servisy v DB, i když v nich není v `service_memberships`? (To by vyžadovalo v backendu rozlišení „root owner“ a speciální logiku.) ano, je to vysvetleno vyse

12. **Pozvánka s rolí owner**  
    Dává smysl pozvat někoho přímo jako **owner** (např. při zakládání nového servisu), nebo se nový servis zakládá vždy bez pozvánky a owner se přiřadí jinak? ne, jako admina, taky uz napsane vyse

---

---

## 4. Shrnutí odpovědí (pro implementaci)

- **Root owner** = jen ty; nikde v aplikaci se root owner **nezobrazuje v žádném seznamu týmu** žádného servisu (ani v API pro členy/adminy toho servisu). Technicky: root není v `service_memberships` u „cizích“ servisů, nebo se v `team-list` / UI vždy filtruje ven.
- **Root owner** vidí všechny servisy a má k nim přístup; může: přehled všech servisů + u každého plné akce (členové, pozvánky, role, capabilities), dále **správa servisů** – vytvořit nový servis (včetně **nastavení názvu** při vytvoření), smazat/deaktivovat servis, pozvat na nový servis admina/membera.
- **Název servisu:** při vytváření nového servisu ho nastaví root owner. Admin toho servisu ho může později měnit v nastavení servisu (např. Nastavení → Servis / Obecné).
- **Více adminů** v jednom servisu, všichni stejná práva (pozvat, měnit role, měnit capabilities).
- **Owner v DB** jen jeden globálně = ty (root). Ostatní servisy: jen role admin a member. *(Viz doplňující otázka D1.)*
- **Capabilities:** nový klíč pro mazání zakázek; záruční/diagnostika/tisk = právo měnit věci v JobiDocs; přidat capability pro „přidávat/odebírat kusy na skladě“ (bez vlivu na odpočet při přidání opravy do zakázky). Member nemá přístup k Tým a přístupy (žádné měnění lidí/rol/capabilities).
- **Měnit capabilities** smí admin(i) servisu a root owner. Výchozí u nového membera: všechny capabilities zapnuté, admin může vypínat.
- **UI:** owner = zobrazit „Vlastník“, skrýt Změnit roli / Odebrat. Pro root ownera hezké intuitivní rozhraní (všechny servisy + členové + akce), pro admina stávající chování (jeden servis v sidebaru).

---

## 5. Doplňující otázky (aby bylo 100 % jasno)

**D1. Owner v DB u „cizích“ servisů**  
Odpověď: (1) Root owner *může* být v `service_memberships`, stačí ho neukazovat členům a adminům toho servisu v UI. (2) Varianta **B** – servis nemá v DB ownera, jen adminy (úprava DB/triggeru).

**Implementace:** Upravit trigger tak, aby servis mohl mít jen adminy a membery (např. trigger blokuje jen „odebrat posledního ownera“, pokud nějaký je; pokud servis nemá žádného ownera, nevadí). Při založení nového servisu root do něj nepřidáš (nebo ho přidáš jako owner a v UI skryješ – podle toho, jestli chceš mít root v tabulce). První pozvaný = role **admin**.

**D2. Název capability pro mazání zakázek**  
Má se nový klíč jmenovat `can_delete_tickets` (mazat zakázky / soft delete), nebo chceš jeden klíč i pro „spravovat archiv“ (smazat + obnovit), např. `can_manage_ticket_archive`? (Teď jsi chtěl nový klíč – beru `can_delete_tickets`, pokud nechceš jinak.) muzeme oboje, can_delete_tickets a can_manage_ticket_archive

**D3. Sklad – úpravy množství**  
Má být „přidat/odebrat kusy produktu na skladě“ samostatná capability (např. `can_adjust_inventory_quantity`), nebo to má patřit pod stávající `can_edit_inventory` (kdo může editovat sklad, může i měnit množství)? taky dáme oboje

**D4. JobiDocs – jeden nebo víc klíčů**  
Stačí jedna capability typu „může měnit věci v JobiDocs“ (šablony, nastavení dokumentů, firma…), nebo to rozdělit (např. šablony vs. údaje firmy vs. tisk/export)? ano, sablony, nastaveni dokumentu, firma. tisk export by mel mit i owner zapnuty.

**D5. Mazání servisu**  
Odpověď: **deaktivace** (servis neaktivní, nelze se přihlásit) + možnost **hard delete** (smazat z DB).

---

## 6. Závěr – další dotazy nemám

Shrnutí pro implementaci:

- **D1:** Owner jen ty (root); root se **nikde neukazuje** v seznamu týmu žádného servisu. Servisy bez ownera v DB (jen admin/member). Root u cizích servisů není v `service_memberships`, nebo se v API/UI vždy vyfiltruje. První pozvaný do nového servisu = **admin**. Název servisu: root nastaví při vytvoření; admin ho může měnit v nastavení servisu.
- **D2:** Dva klíče: `can_delete_tickets` a `can_manage_ticket_archive`.
- **D3:** Dvě capabilities: `can_edit_inventory` + `can_adjust_inventory_quantity`.
- **D4:** JobiDocs rozdělit: šablony, nastavení dokumentů, firma. Tisk/export může mít vlastní capability (owner/member ji může mít zapnutou).
- **D5:** Deaktivace servisu + hard delete.

Mám z toho vše potřebné; další dotazy nemám. Až budeš chtít, můžeš napsat „jdi na to“ a začnu podle tohoto specifikovat úkoly (backend + frontend).
