#!/usr/bin/env bash
# =====================================================================
# migrace-na-staging.sh — nové migrace (a volitelně edge funkce) na staging
# =====================================================================
#
# Pořadí v Jobi je: migrace → STAGING → kouřová zkouška → produkce
# (docs/STAGING.md, docs/MIGRATIONS_SAFETY.md). Tenhle skript dělá druhý
# a třetí krok.
#
# LINK CLI SE NEPŘEPÍNÁ. `supabase link` zapisuje ref do supabase/.temp/
# project-ref – a ten soubor je v gitu a míří na produkci. Kdyby skript
# spadl mezi „link na staging“ a „link zpět“, další `npm run db:migrate`
# by šel na staging a hůř: další ruční `supabase db push` by si někdo
# spletl opačně. Proto se nic nelinkuje:
#   * migrace:  supabase db push --db-url "$STAGING_DB_URL"
#   * funkce:   supabase functions deploy <jméno> --project-ref "$STAGING_REF"
# Obojí jde přímo na staging a link nechá být. Pro jistotu si skript
# supabase/.temp na začátku opíše a na konci (i po chybě, i po Ctrl+C)
# ověří, že je beze změny – kdyby ho nějaká verze CLI přepsala, vrátí ho.
#
# POUŽITÍ
#   bash scripts/staging/migrace-na-staging.sh [--nanecisto] [--funkce CO] [--zaklad REF] [--sonda] [--ano]
#
#   --nanecisto     jen ukáže, co by se pustilo (db push --dry-run, seznam funkcí)
#   --funkce CO     zadne (výchozí) | zmenene | vse | jmeno1,jmeno2
#                   zmenene = funkce změněné proti --zaklad (výchozí origin/main),
#                   i necommitnuté; změna v _shared = všechny funkce
#   --sonda         po migraci pustí scripts/rls-probe.sql a vypíše, co nesedí
#   --ano           bez ptaní (CI)
#
# PROMĚNNÉ (prostředí nebo .env.staging)
#   STAGING_REF, STAGING_DB_URL   jako u obnov-do-stagingu.sh
#   SUPABASE_ACCESS_TOKEN         jen pro nasazení funkcí bez `supabase login`
#   STAGING_BEZ_ZNACKY=1          dovolí push na staging, který ještě nikdy
#                                 neprošel obnovou (jinak se čeká značka jobi_staging)
# =====================================================================
set -euo pipefail

SKRIPTY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/staging/spolecne.sh
. "$SKRIPTY/spolecne.sh"
REPO_ROOT="$STAGING_REPO_ROOT"
cd "$REPO_ROOT"

NANECISTO=0
ANO=0
FUNKCE="zadne"
ZAKLAD="origin/main"
SONDA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --nanecisto|--dry-run) NANECISTO=1 ;;
    --funkce) FUNKCE="${2:-}"; [ -n "$FUNKCE" ] || chyba "--funkce potřebuje hodnotu"; shift ;;
    --zaklad) ZAKLAD="${2:-}"; [ -n "$ZAKLAD" ] || chyba "--zaklad potřebuje git ref"; shift ;;
    --sonda) SONDA=1 ;;
    --ano|--yes) ANO=1 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) chyba "Neznámý přepínač: $1 (nápověda: --help)" ;;
  esac
  shift
done
export ANO

nacti_env_staging
hlidej_staging
vyzaduj_prikaz psql
je_lokalni_url "$STAGING_DB_URL" || vyzaduj_prikaz supabase

# ---------------------------------------------------------------------
# Pojistka linku: opis supabase/.temp, kontrola a návrat při každém konci
# ---------------------------------------------------------------------
TEMP_DIR="$REPO_ROOT/supabase/.temp"
ZALOHA_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/jobi-link-XXXXXX")"
LINK_PRED=""
if [ -d "$TEMP_DIR" ]; then
  cp -Rp "$TEMP_DIR/." "$ZALOHA_TEMP/"
  LINK_PRED="$(cat "$TEMP_DIR/project-ref" 2>/dev/null || true)"
fi
hlidej_link() {
  local ted
  ted="$(cat "$TEMP_DIR/project-ref" 2>/dev/null || true)"
  if [ "$ted" != "$LINK_PRED" ]; then
    varuj "CLI přepsalo link ($LINK_PRED → $ted). Vracím supabase/.temp do původního stavu."
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    cp -Rp "$ZALOHA_TEMP/." "$TEMP_DIR/"
    ted="$(cat "$TEMP_DIR/project-ref" 2>/dev/null || true)"
  fi
  rm -rf "$ZALOHA_TEMP"
  if [ -n "$LINK_PRED" ] && [ "$ted" != "$LINK_PRED" ]; then
    printf 'CHYBA: link se nepodařilo vrátit! supabase/.temp/project-ref = %s, má být %s. Oprav: supabase link --project-ref %s\n' "$ted" "$LINK_PRED" "$PROD_REF" >&2
    return
  fi
  if [ -n "$ted" ] && [ "$ted" != "$PROD_REF" ]; then
    varuj "Link CLI míří na $ted, ne na produkci ($PROD_REF) – bylo to tak už před spuštěním."
  else
    info ""
    info "Link CLI: ${ted:-není} $( [ "$ted" = "$PROD_REF" ] && echo '(produkce, beze změny)')"
  fi
}
trap hlidej_link EXIT

