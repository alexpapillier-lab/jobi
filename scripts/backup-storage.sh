#!/usr/bin/env bash
# Záloha souborů ze Supabase Storage do Cloudflare R2.
#
# Databázi zálohuje .github/workflows/backup-db.yml (scripts/backup-db.sh) –
# v jejím dumpu je ale jen EVIDENCE souborů (storage.objects), ne samotné
# fotky, podpisy a obrázky. Tenhle skript zrcadlí obsah všech bucketů do R2.
# Denně ho pouští .github/workflows/backup-storage.yml, stejně dobře ho jde
# pustit ručně. Postup obnovy: scripts/obnov-storage.sh, docs/OBNOVA_ZE_ZALOHY.md.
#
# Rozložení v R2 (bucket jobi-zaloha-storage):
#   aktualni/<bucket>/<cesta>          zrcadlo produkce po posledním běhu
#   smazane/<RRRR-MM-DD>/<bucket>/…    co ten den z produkce zmizelo nebo se
#                                      přepsalo (rclone --backup-dir); R2 to
#                                      po 30 dnech smaže samo (lifecycle)
#   metadata/buckety.json, objekty.tsv nastavení bucketů a evidence z databáze
#   denik/<RRRR-MM-DD>/…               totéž k danému dni (lifecycle 30 dní)
#
# Dvě cesty, jak soubory ze Supabase dostat:
#   s3    (preferovaná) S3 protokol Storage + rclone sync. Inkrementální,
#         kopíruje jen změny, mazání a přepisy odkládá do smazane/<datum>.
#   rest  (náhradní) když S3 klíče nejsou: seznam z databáze, stažení změn
#         přes REST API se service role klíčem, nahrání rclone copy.
#
# Po synchronizaci se R2 porovná s storage.objects v databázi. Když nesedí,
# skript skončí chybou (a workflow spadne).
#
# Proměnné prostředí:
#   SUPABASE_DB_URL            vždy (evidence souborů, ověření)
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   vždy
#   R2_BUCKET                  výchozí jobi-zaloha-storage
#   SUPABASE_S3_ACCESS_KEY, SUPABASE_S3_SECRET_KEY         cesta s3
#   SUPABASE_S3_ENDPOINT       nebo SUPABASE_URL, ze které se odvodí
#   SUPABASE_S3_REGION         výchozí eu-west-1 (region projektu Jobi)
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY                cesta rest
#   ZALOHA_REZIM               auto (výchozí) | s3 | rest
#   NANECISTO=1                rclone --dry-run, nic se nezapíše, neověřuje se
#   ZALOHA_PLNE_POROVNANI=1    s3: porovnat i časy změn z metadat (pomalejší,
#                              HEAD na každý soubor) – když ověření hlásí
#                              jinou velikost a běžný běh to nespraví
#   ZALOHA_POVOLIT_HROMADNE_MAZANI=1   pustit synchronizaci, i když databáze
#                              eviduje méně než polovinu souborů ze zálohy
#   ZALOHA_TOLERANCE_POCET     výchozí 5 souborů
#   ZALOHA_TOLERANCE_PROCENT   výchozí 1 (celé číslo, procenta)
#
# Lokálně:
#   export SUPABASE_DB_URL=… R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
#   export SUPABASE_S3_ACCESS_KEY=… SUPABASE_S3_SECRET_KEY=… SUPABASE_URL=https://<ref>.supabase.co
#   NANECISTO=1 bash scripts/backup-storage.sh     # nejdřív nanečisto

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=zaloha-storage-spolecne.sh
. "$SCRIPT_DIR/zaloha-storage-spolecne.sh"
POMOCNIK="$SCRIPT_DIR/zaloha-storage.py"

potrebuju rclone psql python3

R2_BUCKET="${R2_BUCKET:-jobi-zaloha-storage}"
REZIM="${ZALOHA_REZIM:-auto}"
NANECISTO="${NANECISTO:-0}"
TOL_POCET="${ZALOHA_TOLERANCE_POCET:-5}"
TOL_PROCENT="${ZALOHA_TOLERANCE_PROCENT:-1}"
SUPABASE_S3_REGION="${SUPABASE_S3_REGION:-eu-west-1}"

