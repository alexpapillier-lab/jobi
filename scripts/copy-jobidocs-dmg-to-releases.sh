#!/bin/bash
# Zkopíruje JobiDocs DMG z jobidocs/release/ do Releases/ (pro přehled vedle Jobi DMG).
# Spusť po buildu JobiDocs (npm run electron:build:universal v jobidocs/).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
RELEASES_DIR="$ROOT/Releases"
mkdir -p "$RELEASES_DIR"

SRC=$(find "$ROOT/jobidocs/release" -maxdepth 1 -name "*.dmg" -type f 2>/dev/null | head -1)
if [ -z "$SRC" ]; then
  echo "JobiDocs DMG nenalezen v jobidocs/release/. Nejdřív spusť build v jobidocs/." >&2
  exit 1
fi

cp "$SRC" "$RELEASES_DIR/"
echo "Zkopírováno: $RELEASES_DIR/$(basename "$SRC")"
