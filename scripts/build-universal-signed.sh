#!/bin/bash
# Universal build s načteným signing klíčem z ~/.tauri/jobi.key (pro OTA artefakty).

set -e

KEY_FILE="${TAURI_SIGNING_KEY_FILE:-$HOME/.tauri/jobi.key}"

if [ ! -f "$KEY_FILE" ]; then
  echo "Error: Signing key not found: $KEY_FILE"
  echo "Generate with: npm run tauri signer generate -- --write-keys $KEY_FILE"
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
# Volitelně heslo k klíči (pokud jsi ho při generování nastavil):
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="tvoje_heslo"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/build-universal.sh"