# --- Kontrola vstupů ---------------------------------------------------------
chybi=""
for p in SUPABASE_DB_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  [ -z "${!p:-}" ] && chybi="$chybi $p"
done
if [ -n "$chybi" ]; then
  chyba "Chybí:$chybi. Postup je v docs/ZALOHY_DATABAZE.md, kapitola 7."
  exit 1
fi

ma_s3=0
[ -n "${SUPABASE_S3_ACCESS_KEY:-}" ] && [ -n "${SUPABASE_S3_SECRET_KEY:-}" ] && ma_s3=1
ma_rest=0
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && [ -n "${SUPABASE_URL:-}" ] && ma_rest=1

if [ "$REZIM" = "auto" ]; then
  if [ "$ma_s3" = 1 ]; then REZIM=s3
  elif [ "$ma_rest" = 1 ]; then REZIM=rest
  else
    chyba "Chybí přístup ke Storage: buď SUPABASE_S3_ACCESS_KEY + SUPABASE_S3_SECRET_KEY (preferováno), nebo SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL."
    exit 1
  fi
fi
case "$REZIM" in
  s3)
    if [ "$ma_s3" != 1 ]; then chyba "Režim s3 potřebuje SUPABASE_S3_ACCESS_KEY a SUPABASE_S3_SECRET_KEY."; exit 1; fi
    if [ -z "${SUPABASE_S3_ENDPOINT:-}" ]; then
      if ! SUPABASE_S3_ENDPOINT="$(s3_endpoint_z_url "${SUPABASE_URL:-}")"; then
        chyba "Chybí SUPABASE_S3_ENDPOINT a z SUPABASE_URL ('${SUPABASE_URL:-}') ho neumím odvodit."
        exit 1
      fi
    fi ;;
  rest)
    if [ "$ma_rest" != 1 ]; then chyba "Režim rest potřebuje SUPABASE_SERVICE_ROLE_KEY a SUPABASE_URL."; exit 1; fi
    varovani "Záloha jde náhradní cestou přes REST API. Rychlejší a spolehlivější je S3 protokol – klíče se generují v Dashboardu → Storage → S3 access keys." ;;
  *) chyba "Neznámý ZALOHA_REZIM '$REZIM' (auto | s3 | rest)."; exit 1 ;;
esac

PRACOVNI="$(mktemp -d)"
trap 'rm -rf "$PRACOVNI"' EXIT
izoluj_rclone "$PRACOVNI"
nastav_r2
[ "$REZIM" = s3 ] && nastav_supabase_s3 SUPA "$SUPABASE_S3_ACCESS_KEY" "$SUPABASE_S3_SECRET_KEY" "$SUPABASE_S3_ENDPOINT" "$SUPABASE_S3_REGION"
export TZ=UTC

sql() {
  psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -At -F "$TAB" -c "$1"
}

DATUM="$(date -u +%Y-%m-%d)"
# Začátek podle hodin databáze, ne runneru: s ním se pak porovnává
# storage.objects.updated_at a posun hodin by dělal falešné chyby.
START="$(sql "select now()")"
CIL="r2:$R2_BUCKET/aktualni"
KOS="r2:$R2_BUCKET/smazane/$DATUM"
DENIK="r2:$R2_BUCKET/denik/$DATUM"

RCLONE_SPOLECNE=(--fast-list --checkers 16 --transfers 8 --retries 5 --low-level-retries 10
                 --stats 1m --stats-one-line --stats-log-level NOTICE)
[ "$NANECISTO" = 1 ] && RCLONE_SPOLECNE+=(--dry-run)

echo "Režim: $REZIM, cíl: r2:$R2_BUCKET, datum koše: $DATUM, začátek: $START"
[ "$NANECISTO" = 1 ] && echo "NANEČISTO – nic se nezapíše."

