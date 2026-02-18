#!/bin/bash
set -e

# Tauri CLI expects CI=true or CI=false; unset or CI=1 breaks the build
export CI=false

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Project root (parent of scripts directory)
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

# Při spuštění z GUI (Release App) se nenačte .zshrc/.bash_profile – doplnit cesty k nástrojům
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
# nvm: načíst defaultní Node, pokud existuje
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi
if ! command -v rustup >/dev/null 2>&1; then
  echo "Error: rustup not found. Nainstaluj z https://rustup.rs nebo přidej \$HOME/.cargo/bin do PATH." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm not found. Nainstaluj Node (brew install node) nebo nvm a přidej do PATH." >&2
  exit 1
fi

echo "🔨 Building Universal Binary for macOS..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if x86_64 target is installed
if ! rustup target list --installed | grep -q "x86_64-apple-darwin"; then
    echo -e "${YELLOW}Installing x86_64-apple-darwin target...${NC}"
    rustup target add x86_64-apple-darwin
fi

# Build directories
AARCH64_DIR="src-tauri/target/aarch64-apple-darwin/release"
X86_64_DIR="src-tauri/target/x86_64-apple-darwin/release"
UNIVERSAL_DIR="src-tauri/target/release"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"

echo -e "${GREEN}Building for aarch64 (Apple Silicon)...${NC}"
npm run build:prod
npx tauri build --target aarch64-apple-darwin

echo -e "${GREEN}Building for x86_64 (Intel)...${NC}" >&2
echo "Může trvat 5–10 minut na Apple Silicon; výstup se může na chvíli zdát zastavený." >&2
npx tauri build --target x86_64-apple-darwin

echo -e "${GREEN}Creating universal binary with lipo...${NC}"
# Create universal binary
mkdir -p "$UNIVERSAL_DIR"
lipo -create \
    "$AARCH64_DIR/jobi" \
    "$X86_64_DIR/jobi" \
    -output "$UNIVERSAL_DIR/jobi"

echo -e "${GREEN}Copying .app bundle structure...${NC}"
# Copy the .app bundle from aarch64 build (structure is the same)
cp -R "$AARCH64_DIR/bundle/macos/jobi.app" "$BUNDLE_DIR"
# Replace the binary with universal binary (lipo output is unsigned)
cp "$UNIVERSAL_DIR/jobi" "$BUNDLE_DIR/jobi.app/Contents/MacOS/jobi"

# Re-sign for notarization: universal binary must be signed with hardened runtime + timestamp
ROOT_ABS="$(cd "$ROOT" && pwd)"
SIGNING_IDENTITY=$(node -e "try { const c=require('$ROOT_ABS/src-tauri/tauri.conf.json'); console.log(c.bundle.macOS.signingIdentity || ''); } catch(e) { console.log(''); }" 2>/dev/null || true)
if [ -n "$SIGNING_IDENTITY" ] && [ "$SIGNING_IDENTITY" != "null" ]; then
  echo -e "${GREEN}Re-signing universal .app (hardened runtime + timestamp) for notarization...${NC}"
  codesign --force --options runtime --timestamp -s "$SIGNING_IDENTITY" "$BUNDLE_DIR/jobi.app/Contents/MacOS/jobi"
  codesign --force --options runtime --timestamp -s "$SIGNING_IDENTITY" "$BUNDLE_DIR/jobi.app"
else
  echo -e "${YELLOW}Could not read signingIdentity from tauri.conf.json – universal .app not re-signed (notarization will fail).${NC}"
fi

echo -e "${GREEN}Creating ZIP archive...${NC}"
cd "$BUNDLE_DIR"
zip -r "../../../../jobi-universal.zip" jobi.app
cd - > /dev/null

echo -e "${GREEN}Creating .tar.gz for OTA updater...${NC}"
cd "$BUNDLE_DIR"
tar czf "jobi.app.tar.gz" jobi.app
cd - > /dev/null

# Sign and generate latest.json when signing key is available (one universal build → both archs in OTA)
if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ] || [ -f "$HOME/.tauri/jobi.key" ]; then
  echo -e "${GREEN}Signing OTA bundle...${NC}"
  if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
    export TAURI_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY"
    # Předat i prázdné heslo, aby signer nepromptoval (klíč bez hesla)
    export TAURI_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  else
    export TAURI_PRIVATE_KEY_PATH="$HOME/.tauri/jobi.key"
    export TAURI_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  fi
  npx tauri signer sign "$BUNDLE_DIR/jobi.app.tar.gz"
  echo -e "${GREEN}Generating latest.json (universal – both darwin-aarch64 and darwin-x86_64)...${NC}"
  bash "$SCRIPT_DIR/generate-jobi-latest-json.sh" universal "$ROOT/latest.json"
  echo -e "${GREEN}✅ OTA artifacts ready: jobi.app.tar.gz, jobi.app.tar.gz.sig, latest.json${NC}"
else
  echo -e "${YELLOW}No TAURI_SIGNING_PRIVATE_KEY / ~/.tauri/jobi.key – skipping signing and latest.json.${NC}"
  echo -e "${YELLOW}Set key and re-run to get OTA artifacts, or run: npm run generate-latest-json universal${NC}"
fi

echo -e "${GREEN}✅ Universal binary created: jobi-universal.zip${NC}"

