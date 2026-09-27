#!/usr/bin/env bash
# Obnova souborů ze zálohy v Cloudflare R2 zpátky do Supabase Storage.
#
# Zálohu dělá scripts/backup-storage.sh (denně .github/workflows/backup-storage.yml).
# Celý postup po havárii: docs/OBNOVA_ZE_ZALOHY.md, kapitola 5.
#
# Použití:
#   bash scripts/obnov-storage.sh [volby]
#
#   (bez voleb)          poslední stav: všechno z aktualni/ – typicky do NOVÉHO projektu
#   --kos RRRR-MM-DD     jen soubory, které ten den z produkce zmizely nebo se
#                        přepsaly (smazane/<datum>/) – „někdo smazal fotky"
#   --stav RRRR-MM-DD    stav souborů ke konci daného dne (UTC): zrcadlo bez
#                        souborů nahraných později, doplněné o verze z koše
#                        všech pozdějších dnů. Jde jen 30 dní zpátky.
#   --bucket JMENO       jen tenhle bucket (jde opakovat); jinak všechny
#   --jen-chybejici      nepřepisovat, co v cíli už je. Výchozí u --kos
#                        (obnova do ostrého projektu, kde zbytek souborů žije).
#                        POZOR: nepoužívat po obnově databáze do nového
#                        projektu – viz níž.
#   --prepsat            přepsat i existující soubory. Výchozí bez voleb
#                        a u --stav; u --kos vrátí i přepsané starší verze.
#   --nanecisto          jen vypsat, co by se nahrálo
#   --rychle-overeni     po nahrání porovnat jen velikosti, ne obsah
#   --ano                neptat se na potvrzení (jen pro skripty)
#
# Proměnné prostředí (záměrně jiné názvy než u zálohy, ať se obnova
# nepustí omylem proti produkci jen proto, že v shellu zůstaly její klíče):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (výchozí jobi-zaloha-storage)
#   CIL_S3_ACCESS_KEY, CIL_S3_SECRET_KEY    S3 klíče CÍLOVÉHO projektu
#                                           (Dashboard → Storage → S3 access keys)
#   CIL_S3_ENDPOINT                         nebo CIL_SUPABASE_URL, ze které se odvodí
#   CIL_S3_REGION                           výchozí eu-west-1
#   CIL_DB_URL                              volitelně: connection string cílového
#                                           projektu – chybějící buckety se pak
#                                           založí se stejným nastavením jako v produkci
#
# Proč se ve výchozím stavu přepisuje: po obnově databáze (data.sql) už
# v novém projektu je evidence souborů (storage.objects) a S3 výpis Storage
# se bere z ní. Soubory pak „existují", i když jejich obsah chybí, a volba
# --jen-chybejici by nenahrála nic.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=zaloha-storage-spolecne.sh
. "$SCRIPT_DIR/zaloha-storage-spolecne.sh"

REZIM=aktualni
DATUM=""
VYBRANE=()
PREPIS=auto
NANECISTO=0
RYCHLE=0
ANO=0

napoveda() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; }

over_datum() {
  case "$1" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) chyba "Datum '$1' není ve tvaru RRRR-MM-DD."; exit 1 ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kos) REZIM=kos; DATUM="${2:-}"; over_datum "$DATUM"; shift 2 ;;
    --stav) REZIM=stav; DATUM="${2:-}"; over_datum "$DATUM"; shift 2 ;;
    --bucket) over_nazev_bucketu "${2:-}"; VYBRANE+=("$2"); shift 2 ;;
    --jen-chybejici) PREPIS=0; shift ;;
    --prepsat) PREPIS=1; shift ;;
    --nanecisto) NANECISTO=1; shift ;;
    --rychle-overeni) RYCHLE=1; shift ;;
    --ano) ANO=1; shift ;;
    -h|--help) napoveda; exit 0 ;;
    *) chyba "Neznámá volba '$1'. Nápověda: bash scripts/obnov-storage.sh --help"; exit 1 ;;
  esac
done

potrebuju rclone python3

chybi=""
for p in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY CIL_S3_ACCESS_KEY CIL_S3_SECRET_KEY; do
  [ -z "${!p:-}" ] && chybi="$chybi $p"
done
if [ -n "$chybi" ]; then
  chyba "Chybí:$chybi. Viz hlavička skriptu a docs/OBNOVA_ZE_ZALOHY.md."
  exit 1
fi
R2_BUCKET="${R2_BUCKET:-jobi-zaloha-storage}"
CIL_S3_REGION="${CIL_S3_REGION:-eu-west-1}"
if [ -z "${CIL_S3_ENDPOINT:-}" ]; then
  if ! CIL_S3_ENDPOINT="$(s3_endpoint_z_url "${CIL_SUPABASE_URL:-}")"; then
    chyba "Chybí CIL_S3_ENDPOINT nebo CIL_SUPABASE_URL (https://<ref>.supabase.co cílového projektu)."
    exit 1
  fi
