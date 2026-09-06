# Postavení databáze Jobi od nuly

Ostrá databáze Jobi nevznikla jedním čistým během migrací. Zakládala se
postupně a část zásahů se dělala rovnou v Supabase Studiu. Dokud se
nezkusí opak, nikdo neví, jestli by se z `supabase/migrations/` dala
databáze postavit znovu — a to je přesně to, co by po havárii nebo při
zakládání druhého prostředí bylo potřeba.

Tenhle dokument popisuje test, který to ověřuje, a rozdíly, které mezi
produkcí a „čistou“ databází zbývají.

Stav k 6. 9. 2026: **136 migrací ze 136 projde a databáze funguje.**

## Jak test spustit

```bash
npm run test:migrace
```

Skript `scripts/test-migrace-na-cisto.sh`:

1. Založí si vlastní jednorázový PostgreSQL cluster v dočasném adresáři.
   **Na ostrou databázi nesahá** a Docker nepotřebuje.
2. Spustí `supabase/bootstrap-test.sql` — kus prostředí, který kolem
   migrací provozuje Supabase a v repozitáři jinak nikde není (role
   `anon`/`authenticated`/`service_role`, schéma `auth` s `auth.uid()`,
   schéma `storage`, publikace `supabase_realtime`, extenze).
3. Pustí všechny migrace v pořadí podle názvu souboru a vypíše, kolik
   jich prošlo.
4. Udělá kouřovou zkoušku: založí servis, člena a zakázku a ověří, že
   funguje optimistické zamykání (`version`), trigger na `updated_at`,
   publikace `supabase_realtime` a že RLS pustí člena servisu a nepustí
   cizího uživatele.

### Předpoklady

PostgreSQL **server** (ne jen klient z libpq — `/opt/homebrew/bin/psql`
sám o sobě nestačí):

```bash
brew install postgresql@17
```

### Proměnné

| Proměnná | K čemu |
| --- | --- |
| `PGPORT_TEST` | port testovacího clusteru (výchozí 55432) |
| `PGBIN` | adresář s `initdb`/`pg_ctl`/`psql`, když ho skript nenajde sám |
| `KEEP_CLUSTER=1` | nechá cluster po doběhnutí běžet, ať se dá do databáze nakouknout |

Po běhu s `KEEP_CLUSTER=1` zůstane port obsazený a další spuštění by
skončilo nesrozumitelným „could not start server“. Skript to od teď pozná
a řekne to rovnou; cluster se zastaví přes `pg_ctl -D <datadir> stop`.

## Co test ověřil

Z prázdného Postgresu + bootstrapu + 136 migrací vznikne:

| | čistá DB | produkce |
| --- | --- | --- |
| tabulky | 60 | 60 |
| sloupce | 597 | 597 |
| RLS politiky | 194 | 194 |
| funkce | 85 | 85 |
| triggery | 49 | 51 |
| indexy | 218 | 218 |
| constrainty | 218 | 218 |
| tabulky v `supabase_realtime` | 23 | 23 |
| granty pro anon/authenticated/service_role | 166 | 166 |
| storage buckety a politiky | 2 / 8 | 2 / 8 |

Porovnání se dělalo čtecími dotazy proti ostré databázi
(`npx supabase db query --linked -f …` nad `pg_class`, `pg_policies`,
`pg_proc`, `pg_trigger`, `pg_indexes`, `pg_constraint`,
`pg_publication_tables`, `information_schema`) a stejnými dotazy nad
čistou databází. **Na produkci se nic nespouštělo.**

Ledger migrací na produkci (`supabase_migrations.schema_migrations`)
obsahuje 135 záznamů a odpovídá souborům v repozitáři. Jediná migrace,
která na produkci ještě neběžela, je `20260910000000_dorovnani_schematu_z_produkce.sql`.

## Migrace 20260910000000 — dorovnání schématu z produkce