# --- Co je v databázi --------------------------------------------------------
# Novější Storage má verzování (is_delete_marker, archived_at). Staré verze
# a značky smazání S3 nevypíše, takže se nesmí počítat ani tady.
ZIVE="$(sql "select coalesce(string_agg(podminka, ' and '), 'true') from (
  select case column_name
           when 'is_delete_marker' then 'not coalesce(o.is_delete_marker, false)'
           when 'archived_at' then 'o.archived_at is null' end as podminka
    from information_schema.columns
   where table_schema = 'storage' and table_name = 'objects'
     and column_name in ('is_delete_marker', 'archived_at')) x")"
# Analytické buckety (Iceberg) nejsou soubory, přes S3 je nevypíšeš.
STANDARDNI="$(sql "select case when exists (select 1 from information_schema.columns
   where table_schema = 'storage' and table_name = 'buckets' and column_name = 'type')
   then 'b.type::text = ''STANDARD''' else 'true' end")"

sql "select b.id from storage.buckets b where $STANDARDNI order by b.id" > "$PRACOVNI/buckety.txt"
BUCKETY=()
while IFS= read -r b; do
  [ -z "$b" ] && continue
  over_nazev_bucketu "$b"
  BUCKETY+=("$b")
done < "$PRACOVNI/buckety.txt"
if [ "${#BUCKETY[@]}" -eq 0 ]; then
  chyba "V storage.buckets není žádný bucket – to u Jobi nesedí, nezálohuji nic."
  exit 1
fi
echo "Buckety: ${BUCKETY[*]}"

sql "select coalesce(json_agg(json_build_object(
        'id', b.id, 'name', b.name, 'public', b.public,
        'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types)
        order by b.id), '[]'::json)
       from storage.buckets b where $STANDARDNI" > "$PRACOVNI/buckety.json"
sql "select o.bucket_id, o.name, coalesce(o.metadata->>'size', ''), coalesce(o.metadata->>'mimetype', ''),
            coalesce(o.updated_at, o.created_at)
       from storage.objects o join storage.buckets b on b.id = o.bucket_id
      where $ZIVE and $STANDARDNI order by 1, 2" > "$PRACOVNI/objekty.tsv"

# Buckety, které v produkci už nejsou, se v R2 nechávají být – zrušený
# bucket je přesně ta chvíle, kdy se záloha hodí. Jen se o nich řekne.
while IFS= read -r d; do
  d="${d%/}"
  [ -z "$d" ] && continue
  printf '%s\n' "${BUCKETY[@]}" | grep -qx -- "$d" || \
    varovani "Bucket '$d' je v záloze, ale v produkci už ne. Záloha zůstává v aktualni/$d, nic se nemaže."
done < <(rclone lsf --dirs-only "$CIL" 2>/dev/null || true)

CHYBY=""

# Druhá pojistka, proti opačné chybě: databáze eviduje mnohem míň souborů,
# než je v záloze. Stane se to, když secrets ukazují na nový prázdný projekt
# (po havárii, před obnovou souborů) – sync by celé zrcadlo přesunul do koše
# a za 30 dní by R2 zálohu smazalo. Skutečné hromadné mazání (zrušený servis)
# se pustí ručně s ZALOHA_POVOLIT_HROMADNE_MAZANI=1.
pojistka_mazani() {
  local b="$1" pocet_db="$2" pocet_r2
  [ "${ZALOHA_POVOLIT_HROMADNE_MAZANI:-0}" = 1 ] && return 0
  pocet_r2="$(vypis_r2 "$CIL/$b" --format p | wc -l | tr -d ' ')" || return 1
  if [ "$pocet_r2" -gt 20 ] && [ $(( pocet_db * 2 )) -lt "$pocet_r2" ]; then
    chyba "Bucket $b: v záloze je $pocet_r2 souborů, databáze eviduje jen $pocet_db. Nesynchronizuji – je to nový projekt, nebo se opravdu smazala víc než polovina? (docs/ZALOHY_DATABAZE.md kap. 7)"
    return 1
  fi
}

