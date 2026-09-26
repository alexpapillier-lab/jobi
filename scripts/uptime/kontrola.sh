#!/usr/bin/env bash
# Jedna kontrola dostupnosti zvenčí pro .github/workflows/uptime.yml.
#
#   scripts/uptime/kontrola.sh <název> <povolené kódy> <url> [volby]
#
#   <povolené kódy>   kódy oddělené čárkou, např. "200" nebo "200,401,403"
#   --obsahuje TEXT   tělo odpovědi musí obsahovat TEXT
#   --json-pole POLE  tělo musí být JSON s neprázdným polem POLE (přes jq)
#   --hlavicka "X: y" hlavička pro curl (lze víckrát)
#   --pokusy N        počet pokusů (výchozí 3)
#   --pauza S         pauza mezi pokusy v sekundách (výchozí 20)
#
# Kontrola projde, když KTERÝKOLI pokus projde. Selhání se hlásí až po
# posledním pokusu: runner GitHubu občas na pár sekund ztratí síť a Supabase
# má vlastní krátká zaškobrtnutí – e-mail za něco, co při ručním ověření
# vypadá v pořádku, je nejrychlejší způsob, jak si hlídače člověk odfiltruje
# do koše. Stejné pravidlo drží scripts/hlidac/hlidac.mjs.
#
# Proč se kontroluje i obsah, ne jen kód: Cloudflare Pages vrací pro
# neznámou cestu index.html s kódem 200 (žádná 404 stránka). Samotné „200“
# by tedy prošlo, i kdyby /servis/version.json vůbec neexistoval.
#
# Výstup pro Actions: do $GITHUB_OUTPUT zapíše `stav=ok|chyba` a `detail=…`,
# ať si to závěrečný krok posbírá do e-mailu. Lokálně stačí spustit a číst
# konzoli.

set -u

NAZEV="${1:?název kontroly}"
KODY="${2:?povolené kódy}"
URL="${3:?url}"
shift 3

OBSAHUJE=""
JSON_POLE=""
POKUSY=3
PAUZA=20
HLAVICKY=()
while [ $# -gt 0 ]; do
  case "$1" in
    --obsahuje) OBSAHUJE="$2"; shift 2 ;;
    --json-pole) JSON_POLE="$2"; shift 2 ;;
    --hlavicka) HLAVICKY+=(-H "$2"); shift 2 ;;
    --pokusy) POKUSY="$2"; shift 2 ;;
    --pauza) PAUZA="$2"; shift 2 ;;
    *) echo "Neznámá volba: $1" >&2; exit 2 ;;
  esac
done

TELO="$(mktemp)"
trap 'rm -f "$TELO"' EXIT

zapis_vystup() {
  # $1 = ok|chyba, $2 = detail (jeden řádek)
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "stav=$1"
      echo "detail=$2"
    } >> "$GITHUB_OUTPUT"
  fi
}

DUVOD=""
for ((i = 1; i <= POKUSY; i++)); do
  # -m 15: co neodpoví do 15 s, je pro zákazníka stejně nepoužitelné.
  # Kód 000 znamená, že se spojení vůbec nepovedlo (DNS, TLS, timeout).
  # ${HLAVICKY[@]+…}: prázdné pole je pod `set -u` v bashi 3 (macOS) chyba.
  KOD="$(curl -sS -o "$TELO" -w '%{http_code}' -m 15 \
    -A "Jobi-Uptime/1 (+https://appjobi.com/status)" \
    ${HLAVICKY[@]+"${HLAVICKY[@]}"} "$URL" 2>"$TELO.err")" || KOD="000"
  CHYBA_CURL="$(head -c 200 "$TELO.err" 2>/dev/null || true)"
  rm -f "$TELO.err"

  DUVOD=""
  if ! [[ ",$KODY," == *",$KOD,"* ]]; then
    DUVOD="kód $KOD (čekal se $KODY)${CHYBA_CURL:+ – $CHYBA_CURL}"
  elif [ -n "$OBSAHUJE" ] && ! grep -q -- "$OBSAHUJE" "$TELO"; then
    DUVOD="kód $KOD, ale v odpovědi chybí text „$OBSAHUJE“"
  elif [ -n "$JSON_POLE" ] && ! jq -e --arg p "$JSON_POLE" '.[$p] | . != null and . != ""' "$TELO" >/dev/null 2>&1; then
    DUVOD="kód $KOD, ale odpověď není JSON s polem „$JSON_POLE“: $(head -c 120 "$TELO" | tr '\n' ' ')"
  fi

  if [ -z "$DUVOD" ]; then
    echo "OK  $NAZEV – kód $KOD (pokus $i/$POKUSY)"
    zapis_vystup ok "kód $KOD"
    exit 0
  fi

  echo "..  $NAZEV – pokus $i/$POKUSY neprošel: $DUVOD"
  if [ "$i" -lt "$POKUSY" ]; then
    sleep "$PAUZA"
  fi
done

echo "::error title=$NAZEV::$DUVOD ($URL)"
echo "CHYBA  $NAZEV – $DUVOD"
zapis_vystup chyba "$DUVOD"
exit 1
