#!/usr/bin/env bash
# =====================================================================
# spolecne.sh — sdílené pojistky pro skripty stagingu
# =====================================================================
# Načítá se přes `source` z obnov-do-stagingu.sh a migrace-na-staging.sh.
# Všechno, co by mohlo omylem sáhnout na produkci, se kontroluje TADY,
# jedním kusem kódu, ať se pojistky v jednotlivých skriptech nerozejdou.
#
# Produkční projekt: ijtvcgolsdsrquqbvjrz (tam míří .env a link CLI).
# =====================================================================

# Ref produkčního projektu. Přepsat jde jen proměnnou prostředí – kdyby se
# produkce někdy stěhovala, ať se nemusí hledat po skriptech.
PROD_REF="${JOBI_PROD_REF:-ijtvcgolsdsrquqbvjrz}"

STAGING_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

info()  { printf '%s\n' "$*"; }
krok()  { printf '\n=== %s ===\n' "$*"; }
varuj() { printf 'POZOR: %s\n' "$*" >&2; }
chyba() { printf 'CHYBA: %s\n' "$*" >&2; exit 1; }

# Načte .env.staging (nebo soubor v STAGING_ENV_SOUBOR). Proměnné, které už
# jsou nastavené v prostředí, mají přednost – v CI tak vyhrají secrets.
nacti_env_staging() {
  local soubor="${STAGING_ENV_SOUBOR:-$STAGING_REPO_ROOT/.env.staging}"
  [ -f "$soubor" ] || return 0
  local promenne=(STAGING_REF STAGING_DB_URL STAGING_TEST_PASSWORD STAGING_PONECHAT_EMAILY
                  STAGING_CRON BACKUP_PASSPHRASE SUPABASE_ACCESS_TOKEN JOBI_GH_REPO)
  local p ulozene=()
  for p in "${promenne[@]}"; do
    if [ -n "${!p+x}" ]; then ulozene+=("$p=${!p}"); fi
  done
  set -a
  # shellcheck disable=SC1090
  . "$soubor"
  set +a
  local u
  for u in ${ulozene[@]+"${ulozene[@]}"}; do
    export "${u%%=*}=${u#*=}"
  done
}

# Je adresa databáze lokální (zkouška skriptu nad vlastním Postgresem)?
je_lokalni_url() {
  case "$1" in
    *@127.0.0.1[:/]*|*@localhost[:/]*|postgresql://127.0.0.1*|postgresql://localhost*|postgres://127.0.0.1*|postgres://localhost*) return 0 ;;
    *) return 1 ;;
  esac
}

# Hlavní pojistka: STAGING_REF a STAGING_DB_URL musí ukazovat na staging,
# nikdy na produkci. Lokální Postgres (127.0.0.1/localhost) je povolený jen
# se STAGING_LOKALNI=1 – slouží ke zkoušce skriptů nanečisto.
hlidej_staging() {
  [ -n "${STAGING_DB_URL:-}" ] || chyba "Chybí STAGING_DB_URL (connection string stagingu). Vzor je v .env.staging.example, postup v docs/STAGING.md."
  if je_lokalni_url "$STAGING_DB_URL"; then
    [ "${STAGING_LOKALNI:-0}" = "1" ] || chyba "STAGING_DB_URL míří na lokální Postgres. To je povolené jen pro zkoušku skriptu se STAGING_LOKALNI=1."
    STAGING_REF="${STAGING_REF:-lokalnizkouska}"
    varuj "Lokální zkouška: cíl je lokální Postgres, ne Supabase."
    return 0
  fi
  [ -n "${STAGING_REF:-}" ] || chyba "Chybí STAGING_REF (ref projektu stagingu, 20 malých písmen z adresy v Dashboardu)."
  [[ "$STAGING_REF" =~ ^[a-z]{20}$ ]] || chyba "STAGING_REF='$STAGING_REF' nevypadá jako ref projektu Supabase (20 malých písmen)."
  [ "$STAGING_REF" != "$PROD_REF" ] || chyba "STAGING_REF je ref PRODUKCE ($PROD_REF). Tohle skript nikdy neudělá."
  case "$STAGING_DB_URL" in
    *"$PROD_REF"*) chyba "STAGING_DB_URL obsahuje ref PRODUKCE ($PROD_REF). Zkontroluj .env.staging." ;;
  esac
  case "$STAGING_DB_URL" in
    *"$STAGING_REF"*) ;;
    *) chyba "STAGING_DB_URL neobsahuje STAGING_REF ($STAGING_REF). Pooler má uživatele postgres.<ref>, přímé připojení host db.<ref>.supabase.co – jinak nejde ověřit, kam se připojujeme." ;;
  esac
  # Druhá strana: .env aplikace nemá mířit na staging, jinak by se po
  # „vrácení“ na produkci pracovalo dál proti stagingu, aniž by si toho kdo všiml.
  if [ -f "$STAGING_REPO_ROOT/.env" ] && grep -q "$STAGING_REF" "$STAGING_REPO_ROOT/.env"; then
    varuj ".env míří na staging ($STAGING_REF). Proti stagingu se pouští npm run dev:staging / dev:web:staging, .env patří produkci."
  fi
}

# psql proti stagingu bez uživatelského ~/.psqlrc (mohl by měnit výstup).
psql_staging() { psql "$STAGING_DB_URL" -X "$@"; }

# Značka, že databázi naplnil obnov-do-stagingu.sh. Produkce ji nikdy nemá,
# takže podle ní skripty poznají, že jsou opravdu na stagingu.
ma_znacku_stagingu() {
  local v
  v=$(psql_staging -At -c "select to_regclass('jobi_staging.obnovy') is not null" 2>/dev/null) || return 1
  [ "$v" = "t" ]
}

# Počet řádků tabulky na stagingu, -1 když tabulka není. Dotaz jde přes
# query_to_xml, aby chybějící tabulka neshodila parser celého dotazu.
pocet_radku() {
  psql_staging -At -v ON_ERROR_STOP=1 -c "select case when to_regclass('$1') is null then -1
    else (xpath('/row/n/text()', query_to_xml('select count(*) as n from $1', false, true, '')))[1]::text::bigint end"
}

vyzaduj_prikaz() {
  local p
  for p in "$@"; do
    command -v "$p" >/dev/null 2>&1 || chyba "Chybí příkaz '$p'. $(napoveda_instalace "$p")"
  done
}

napoveda_instalace() {
  case "$1" in
    psql) echo "Nainstaluj klienta: brew install libpq (nebo postgresql@17)." ;;
    supabase) echo "Nainstaluj CLI: brew install supabase/tap/supabase." ;;
    gh) echo "Nainstaluj: brew install gh a přihlas se: gh auth login." ;;
    gpg) echo "Nainstaluj: brew install gnupg." ;;
    python3) echo "Python 3 je na macOS i v CI; jinak brew install python." ;;
    *) echo "" ;;
  esac
}

# Potvrzení před zápisem: napsat ref stagingu. Přeskočí se s --ano (CI).
potvrd_ref() {
  local zprava="$1"
  if [ "${ANO:-0}" = "1" ]; then return 0; fi
  if [ ! -t 0 ]; then chyba "Není terminál pro potvrzení. Spusť s --ano, pokud víš, co děláš."; fi
  printf '\n%s\nPro potvrzení napiš ref stagingu (%s): ' "$zprava" "$STAGING_REF"
  local odpoved
  read -r odpoved
  [ "$odpoved" = "$STAGING_REF" ] || chyba "Nepotvrzeno, nic se nezměnilo."
}
