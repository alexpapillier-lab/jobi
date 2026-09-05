# Audit rolí a oprávnění — 2026-09-02

Prověřeno proti **nasazené databázi**, ne proti migracím: `pg_policies`,
`information_schema.column_privileges`, definice funkcí a všech 27 edge funkcí.

Model: role `owner` / `admin` / `member` v `service_memberships`, k tomu
`capabilities` (jsonb) pro členy a zvláštní **root owner** nad všemi servisy.

---

## Co je v pořádku

- **RLS je zapnuté na všech 37 tabulkách.** `capture_tokens` a `draft_capture_photos`
  nemají žádnou politiku záměrně — sahá na ně jen `service_role`.
- **Role nejde měnit přímo z klienta.** `service_memberships` nemá politiku pro
  INSERT ani UPDATE, takže změna role musí projít edge funkcí. Jediná DELETE
  politika platí pro `service_role`.
- **`has_capability()` selhává do zavřeno** — nečlen `false`, chybějící klíč `false`,
  owner/admin implicitně `true`.
- **Root owner se vyhodnocuje na serveru.** Edge funkce čtou `ROOT_OWNER_ID`
  z prostředí Denu; klientské `VITE_ROOT_OWNER_ID` jen kreslí UI. To je správně:
  i kdyby si někdo bundl přepsal, žádné právo tím nezíská.
- **`team-update-role`** hlídá roli volajícího, jen owner smí povýšit na ownera
  a poslední owner nejde degradovat.
- **`team-remove-member`** ownera odebrat nedovolí vůbec.
- **`public-catalog`** (nový) vypisuje sloupce jmenovitě, kontroluje nároky servisu,
  filtruje `public_visible`, nevydává `costs` a nejde jím zjišťovat existující slugy.

---

## Nálezy

### 1. Část schopností šla obejít

> **Oprava vlastního nálezu.** Původně jsem sem napsal, že vynucené jsou jen
> čtyři schopnosti z dvanácti. Byla to chyba mého skenu: hledal jsem
> `has_capability\([^)]*'jméno'`, jenže `[^)]*` se zarazí o závorku vnořeného
> `auth.uid()`, takže mi propadly dva triggery na `tickets` a kontroly uvnitř
> RPC funkcí. Skutečný stav byl podstatně lepší, než jsem tvrdil.

Vynucené byly: `can_manage_tickets_basic` a `can_change_ticket_status`
(triggery na `tickets`), `can_edit_service_settings` a `can_manage_documents`
(RPC `update_service_settings`), `can_manage_customers`, `can_edit_devices`,
`can_edit_inventory` (RLS).

Skutečné mezery byly čtyři:

| schopnost | stav | proč to vadilo |
|---|---|---|
| `can_delete_tickets` | jen v RPC `soft_delete_ticket` | `authenticated` má UPDATE na všech 42 sloupcích `tickets` a starý trigger `deleted_at` nekontroloval, takže stačil přímý PATCH na `/rest/v1/tickets` |
| `can_manage_ticket_archive` | jen v RPC `restore_ticket` | totéž |
| `can_manage_statuses` | nikde | RLS pouštělo jen owner/admin, přepínač členovi nikdy nic nedal |
| `can_adjust_inventory_quantity` | nikde | `inventory_products` hlídalo jen `can_edit_inventory` |

`can_print_export` serverově vynutit nejde — kdo data vidí, může si je opsat.
Zůstává tedy jako kosmetika v UI, což je v pořádku.

### 2. Admin může degradovat ownera — a tím obejít zákaz jeho odebrání

`team-update-role` brání jen degradaci **posledního** ownera. Při dvou ownerech
může admin jednoho z nich degradovat na člena a pak ho `team-remove-member`
odebrat. Jedním krokem je to zakázané, dvěma projde.

Chybí kontrola, že cíl s rolí `owner` smí měnit jen owner nebo root owner.

### 3. Kterýkoli člen si může vyrobit API token

