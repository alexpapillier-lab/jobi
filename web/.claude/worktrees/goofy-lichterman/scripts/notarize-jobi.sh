#!/bin/bash
# Notarizace Jobi .app – zabalí, pošle k Apple, po schválení připíchne lístek.
# Před spuštěním: export NOTARY_APPLE_ID, NOTARY_APPLE_PASSWORD, NOTARY_TEAM_ID
# Viz docs/INSTALACE_KLIENTUM.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
APP_PATH="$ROOT/src-tauri/target/release/bundle/macos/jobi.app"
ZIP_PATH="$ROOT/jobi-notarize.zip"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Run build first: npm run tauri:build:universal:signed"
  exit 1
fi

if [ -z "$NOTARY_APPLE_ID" ] || [ -z "$NOTARY_APPLE_PASSWORD" ] || [ -z "$NOTARY_TEAM_ID" ]; then
  echo "Error: Set NOTARY_APPLE_ID, NOTARY_APPLE_PASSWORD (app-specific), NOTARY_TEAM_ID"
  echo "Example: export NOTARY_APPLE_ID=\"your@email.com\""
  echo "         export NOTARY_APPLE_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\""
  echo "         export NOTARY_TEAM_ID=\"8ZC264M873\""
  exit 1
fi

echo "Creating zip for notarization..."
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "Submitting to Apple (notarytool)..."
xcrun notarytool submit "$ZIP_PATH" \
  --apple-id "$NOTARY_APPLE_ID" \
  --password "$NOTARY_APPLE_PASSWORD" \
  --team-id "$NOTARY_TEAM_ID" \
  --wait

echo "Stapling notarization ticket to .app..."
xcrun stapler staple "$APP_PATH"

echo "Validating..."
xcrun stapler validate "$APP_PATH"

rm -f "$ZIP_PATH"
echo "Done. Notarized app: $APP_PATH"
