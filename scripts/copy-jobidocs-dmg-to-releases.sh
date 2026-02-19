#!/bin/bash
# Zkopíruje JobiDocs artefakty z jobidocs/release/ do Releases/:
#   JobiDocs-{verze}.dmg, latest-mac.yml, JobiDocs-*-mac.zip (pro electron-updater OTA).
# Verze z jobi src-tauri/tauri.conf.json. Staré JobiDocs-*.dmg a staré latest-mac.yml / *-mac.zip se smažou.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
RELEASES_DIR="$ROOT/Releases"
JOBIDOCS_RELEASE="$ROOT/jobidocs/release"
mkdir -p "$RELEASES_DIR"

# Verze z Jobi (tauri.conf.json) aby název odpovídal release
VERSION=""
if [ -f "$ROOT/src-tauri/tauri.conf.json" ]; then
  VERSION=$(node -e "console.log(require('$ROOT/src-tauri/tauri.conf.json').version || '')")
fi
if [ -z "$VERSION" ] && [ -f "$ROOT/jobidocs/package.json" ]; then
  VERSION=$(node -e "console.log(require('$ROOT/jobidocs/package.json').version || '')")
fi
if [ -z "$VERSION" ]; then
  echo "Nelze zjistit verzi z src-tauri/tauri.conf.json ani jobidocs/package.json." >&2
  exit 1
fi

DEST_DMG="$RELEASES_DIR/JobiDocs-${VERSION}.dmg"

# Bereme jen DMG odpovídající verzi (JobiDocs-0.1.4-universal.dmg), ne náhodně první *.dmg
SRC_DMG=$(find "$JOBIDOCS_RELEASE" -maxdepth 1 -name "JobiDocs-${VERSION}*.dmg" -type f 2>/dev/null | head -1)
if [ -z "$SRC_DMG" ]; then
  echo "JobiDocs DMG pro verzi $VERSION nenalezen v jobidocs/release/." >&2
  echo "Očekávaný vzor: JobiDocs-${VERSION}-universal.dmg. Nejdřív spusť build JobiDocs." >&2
  exit 1
fi

# Odstranit staré JobiDocs DMG a OTA artefakty
for f in "$RELEASES_DIR"/JobiDocs-*.dmg; do [ -e "$f" ] && rm -f "$f" && echo "Smazán starý: $f"; done
[ -f "$RELEASES_DIR/latest-mac.yml" ] && rm -f "$RELEASES_DIR/latest-mac.yml" && echo "Smazán starý: latest-mac.yml"
for f in "$RELEASES_DIR"/JobiDocs-*-mac.zip; do [ -e "$f" ] && rm -f "$f" && echo "Smazán starý: $f"; done

cp "$SRC_DMG" "$DEST_DMG"
echo "Zkopírováno: $DEST_DMG"

# OTA pro electron-updater: latest-mac.yml a JobiDocs-*-mac.zip
if [ -f "$JOBIDOCS_RELEASE/latest-mac.yml" ]; then
  cp "$JOBIDOCS_RELEASE/latest-mac.yml" "$RELEASES_DIR/"
  echo "Zkopírováno: $RELEASES_DIR/latest-mac.yml"
else
  echo "Varování: latest-mac.yml nenalezen v jobidocs/release/ – OTA v JobiDocs nebude fungovat bez tohoto souboru." >&2
fi
SRC_ZIP=$(find "$JOBIDOCS_RELEASE" -maxdepth 1 -name "JobiDocs-*-mac.zip" -type f 2>/dev/null | head -1)
if [ -n "$SRC_ZIP" ]; then
  cp "$SRC_ZIP" "$RELEASES_DIR/"
  echo "Zkopírováno: $RELEASES_DIR/$(basename "$SRC_ZIP")"
else
  echo "Varování: JobiDocs-*-mac.zip nenalezen v jobidocs/release/ – OTA v JobiDocs nebude fungovat bez tohoto souboru." >&2
fi