`api_tokens_write_members` je `ALL` pro každého člena servisu. Token se ukládá
hashovaný (správně), jenže člen může řádek **vložit** — tedy zapsat hash tokenu,
který si sám zvolí, s libovolnými `scopes`. Fakticky si tak vydá přístupové údaje
k veřejnému API. Zároveň může cizí tokeny mazat nebo revokovat.

### 4. Člen může přenastavit DPH a veřejný slug

`services_update_vat_members` je permisivní UPDATE pro každého člena. Permisivní
politiky se spojují přes OR, takže tahle přebíjí `services_update_by_admin`.

Rozsah škody omezují **sloupcové granty** — `authenticated` má UPDATE jen na
`vat_payer`, `default_vat_rate`, `prices_include_vat`, `public_slug` a
`inventory_availability_mode`; `name` ani `active` mezi nimi nejsou. To je dobře
ošetřené. Přesto: nastavení DPH ovlivňuje fakturaci celého servisu a změna
`public_slug` přesune adresu veřejného ceníku.

### 5. Dvě protichůdné UPDATE politiky na `tickets`

- `tickets_update_by_membership` — členství **a** `deleted_at IS NULL`
- `Service members can update tickets` — jen členství

Obě jsou permisivní, takže volnější vyhrává a podmínka `deleted_at IS NULL`
je bez účinku. Ochrana měkce smazaných zakázek tím padá.

### 6. `profiles` čte kdokoli přihlášený

`profiles_select_authenticated` má `USING (true)`. Tabulka obsahuje jen `nickname`
a `avatar_url`, žádné e-maily, takže o vážný únik nejde — ale uživatel jednoho
servisu vidí přezdívky uživatelů všech ostatních. Patřilo by to omezit na lidi,
se kterými sdílí servis.

### 7. `anon` má sloupcové granty na `services` včetně `name` a `active`

Momentálně neškodné — žádná politika pro `anon` na `services` neexistuje, takže
RLS to zastaví. Je to ale nastražená past: první permisivní politika pro `anon`
by rovnou otevřela i přejmenování a deaktivaci servisu.

---

## Pořadí oprav

1. **#2** (admin nad ownerem) — čistá autorizační díra, oprava je jedna podmínka.
2. **#3** (API tokeny) — omezit zápis na owner/admin.
3. **#5** (protichůdné politiky) — smazat tu volnější.
4. **#4** (DPH a slug) — rozhodnout, zda to má člen smět; případně přes edge funkci.
5. **#1** (schopnosti) — buď je vynutit v RLS, nebo z UI odstranit ty, které nic
   nedělají. Současný stav slibuje ochranu, kterou neposkytuje.
6. **#6**, **#7** — kosmetika a prevence.

Body 3 a 4 pocházejí z práce na veřejném API z večera 2026-09-02.

---

## Co bylo opraveno (2026-09-02)

Migrace `20260902260000_role_audit_fixes.sql` a `20260902270000_narrow_ticket_capability_trigger.sql`,
edge funkce `team-update-role`.

| nález | oprava |
|---|---|
| #1 archivace | trigger `enforce_ticket_capabilities` na `deleted_at` |
| #1 statusy | RLS na `service_statuses` přes `has_capability('can_manage_statuses')` |
| #1 množství | trigger `enforce_inventory_capabilities` na `stock` |
| #2 | `team-update-role`: nad ownerem smí konat jen owner nebo root owner |
| #3 | zápis do `api_tokens` jen owner/admin |
| #4 | zrušena `services_update_vat_members` |
| #5 | zrušena volnější z dvojice UPDATE politik na `tickets` |
| #6 | `profiles` omezené na sebe a na sdílený servis |
| #7 | odebrány granty `anon` na `services`, `tickets`, `api_tokens` |

Ověřeno přepnutím do role `authenticated` s nastavenými JWT nároky — tedy
stejnou cestou, kterou jde PostgREST — v transakci, která se pak zahodila:

| | archivovat | obnovit z archivu | množství | API token | cizí profil |
|---|---|---|---|---|---|
| člen bez oprávnění | ✗ | ✗ | ✗ | ✗ | ✗ |
| člen s `can_delete_tickets` | ✓ (RPC) | ✗ | ✗ | ✗ | ✗ |
| člen s `can_manage_ticket_archive` | ✓ (RPC) | ✓ (RPC) | ✗ | ✗ | ✗ |
| admin | ✓ | ✓ | ✓ | ✓ | ✗ |
| owner | ✓ | ✓ | ✓ | ✓ | ✗ |

Přímý `UPDATE` na `tickets.deleted_at` je nově zavřený pro všechny včetně
ownera; archivace a obnovení musí projít RPC funkcemi, které schopnosti
kontrolují. Aplikace tudy chodí už dnes (`Orders.tsx`, `DeletedTicketsSettings.tsx`),
takže se nic nerozbilo.

Nezměněno zůstává `services_insert_any_authenticated` — zakládání servisu
je otevřené každému přihlášenému záměrně, kvůli registraci.


## Druhé kolo (5. 9. 2026 večer) – správce, člen bez práv, cizí servis, anon

Probe skript rozšířený na 120 dotazů (`scripts/rls-probe.sql`), spouští se
`NODE_OPTIONS=--dns-result-order=ipv4first npx supabase db query --linked "$(grep -v '^\s*--' scripts/rls-probe.sql)"`
(řádky s komentáři musí pryč, jinak si je CLI vyloží jako přepínače).

**Oddělení servisů v tabulkách drží** včetně nových: `branches`, `service_billing`,
`service_integrations`, `tickets.quote_items`. Díry byly ve funkcích a v triggeru
(opraveno migrací `20260907130000_audit2_opravneni.sql`, nasazeno a ověřeno):

1. **`delete_service_for_root()` šlo zavolat s anon klíčem** přes REST a smazat
   libovolný servis se všemi daty. Nejvážnější nález celého auditu. Funkce teď
   pustí jen `service_role` (edge funkce service-manage, která ověřuje root
   ownera); přihlášený uživatel i anon dostanou 42501. Ověřeno oběma cestami.
2. `get_auth_user_id_by_email()` a `invited_email_has_any_membership()` – z anon
   role šlo zjišťovat, které e-maily mají účet. Jen pro service_role.
3. `next_invoice_number()` – kdokoli mohl posunout číselnou řadu faktur cizího
   servisu (díry v číslování dokladů). Teď vyžaduje členství.
4. Provozní funkce (úklidy, `default_branch_id`, `branches_allowed`) měly
   EXECUTE pro PUBLIC. Odebráno.
5. Trigger `enforce_ticket_basic_update_permissions` hlídal pevný seznam
   sloupců: člen bez práva „Úpravy zakázek" mohl přepsat cenovou nabídku včetně
   stavu schválení, pobočku, termín, portálový token i podpis převzetí; a při
   změně stavu se kontrola přeskočila úplně. Teď se hlídá všechno kromě
   výslovných výjimek (stav, completed_at, archivace, systémové sloupce);
   podpis a rozhodnutí o nabídce smí psát jen portál (service_role), portálový
   token jen `ensure_portal_token`.
6. `anon` měl plné tabulkové granty na nové tabulky. Odebráno.

Po opravě: 120 probe, 0 neshod s očekáváním. Celá E2E sada (14 testů) prochází,
klient žádný chráněný sloupec nepíše přímo.

**Zbývá:** revize toho, co veřejné funkce `portal-ticket` a `capture-*` vracejí
zákazníkovi bez přihlášení (telefon, e-mail, IMEI, heslo k zařízení, interní
poznámky, nákupní ceny tam být nesmí) – kód to podle hlavičky funkce filtruje,
ale nikdo to po posledních změnách (quote_items) znovu neprošel.