# --- Cesta s3: rclone sync ---------------------------------------------------
zaloha_s3() {
  local b="$1" pocet_db pocet_src tol
  pocet_db="$(sql "select count(*) from storage.objects o where o.bucket_id = '$b' and $ZIVE")" || return 1
  # Pojistka před synchronizací: kdyby S3 vrátilo míň souborů, než eviduje
  # databáze (odebraná práva klíče, výpadek výpisu), sync by „chybějící"
  # soubory odklidil ze zrcadla do koše. Radši nesynchronizovat vůbec.
  pocet_src="$(rclone size "supa:$b" --fast-list --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])')" || {
    chyba "Bucket $b: přes S3 se nepodařilo vypsat soubory (klíče, endpoint, region?)."
    return 1
  }
  case "$pocet_db$pocet_src" in
    *[!0-9]*|'') chyba "Bucket $b: nečíselný počet souborů (DB '$pocet_db', S3 '$pocet_src')."; return 1 ;;
  esac
  tol=$(( pocet_db * TOL_PROCENT / 100 ))
  [ "$tol" -lt "$TOL_POCET" ] && tol="$TOL_POCET"
  echo "  S3 vypisuje $pocet_src souborů, databáze eviduje $pocet_db"
  if [ "$pocet_src" -lt $(( pocet_db - tol )) ]; then
    chyba "Bucket $b: S3 vypsalo jen $pocet_src z $pocet_db souborů. Nesynchronizuji, aby se zrcadlo nevyprázdnilo."
    return 1
  fi
  pojistka_mazani "$b" "$pocet_db" || return 1
  local porovnani=(--update --use-server-modtime)
  # Bez HEAD na každý soubor: změněný soubor má v produkci novější čas
  # nahrání než kopie v R2, nezměněný starší (doporučení z dokumentace rclone
  # pro S3 → S3). Plné porovnání čte čas změny z metadat každého souboru.
  [ "${ZALOHA_PLNE_POROVNANI:-0}" = 1 ] && porovnani=()
  rclone sync "supa:$b" "$CIL/$b" --backup-dir "$KOS/$b" \
    ${porovnani[@]+"${porovnani[@]}"} "${RCLONE_SPOLECNE[@]}"
}

# --- Cesta rest: seznam z databáze, stažení změn, rclone copy -----------------
zaloha_rest() {
  local b="$1" adr="$PRACOVNI/rest/$b"
  mkdir -p "$adr/soubory"
  # Seznam se bere z databáze, ne z REST API: /storage/v1/object/list vrací
  # jen jednu úroveň složek a stránkuje po stovkách, databáze dá všechno naráz.
  sql "select o.name, coalesce(o.metadata->>'size', ''),
              extract(epoch from coalesce(o.updated_at, o.created_at))::bigint
         from storage.objects o where o.bucket_id = '$b' and $ZIVE order by o.name" > "$adr/db.tsv" || return 1
  pojistka_mazani "$b" "$(wc -l < "$adr/db.tsv" | tr -d ' ')" || return 1
  vypis_r2 "$CIL/$b" --format pst --use-server-modtime > "$adr/r2.tsv" || return 1
  python3 "$POMOCNIK" plan --db "$adr/db.tsv" --r2 "$adr/r2.tsv" \
    --stahnout "$adr/stahnout.tsv" --odklidit "$adr/odklidit.txt" || return 1

  if [ "$NANECISTO" = 1 ]; then
    head -n 20 "$adr/stahnout.tsv" | cut -f1 | sed 's/^/    stáhl bych: /'
    head -n 20 "$adr/odklidit.txt" | sed 's/^/    odklidil bych: /'
    return 0
  fi

  local vysledek=0
  if [ -s "$adr/stahnout.tsv" ]; then
    python3 "$POMOCNIK" stahni --bucket "$b" --seznam "$adr/stahnout.tsv" --cil "$adr/soubory" || vysledek=1
    # Nahrát i to, co se stáhnout povedlo; přepisovaná verze jde do koše.
    rclone copy "$adr/soubory" "$CIL/$b" --backup-dir "$KOS/$b" "${RCLONE_SPOLECNE[@]}" || vysledek=1
  fi
  if [ -s "$adr/odklidit.txt" ]; then
    # Smazané v produkci se ze zrcadla přesouvá do koše (na straně R2, nic se nestahuje).
    rclone move "$CIL/$b" "$KOS/$b" --files-from-raw "$adr/odklidit.txt" "${RCLONE_SPOLECNE[@]}" || vysledek=1
  fi
  rm -rf "$adr/soubory"
  return "$vysledek"
}