Test odhalil, že z migrací nevznikne celý blok objektů kolem
`tickets` / `customers` / `service_statuses`. Nejde o kosmetiku: bez
sloupce `version` je aplikace rozbitá — `src/pages/Orders.tsx` ho čte
v explicitním `.select(...)`, takže výpis zakázek by skončil chybou
`column does not exist`, a `useOrderActions` / `useCustomerActions` na
něm staví optimistické zamykání.

Migrace `supabase/migrations/20260910000000_dorovnani_schematu_z_produkce.sql`
doplňuje:

- sloupce `tickets.version`, `customers.version` (`integer NOT NULL DEFAULT 1`),
- constrainty `tickets_version_gte_1`, `customers_version_gte_1`,
  `customers_phone_norm_not_empty`, `service_statuses_order_index_gte_0`,
- funkci `public.bump_version()` a triggery `bump_tickets_version`,
  `bump_customers_version`, `set_service_statuses_updated_at`,
- 10 indexů nad `tickets`, `customers` a `service_statuses`
  (mimo jiné unikátnost `ux_service_statuses_service_key`),
- `FORCE ROW LEVEL SECURITY` na `services`, `service_memberships`,
  `service_invites`, `customers`,
- tabulky `tickets` a `sms_conversations` do publikace `supabase_realtime`.

### Je bezpečná k pushnutí na produkci?

Ano. Všech 24 objektů z bodů 1–3 bylo na produkci **ověřeno čtecím
dotazem**: existují a definice sedí znak po znaku s tím, co migrace
zakládá (porovnáno přes `pg_get_constraintdef`, `pg_get_functiondef`,
`pg_get_triggerdef`, `pg_indexes.indexdef` a `information_schema.columns`).
`tickets` i `sms_conversations` už v publikaci `supabase_realtime` jsou.
Každý krok je podmíněný (`if not exists`, kontrola v `pg_constraint` /
`pg_trigger` / `pg_publication_tables`), takže se na produkci nic z toho
nespustí.

Push by na produkci reálně udělal jen dvě věci, obě bez dopadu na data
i chování:

1. `create or replace function public.bump_version()` přepíše funkci
   totožnou definicí (zneplatní se uložené plány),
2. `comment on function` doplní popis, který v katalogu zatím chybí.

Na čisté databázi migrace naopak dělá skoro všechnu práci — bez ní by
obnovená databáze byla proti ostré ochuzená o zamykání, indexy i FORCE RLS.

## Rozdíly, které zůstávají

Po dorovnání zbývají proti produkci tři rozdíly. Žádný nebrání provozu.

### 1. Dva triggery navíc na produkci (záměrně nekopírujeme)

Produkce má na `tickets` a `customers` triggery `set_tickets_updated_at`
a `set_customers_updated_at`, které z migrací nevznikají. Dělají ale
totéž co `tickets_set_updated_at` a `trg_customers_updated_at`, které
z migrací vznikají — na produkci tak `set_updated_at()` běží při každém
UPDATE dvakrát. Duplicitu do čisté databáze nepřenášíme.

Zbytečnou práci navíc by šlo z produkce odstranit (`drop trigger`), ale
to už není no-op a patří to do samostatné migrace.

### 2. `prevent_root_owner_change()` je na produkci `SECURITY DEFINER`

Migrace `20260223100000_allow_root_owner_delete_on_service_delete.sql`
funkci přepisuje přes `CREATE OR REPLACE` **bez** `SECURITY DEFINER`,
takže po ní má být `SECURITY INVOKER` — a taková v čisté databázi
opravdu je. Na produkci je ale `SECURITY DEFINER`; migrace v ledgeru je,
takže ji tam někdo přepnul zpět ručně ve Studiu až potom.

Chování je stejné: funkce jen čte `OLD`/`NEW` a `current_setting()`,
nic, na co by potřebovala cizí práva. Verze z migrací je z těch dvou
konzervativnější, proto se drift nedorovnává.

