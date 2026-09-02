#!/bin/bash
# Doplní Windows záznam do existujícího latest.json pro Tauri updater.
#
# macOS část generuje scripts/generate-jobi-latest-json.sh – tenhle skript
# ho ZÁMĚRNĚ nenahrazuje ani neupravuje, jen k jeho výstupu přidá
# platformu "windows-x86_64". Odladěná macOS cesta tak zůstává nedotčená.
#
# Použití:
#   scripts/add-windows-to-latest-json.sh <cesta-k-setup.exe.sig> [název-exe] [latest.json]
#
# Typicky po stažení artefaktu z workflow "Build Windows":
#   gh run download <id> --name jobi-windows --dir /tmp/win
#   scripts/add-windows-to-latest-json.sh /tmp/win/jobi_0.2.3_x64-setup.exe.sig

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

SIG_FILE="${1:-}"
if [ -z "$SIG_FILE" ] || [ ! -f "$SIG_FILE" ]; then
  echo "Chyba: zadej cestu k .sig souboru Windows installeru." >&2
  echo "Použití: $0 <setup.exe.sig> [název-exe] [latest.json]" >&2
  exit 1
fi

# Název exe: buď zadaný, nebo odvozený ze jména .sig (odstraněním přípony .sig)
EXE_NAME="${2:-$(basename "${SIG_FILE%.sig}")}"
OUTPUT_FILE="${3:-$ROOT/latest.json}"

if [ ! -f "$OUTPUT_FILE" ]; then
  echo "Chyba: $OUTPUT_FILE neexistuje." >&2
  echo "Nejdřív spusť scripts/generate-jobi-latest-json.sh (macOS část)." >&2
  exit 1
fi

GITHUB_RELEASES_URL="https://github.com/alexpapillier-lab/jobi/releases/latest/download"
DOWNLOAD_URL="$GITHUB_RELEASES_URL/$EXE_NAME"
SIGNATURE="$(cat "$SIG_FILE" | jq -Rs .)"

TMP="$(mktemp)"
jq \
  --arg url "$DOWNLOAD_URL" \
  --argjson signature "$SIGNATURE" \
  '.platforms["windows-x86_64"] = { signature: $signature, url: $url }' \
  "$OUTPUT_FILE" > "$TMP"
mv "$TMP" "$OUTPUT_FILE"

echo "Doplněno do: $OUTPUT_FILE"
echo "  windows-x86_64 -> $DOWNLOAD_URL"
echo ""
echo "Platformy v souboru:"
jq -r '.platforms | keys[]' "$OUTPUT_FILE" | sed 's/^/  /'
echo ""
echo "POZOR: název .exe obsahuje verzi, takže URL platí jen pro tenhle release."
echo "Na GitHub Releases musí být asset pojmenovaný přesně: $EXE_NAME"