for b in "${BUCKETY[@]}"; do
  echo ""
  echo "== $b"
  if [ "$REZIM" = s3 ]; then
    zaloha_s3 "$b" || CHYBY="$CHYBY $b"
  else
    zaloha_rest "$b" || CHYBY="$CHYBY $b"
  fi
done

if [ "$NANECISTO" = 1 ]; then
  echo ""
  if [ -n "$CHYBY" ]; then
    chyba "Nanečisto: u bucketů$CHYBY by se synchronizace nepovedla."
    exit 1
  fi
  echo "Nanečisto hotovo – nic se nezapsalo, ověření se přeskočilo."
  exit 0
fi

# --- Evidence k záloze -------------------------------------------------------
# Nastavení bucketů (veřejný/neveřejný, limity, typy souborů) v souborech
# není; obnova podle toho buckety v novém projektu založí.
{
  echo "zaloha: $START"
  echo "rezim: $REZIM"
  echo "buckety: ${BUCKETY[*]}"
  echo "chyby synchronizace:${CHYBY:- zadne}"
} > "$PRACOVNI/posledni-beh.txt"
for f in buckety.json objekty.tsv posledni-beh.txt; do
  rclone copyto "$PRACOVNI/$f" "r2:$R2_BUCKET/metadata/$f" "${RCLONE_SPOLECNE[@]}"
  rclone copyto "$PRACOVNI/$f" "$DENIK/$f" "${RCLONE_SPOLECNE[@]}"
done

# --- Ověření -----------------------------------------------------------------
echo ""
echo "== Ověření: R2 proti storage.objects"
sql "select o.bucket_id, o.name, coalesce(o.metadata->>'size', ''),
            case when coalesce(o.updated_at, o.created_at) < '$START'::timestamptz then 't' else 'f' end
       from storage.objects o join storage.buckets b on b.id = o.bucket_id
      where $ZIVE and $STANDARDNI" > "$PRACOVNI/over-db.tsv"
: > "$PRACOVNI/over-r2.tsv"
for b in "${BUCKETY[@]}"; do
  vypis_r2 "$CIL/$b" --format ps | awk -v b="$b" -F "$TAB" 'BEGIN{OFS=FS} {print b, $1, $2}' >> "$PRACOVNI/over-r2.tsv"
done
bucket_arg=()
for b in "${BUCKETY[@]}"; do bucket_arg+=(--bucket "$b"); done
overeni=0
python3 "$POMOCNIK" over --db "$PRACOVNI/over-db.tsv" --r2 "$PRACOVNI/over-r2.tsv" "${bucket_arg[@]}" \
  --tolerance-pocet "$TOL_POCET" --tolerance-procent "$TOL_PROCENT" | tee "$PRACOVNI/overeni.txt" || overeni=1

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Záloha souborů ze Storage ($DATUM, režim $REZIM)"
    echo '```'
    cat "$PRACOVNI/overeni.txt"
    echo '```'
    rclone size "$KOS" --fast-list 2>/dev/null | sed 's/^/Do koše (smazane\/'"$DATUM"') dnes: /' || true
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ -n "$CHYBY" ]; then
  chyba "Synchronizace se nepovedla u bucketů:$CHYBY"
  exit 1
fi
if [ "$overeni" != 0 ]; then
  chyba "Záloha v R2 nesedí na evidenci souborů v databázi – podrobnosti výš."
  exit 1
fi
echo ""
echo "Hotovo."
