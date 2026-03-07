#!/bin/bash
# Release: Jobi + JobiDocs – build, notarize obě aplikace, vytvoř DMG pro obě.
# Použití: nastav Apple credentials, pak spusť z kořene projektu.
#
# Env (povinné pro notarizaci):
#   NOTARY_APPLE_ID       – Apple ID e-mail (nebo APPLE_ID)
#   NOTARY_APPLE_PASSWORD – app-specific heslo (nebo APPLE_APP_SPECIFIC_PASSWORD)
#   NOTARY_TEAM_ID        – Team ID (nebo APPLE_TEAM_ID)
#
# Volitelně: TAURI_SIGNING_KEY_FILE nebo ~/.tauri/jobi.key pro podepsaný Jobi build.
#
# Výstupy:
#   jobi-<verze>.dmg         – v kořeni projektu (notarizovaný Jobi)
#   jobidocs/release/*.dmg   – notarizovaný JobiDocs DMG

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Sjednotit env pro notarizaci (Jobi používá NOTARY_*, JobiDocs APPLE_*)
export NOTARY_APPLE_ID="${NOTARY_APPLE_ID:-$APPLE_ID}"
export NOTARY_APPLE_PASSWORD="${NOTARY_APPLE_PASSWORD:-$APPLE_APP_SPECIFIC_PASSWORD}"
export NOTARY_TEAM_ID="${NOTARY_TEAM_ID:-$APPLE_TEAM_ID}"

if [ -z "$NOTARY_APPLE_ID" ] || [ -z "$NOTARY_APPLE_PASSWORD" ] || [ -z "$NOTARY_TEAM_ID" ]; then
  echo -e "${YELLOW}Error: Pro notarizaci nastav Apple credentials.${NC}"
  echo "  export NOTARY_APPLE_ID=\"tvuj@email.com\""
  echo "  export NOTARY_APPLE_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\"   # app-specific heslo z appleid.apple.com"
  echo "  export NOTARY_TEAM_ID=\"8ZC264M873\""
  exit 1
fi

# JobiDocs očekává APPLE_*
export APPLE_ID="$NOTARY_APPLE_ID"
export APPLE_APP_SPECIFIC_PASSWORD="$NOTARY_APPLE_PASSWORD"
export APPLE_TEAM_ID="$NOTARY_TEAM_ID"

echo -e "${CYAN}=== 1/5 Jobi: build (signed universal) ===${NC}"
bash "$SCRIPT_DIR/build-universal-signed.sh"

echo -e "${CYAN}=== 2/5 Jobi: notarizace ===${NC}"
bash "$SCRIPT_DIR/notarize-jobi.sh"

RELEASES_DIR="$ROOT/Releases"
mkdir -p "$RELEASES_DIR"

echo -e "${CYAN}=== 3/5 Jobi: vytvoření DMG ===${NC}"
bash "$SCRIPT_DIR/create-jobi-dmg.sh"

JOBI_DMG=$(ls -t "$RELEASES_DIR"/jobi-*.dmg 2>/dev/null | head -1)
if [ -n "$JOBI_DMG" ]; then
  echo -e "${GREEN}Jobi DMG: $JOBI_DMG${NC}"
fi

echo -e "${CYAN}=== 4/5 JobiDocs: build + notarizace (universal, DMG) ===${NC}"
cd "$ROOT/jobidocs"
npm run electron:build:universal
cd "$ROOT"

JOBIDOCS_DMG_SRC=$(find "$ROOT/jobidocs/release" -maxdepth 1 -name "*.dmg" -type f 2>/dev/null | head -1)
if [ -n "$JOBIDOCS_DMG_SRC" ]; then
  JOBIDOCS_DMG="$RELEASES_DIR/$(basename "$JOBIDOCS_DMG_SRC")"
  cp "$JOBIDOCS_DMG_SRC" "$JOBIDOCS_DMG"
  echo -e "${GREEN}JobiDocs DMG: $JOBIDOCS_DMG${NC}"
else
  JOBIDOCS_DMG=""
  echo -e "${YELLOW}JobiDocs DMG nenalezen v jobidocs/release/ – zkontroluj výstup buildu.${NC}"
fi

echo -e "${CYAN}=== 5/5 OTA artefakty pro Jobi (volitelně) ===${NC}"
if [ -f "$SCRIPT_DIR/pack-notarized-ota.sh" ]; then
  bash "$SCRIPT_DIR/pack-notarized-ota.sh" || true
  echo "Pro OTA updaty nahraj na GitHub Release: latest.json, jobi.app.tar.gz, jobi.app.tar.gz.sig"
fi

echo ""
echo -e "${GREEN}Hotovo.${NC}"
echo "DMG pro distribuci:"
echo "  • Jobi:    $JOBI_DMG"
echo "  • JobiDocs: $JOBIDOCS_DMG"
echo "Oba DMG jsou ve složce Releases/. Nahraj je na GitHub Release (tag např. v0.1.0)."