# ---------------------------------------------------------------------
krok "Staging"
# ---------------------------------------------------------------------
psql_staging -At -c "select 1" >/dev/null || chyba "Ke stagingu se nejde připojit (STAGING_DB_URL)."
if ma_znacku_stagingu; then
  psql_staging -At -c "select 'poslední obnova z produkce: ' || to_char(kdy, 'YYYY-MM-DD HH24:MI') || ', ' || zaloha
                          || case when dokonceno then '' else ' – NEDOBĚHLA' end
                     from jobi_staging.obnovy order by kdy desc limit 1" 2>/dev/null | sed 's/^/  /' || true
elif [ "${STAGING_BEZ_ZNACKY:-0}" = "1" ]; then
  varuj "Staging nemá značku jobi_staging (nikdy neprošel obnovou), pokračuji kvůli STAGING_BEZ_ZNACKY=1."
else
  chyba "Cílová databáze nemá značku jobi_staging. Buď ji nejdřív naplň (obnov-do-stagingu.sh), nebo – je-li to opravdu nový prázdný staging – spusť se STAGING_BEZ_ZNACKY=1."
fi

# Migrace z repozitáře, které staging ještě nemá (podle historie migrací).
MIGRACE_REPO="$(find supabase/migrations -maxdepth 1 -name '*.sql' -exec basename {} \; | sed -E 's/^([0-9]+)_.*/\1/' | sort)"
MIGRACE_STAGING="$(psql_staging -At -c "select version from supabase_migrations.schema_migrations order by 1" 2>/dev/null | sort || true)"
CEKAJICI="$(comm -23 <(echo "$MIGRACE_REPO") <(echo "$MIGRACE_STAGING") | sed '/^$/d')"
NAVIC="$(comm -13 <(echo "$MIGRACE_REPO") <(echo "$MIGRACE_STAGING") | sed '/^$/d')"
info "  migrací v repozitáři: $(echo "$MIGRACE_REPO" | grep -c . || true), na stagingu: $(echo "$MIGRACE_STAGING" | grep -c . || true)"
if [ -n "$CEKAJICI" ]; then
  info "  čeká na nasazení:"
  for v in $CEKAJICI; do info "    $(ls supabase/migrations/"$v"_*.sql | xargs -n1 basename)"; done
else
  info "  žádná nová migrace"
fi
if [ -n "$NAVIC" ]; then
  varuj "Staging má migrace, které v repozitáři nejsou: $(echo "$NAVIC" | tr '\n' ' ')– db push odmítne pokračovat. Buď chybí soubor (jiná větev?), nebo staging zkoušel migraci, která se zahodila: obnov staging z produkce."
fi

# ---------------------------------------------------------------------
krok "Migrace"
# ---------------------------------------------------------------------
if je_lokalni_url "$STAGING_DB_URL"; then
  varuj "Lokální zkouška: supabase db push se přeskakuje."
else
  # --dry-run vždycky: vypíše přesně to, co CLI pustí, ještě než se na něco sáhne.
  supabase db push --db-url "$STAGING_DB_URL" --dry-run
  if [ "$NANECISTO" = 0 ] && [ -n "$CEKAJICI" ]; then
    potvrd_ref "Pustit migrace výš na staging $STAGING_REF?"
    supabase db push --db-url "$STAGING_DB_URL" --yes
  fi
fi

# ---------------------------------------------------------------------
krok "Edge funkce"
# ---------------------------------------------------------------------
vsechny_funkce() {
  find supabase/functions -mindepth 2 -maxdepth 2 -name index.ts -exec dirname {} \; \
    | xargs -n1 basename | grep -v '^_' | sort
}
SEZNAM=""
case "$FUNKCE" in
  zadne|"") info "  žádné (--funkce zmenene | vse | jmeno1,jmeno2)" ;;
  vse) SEZNAM="$(vsechny_funkce)" ;;
  zmenene)
    git rev-parse --verify --quiet "$ZAKLAD" >/dev/null || chyba "Git ref $ZAKLAD neexistuje (git fetch?)."
    ZMENY="$( { git diff --name-only "$ZAKLAD" -- supabase/functions; \
                git ls-files --others --exclude-standard -- supabase/functions; } | sort -u)"
    if echo "$ZMENY" | grep -q '^supabase/functions/_shared/'; then
      info "  změna ve _shared – nasadí se všechny funkce"
      SEZNAM="$(vsechny_funkce)"
    else
      SEZNAM="$(echo "$ZMENY" | sed -nE 's#^supabase/functions/([^/_][^/]*)/.*#\1#p' | sort -u)"
    fi
    [ -n "$SEZNAM" ] || info "  proti $ZAKLAD se žádná funkce nezměnila"
    ;;
  *) SEZNAM="$(echo "$FUNKCE" | tr ',' '\n' | sed '/^$/d')" ;;
