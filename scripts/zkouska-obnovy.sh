#!/usr/bin/env bash
# =====================================================================
# zkouska-obnovy.sh — obnoví zálohu do prázdného Postgresu a ověří ji
# =====================================================================
#
# K ČEMU TO JE
# ------------
# Záloha, kterou nikdo nezkusil obnovit, je jen soubor. Tenhle skript
# vezme adresář se zálohou (roles.sql, schema.sql, data.sql), nahraje ji
# do PRÁZDNÉ databáze a ověří, že:
#   * se obnoví bez chyb (kromě rozšíření, která v holém Postgresu nejsou),
#   * v každé tabulce sedí počet řádků proti tomu, co je v data.sql,
#   * jsou zpátky RLS politiky, funkce, triggery a publikace pro realtime,
#   * databáze doopravdy funguje (RLS, triggery, optimistické zamykání).
#
# NESAHÁ NA OSTROU DATABÁZI. Bez OBNOVA_DB_URL si zakládá vlastní lokální
# cluster v dočasném adresáři a na konci ho smaže. Docker není potřeba.
#
# POUŽITÍ
#   bash scripts/zkouska-obnovy.sh <adresář-se-zálohou>
#   npm run test:obnova -- backup/2026-09-07
#
# PROMĚNNÉ
#   OBNOVA_DB_URL   obnovit do téhle (prázdné!) databáze místo vlastního
#                   clusteru – tak to dělá workflow backup-db.yml
#   PGPORT_TEST     port pro vlastní cluster (výchozí 55433)
#   PGBIN           adresář s initdb/pg_ctl/psql (jinak se hledá)
#   KEEP_CLUSTER=1  nechá cluster běžet, ať se dá do obnovené DB nakouknout
# =====================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP="$REPO_ROOT/supabase/bootstrap-test.sql"
ZALOHA="${1:-}"
PORT="${PGPORT_TEST:-55433}"
export LC_ALL=C

if [ -z "$ZALOHA" ] || [ ! -f "$ZALOHA/data.sql" ] || [ ! -f "$ZALOHA/schema.sql" ]; then
  echo "Použití: bash scripts/zkouska-obnovy.sh <adresář se schema.sql a data.sql>" >&2
  exit 1
fi
ZALOHA="$(cd "$ZALOHA" && pwd)"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/jobi-obnova-XXXXXX")"
DATADIR="$WORKDIR/data"
VLASTNI_CLUSTER=0

