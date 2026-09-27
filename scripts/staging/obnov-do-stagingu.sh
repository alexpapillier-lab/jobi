#!/usr/bin/env bash
# =====================================================================
# obnov-do-stagingu.sh — staging = poslední záloha produkce, bez osobních údajů
# =====================================================================
#
# K ČEMU TO JE
# ------------
# Migrace, edge funkce a agenti se mají zkoušet na databázi, která vypadá
# jako produkce (stejné schéma, stejný objem, stejné podivnosti v datech),
# ale NEOBSAHUJE skutečné zákazníky. Tenhle skript vezme poslední zálohu
# produkce, staging vyprázdní, zálohu do něj nahraje a osobní údaje
# zákazníků nahradí vymyšlenými. Postup a souvislosti: docs/STAGING.md.
#
# NA PRODUKCI NESAHÁ. Zálohu čte ze souboru nebo z artefaktu GitHubu, zapisuje
# jen do STAGING_DB_URL – a to až po kontrolách ve spolecne.sh (ref stagingu,
# nikdy ref produkce) a po kontrole značky jobi_staging v cílové databázi.
#
# POUŽITÍ
#   bash scripts/staging/obnov-do-stagingu.sh [ZDROJ] [--nanecisto] [--ano]
#
#   ZDROJ (jedno z):
#     --github [ID_BEHU]  artefakt zaloha-db-* z workflow backup-db.yml
#                         (výchozí; bez ID poslední úspěšný běh), rozšifruje
#                         se heslem BACKUP_PASSPHRASE
#     --lokalni           nejnovější složka v backup/ ze scripts/backup-db.sh
#     --zaloha SLOZKA     konkrétní rozbalená záloha (roles.sql, schema.sql, data.sql…)
#
#   --nanecisto  stáhne a připraví zálohu, zkontroluje připojení a stav
#                stagingu a vypíše, co by se stalo. Do stagingu nezapíše nic.
#   --ano        bez ptaní (CI); jinak se čeká na opsání refu stagingu
#
# PROMĚNNÉ (z prostředí nebo z .env.staging, vzor .env.staging.example)
#   STAGING_REF              ref projektu stagingu (NIKDY ijtvcgolsdsrquqbvjrz)
#   STAGING_DB_URL           connection string stagingu i s heslem (session pooler, 5432)
#   STAGING_TEST_PASSWORD    heslo, které po obnově dostanou všichni uživatelé
#                            stagingu (e2e@jobi.test, e2e-technik@jobi.test, …), min. 12 znaků
#   BACKUP_PASSPHRASE        heslo k záloze z GitHubu (jen pro --github)
#   STAGING_PONECHAT_EMAILY  čárkou oddělené e-maily, které se neanonymizují
#                            (např. majitel, ať se přihlásí jako on)
#   STAGING_CRON=zapnuto     nechat na stagingu běžet naplánované úlohy (výchozí: vypnout)
#   JOBI_GH_REPO             repozitář se zálohami (výchozí alexpapillier-lab/jobi)
#
# IDEMPOTENCE: každý běh začíná vyprázdněním, takže dva běhy za sebou dají
# stejný výsledek. Data a anonymizace jdou v jedné transakci – když
# anonymizace selže, v databázi nezůstane nic ze zálohy.
# =====================================================================
set -euo pipefail

SKRIPTY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/staging/spolecne.sh
. "$SKRIPTY/spolecne.sh"
REPO_ROOT="$STAGING_REPO_ROOT"

# Tabulky, které anonymizace celé vyprázdní: tokeny, PINy, hesla k obnově,
# logy chyb a uložené odpovědi API. Na stagingu nemají co dělat a nesou
# tajemství nebo osobní údaje. Kontrola počtů u nich čeká nulu.
VYPRAZDNIT="api_tokens,api_idempotency,api_read_hits,rate_hits,capture_tokens,draft_capture_photos,password_reset_tokens,password_reset_rate_limit,user_pin,error_logs,alert_events"

ZDROJ="github"
RUN_ID=""
ZALOHA_SLOZKA=""
NANECISTO=0
ANO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --github) ZDROJ="github"; if [ -n "${2:-}" ] && [[ "$2" =~ ^[0-9]+$ ]]; then RUN_ID="$2"; shift; fi ;;
    --lokalni) ZDROJ="lokalni" ;;
    --zaloha) ZDROJ="slozka"; ZALOHA_SLOZKA="${2:-}"; [ -n "$ZALOHA_SLOZKA" ] || chyba "--zaloha potřebuje složku"; shift ;;
    --nanecisto|--dry-run) NANECISTO=1 ;;
    --ano|--yes) ANO=1 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) chyba "Neznámý přepínač: $1 (nápověda: --help)" ;;
  esac
  shift
