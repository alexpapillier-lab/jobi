#!/bin/bash
# Sestaví SPOLEČNÝ výstup pro Cloudflare Pages:
#   /          – marketingový web (web/)
#   /servis/   – webová verze aplikace
#
# Díky tomu stačí jeden Pages projekt a jedna doména (appjobi.com).
# Výstup: dist-site/
#
# Cloudflare Pages:
#   Build command:  npm ci && npm run build:site
#   Output dir:     dist-site

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

OUT="$ROOT/dist-site"
APP_PATH="servis"

echo "==> Úklid $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> Marketingový web -> /"
cp -R web/. "$OUT"/
# README do nasazení nepatří
rm -f "$OUT/README.md"

echo "==> Aplikace -> /$APP_PATH/"
JOBI_WEB_BASE="/$APP_PATH/" npm run build:web
mkdir -p "$OUT/$APP_PATH"
cp -R dist-web/. "$OUT/$APP_PATH"/

echo "==> Skládám _headers"
# Hlavičky marketingového webu + hlavičky aplikace (ty už mají prefix /servis).
{
  cat web/_headers 2>/dev/null || true
  echo ""
  cat dist-web/_headers 2>/dev/null || true
} > "$OUT/_headers"
rm -f "$OUT/$APP_PATH/_headers"

echo "==> robots.txt do KOŘENE"
# robots.txt platí jen v kořeni domény; v /servis/ by ho roboti ignorovali.
# Aplikace je záložní nástroj pro servisy, nemá se indexovat.
cat > "$OUT/robots.txt" <<ROBOTS
# appjobi.com
# Webová verze Jobi (/servis/) je neveřejný záložní nástroj pro servisy.
User-agent: *
Disallow: /$APP_PATH/
ROBOTS

echo ""
echo "Hotovo: $OUT"
echo "  /            $(ls "$OUT" | grep -c . ) položek"
echo "  /$APP_PATH/  $(ls "$OUT/$APP_PATH" | wc -l | tr -d ' ') položek"
echo ""
echo "Lokální kontrola:"
echo "  python3 -m http.server 8080 --directory dist-site"
echo "  -> http://localhost:8080/  a  http://localhost:8080/$APP_PATH/"