cleanup() {
  if [ "$VLASTNI_CLUSTER" = "1" ]; then
    if [ "${KEEP_CLUSTER:-0}" = "1" ]; then
      echo ""
      echo "Obnovená databáze běží dál (KEEP_CLUSTER=1):"
      echo "  $PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -d obnova"
      echo "  zastavit: $PGBIN/pg_ctl -D $DATADIR stop"
      return
    fi
    "$PGBIN/pg_ctl" -D "$DATADIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# --- kam obnovovat ------------------------------------------------------
if [ -n "${OBNOVA_DB_URL:-}" ]; then
  # Režim pro CI: prázdná databáze je připravená zvenčí (service container).
  PSQL_BASE=(psql "$OBNOVA_DB_URL")
  echo "=== Obnova do zadané databáze (OBNOVA_DB_URL) ==="
else
  # Serverové binárky: /opt/homebrew/bin obsahuje jen klienta z libpq.
  if [ -z "${PGBIN:-}" ]; then
    for cand in /opt/homebrew/opt/postgresql@17/bin \
                /opt/homebrew/opt/postgresql@16/bin \
                /usr/local/opt/postgresql@17/bin \
                /usr/lib/postgresql/17/bin; do
      if [ -x "$cand/postgres" ]; then PGBIN="$cand"; break; fi
    done
  fi
  if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/postgres" ]; then
    echo "CHYBA: nenašel jsem PostgreSQL SERVER. Nainstaluj: brew install postgresql@17" >&2
    exit 1
  fi
  echo "=== Prázdný cluster: $WORKDIR (port $PORT) ==="
  "$PGBIN/initdb" -D "$DATADIR" -U postgres --encoding=UTF8 --locale=C >/dev/null 2>&1
  # -k /tmp: cesta k socketu má limit 103 znaků.
  "$PGBIN/pg_ctl" -D "$DATADIR" \
    -o "-p $PORT -h 127.0.0.1 -k /tmp -c wal_level=logical" \
    -l "$WORKDIR/postgres.log" -w start >/dev/null
  VLASTNI_CLUSTER=1
  "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -q -c "create database obnova;"
  PSQL_BASE=("$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d obnova)
fi

P=("${PSQL_BASE[@]}" -X -q -v ON_ERROR_STOP=0)

# psql hlásí chyby jako „psql:soubor:řádek: ERROR:  …“, ne jako „ERROR“ na
# začátku řádku – proto se hledá dvojtečka před ERROR i začátek řádku.
pocet_chyb() { grep -cE '(^|: )ERROR:' "$1" || true; }

# --- prostředí Supabase, které v holém Postgresu není --------------------
echo "=== Prostředí Supabase (role, auth, storage) ==="
"${P[@]}" -f "$BOOTSTRAP" > "$WORKDIR/bootstrap.log" 2>&1
echo "  chyb: $(pocet_chyb "$WORKDIR/bootstrap.log")"

# Schéma v záloze (supabase db dump) NEobsahuje tabulky schémat auth a
# storage – platforma si je dělá sama. Data v záloze ale ANO (auth.users,
# storage.objects…). Bez téhle náhrady by se uživatelé a seznam souborů
# tiše zahodili a zkouška obnovy by o tom mlčela. Tabulky se odvodí přímo
# z hlaviček COPY v data.sql, takže drží krok se změnami Supabase.
python3 - "$ZALOHA/data.sql" "$WORKDIR/shim.sql" <<'PY'
import re, sys
zdroj, vystup = sys.argv[1], sys.argv[2]
ddl, tabulky = [], set()
with open(zdroj, encoding='utf-8', errors='replace') as f:
    for radek in f:
        m = re.match(r'^COPY "(auth|storage)"\."([a-z_0-9]+)" \((.*)\) FROM stdin;', radek)
        if m:
            schema, tab, sloupce = m.group(1), m.group(2), m.group(3)
            cols = [c.strip().strip('"') for c in sloupce.split(',')]
            telo = []
            for c in cols:
                # auth.users.id musí být uuid – vedou na něj cizí klíče z public.
                if c == 'id' and (schema, tab) == ('auth', 'users'):
                    telo.append('  "id" uuid primary key')
                elif c == 'id' and (schema, tab) == ('storage', 'buckets'):
                    telo.append('  "id" text primary key')
                else:
                    telo.append('  "%s" text' % c)
            ddl.append('create table if not exists "%s"."%s" (\n%s\n);' % (schema, tab, ',\n'.join(telo)))
            # bootstrap-test.sql některé tabulky vytvořil zjednodušeně – doplň sloupce
            for c in cols:
                ddl.append('alter table "%s"."%s" add column if not exists "%s" text;' % (schema, tab, c))
            tabulky.add('%s.%s' % (schema, tab))
        s = re.match(r"^SELECT pg_catalog\.setval\('\"(auth|storage)\"\.\"([a-z_0-9]+)\"'", radek)
        if s:
            ddl.append('create sequence if not exists "%s"."%s";' % (s.group(1), s.group(2)))
open(vystup, 'w').write('\n'.join(ddl) + '\n')
print('  tabulek auth/storage doplněno: %d' % len(tabulky))
PY
"${P[@]}" -f "$WORKDIR/shim.sql" > "$WORKDIR/shim.log" 2>&1
echo "  chyb: $(pocet_chyb "$WORKDIR/shim.log")"

# --- vlastní obnova ------------------------------------------------------
echo ""
echo "=== Obnova zálohy ==="
if [ -f "$ZALOHA/roles.sql" ]; then
  "${P[@]}" -f "$ZALOHA/roles.sql" > "$WORKDIR/roles.log" 2>&1
  echo "  roles.sql  – chyb: $(pocet_chyb "$WORKDIR/roles.log")"
fi
"${P[@]}" -f "$ZALOHA/schema.sql" > "$WORKDIR/schema.log" 2>&1
CHYB_SCHEMA=$(pocet_chyb "$WORKDIR/schema.log")
echo "  schema.sql – chyb: $CHYB_SCHEMA"
# session_replication_role=replica: data se sypou v pořadí, v jakém je dal
# pg_dump, ne v pořadí cizích klíčů – bez vypnutých triggerů by to spadlo.
PGOPTIONS="-c session_replication_role=replica" "${P[@]}" -f "$ZALOHA/data.sql" > "$WORKDIR/data.log" 2>&1
CHYB_DATA=$(pocet_chyb "$WORKDIR/data.log")
echo "  data.sql   – chyb: $CHYB_DATA"

# pg_cron, pg_net a supabase_vault v holém Postgresu nejsou a nevadí to –
# na Supabase je má platforma. Cokoli jiného je skutečná chyba obnovy.
JINE_CHYBY=$(grep -E '(^|: )ERROR:' "$WORKDIR/schema.log" \
  | grep -vE 'extension "(pg_cron|pg_net|supabase_vault|pgsodium|pgjwt|pg_graphql|pg_stat_statements|pgaudit|http|wrappers|index_advisor|hypopg)" is not available' \
  | head -20)
if [ -n "$JINE_CHYBY" ]; then
  echo ""
  echo "CHYBA: schéma se neobnovilo čistě:" >&2
  echo "$JINE_CHYBY" >&2
  exit 1
fi
if [ "$CHYB_DATA" != "0" ]; then
  echo ""
  echo "CHYBA: data se neobnovila čistě:" >&2
  grep -E '(^|: )ERROR:' "$WORKDIR/data.log" | head -20 >&2
  exit 1
fi

# --- sedí počty řádků? ---------------------------------------------------
# Porovnává se proti tomu, co je v data.sql, ne proti ostré databázi:
# mezi dumpem a kontrolou vznikne na ostré DB další zakázka a porovnání by
# padalo náhodně. Tohle je deterministické a odhalí to, na čem záleží –
# jestli se do obnovené databáze dostalo všechno, co v záloze je.
echo ""
echo "=== Kontrola počtu řádků (záloha vs. obnovená databáze) ==="
python3 - "$ZALOHA/data.sql" "$WORKDIR/ocekavano.txt" <<'PY'
import re, sys
zdroj, vystup = sys.argv[1], sys.argv[2]
pocty, tabulka, n = [], None, 0
with open(zdroj, encoding='utf-8', errors='replace') as f:
    for radek in f:
        if tabulka is not None:
            if radek.rstrip('\n') == '\\.':
                pocty.append((tabulka, n)); tabulka, n = None, 0
            else:
                n += 1
            continue
        m = re.match(r'^COPY "public"\."([a-z_0-9]+)" \(.*\) FROM stdin;', radek)
        if m:
            tabulka, n = m.group(1), 0
with open(vystup, 'w') as f:
    for t, n in sorted(pocty):
        f.write('%s|%d\n' % (t, n))
print('  tabulek s daty v záloze: %d' % len(pocty))
PY

"${P[@]}" -At -F '|' -o "$WORKDIR/obnoveno.txt" <<'SQL'
do $$
declare r record; n bigint;
begin
  create temp table _pocty(t text, n bigint);
  for r in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    insert into _pocty values (r.tablename, n);
  end loop;
end $$;
-- collate "C" je tady nutnost, ne kosmetika: druhou stranu porovnání
-- (ocekavano.txt) řadí Python podle bajtů. Bez tohohle řadí databáze podle
-- svého locale, a glibc v en_US.UTF-8 podtržítko ignoruje – takže vrátí
-- „invoices" před „invoice_series", kdežto Python obráceně. Diff pak hlásí
-- rozdíl, i když se všechny počty shodují.
--
-- Lokálně se to neprojeví (vlastní cluster se zakládá s --locale=C), ale
-- service container v CI běží v en_US.UTF-8. LC_ALL=C na začátku skriptu
-- řídí jen shell, do řazení uvnitř databáze nemluví.
select t, n from _pocty order by t collate "C";
SQL

if ! diff -u "$WORKDIR/ocekavano.txt" "$WORKDIR/obnoveno.txt" > "$WORKDIR/rozdil.txt"; then
  echo "CHYBA: počty řádků po obnově nesedí se zálohou:" >&2
  cat "$WORKDIR/rozdil.txt" >&2
  exit 1
fi
echo "  počty řádků sedí ve všech tabulkách"

# --- je zpátky i schéma, ne jen data? -----------------------------------
echo ""
echo "=== Obnovené schéma ==="
"${P[@]}" -c "
select
  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tabulky,
  (select count(*) from pg_policies where schemaname='public') as politiky,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as funkce,
  (select count(*) from pg_trigger t join pg_class r on r.oid=t.tgrelid
     join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and not t.tgisinternal) as triggery,
  (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public') as realtime,
  (select count(*) from auth.users) as uzivatele,
  (select count(*) from storage.objects) as soubory_v_evidenci;"

"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL' || exit 1
do $$
declare n_politik int; n_funkci int; n_triggeru int; n_realtime int; n_uzivatelu int;
begin
  select count(*) into n_politik from pg_policies where schemaname='public';
  select count(*) into n_funkci from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
  select count(*) into n_triggeru from pg_trigger t join pg_class r on r.oid=t.tgrelid
    join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and not t.tgisinternal;
  select count(*) into n_realtime from pg_publication_tables where pubname='supabase_realtime' and schemaname='public';
  select count(*) into n_uzivatelu from auth.users;
  -- Bez RLS politik by obnovená databáze pustila každého ke všem servisům,
  -- bez triggerů by nefungovalo optimistické zamykání ani historie.
  if n_politik < 100 then raise exception 'Po obnově je jen % RLS politik', n_politik; end if;
  if n_funkci < 50 then raise exception 'Po obnově je jen % funkcí', n_funkci; end if;
  if n_triggeru < 20 then raise exception 'Po obnově je jen % triggerů', n_triggeru; end if;
  if n_realtime < 15 then raise exception 'V publikaci supabase_realtime je jen % tabulek', n_realtime; end if;
  if n_uzivatelu = 0 then raise exception 'V záloze nejsou žádní uživatelé (auth.users) – nikdo by se po obnově nepřihlásil'; end if;
end $$;
SQL

# --- kouřová zkouška: funguje ta databáze doopravdy? --------------------
echo ""
echo "=== Kouřová zkouška ==="
"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL' || exit 1
begin;

-- RLS: člen servisu vidí zakázky svého servisu, cizí uživatel nevidí nic.
do $$
declare v_user uuid; v_service uuid; n_ocekavano bigint; n_videno bigint;
begin
  select m.user_id, m.service_id into v_user, v_service
    from public.service_memberships m
    join public.tickets t on t.service_id = m.service_id
   group by m.user_id, m.service_id order by count(*) desc limit 1;
  if v_user is null then raise notice 'v záloze není žádný člen servisu se zakázkami – RLS se nedá ověřit'; return; end if;
  select count(*) into n_ocekavano from public.tickets where service_id = v_service;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  select count(*) into n_videno from public.tickets;
  if n_videno < n_ocekavano then
    raise exception 'Člen servisu vidí po obnově % zakázek místo aspoň %', n_videno, n_ocekavano;
  end if;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
  select count(*) into n_videno from public.tickets;
  if n_videno <> 0 then raise exception 'RLS pouští cizího uživatele – vidí % zakázek', n_videno; end if;
  reset role;
  raise notice 'RLS OK (člen vidí své zakázky, cizí uživatel nevidí nic)';
end $$;

-- Zápis: triggery (verze, updated_at, root owner) a optimistické zamykání.
-- Nároky z předchozího bloku se musí zahodit, jinak by trigger na historii
-- zapisoval změnu pod neexistujícím uživatelem a spadl na cizí klíč.
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
insert into public.services (id, name) values ('aaaaaaaa-0000-0000-0000-0000000000aa', 'ZKOUŠKA OBNOVY');
insert into public.service_statuses (service_id, key, label, order_index)
  values ('aaaaaaaa-0000-0000-0000-0000000000aa', 'new', 'Nová', 0);
insert into public.tickets (id, service_id, title, status)
  values ('aaaaaaaa-0000-0000-0000-0000000000bb', 'aaaaaaaa-0000-0000-0000-0000000000aa', 'Zkouška obnovy', 'new');
do $$
declare v integer; c integer; u boolean;
begin
  select version into v from public.tickets where id = 'aaaaaaaa-0000-0000-0000-0000000000bb';
  if v <> 1 then raise exception 'Nová zakázka má version=%, čekalo se 1', v; end if;
  update public.tickets set title = 'Zkouška obnovy v2' where id = 'aaaaaaaa-0000-0000-0000-0000000000bb';
  select version, updated_at >= created_at into v, u from public.tickets where id = 'aaaaaaaa-0000-0000-0000-0000000000bb';
  if v <> 2 then raise exception 'Trigger bump_version nefunguje (version=%)', v; end if;
  if not u then raise exception 'Trigger na updated_at nefunguje'; end if;
  update public.tickets set title = 'konflikt' where id = 'aaaaaaaa-0000-0000-0000-0000000000bb' and version = 1;
  get diagnostics c = row_count;
  if c <> 0 then raise exception 'Optimistické zamykání nefunguje – starý version prošel'; end if;
  raise notice 'zápis, triggery a optimistické zamykání OK';
end $$;

-- Sekvence: po obnově musí navazovat, jinak první nová faktura spadne na duplicitu.
do $$
declare spatne text := '';
begin
  select string_agg(sequencename, ', ') into spatne from pg_sequences
   where schemaname = 'public' and last_value is null
     and sequencename in (select sequencename from pg_sequences where schemaname='public');
  if spatne is not null then raise notice 'sekvence bez nastavené hodnoty: %', spatne; end if;
end $$;

rollback;
SQL

echo ""
echo "Záloha se obnovila a obnovená databáze funguje."
if [ -f "$ZALOHA/storage-soubory.csv" ]; then
  echo "Pozor: soubory ve Storage ($(grep -c . "$ZALOHA/storage-soubory.csv") kusů podle seznamu) v téhle záloze nejsou –"
  echo "co se po havárii nevrátí samo, je v docs/OBNOVA_ZE_ZALOHY.md."
fi
exit 0
