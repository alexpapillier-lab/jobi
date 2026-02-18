#!/bin/bash
# Po notarizaci: zabalí notarizovanou .app do .tar.gz, podepíše pro OTA, vygeneruje latest.json.
# Spusť až po úspěšném ./scripts/notarize-jobi.sh
# Vyžaduje Tauri signing key (viz build-universal-signed.sh).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle/macos"
APP_PATH="$BUNDLE_DIR/jobi.app"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Run build and notarize first." >&2
  exit 1
fi

echo "Validating notarization..."
if ! xcrun stapler validate "$APP_PATH" 2>/dev/null; then
  echo -e "${YELLOW}Error: .app is not notarized. Run ./scripts/notarize-jobi.sh first.${NC}" >&2
  exit 1
fi

# Load Tauri signing key
KEY_FILE="${TAURI_SIGNING_KEY_FILE:-$HOME/.tauri/jobi.key}"
if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  export TAURI_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY"
elif [ -f "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
  export TAURI_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY"
else
  echo "Error: Set TAURI_SIGNING_PRIVATE_KEY or have $KEY_FILE for OTA signing." >&2
  exit 1
fi
[ -n "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" ] && export TAURI_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"

echo -e "${GREEN}Creating .tar.gz from notarized .app...${NC}"
cd "$BUNDLE_DIR"
rm -f jobi.app.tar.gz jobi.app.tar.gz.sig
COPYFILE_DISABLE=1 tar czf jobi.app.tar.gz jobi.app
cd - > /dev/null

echo -e "${GREEN}Signing .tar.gz for OTA...${NC}"
npx tauri signer sign "$BUNDLE_DIR/jobi.app.tar.gz"

echo -e "${GREEN}Generating latest.json...${NC}"
bash "$SCRIPT_DIR/generate-jobi-latest-json.sh" universal "$ROOT/latest.json"

echo ""
echo -e "${GREEN}✅ OTA artefakty z notarizované .app jsou připravené.${NC}"
echo "Nahraj na GitHub Release (tag např. v0.1.0):"
echo "  1. $ROOT/latest.json"
echo "  2. $BUNDLE_DIR/jobi.app.tar.gz"
echo "  3. $BUNDLE_DIR/jobi.app.tar.gz.sig"
