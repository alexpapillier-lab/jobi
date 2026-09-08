#!/usr/bin/env bash
# =====================================================================
# test-migrace-na-cisto.sh — postaví databázi Jobi od nuly
# =====================================================================
#
# K ČEMU TO JE
# ------------
# Ostrá databáze Jobi vznikala postupně a část historie se do migrací
# dostala až zpětně. Tenhle skript ověří, že se všechny migrace v
# supabase/migrations/ dají spustit v pořadí na PRÁZDNÉM Postgresu —
# tedy že by šlo Jobi obnovit ze zálohy nebo založit druhé prostředí.
#
# NESAHÁ NA OSTROU DATABÁZI. Spouští si vlastní lokální cluster
# v dočasném adresáři a na konci ho zastaví a smaže.
#
# POUŽITÍ
#   npm run test:migrace
#   nebo přímo: bash scripts/test-migrace-na-cisto.sh
#
# PŘEDPOKLADY
#   Lokální PostgreSQL server (ne jen klient libpq!). Homebrew:
#     brew install postgresql@17
#   Docker není potřeba.
#
# PROMĚNNÉ
#   PGPORT_TEST   port pro testovací cluster (výchozí 55432)
#   PGBIN         adresář s initdb/pg_ctl/psql (jinak se hledá)
#   KEEP_CLUSTER  =1 nechá cluster běžet, ať se dá do DB nakouknout
# =====================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
BOOTSTRAP="$REPO_ROOT/supabase/bootstrap-test.sql"
PORT="${PGPORT_TEST:-55432}"
DB="jobi_test"

# macOS: bez LC_ALL=C se postmaster na startu „stane multithreaded“ a spadne.
export LC_ALL=C

# --- najdi serverové binárky (libpq v /opt/homebrew/bin server NEMÁ) -----
if [ -z "${PGBIN:-}" ]; then
  for cand in /opt/homebrew/opt/postgresql@17/bin \
              /opt/homebrew/opt/postgresql@16/bin \
              /opt/homebrew/opt/postgresql@15/bin \
              /usr/local/opt/postgresql@17/bin \
              /usr/lib/postgresql/17/bin \
              /usr/lib/postgresql/16/bin; do
    if [ -x "$cand/postgres" ]; then PGBIN="$cand"; break; fi
  done
fi
if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/postgres" ]; then
  echo "CHYBA: nenašel jsem PostgreSQL SERVER (binárku 'postgres')." >&2
  echo "       /opt/homebrew/bin obsahuje jen klienta z libpq." >&2
  echo "       Nainstaluj: brew install postgresql@17" >&2
  exit 1
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/jobi-migrace-XXXXXX")"
DATADIR="$WORKDIR/data"
LOGFILE="$WORKDIR/postgres.log"
REPORT="$WORKDIR/report.txt"

