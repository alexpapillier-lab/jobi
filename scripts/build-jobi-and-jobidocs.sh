#!/bin/bash
# Build Jobi (Tauri) + JobiDocs (Electron) and create combined zip for testing
set -e
export CI=false

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}1/3 Building Jobi (Tauri universal)...${NC}"
bash scripts/build-universal.sh

echo -e "${GREEN}2/3 Building JobiDocs (Electron)...${NC}"
cd jobidocs
npm run build:electron
npx electron-builder --mac
cd ..

echo -e "${GREEN}3/3 Creating combined zip...${NC}"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
JOBI_APP="$BUNDLE_DIR/jobi.app"
JOBIDOCS_APP=$(find jobidocs/release -name "JobiDocs.app" -type d 2>/dev/null | head -1)

if [ ! -d "$JOBI_APP" ]; then
  echo -e "${YELLOW}Error: jobi.app not found at $JOBI_APP${NC}"
  exit 1
fi

ZIP_DIR="build-export"
rm -rf "$ZIP_DIR"
mkdir -p "$ZIP_DIR"
cp -R "$JOBI_APP" "$ZIP_DIR/"
if [ -n "$JOBIDOCS_APP" ] && [ -d "$JOBIDOCS_APP" ]; then
  cp -R "$JOBIDOCS_APP" "$ZIP_DIR/"
  echo -e "${GREEN}Included: jobi.app + JobiDocs.app${NC}"
else
  echo -e "${YELLOW}JobiDocs.app not found - zip contains jobi.app only${NC}"
fi

cd "$ZIP_DIR"
zip -r "../jobi-export.zip" .
cd ..
rm -rf "$ZIP_DIR"

echo -e "${GREEN}Done: jobi-export.zip (project root)${NC}"
