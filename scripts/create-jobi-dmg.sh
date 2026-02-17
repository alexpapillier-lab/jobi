#!/bin/bash
# Vytvoří Jobi .dmg z notarizované jobi.app (pro distribuci – jeden soubor ke sdílení).
# Spusť až po notarizaci (./scripts/notarize-jobi.sh).
# S create-dmg (brew install create-dmg): fancy layout – fialové pozadí, ikona Aplikací.
# Bez create-dmg: jednoduchý DMG (app + symlink Aplikace).
# Výstup: jobi-<verze>.dmg v kořeni projektu.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
APP_PATH="$ROOT/src-tauri/target/release/bundle/macos/jobi.app"
DMG_ASSETS="$SCRIPT_DIR/dmg-assets"
BACKGROUND="$DMG_ASSETS/dmg-background.png"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Run build and notarize first." >&2
  exit 1
fi

# Zajistit pozadí pro fancy DMG
if [ ! -f "$BACKGROUND" ]; then
  echo "Generating DMG background..."
  node "$ROOT/scripts/gen-dmg-background.js"
fi

VERSION=$(node -e "try { console.log(require('$ROOT/src-tauri/tauri.conf.json').version || '0.1.0'); } catch(e) { console.log('0.1.0'); }" 2>/dev/null || echo "0.1.0")
DMG_NAME="jobi-${VERSION}.dmg"
DMG_PATH="$ROOT/$DMG_NAME"

STAGING=$(mktemp -d -t jobi-dmg-staging)
trap "rm -rf '$STAGING'" EXIT
cp -R "$APP_PATH" "$STAGING/jobi.app"

rm -f "$DMG_PATH"

if command -v create-dmg >/dev/null 2>&1; then
  echo "Creating fancy $DMG_NAME (background + Přesunout do Aplikací)..."
  create-dmg \
    --volname "Jobi" \
    --background "$BACKGROUND" \
    --window-size 540 380 \
    --icon-size 80 \
    --icon "jobi.app" 130 220 \
    --app-drop-link 410 220 \
    --no-internet-enable \
    "$DMG_PATH" \
    "$STAGING"
else
  echo "create-dmg not found – creating simple DMG. Install with: brew install create-dmg"
  ln -sf /Applications "$STAGING/Applications"
  hdiutil create -volname "Jobi" -srcfolder "$STAGING" -ov -format UDZO "$DMG_PATH"
fi

echo "Done: $DMG_PATH"
echo "Upload this file to GitHub Release so users can download Jobi (JobiDocs they get via the in-app link)."