fi
CIL_REF="$(printf '%s' "$CIL_S3_ENDPOINT" | sed -E 's#^https?://([^.]+)\..*$#\1#')"

PRACOVNI="$(mktemp -d)"
trap 'rm -rf "$PRACOVNI"' EXIT
izoluj_rclone "$PRACOVNI"
nastav_r2
nastav_supabase_s3 CIL "$CIL_S3_ACCESS_KEY" "$CIL_S3_SECRET_KEY" "$CIL_S3_ENDPOINT" "$CIL_S3_REGION"
export TZ=UTC

ZDROJ="r2:$R2_BUCKET"
RCLONE_ZAKLAD=(--fast-list --checkers 16 --transfers 8 --retries 5 --low-level-retries 10
               --stats 30s --stats-one-line --stats-log-level NOTICE)
RCLONE_SPOLECNE=("${RCLONE_ZAKLAD[@]}")
[ "$NANECISTO" = 1 ] && RCLONE_SPOLECNE+=(--dry-run)
if [ "$PREPIS" = auto ]; then
  if [ "$REZIM" = kos ]; then PREPIS=0; else PREPIS=1; fi
fi
if [ "$PREPIS" = 0 ]; then
  NAHRANI=(--ignore-existing)
else
  # Nahrát vždy, i když cíl hlásí stejnou velikost – viz hlavička.
  NAHRANI=(--ignore-times)
fi

# --- Které buckety -----------------------------------------------------------
case "$REZIM" in
  aktualni) KOREN="$ZDROJ/aktualni" ;;
  kos)      KOREN="$ZDROJ/smazane/$DATUM" ;;
  stav)     KOREN="$ZDROJ/aktualni" ;;
esac
if [ "${#VYBRANE[@]}" -gt 0 ]; then
  BUCKETY=("${VYBRANE[@]}")
else
  BUCKETY=()
  while IFS= read -r d; do
    d="${d%/}"
    [ -z "$d" ] && continue
    over_nazev_bucketu "$d"
    BUCKETY+=("$d")
  done < <(rclone lsf --dirs-only "$KOREN")
fi
if [ "$REZIM" = stav ]; then
  # Dny v koši novější než požadovaný stav, od nejnovějšího. Nejstarší
  # (nejbližší požadovanému dni) se nakopíruje poslední a vyhraje.
  rclone lsf --dirs-only "$ZDROJ/smazane" | tr -d / \
    | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort > "$PRACOVNI/dny.txt" || true
  VRSTVY=()
  while IFS= read -r d; do
    [[ "$d" > "$DATUM" ]] && VRSTVY+=("$d")
  done < <(sort -r "$PRACOVNI/dny.txt")
  NEJSTARSI="$(head -n 1 "$PRACOVNI/dny.txt")"
  if [ -n "$NEJSTARSI" ] && [[ "$DATUM" < "$NEJSTARSI" ]]; then
    varovani "Nejstarší den v koši je $NEJSTARSI. Stav k $DATUM už nejde složit přesně – soubory smazané před $NEJSTARSI jsou pryč."
  fi
  DALSI_DEN="$(python3 -c 'import datetime,sys; print((datetime.date.fromisoformat(sys.argv[1]) + datetime.timedelta(days=1)).isoformat())' "$DATUM")"
fi
if [ "${#BUCKETY[@]}" -eq 0 ]; then
  chyba "V $KOREN není žádný bucket – nic k obnově."
  exit 1
fi

echo "Obnova souborů ze zálohy"
echo "  zdroj:   $KOREN  (režim $REZIM${DATUM:+, $DATUM})"
[ "$REZIM" = stav ] && echo "  vrstvy z koše: ${VRSTVY[*]:-žádné}; soubory změněné od $DALSI_DEN se vynechají"
echo "  cíl:     projekt $CIL_REF ($CIL_S3_ENDPOINT)"
echo "  buckety: ${BUCKETY[*]}"
echo "  přepisovat existující: $([ "$PREPIS" = 0 ] && echo ne || echo ano)"
[ "$NANECISTO" = 1 ] && echo "  NANEČISTO – nic se nenahraje"

if [ "$ANO" != 1 ] && [ "$NANECISTO" != 1 ]; then
  printf '\nNapiš ref cílového projektu (%s) pro potvrzení: ' "$CIL_REF"
  read -r odpoved
  if [ "$odpoved" != "$CIL_REF" ]; then
    echo "Nepotvrzeno, končím."
    exit 1
  fi
