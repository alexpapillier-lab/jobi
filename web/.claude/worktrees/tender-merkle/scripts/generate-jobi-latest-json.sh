#!/bin/bash
# Generates latest.json for Tauri updater (static JSON) from a signed macOS build.
# Single-arch: run after "export TAURI_SIGNING_PRIVATE_KEY=...; npm run tauri build"
# Universal:    run after "scripts/build-universal.sh" (with signing key set)
# Usage: generate-jobi-latest-json.sh [universal] [output.json]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
BUNDLE_MACOS="$ROOT/src-tauri/target/release/bundle/macos"
CONFIG="$ROOT/src-tauri/tauri.conf.json"

UNIVERSAL=false
if [ "${1:-}" = "universal" ]; then
  UNIVERSAL=true
  shift
fi
OUTPUT_FILE="${1:-$ROOT/latest.json}"

if [ ! -f "$CONFIG" ]; then
  echo "Error: tauri.conf.json not found at $CONFIG" >&2
  exit 1
fi

# Product name from tauri.conf (default jobi)
PRODUCT_NAME="$(node -e "console.log(require('$CONFIG').productName || 'jobi')")"
VERSION="$(node -e "console.log(require('$CONFIG').version || '0.0.0')")"

TAR_GZ="$BUNDLE_MACOS/$PRODUCT_NAME.app.tar.gz"
SIG_FILE="$BUNDLE_MACOS/$PRODUCT_NAME.app.tar.gz.sig"

if [ ! -f "$TAR_GZ" ]; then
  echo "Error: Build artifact not found: $TAR_GZ" >&2
  echo "Run first: export TAURI_SIGNING_PRIVATE_KEY=\"\$(cat ~/.tauri/jobi.key)\"; npm run tauri build" >&2
  echo "Or for universal: export TAURI_SIGNING_PRIVATE_KEY=...; bash scripts/build-universal.sh" >&2
  exit 1
fi

if [ ! -f "$SIG_FILE" ]; then
  echo "Error: Signature not found: $SIG_FILE" >&2
  echo "Build with TAURI_SIGNING_PRIVATE_KEY set to generate .sig" >&2
  exit 1
fi

# GitHub Releases URL for "latest" release (same repo as in tauri.conf endpoints)
GITHUB_RELEASES_URL="https://github.com/alexpapillier-lab/jobi/releases/latest/download"
DOWNLOAD_URL="$GITHUB_RELEASES_URL/$PRODUCT_NAME.app.tar.gz"

# Signature: entire content of .sig file (minisign format), must be valid JSON string
SIGNATURE="$(cat "$SIG_FILE" | jq -Rs .)"

# pub_date RFC 3339
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ "$UNIVERSAL" = true ]; then
  # One .tar.gz for both architectures (universal binary) – same URL and signature for both
  jq -n \
    --arg version "$VERSION" \
    --arg pub_date "$PUB_DATE" \
    --arg url "$DOWNLOAD_URL" \
    --argjson signature "$SIGNATURE" \
    '{
      version: $version,
      notes: "See GitHub Releases for details.",
      pub_date: $pub_date,
      platforms: {
        "darwin-aarch64": { signature: $signature, url: $url },
        "darwin-x86_64":  { signature: $signature, url: $url }
      }
    }' > "$OUTPUT_FILE"
  echo "Written: $OUTPUT_FILE (universal – darwin-aarch64 + darwin-x86_64)"
else
  # Single platform (current arch only)
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)   PLATFORM="darwin-aarch64" ;;
    x86_64)  PLATFORM="darwin-x86_64" ;;
    *)       echo "Error: Unsupported arch $ARCH" >&2; exit 1 ;;
  esac
  jq -n \
    --arg version "$VERSION" \
    --arg pub_date "$PUB_DATE" \
    --arg platform "$PLATFORM" \
    --arg url "$DOWNLOAD_URL" \
    --argjson signature "$SIGNATURE" \
    '{
      version: $version,
      notes: "See GitHub Releases for details.",
      pub_date: $pub_date,
      platforms: {
        ($platform): {
          signature: $signature,
          url: $url
        }
      }
    }' > "$OUTPUT_FILE"
  echo "Written: $OUTPUT_FILE"
  echo "Platform: $PLATFORM"
fi

echo "Version: $VERSION"
echo ""
echo "Upload to GitHub Releases (tag e.g. v$VERSION):"
echo "  1. latest.json"
echo "  2. $PRODUCT_NAME.app.tar.gz"
echo "  3. $PRODUCT_NAME.app.tar.gz.sig"
echo ""
echo "Endpoint in app: $GITHUB_RELEASES_URL/latest.json"
