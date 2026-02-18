#!/bin/bash
# Zkopíruje JobiDocs DMG z jobidocs/release/ do Releases/JobiDocs-{verze}.dmg.
# Verze z jobi src-tauri/tauri.conf.json (sjednoceno s release). Staré JobiDocs-*.dmg se smažou.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
RELEASES_DIR="$ROOT/Releases"
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

DEST="$RELEASES_DIR/JobiDocs-${VERSION}.dmg"

SRC=$(find "$ROOT/jobidocs/release" -maxdepth 1 -name "*.dmg" -type f 2>/dev/null | head -1)
if [ -z "$SRC" ]; then
  echo "JobiDocs DMG nenalezen v jobidocs/release/. Nejdřív spusť build v jobidocs/." >&2
  exit 1
fi

# Odstranit staré JobiDocs DMG, aby se na GitHub nenahrála předchozí verze
for f in "$RELEASES_DIR"/JobiDocs-*.dmg; do
  [ -e "$f" ] && rm -f "$f" && echo "Smazán starý: $f"
done

cp "$SRC" "$DEST"
echo "Zkopírováno: $DEST"
