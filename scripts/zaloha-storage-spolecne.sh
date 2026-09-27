# shellcheck shell=bash
# Společné kousky zálohy a obnovy souborů ze Supabase Storage.
# Načítají ho scripts/backup-storage.sh a scripts/obnov-storage.sh (source),
# samostatně se nespouští.
#
# rclone se tu nastavuje jen proměnnými prostředí (RCLONE_CONFIG_<JMENO>_<VOLBA>),
# žádný konfigurační soubor s klíči na disku nevzniká. Případný vlastní
# ~/.config/rclone/rclone.conf se schválně nečte, aby se do zálohy nepřimíchal
# stejnojmenný remote odjinud.

TAB="$(printf '\t')"

chyba() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; else echo "CHYBA: $*" >&2; fi
}

varovani() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; else echo "POZOR: $*" >&2; fi
}

potrebuju() {
  local chybi="" p
  for p in "$@"; do
    command -v "$p" >/dev/null 2>&1 || chybi="$chybi $p"
  done
  if [ -n "$chybi" ]; then
    chyba "Chybí program:$chybi. rclone: brew install rclone / https://rclone.org/downloads/, psql: brew install libpq."
    exit 1
  fi
}

# Prázdný konfigurační soubor rclone – všechno ostatní jde z proměnných.
izoluj_rclone() {
  local adresar="$1"
  export RCLONE_CONFIG="$adresar/rclone.conf"
  : > "$RCLONE_CONFIG"
}

# Cloudflare R2 jako remote „r2".
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
nastav_r2() {
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_REGION=auto
  export RCLONE_CONFIG_R2_ACL=private
  # Token R2 omezený na jeden bucket nesmí buckety vypisovat ani zakládat;
  # bez tohohle by rclone před prvním nahráním zkoušel bucket vytvořit.
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
}

# Adresa S3 rozhraní Supabase Storage z adresy projektu
# (https://<ref>.supabase.co → https://<ref>.storage.supabase.co/storage/v1/s3).
s3_endpoint_z_url() {
  local url="$1" ref
  ref="$(printf '%s' "$url" | sed -E 's#^https?://([a-z0-9]+)\.supabase\.(co|in)/?.*$#\1#')"
  if [ -z "$ref" ] || [ "$ref" = "$url" ]; then
    return 1
  fi
  printf 'https://%s.storage.supabase.co/storage/v1/s3' "$ref"
}

# Supabase Storage přes S3 protokol jako remote s daným jménem.
#   $1 jméno remotu velkými písmeny (SUPA, CIL), $2 klíč, $3 tajemství,
#   $4 endpoint, $5 region projektu
nastav_supabase_s3() {
  local jmeno="$1"
  export "RCLONE_CONFIG_${jmeno}_TYPE=s3"
  export "RCLONE_CONFIG_${jmeno}_PROVIDER=Other"
  export "RCLONE_CONFIG_${jmeno}_ACCESS_KEY_ID=$2"
  export "RCLONE_CONFIG_${jmeno}_SECRET_ACCESS_KEY=$3"
  export "RCLONE_CONFIG_${jmeno}_ENDPOINT=$4"
  # Supabase chce region projektu (Settings → General), jinak podpis nesedí.
  export "RCLONE_CONFIG_${jmeno}_REGION=$5"
  export "RCLONE_CONFIG_${jmeno}_FORCE_PATH_STYLE=true"
  # Supabase umí ListObjectsV2; rclone by u neznámého poskytovatele sáhl po v1.
  export "RCLONE_CONFIG_${jmeno}_LIST_VERSION=2"
  # Buckety se nezakládají přes S3 (vznikly by neveřejné a bez limitů),
  # ale z evidence buckets.json – viz obnov-storage.sh.
  export "RCLONE_CONFIG_${jmeno}_NO_CHECK_BUCKET=true"
}

# Název bucketu jde do SQL i do cest; Supabase povoluje jen tyhle znaky,
# a kdyby se objevilo něco jiného, radši skončit než skládat dotaz.
over_nazev_bucketu() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*)
      chyba "Podivný název bucketu '$1' – skript s ním neumí bezpečně pracovat."
      exit 1 ;;
  esac
}

# rclone lsf nad prázdnou „složkou" v S3 skončí chybou directory not found.
# Pro nás je to prázdný seznam, jiná chyba je chyba.
vypis_r2() {
  local cesta="$1"; shift
  local err
  err="$(mktemp)"
  if ! rclone lsf -R --files-only --fast-list --separator "$TAB" "$@" "$cesta" 2>"$err"; then
    if grep -qi "directory not found" "$err"; then
      rm -f "$err"
      return 0
    fi
    cat "$err" >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
}
