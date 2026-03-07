#!/bin/bash
# Universal build s signing klíčem: z env TAURI_SIGNING_PRIVATE_KEY (Release App) nebo z ~/.tauri/jobi.key.

set -e

KEY_FILE="${TAURI_SIGNING_KEY_FILE:-$HOME/.tauri/jobi.key}"

if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  # Klíč už je v env (např. z Release App Keychain)
  :
elif [ -f "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
else
  echo "Error: Signing key not found. Set TAURI_SIGNING_PRIVATE_KEY or have $KEY_FILE"
  echo "Generate with: npm run tauri signer generate -w $KEY_FILE"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/build-universal.sh"