fi

# --- Buckety v cíli ----------------------------------------------------------
# Přes S3 by vznikly neveřejné a bez limitů. Proto se zakládají podle
# evidence ze zálohy (metadata/buckety.json), když je k dispozici databáze.
BUCKETY_JSON="$ZDROJ/metadata/buckety.json"
if [ -n "$DATUM" ] && rclone lsf "$ZDROJ/denik/$DATUM/buckety.json" >/dev/null 2>&1; then
  BUCKETY_JSON="$ZDROJ/denik/$DATUM/buckety.json"
fi
if [ -n "${CIL_DB_URL:-}" ] && [ "$NANECISTO" != 1 ]; then
  potrebuju psql
  json="$(rclone cat "$BUCKETY_JSON")"
  psql "$CIL_DB_URL" -X -q -v ON_ERROR_STOP=1 -v buckety="$json" -f - <<'SQL'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select id, name, public, file_size_limit, allowed_mime_types
  from json_to_recordset(:'buckety'::json)
       as x(id text, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])
on conflict (id) do nothing;
SQL
  echo "Buckety v cíli doplněné podle $BUCKETY_JSON (existující se nemění)."
fi
EXISTUJICI="$(rclone lsf --dirs-only CIL: 2>/dev/null || true)"
for b in "${BUCKETY[@]}"; do
  if ! printf '%s\n' "$EXISTUJICI" | grep -qx -- "$b/"; then
    if [ "$NANECISTO" = 1 ]; then
      varovani "Bucket $b v cíli není – při ostré obnově ho založ (CIL_DB_URL nebo Dashboard)."
    else
      chyba "Bucket $b v cílovém projektu není. Nastav CIL_DB_URL (založí se podle zálohy), nebo ho vytvoř v Dashboardu se stejným nastavením – viz $BUCKETY_JSON."
      exit 1
    fi
  fi
done

# --- Nahrání -----------------------------------------------------------------
CHYBY=""
for b in "${BUCKETY[@]}"; do
  echo ""
  echo "== $b"
  if [ "$REZIM" = stav ]; then
    # Stav se skládá lokálně: vrstvy jdou přes sebe v pořadí, ve kterém
    # platily, a do cíle se pak nahraje jen výsledek.
    slozka="$PRACOVNI/stav/$b"
    mkdir -p "$slozka"
    # Skládá se i nanečisto (jen čtení z R2 do dočasné složky), ať je vidět,
    # co by se nahrálo.
    rclone copy "$ZDROJ/aktualni/$b" "$slozka" --min-age "${DALSI_DEN}T00:00:00Z" \
      "${RCLONE_ZAKLAD[@]}" || { CHYBY="$CHYBY $b"; continue; }
    vrstva_chyba=0
    for v in ${VRSTVY[@]+"${VRSTVY[@]}"}; do
      # Den, kdy se v tomhle bucketu nic nesmazalo, v koši složku nemá.
      rclone lsf --dirs-only "$ZDROJ/smazane/$v" | grep -qx -- "$b/" || continue
      rclone copy "$ZDROJ/smazane/$v/$b" "$slozka" --min-age "${DALSI_DEN}T00:00:00Z" --ignore-times \
        "${RCLONE_ZAKLAD[@]}" || vrstva_chyba=1
    done
    if [ "$vrstva_chyba" = 1 ]; then CHYBY="$CHYBY $b"; continue; fi
    ZDROJ_B="$slozka"
  else
    ZDROJ_B="$KOREN/$b"
  fi
  rclone copy "$ZDROJ_B" "CIL:$b" "${NAHRANI[@]}" "${RCLONE_SPOLECNE[@]}" || { CHYBY="$CHYBY $b"; continue; }

  if [ "$NANECISTO" != 1 ]; then
    # Ověření: bez --download by se u projektu obnoveného z data.sql
    # porovnávala jen evidence v databázi, ne skutečný obsah souborů.
    over=(--one-way --download)
    [ "$RYCHLE" = 1 ] && over=(--one-way --size-only)
    rclone check "$ZDROJ_B" "CIL:$b" "${over[@]}" --fast-list --checkers 8 || CHYBY="$CHYBY $b(ověření)"
  fi
  [ "$REZIM" = stav ] && rm -rf "$slozka"
done

echo ""
if [ -n "$CHYBY" ]; then
  chyba "Obnova se nepovedla celá:$CHYBY"
  exit 1
fi
if [ "$NANECISTO" = 1 ]; then
  echo "Nanečisto hotovo."
else
  echo "Hotovo. Zkontroluj v aplikaci fotku u některé zakázky (docs/OBNOVA_ZE_ZALOHY.md, kontrolní seznam)."
fi
