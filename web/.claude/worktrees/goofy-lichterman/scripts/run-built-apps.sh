#!/bin/bash
# Spustí už sestavené Jobi + JobiDocs (.app) bez vytváření instalačního balíčku.
# Použití:
#   bash scripts/run-built-apps.sh        – spustí existující build
#   bash scripts/run-built-apps.sh --build – nejdřív sestaví, pak spustí
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DO_BUILD=false
for arg in "$@"; do
  if [ "$arg" = "--build" ] || [ "$arg" = "-b" ]; then
    DO_BUILD=true
    break
  fi
done

if [ "$DO_BUILD" = true ]; then
  echo -e "${GREEN}Stavím Jobi + JobiDocs...${NC}"
  export CI=false
  npm run build:prod
  npx tauri build
  cd jobidocs
  npm run build:electron
  npx electron-builder --mac
  cd ..
fi

JOBI_APP="src-tauri/target/release/bundle/macos/jobi.app"
JOBIDOCS_APP=$(find jobidocs/release -maxdepth 2 -name "JobiDocs.app" -type d 2>/dev/null | head -1)

if [ ! -d "$JOBI_APP" ]; then
  echo -e "${YELLOW}Jobi.app nenalezen. Spusť nejdřív build (např. bash scripts/run-built-apps.sh --build).${NC}"
  exit 1
fi

echo -e "${GREEN}Spouštím Jobi a JobiDocs...${NC}"
open "$JOBI_APP"
if [ -n "$JOBIDOCS_APP" ] && [ -d "$JOBIDOCS_APP" ]; then
  open "$JOBIDOCS_APP"
else
  echo -e "${YELLOW}JobiDocs.app nenalezen – spusť JobiDocs z jobidocs/ (npm run electron:dev nebo build).${NC}"
fi