esac
for f in $SEZNAM; do
  [ -f "supabase/functions/$f/index.ts" ] || chyba "Funkce $f v supabase/functions není."
done
if [ -n "$SEZNAM" ]; then
  info "  funkce: $(echo "$SEZNAM" | tr '\n' ' ')"
  if [ "$NANECISTO" = 1 ] || je_lokalni_url "$STAGING_DB_URL"; then
    info "  (nanečisto – nic se nenasazuje)"
  else
    potvrd_ref "Nasadit $(echo "$SEZNAM" | grep -c .) funkcí na staging $STAGING_REF?"
    for f in $SEZNAM; do
      # --use-api: balí server Supabase, Docker není potřeba. verify_jwt se
      # bere ze supabase/config.toml jako u produkce.
      supabase functions deploy "$f" --project-ref "$STAGING_REF" --use-api
    done
  fi
fi

# ---------------------------------------------------------------------
krok "Kouřová zkouška"
# ---------------------------------------------------------------------
if [ "$NANECISTO" = 1 ]; then
  info "  nanečisto – přeskočeno"
  exit 0
fi
psql_staging -v ON_ERROR_STOP=1 -c "
select
  (select count(*) from supabase_migrations.schema_migrations) as migrace,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tabulky,
  (select count(*) from pg_policies where schemaname = 'public') as politiky,
  (select count(*) from pg_policies where schemaname = 'storage') as politiky_storage,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public') as realtime,
  (select count(*) from public.tickets) as zakazky;" | sed 's/^/  /'

ZBYVA="$(comm -23 <(echo "$MIGRACE_REPO") <(psql_staging -At -c "select version from supabase_migrations.schema_migrations order by 1" | sort) | sed '/^$/d')"
if [ -n "$ZBYVA" ] && ! je_lokalni_url "$STAGING_DB_URL"; then
  chyba "Na stagingu pořád chybí migrace: $(echo "$ZBYVA" | tr '\n' ' ')"
fi

# Stejné minimum jako zkouška obnovy: bez politik, funkcí a realtime by
# aplikace „fungovala“, jen by pouštěla každého všude nebo se nic nepropsalo.
psql_staging -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare n_politik int; n_funkci int; n_realtime int;
begin
  select count(*) into n_politik from pg_policies where schemaname = 'public';
  select count(*) into n_funkci from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
  select count(*) into n_realtime from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
  if n_politik < 100 then raise exception 'Na stagingu je jen % RLS politik', n_politik; end if;
  if n_funkci < 50 then raise exception 'Na stagingu je jen % funkcí', n_funkci; end if;
  if n_realtime < 15 then raise warning 'V publikaci supabase_realtime je jen % tabulek', n_realtime; end if;
end $$;
SQL
info "  schéma v pořádku"

if [ "$SONDA" = 1 ]; then
  info ""
  info "  Sonda oprávnění (scripts/rls-probe.sql, zápisy se vrací zpět):"
  # Sonda si vyrobí ladicí funkci a na posledním řádku ji zase zahodí.
  # Na stagingu jsou stejná ID testovacích lidí jako na produkci (ID se
  # anonymizací nemění), takže sonda platí beze změny.
  psql_staging -q -At -F '|' -v ON_ERROR_STOP=1 -f scripts/rls-probe.sql > "${TMPDIR:-/tmp}/jobi-sonda-$$.txt"
  awk -F'|' '
    $3 == "kontrola" { next }
    { ok = 0
      if ($3 == "nic")        ok = ($4 == "PROSLO:0")
      else if ($3 == "odmitnuto") ok = ($4 ~ /^ODMITNUTO/)
      else if ($3 == "projde" || $3 == "neco") ok = ($4 ~ /^PROSLO:[1-9]/)
      else ok = 1
      n++; if (!ok) { bad++; printf "    NESEDÍ %s %s: čekalo se %s, je %s\n", $1, $2, $3, $4 } }
    END { printf "    sond: %d, nesedí: %d\n", n, bad; exit (bad > 0) }' "${TMPDIR:-/tmp}/jobi-sonda-$$.txt" \
    || { rm -f "${TMPDIR:-/tmp}/jobi-sonda-$$.txt"; chyba "Sonda oprávnění hlásí rozdíly (výpis výš)."; }
  rm -f "${TMPDIR:-/tmp}/jobi-sonda-$$.txt"
fi

krok "Hotovo"
info "Staging má všechny migrace z repozitáře. Teď aplikaci vyzkoušej proti stagingu:"
info "  npm run dev:web:staging    (http://localhost:1432)"
info "  npm run tauri:dev:staging  (desktop)"
info "Až bude v pořádku: npx supabase db push --dry-run a pak npm run db:migrate (produkce)."
