#!/bin/bash
# Vytvoří Jobi .dmg z notarizované jobi.app (pro distribuci – jeden soubor ke sdílení).
# Spusť až po notarizaci (./scripts/notarize-jobi.sh).
# Vyžaduje create-dmg (brew install create-dmg) – fancy layout s fialovým pozadím a „Přetáhněte do Aplikací“.
# Výstup: jobi-<verze>.dmg ve složce Releases/ v kořeni projektu.

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

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "Error: create-dmg is required for the installer DMG (background + Přetáhněte do Aplikací)." >&2
  echo "Install with: brew install create-dmg" >&2
  exit 1
fi

# Vždy vygenerovat pozadí (fialový gradient + text „Přetáhněte do Aplikací“)
echo "Generating DMG background..."
node "$ROOT/scripts/gen-dmg-background.js"
if [ ! -f "$BACKGROUND" ]; then
  echo "Error: Background not created at $BACKGROUND" >&2
  exit 1
fi

VERSION=$(node -e "try { console.log(require('$ROOT/src-tauri/tauri.conf.json').version || '0.1.0'); } catch(e) { console.log('0.1.0'); }" 2>/dev/null || echo "0.1.0")
DMG_NAME="jobi-${VERSION}.dmg"
RELEASES_DIR="$ROOT/Releases"
mkdir -p "$RELEASES_DIR"
DMG_PATH="$RELEASES_DIR/$DMG_NAME"

STAGING=$(mktemp -d -t jobi-dmg-staging)
trap "rm -rf '$STAGING'" EXIT
cp -R "$APP_PATH" "$STAGING/jobi.app"

rm -f "$DMG_PATH"

echo "Creating fancy $DMG_NAME (background + Přetáhněte do Aplikací)..."
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

echo "Done: $DMG_PATH"
echo "Upload this file to GitHub Release so users can download Jobi (JobiDocs they get via the in-app link)."