### 3. `service_invites.email` — jen jinak vypsaný typ

Produkce hlásí `citext`, čistá databáze `extensions.citext`. Je to týž
typ; produkční session má `extensions` v `search_path`, takže
`format_type` schéma vynechá. Extenze `citext` je v obou případech
ve schématu `extensions`.

## Co test nepokrývá

- **Extenze, které nejsou v prostém Postgresu.** `pg_cron`, `pg_net`
  a schéma `vault` v bootstrapu záměrně nejsou. Migrace, které je
  používají, jsou podmíněné a lokálně se korektně přeskočí — test tím
  zároveň ověřuje, že ta podmíněnost funguje. Naopak bootstrap zakládá
  `pg_trgm` a `btree_gist`, které produkce nemá; nevadí to, žádná
  migrace je nevyžaduje.
- **Naplánované úlohy.** Produkce má čtyři: `jobi-alerts` (`5 * * * *`),
  `jobi-automations` (`*/15 * * * *`), `jobi-uklid-api` (`20 3 * * *`)
  a `jobi-uklid-limitu` (`25 3 * * *`). Všechny čtyři zakládají migrace
  se stejným názvem, plánem i příkazem, takže na skutečném Supabase
  vzniknou samy — jen se to v tomhle testu neověří.
- **Data.** Test staví prázdné schéma, ne obsah.

## Nález mimo migrace: tři tabulky chybí v realtime i na produkci

Aplikace se přes `postgres_changes` přihlašuje k odběru tabulek
`customers` (`src/pages/Customers.tsx`), `device_repairs`
(`src/pages/Orders.tsx`) a `service_document_settings`
(`src/pages/Orders.tsx`), ale ani jedna z nich není v publikaci
`supabase_realtime` — **ani na produkci**. Odběr se tiše naváže a nikdy
nic nepřijde; seznam se aktualizuje až po ručním obnovení.

Není to regrese obnovy, je to existující chyba provozu. Oprava znamená
přidat je do publikace, což už není no-op, takže patří do samostatné
migrace.

## Co by bylo potřeba pro plnou obnovu ze zálohy

Schéma je jen část. Aby z obnovené databáze vzniklo funkční Jobi:

1. **Projekt Supabase** — role, `auth`, `storage`, `realtime`,
   `supabase_migrations`, extenze. Nový projekt to má rovnou; na
   holém Postgresu je nejbližší náhradou `supabase/bootstrap-test.sql`
   (ale bez skutečné autentizace a Storage API).
2. **Migrace** v pořadí podle názvu souboru, včetně
   `20260910000000_dorovnani_schematu_z_produkce.sql`.
3. **Data** — obnova dumpu do `public`, plus `auth.users` a
   `auth.identities`. Bez uživatelů nedávají FK v `service_memberships`
   smysl a nikdo se nepřihlásí.
4. **Soubory ve Storage** — obsah bucketů `diagnostic-photos`
   a `product-images`. Buckety i politiky nad nimi z migrací vzniknou,
   soubory ne.
5. **Tajemství** — Vault (`automations_cron_secret` zakládá migrace
   `20260904150000_automations.sql`, ale jen když `vault` existuje)
   a secrets edge funkcí (Resend, Twilio, Stripe, iDoklad, OTA).
6. **Edge funkce** — 46 funkcí v `supabase/functions/`, nasazují se
   zvlášť, migrace o nich nevědí.
7. **Naplánované úlohy** — vzniknou z migrací, pokud je v projektu
   `pg_cron`; jinak je potřeba naplánovat je ručně (migrace to v takovém
   případě oznámí `RAISE NOTICE`).

## Související

- `docs/MIGRATIONS_SAFETY.md` — pravidla pro psaní migrací
- `docs/ZALOHY_DATABAZE.md` a `docs/HLIDAC_PROVOZU.md` — zálohování a hlídání provozu
- `scripts/rls-probe.sql` — sonda na oprávnění po změně politik
