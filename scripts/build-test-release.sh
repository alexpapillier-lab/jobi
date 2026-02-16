#!/bin/bash
# První test release: Jobi (jedna architektura = rychlejší) + JobiDocs, výstup do jobi-test-release.zip
# Pro univerzální Jobi (Intel + Apple Silicon) použij: bash scripts/build-jobi-and-jobidocs.sh
set -e
export CI=false

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Rust musí mít výchozí toolchain (jinak: rustup default stable)
if ! command -v rustc &>/dev/null; then
  echo -e "${YELLOW}Rust není nainstalovaný. Nainstaluj: https://rustup.rs${NC}"
  exit 1
fi
if ! cargo --version &>/dev/null; then
  echo -e "${YELLOW}Rust toolchain není nastaven. Spusť: rustup default stable${NC}"
  exit 1
fi

echo -e "${GREEN}1/3 Building Jobi (Tauri, aktuální architektura)...${NC}"
npm run build:prod
npx tauri build

echo -e "${GREEN}2/3 Building JobiDocs (Electron)...${NC}"
cd jobidocs
npm run build:electron
npx electron-builder --mac
cd ..

echo -e "${GREEN}3/3 Creating test release zip...${NC}"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
JOBI_APP="$BUNDLE_DIR/jobi.app"
JOBIDOCS_APP=$(find jobidocs/release -name "JobiDocs.app" -type d 2>/dev/null | head -1)

if [ ! -d "$JOBI_APP" ]; then
  echo -e "${YELLOW}Error: jobi.app not found at $JOBI_APP${NC}"
  exit 1
fi

ZIP_DIR="build-test-release"
rm -rf "$ZIP_DIR"
mkdir -p "$ZIP_DIR"
cp -R "$JOBI_APP" "$ZIP_DIR/"
if [ -n "$JOBIDOCS_APP" ] && [ -d "$JOBIDOCS_APP" ]; then
  cp -R "$JOBIDOCS_APP" "$ZIP_DIR/"
  echo -e "${GREEN}Obsah: jobi.app + JobiDocs.app${NC}"
else
  echo -e "${YELLOW}JobiDocs.app nenalezen – zip obsahuje jen jobi.app${NC}"
fi

cd "$ZIP_DIR"
zip -r "../jobi-test-release.zip" .
cd ..
rm -rf "$ZIP_DIR"

echo -e "${GREEN}Hotovo: jobi-test-release.zip (v kořeni projektu)${NC}"
