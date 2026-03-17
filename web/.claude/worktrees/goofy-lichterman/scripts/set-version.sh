#!/bin/bash
# Přepíše číslo verze všude v repozitáři (Jobi + JobiDocs).
# Použití: ./scripts/set-version.sh 0.1.2
# Aktualizuje: src-tauri/tauri.conf.json, src-tauri/Cargo.toml, jobidocs/package.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Použití: $0 <verze>" >&2
  echo "Příklad: $0 0.1.2" >&2
  exit 1
fi

# Ověřit formát (např. 0.1.2 nebo 1.0.0)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Chyba: Verze musí být ve tvaru X.Y.Z (např. 0.1.2)" >&2
  exit 1
fi

echo "Nastavuji verzi na $VERSION..."

# Jobi – Tauri config
TAURI_CONF="$ROOT/src-tauri/tauri.conf.json"
node -e "
const fs = require('fs');
const p = process.argv[1];
const v = process.argv[2];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.version = v;
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('  ' + p + ' -> ' + v);
" "$TAURI_CONF" "$VERSION"

# Jobi – Cargo.toml
CARGO_TOML="$ROOT/src-tauri/Cargo.toml"
sed -i.bak "s/^version = .*/version = \"$VERSION\"/" "$CARGO_TOML"
rm -f "$CARGO_TOML.bak"
echo "  $CARGO_TOML -> $VERSION"

# JobiDocs – package.json
JOBIDOCS_PKG="$ROOT/jobidocs/package.json"
node -e "
const fs = require('fs');
const p = process.argv[1];
const v = process.argv[2];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.version = v;
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('  ' + p + ' -> ' + v);
" "$JOBIDOCS_PKG" "$VERSION"

echo "Hotovo. Verze $VERSION je nastavena v tauri.conf.json, Cargo.toml a jobidocs/package.json."