done
export ANO

nacti_env_staging
hlidej_staging
[ -n "${STAGING_TEST_PASSWORD:-}" ] || chyba "Chybí STAGING_TEST_PASSWORD – heslo, které po obnově dostanou uživatelé stagingu (e2e@jobi.test…)."
[ "${#STAGING_TEST_PASSWORD}" -ge 12 ] || chyba "STAGING_TEST_PASSWORD musí mít aspoň 12 znaků."
export STAGING_TEST_PASSWORD
export STAGING_PONECHAT_EMAILY="${STAGING_PONECHAT_EMAILY:-}"

vyzaduj_prikaz psql python3
[ "$ZDROJ" = "github" ] && vyzaduj_prikaz gh gpg

# Rozbalená záloha obsahuje celou databázi zákazníků – jen do soukromé
# dočasné složky a po skončení pryč, i po chybě.
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/jobi-staging-XXXXXX")"
chmod 700 "$WORKDIR"
uklid() { rm -rf "$WORKDIR"; }
trap uklid EXIT

# ---------------------------------------------------------------------
krok "Záloha"
# ---------------------------------------------------------------------
case "$ZDROJ" in
  slozka)
    [ -d "$ZALOHA_SLOZKA" ] || chyba "Složka $ZALOHA_SLOZKA není."
    ZALOHA="$(cd "$ZALOHA_SLOZKA" && pwd)"
    info "  zadaná složka: $ZALOHA"
    ;;
  lokalni)
    ZALOHA=""
    if [ -d "$REPO_ROOT/backup" ]; then
      for d in "$REPO_ROOT"/backup/*/; do
        [ -f "$d/data.sql" ] && ZALOHA="${d%/}"
      done
    fi
    [ -n "$ZALOHA" ] || chyba "V backup/ není žádná záloha se data.sql. Udělej ji: bash scripts/backup-db.sh"
    info "  nejnovější lokální: $ZALOHA"
    ;;
  github)
    [ -n "${BACKUP_PASSPHRASE:-}" ] || chyba "Chybí BACKUP_PASSPHRASE (heslo k záloze z GitHubu). Nebo použij --lokalni / --zaloha."
    REPO="${JOBI_GH_REPO:-alexpapillier-lab/jobi}"
    if [ -z "$RUN_ID" ]; then
      RUN_ID=$(gh run list --repo "$REPO" --workflow backup-db.yml --status success -L 1 \
                 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
      [ -n "$RUN_ID" ] || chyba "Nenašel jsem úspěšný běh backup-db.yml v $REPO (gh auth status? secrets zálohy nastavené?)."
    fi
    info "  běh workflow: $RUN_ID ($REPO)"
    gh run download "$RUN_ID" --repo "$REPO" --pattern 'zaloha-db-*' -D "$WORKDIR/stazeno" >/dev/null
    SIFRA=$(find "$WORKDIR/stazeno" -name 'zaloha-*.tar.gz.gpg' ! -name 'zaloha-storage-*' | sort | tail -1)
    [ -n "$SIFRA" ] || chyba "V artefaktu běhu $RUN_ID není zaloha-*.tar.gz.gpg (artefakty se drží 90 dní)."
    info "  soubor: $(basename "$SIFRA")"
    # Heslo přes deskriptor, ne na příkazové řádce (bylo by vidět v ps).
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
        --decrypt -o "$WORKDIR/zaloha.tar.gz" "$SIFRA" 3<<<"$BACKUP_PASSPHRASE" \
      || chyba "Zálohu se nepodařilo rozšifrovat – špatné BACKUP_PASSPHRASE?"
    mkdir -p "$WORKDIR/zaloha"
    tar -xzf "$WORKDIR/zaloha.tar.gz" -C "$WORKDIR/zaloha"
    rm -f "$WORKDIR/zaloha.tar.gz"
    ZALOHA="$WORKDIR/zaloha"
    ;;
esac
ZALOHA_NAZEV="$(basename "$ZALOHA")"
[ "$ZDROJ" = "github" ] && ZALOHA_NAZEV="github běh $RUN_ID ($(basename "$SIFRA"))"
for f in schema.sql data.sql; do
  [ -s "$ZALOHA/$f" ] || chyba "V záloze chybí $f."
done
[ -f "$ZALOHA/migrace.csv" ] || varuj "V záloze chybí migrace.csv – historie migrací na stagingu se nenastaví a db push by chtěl přehrát všechno."
info "  $(du -sh "$ZALOHA" | cut -f1) v $(ls "$ZALOHA" | wc -l | tr -d ' ') souborech"

# ---------------------------------------------------------------------
krok "Příprava dat"
# ---------------------------------------------------------------------
python3 "$SKRIPTY/priprav-data.py" filtr "$ZALOHA/data.sql" "$WORKDIR/data-staging.sql" "$WORKDIR/ocekavano.txt"

# ---------------------------------------------------------------------
krok "Staging"
# ---------------------------------------------------------------------
psql_staging -At -c "select 1" >/dev/null 2>"$WORKDIR/pripojeni.log" \
  || { cat "$WORKDIR/pripojeni.log" >&2; chyba "Ke stagingu se nejde připojit (STAGING_DB_URL, heslo, síť)."; }

ZNACKA=0
ma_znacku_stagingu && ZNACKA=1
ZAKAZEK=$(pocet_radku public.tickets)
LEDGER=$(pocet_radku supabase_migrations.schema_migrations)
[ "$LEDGER" = "-1" ] && LEDGER=0
POLITIK_STORAGE=$(psql_staging -At -c "select count(*) from pg_policies where schemaname in ('storage', 'realtime')")
info "  značka stagingu: $([ "$ZNACKA" = 1 ] && echo ano || echo ne), zakázek: $([ "$ZAKAZEK" = -1 ] && echo 'tabulka není' || echo "$ZAKAZEK"), migrací v historii: $LEDGER, politik Storage/Realtime: $POLITIK_STORAGE"
if [ "$ZNACKA" = 1 ]; then
  psql_staging -At -c "select 'poslední obnova: ' || to_char(kdy, 'YYYY-MM-DD HH24:MI') || ', ' || zaloha
                           || case when dokonceno then '' else ' – NEDOBĚHLA' end
                      from jobi_staging.obnovy order by kdy desc limit 1" 2>/dev/null | sed 's/^/  /' || true
fi

# Druhá pojistka vedle refu: vyprázdnit se smí jen databáze, kterou tenhle
# skript už dřív naplnil, nebo databáze bez zakázek (nový projekt).
# Produkce značku nikdy nemá a zakázky má, takže tady skončí vždycky.
if [ "$ZNACKA" = 0 ] && [ "$ZAKAZEK" -gt 0 ]; then
  chyba "Cílová databáze má $ZAKAZEK zakázek a nemá značku jobi_staging – nevypadá jako staging. Nic jsem nezměnil."
fi

PRVNI_PUSH=0
if [ "$LEDGER" = "0" ]; then
  PRVNI_PUSH=1
  info "  Staging je nový projekt: nejdřív se na něj pustí všechny migrace (db push),"
  info "  aby vznikly buckety, politiky Storage, rozšíření a úlohy. Pak se nahraje záloha."
  vyzaduj_prikaz supabase
fi

# ---------------------------------------------------------------------
if [ "$NANECISTO" = 1 ]; then
  krok "Nanečisto – co by se stalo"
  [ "$PRVNI_PUSH" = 1 ] && info "  0. supabase db push --db-url <staging> (všech $(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ') migrací)"
  info "  1. opsat politiky Storage/Realtime ze stagingu (vrátí se po obnově)"
  info "  2. vyprázdnit public na stagingu (scripts/staging/vyprazdneni.sql)"
  info "  3. roles.sql, schema.sql ze zálohy"
  info "  4. v jedné transakci: uživatelé + data + anonymizace + historie migrací + značka"
  info "  5. kontrola počtů řádků proti záloze, vypnutí naplánovaných úloh"
  info ""
  info "Do stagingu se nic nezapsalo."
  exit 0
fi

potvrd_ref "Staging ($STAGING_REF) se VYPRÁZDNÍ a naplní zálohou $ZALOHA_NAZEV."

if [ "$PRVNI_PUSH" = 1 ]; then
  krok "První nasazení migrací na nový staging"
  if je_lokalni_url "$STAGING_DB_URL"; then
    varuj "Lokální zkouška: db push se přeskakuje."
  else
    ( cd "$REPO_ROOT" && supabase db push --db-url "$STAGING_DB_URL" --yes )
  fi
fi

# ---------------------------------------------------------------------
krok "Politiky mimo public"
# ---------------------------------------------------------------------
# Politiky nad storage.objects (fotky, chat, obrázky produktů) odkazují na
# tabulky v public, takže je vyprázdnění přes CASCADE smaže. Schéma ze
# zálohy je nevrátí – dump bere jen public. Proto se opíšou teď a vrátí po
# obnově schématu.
#
# Opis se ukládá i do stagingu (jobi_staging.krizove). Kdyby obnova spadla
# mezi vyprázdněním a vrácením politik, na stagingu by už nebyly a další běh
# by neměl odkud je vzít – proto se po nedoběhnuté obnově (dokonceno = false)
# berou z uložené kopie, ne ze stagingu.
psql_staging -q -v ON_ERROR_STOP=1 <<'SQL'
set client_min_messages = warning;
create schema if not exists jobi_staging;
comment on schema jobi_staging is 'Značka stagingu Jobi (scripts/staging/obnov-do-stagingu.sh). Na produkci NESMÍ existovat.';
revoke all on schema jobi_staging from public;
create table if not exists jobi_staging.obnovy (
  kdy timestamptz not null default now(),
  zaloha text not null,
  kdo text not null default current_user
);
alter table jobi_staging.obnovy add column if not exists id bigserial;
-- Starší záznamy (bez sloupce) se berou jako dokončené.
alter table jobi_staging.obnovy add column if not exists dokonceno boolean not null default true;
create table if not exists jobi_staging.krizove (poradi int not null, ddl text not null);
SQL
POSLEDNI_DOBEHLA=$(psql_staging -At -c "select coalesce((select dokonceno from jobi_staging.obnovy order by kdy desc limit 1), true)")
ULOZENYCH=$(psql_staging -At -c "select count(*) from jobi_staging.krizove")
if [ "$POSLEDNI_DOBEHLA" = "f" ] && [ "$ULOZENYCH" != "0" ]; then
  varuj "Minulá obnova nedoběhla – politiky beru z kopie uložené před ní ($ULOZENYCH), ne ze stagingu."
else
  # Cesta hledání prázdná = výrazy v politikách plně kvalifikované.
  psql_staging -q -1 -v ON_ERROR_STOP=1 <<'SQL'
set local search_path = '';
delete from jobi_staging.krizove;
insert into jobi_staging.krizove (poradi, ddl)
select row_number() over (order by d.poradi, d.klic), d.ddl from (
  select 1 as poradi, schemaname || '.' || tablename || '.' || policyname as klic,
         format('drop policy if exists %I on %I.%I;%screate policy %I on %I.%I as %s for %s to %s%s%s;',
                policyname, schemaname, tablename, E'\n', policyname, schemaname, tablename,
                permissive, cmd,
                (select string_agg(case when r = 'public' then 'public' else pg_catalog.quote_ident(r) end, ', ') from pg_catalog.unnest(roles) r),
                case when qual is not null then ' using (' || qual || ')' else '' end,
                case when with_check is not null then ' with check (' || with_check || ')' else '' end) as ddl
    from pg_catalog.pg_policies
   where schemaname in ('storage', 'realtime')
  union all
  -- Triggery na tabulkách platformy, které volají naše funkce z public.
  select 2, n.nspname || '.' || c.relname || '.' || t.tgname,
         format('drop trigger if exists %I on %I.%I;%s%s;', t.tgname, n.nspname, c.relname, E'\n', pg_catalog.pg_get_triggerdef(t.oid))
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
   where n.nspname in ('auth', 'storage') and pn.nspname = 'public' and not t.tgisinternal
) d;
SQL
fi
psql_staging -q -At -v ON_ERROR_STOP=1 -c "select ddl from jobi_staging.krizove order by poradi" > "$WORKDIR/krizove.sql"
N_KRIZOVE=$(psql_staging -At -c "select count(*) from jobi_staging.krizove")
info "  opsáno politik a triggerů: $N_KRIZOVE"
if [ "$N_KRIZOVE" = "0" ] && ! je_lokalni_url "$STAGING_DB_URL"; then
  varuj "Na stagingu nejsou žádné politiky Storage – po obnově nepůjde nahrávat fotky. Postup nápravy je v docs/STAGING.md (Politiky Storage)."
fi

# Od teď až do konce transakce s daty je staging „rozdělaný“.
RUN_ID_OBNOVY=$(psql_staging -q -At -v ON_ERROR_STOP=1 -v zaloha_nazev="$ZALOHA_NAZEV (nedoběhla)" <<'SQL' | head -1
insert into jobi_staging.obnovy (zaloha, dokonceno) values (:'zaloha_nazev', false) returning id;
SQL
)

# ---------------------------------------------------------------------
krok "Vyprázdnění stagingu"
# ---------------------------------------------------------------------
psql_staging -q -1 -v ON_ERROR_STOP=1 -f "$SKRIPTY/vyprazdneni.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^/  /'

# ---------------------------------------------------------------------
krok "Role a schéma"
# ---------------------------------------------------------------------
pocet_chyb() { grep -cE '(^|: )ERROR:' "$1" || true; }
if [ -f "$ZALOHA/roles.sql" ]; then
  psql_staging -q -v ON_ERROR_STOP=0 -f "$ZALOHA/roles.sql" > "$WORKDIR/roles.log" 2>&1 || true
  # Role na Supabase spravuje platforma; „already exists“ a „permission
  # denied“ jsou tu normální. Důležité je nastavení timeoutů, a to projde.
  info "  roles.sql – chyb: $(pocet_chyb "$WORKDIR/roles.log") (u rolí se čekají, jen se vypíšou)"
fi
psql_staging -q -v ON_ERROR_STOP=0 -f "$ZALOHA/schema.sql" > "$WORKDIR/schema.log" 2>&1 || true
info "  schema.sql – chyb: $(pocet_chyb "$WORKDIR/schema.log")"
grep -E '(^|: )ERROR:' "$WORKDIR/schema.log" | sed -e 's/^psql:[^ ]* //' -e 's/^/    /' | head -10 || true
# Chyby, se kterými se na Supabase počítá: rozšíření a schémata, která
# spravuje platforma. Cokoli jiného znamená, že schéma není celé.
JINE=$(grep -E '(^|: )ERROR:' "$WORKDIR/schema.log" \
  | grep -vE 'extension "[a-z_0-9]+" (is not available|already exists)|permission denied to create extension|must be owner of (schema|extension|database)|schema "[a-z_0-9]+" already exists|role "[a-z_0-9]+" already exists|is already member of publication' \
  | head -20 || true)
if [ -n "$JINE" ]; then
  echo "$JINE" >&2
  if [ "${STAGING_IGNORUJ_CHYBY_SCHEMATU:-0}" = "1" ]; then
    varuj "Schéma se nenahrálo čistě, pokračuji kvůli STAGING_IGNORUJ_CHYBY_SCHEMATU=1."
  else
    chyba "Schéma se nenahrálo čistě (výpis výš). Staging je teď bez dat – oprav příčinu a pusť skript znovu."
  fi
fi

if [ "$N_KRIZOVE" != "0" ]; then
  psql_staging -q -v ON_ERROR_STOP=1 -f "$WORKDIR/krizove.sql" > "$WORKDIR/krizove.log" 2>&1 \
    || { cat "$WORKDIR/krizove.log" >&2; chyba "Politiky Storage se nepodařilo vrátit."; }
  info "  politiky Storage/Realtime vráceny"
fi

# ---------------------------------------------------------------------
krok "Data a anonymizace (jedna transakce)"
# ---------------------------------------------------------------------
# Uživatelé se mažou až tady, ve stejné transakci jako nahrání: když něco
# spadne, staging zůstane s původními (už anonymizovanými) uživateli.
cat > "$WORKDIR/pred-daty.sql" <<'SQL'
set local session_replication_role = replica;
truncate auth.users cascade;
SQL

if [ -f "$ZALOHA/migrace.csv" ]; then
  cp "$ZALOHA/migrace.csv" "$WORKDIR/migrace.csv"
  cat > "$WORKDIR/historie.sql" <<SQL
-- Historie migrací = historie produkce. db push na stagingu pak pustí přesně
-- to, co by pustil na produkci – a o to jde.
do \$\$ begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    create schema if not exists supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
  end if;
end \$\$;
truncate supabase_migrations.schema_migrations;
\\copy supabase_migrations.schema_migrations (version, name) from '$WORKDIR/migrace.csv' with (format csv)
SQL
else
  echo "-- migrace.csv v záloze není" > "$WORKDIR/historie.sql"
fi

cat > "$WORKDIR/znacka.sql" <<'SQL'
-- Značka: obnova doběhla. Schéma jobi_staging vyprázdnění nemaže a produkce
-- ho nikdy nemá – podle něj skripty poznají, že jsou na stagingu.
update jobi_staging.obnovy set zaloha = :'zaloha_nazev', dokonceno = true where id = :'id_obnovy';
SQL

PGOPTIONS="-c session_replication_role=replica" psql_staging -q -1 -v ON_ERROR_STOP=1 \
  -v vyprazdnit="$VYPRAZDNIT" -v zaloha_nazev="$ZALOHA_NAZEV" -v id_obnovy="$RUN_ID_OBNOVY" \
  -f "$WORKDIR/pred-daty.sql" \
  -f "$WORKDIR/data-staging.sql" \
  -f "$SKRIPTY/anonymizace.sql" \
  -f "$WORKDIR/historie.sql" \
  -f "$WORKDIR/znacka.sql" > "$WORKDIR/data.log" 2>&1 \
  || { grep -E 'ERROR|CHYBA|Anonymizace' "$WORKDIR/data.log" | head -20 >&2
       chyba "Nahrání dat nebo anonymizace selhaly – transakce se vrátila, žádná data ze zálohy na stagingu nejsou. Staging je teď bez dat, pusť skript znovu po opravě."; }
grep -E 'NOTICE:  anonymizace' "$WORKDIR/data.log" | sed 's/^.*NOTICE:  /  /' || true

# ---------------------------------------------------------------------
krok "Kontrola počtu řádků (záloha vs. staging)"
# ---------------------------------------------------------------------
psql_staging -q -At -F '|' -v ON_ERROR_STOP=1 -o "$WORKDIR/skutecne.txt" <<'SQL'
do $$
declare r record; n bigint;
begin
  create temp table _pocty(t text, n bigint);
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    insert into _pocty values ('public.' || r.tablename, n);
  end loop;
  if to_regclass('auth.users') is not null then
    insert into _pocty select 'auth.users', count(*) from auth.users;
  end if;
  if to_regclass('auth.identities') is not null then
    insert into _pocty select 'auth.identities', count(*) from auth.identities;
  end if;
end $$;
select t, n from _pocty order by t collate "C";
SQL
python3 "$SKRIPTY/priprav-data.py" porovnej "$WORKDIR/ocekavano.txt" "$WORKDIR/skutecne.txt" "$VYPRAZDNIT"

psql_staging -c "
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tabulky,
  (select count(*) from pg_policies where schemaname = 'public') as politiky,
  (select count(*) from pg_policies where schemaname = 'storage') as politiky_storage,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public') as realtime,
  (select count(*) from auth.users) as uzivatele,
  (select count(*) from supabase_migrations.schema_migrations) as migrace;" | sed 's/^/  /'

# ---------------------------------------------------------------------
krok "Naplánované úlohy"
# ---------------------------------------------------------------------
# Úlohy na stagingu by každou hodinu posílaly hlídací e-maily a spouštěly
# automatizace (SMS). Výchozí je vypnout; STAGING_CRON=zapnuto je nechá.
if [ "$(psql_staging -At -c "select to_regclass('cron.job') is not null")" = "t" ]; then
  if [ "${STAGING_CRON:-}" = "zapnuto" ]; then
    info "  nechávám zapnuté (STAGING_CRON=zapnuto)"
  else
    psql_staging -At -c "select count(*) from (select cron.alter_job(jobid, active := false) from cron.job where active) x" \
      | sed 's/^/  vypnuto úloh: /' || varuj "Úlohy se nepodařilo vypnout – zkontroluj cron.job ručně."
  fi
else
  info "  pg_cron na stagingu není – nic k vypnutí"
fi

krok "Hotovo"
info "Staging $STAGING_REF obsahuje zálohu $ZALOHA_NAZEV, bez osobních údajů zákazníků."
info "Přihlášení: e2e@jobi.test (a kdokoli jiný) s heslem ze STAGING_TEST_PASSWORD."
info "Ostatní uživatelé mají e-mail uzivatel-N@staging.jobi.test."
info "Další krok: bash scripts/staging/migrace-na-staging.sh"
