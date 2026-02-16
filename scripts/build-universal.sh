#!/bin/bash
set -e

# Tauri CLI expects CI=true or CI=false; unset or CI=1 breaks the build
export CI=false

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Change to project root (parent of scripts directory)
cd "$SCRIPT_DIR/.."

echo "🔨 Building Universal Binary for macOS..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if x86_64 target is installed
if ! rustup target list --installed | grep -q "x86_64-apple-darwin"; then
    echo -e "${YELLOW}Installing x86_64-apple-darwin target...${NC}"
    rustup target add x86_64-apple-darwin
fi

# Build directories
AARCH64_DIR="src-tauri/target/aarch64-apple-darwin/release"
X86_64_DIR="src-tauri/target/x86_64-apple-darwin/release"
UNIVERSAL_DIR="src-tauri/target/release"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"

echo -e "${GREEN}Building for aarch64 (Apple Silicon)...${NC}"
npm run build:prod
npx tauri build --target aarch64-apple-darwin

echo -e "${GREEN}Building for x86_64 (Intel)...${NC}"
npx tauri build --target x86_64-apple-darwin

echo -e "${GREEN}Creating universal binary with lipo...${NC}"
# Create universal binary
mkdir -p "$UNIVERSAL_DIR"
lipo -create \
    "$AARCH64_DIR/jobi" \
    "$X86_64_DIR/jobi" \
    -output "$UNIVERSAL_DIR/jobi"

echo -e "${GREEN}Copying .app bundle structure...${NC}"
# Copy the .app bundle from aarch64 build (structure is the same)
cp -R "$AARCH64_DIR/bundle/macos/jobi.app" "$BUNDLE_DIR"
# Replace the binary with universal binary
cp "$UNIVERSAL_DIR/jobi" "$BUNDLE_DIR/jobi.app/Contents/MacOS/jobi"

echo -e "${GREEN}Creating ZIP archive...${NC}"
cd "$BUNDLE_DIR"
zip -r "../../../../jobi-universal.zip" jobi.app
cd - > /dev/null

echo -e "${GREEN}✅ Universal binary created: jobi-universal.zip${NC}"