cleanup() {
  if [ "${KEEP_CLUSTER:-0}" = "1" ]; then
    echo ""
    echo "Cluster běží dál (KEEP_CLUSTER=1):"
    echo "  $PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -d $DB"
    echo "  zastavit: $PGBIN/pg_ctl -D $DATADIR stop"
    return
  fi
  "$PGBIN/pg_ctl" -D "$DATADIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# Obsazený port je nejčastější důvod, proč skript spadne hned na startu:
# po běhu s KEEP_CLUSTER=1 zůstane starý cluster naslouchat a pg_ctl pak
# hlásí jen „could not start server“ bez příčiny.
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "CHYBA: na portu $PORT už něco poslouchá – nejspíš cluster z běhu" >&2
  echo "       s KEEP_CLUSTER=1. Zastav ho (pg_ctl -D <datadir> stop)," >&2
  echo "       nebo zvol jiný port: PGPORT_TEST=55444 npm run test:migrace" >&2
  exit 1
fi

echo "=== Testovací cluster: $WORKDIR (port $PORT) ==="
# stderr do koše: initdb hlásí „trust authentication“, což je u zahozitelného
# clusteru na 127.0.0.1 v pořádku.
"$PGBIN/initdb" -D "$DATADIR" -U postgres --encoding=UTF8 --locale=C >/dev/null 2>&1
# wal_level=logical: bez něj Postgres u publikace supabase_realtime hlásí
# varování. -k /tmp: cesta k socketu má limit 103 znaků.
"$PGBIN/pg_ctl" -D "$DATADIR" \
  -o "-p $PORT -h 127.0.0.1 -k /tmp -c wal_level=logical" \
  -l "$LOGFILE" -w start >/dev/null
"$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -q -c "create database $DB;"

PSQL="$PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -v ON_ERROR_STOP=1 -X -q"

echo "=== Bootstrap prostředí Supabase ==="
$PSQL -f "$BOOTSTRAP"

echo "=== Migrace ==="
OK=0
FAIL=0
: > "$REPORT"
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  name="$(basename "$f")"
  if err="$($PSQL -f "$f" 2>&1 >/dev/null)"; then
    OK=$((OK + 1))
    printf 'OK    %s\n' "$name" >> "$REPORT"
  else
    FAIL=$((FAIL + 1))
    printf 'CHYBA %s\n%s\n\n' "$name" "$err" >> "$REPORT"
    echo "CHYBA $name"
    echo "$err" | sed 's/^/      /'
    # Dál se nepokračuje: následující migrace by běžely nad rozbitým schématem
    # a jejich „OK" by nic neznamenalo – nebo by spadly lavinou chyb, ve které
    # se ta první ztratí. Opravuje se vždycky ta první.
    echo ""
    echo "Zastaveno u první selhané migrace – další by běžely nad rozbitým schématem."
    break
  fi
done

echo ""
echo "=== Výsledek: $OK prošlo, $FAIL selhalo (ze $((OK + FAIL))) ==="

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Podrobnosti: $REPORT"
  exit 1
fi

echo ""
echo "=== Vzniklé schéma ==="
$PSQL -c "
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE') as tabulky,
  (select count(*) from pg_policies where schemaname='public') as politiky,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public') as funkce,
  (select count(*) from pg_trigger t join pg_class r on r.oid=t.tgrelid
     join pg_namespace n on n.oid=r.relnamespace
     where n.nspname='public' and not t.tgisinternal) as triggery;"

# --- Kouřová zkouška ---------------------------------------------------
# Že migrace projdou, ještě neznamená, že databáze funguje. Tohle ověří
# to, co Jobi opravdu potřebuje: RLS pouští jen členy servisu, verze
# zakázky se zvedá (optimistické zamykání) a updated_at se aktualizuje.
echo ""
echo "=== Kouřová zkouška ==="
$PSQL <<'SMOKE'
-- Od migrace 20260910150000 přidává trigger na services skrytého root
-- ownera (public.root_owner_id()) mezi členy. V ostrém Supabase ten účet
-- existuje; tady ho musí založit zkouška, jinak insert servisu spadne na FK.
insert into auth.users (id, email)
  select public.root_owner_id(), 'root@test.cz';
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','sef@test.cz'),
  ('22222222-2222-2222-2222-222222222222','cizi@test.cz');

insert into public.services (id, name)
  values ('33333333-3333-3333-3333-333333333333','Testovací servis');
insert into public.service_memberships (service_id, user_id, role)
  values ('33333333-3333-3333-3333-333333333333',
          '11111111-1111-1111-1111-111111111111','owner');
insert into public.service_statuses (service_id, key, label, order_index)
  values ('33333333-3333-3333-3333-333333333333','new','Nová',0);
insert into public.tickets (id, service_id, title, status)
  values ('44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333','Nefunkční displej','new');

do $$
declare v_version integer; v_pocet integer; v_updated boolean;
begin
  select version into v_version from public.tickets
    where id = '44444444-4444-4444-4444-444444444444';
  if v_version <> 1 then
    raise exception 'Nová zakázka má version=%, čekalo se 1', v_version;
  end if;

  update public.tickets set title = 'Nefunkční displej v2'
    where id = '44444444-4444-4444-4444-444444444444';

  select version, updated_at > created_at into v_version, v_updated
    from public.tickets where id = '44444444-4444-4444-4444-444444444444';
  if v_version <> 2 then
    raise exception 'Trigger bump_version nefunguje (version=%)', v_version;
  end if;
  if not v_updated then
    raise exception 'Trigger na updated_at nefunguje';
  end if;

  -- Update se zastaralou verzí nesmí potkat žádný řádek – na tom stojí
  -- detekce konfliktu v Zakázkách i Zákaznících.
  update public.tickets set title = 'konflikt'
    where id = '44444444-4444-4444-4444-444444444444' and version = 1;
  get diagnostics v_pocet = row_count;
  if v_pocet <> 0 then
    raise exception 'Optimistické zamykání nefunguje – starý version prošel';
  end if;
  raise notice 'optimistické zamykání OK';
end $$;

-- Realtime: bez tabulky v publikaci supabase_realtime se aplikace přihlásí
-- k odběru, ale žádná změna jí nikdy nepřijde – a nic se přitom nerozbije
-- viditelně. Zakázky a Kalendář na tom stojí, proto se to kontroluje.
--
-- Seznam je úplný soupis tabulek, které si aplikace nechává posílat přes
-- `postgres_changes`. Kontrolovaly se dřív jen čtyři a přesně proto se
-- přehlédlo, že `customers` a `service_document_settings` v publikaci
-- nejsou (docs/MIGRACE_NA_CISTO.md, „Nález mimo migrace“) – seznam odběrů
-- se rozrůstal, kontrola ne. Když přibude nový odběr, přidej tabulku sem;
-- co aplikace odebírá, vypíše:
--   grep -rn -A12 postgres_changes src | grep -oE 'table: *.[a-z_]+.'
do $$
declare chybi text;
begin
  select string_agg(t, ', ') into chybi
    from unnest(array[
      'bookings','branches','customers','device_brands','device_categories',
      'device_models','inventory_product_categories','inventory_products',
      'repairs','service_document_settings','service_settings',
      'service_statuses','sms_messages','ticket_comments',
      'ticket_portal_events','ticket_work_sessions','tickets','warranty_claims'
    ]) as t
   where not exists (
     select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
   );
  if chybi is not null then
    raise exception 'V publikaci supabase_realtime chybí: %', chybi;
  end if;
  raise notice 'realtime publikace OK';
end $$;

-- RLS: cizí uživatel nesmí zakázku vidět, člen servisu ano.
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.tickets;
  if n <> 0 then raise exception 'RLS pouští cizího uživatele (vidí % zakázek)', n; end if;
  raise notice 'RLS proti cizímu uživateli OK';
end $$;

set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.tickets;
  if n <> 1 then raise exception 'Člen servisu vidí % zakázek místo 1', n; end if;
  raise notice 'RLS pro člena servisu OK';
end $$;
reset role;
SMOKE

echo ""
echo "Databáze Jobi se z migrací postaví od nuly a funguje."
exit 0
