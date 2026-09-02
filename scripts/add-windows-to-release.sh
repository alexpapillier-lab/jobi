#!/bin/bash
# Doplní Windows instalátory k už existujícímu GitHub releasu.
#
# Windows build nejde udělat z macOS (ring v updateru potřebuje Windows
# C hlavičky), staví se na GitHub Actions. Tenhle skript ten build najde
# nebo spustí, počká na něj, stáhne artefakty a přiloží je k releasu.
#
# Použití:
#   scripts/add-windows-to-release.sh v0.2.4
#
# Vyžaduje gh přihlášené k repozitáři.

set -euo pipefail

REPO="alexpapillier-lab/jobi"
WORKFLOW="build-windows.yml"
TAG="${1:-}"

if [ -z "$TAG" ]; then
  echo "Chyba: zadej tag, např. $0 v0.2.4" >&2
  exit 1
fi

echo "== Windows k releasu $TAG =="

# 1) Release musí existovat, jinak není kam nahrávat.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Chyba: release $TAG neexistuje." >&2
  exit 1
fi

IS_PRE=$(gh release view "$TAG" --repo "$REPO" --json isPrerelease --jq .isPrerelease)
TAG_SHA=$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq '.object.sha' 2>/dev/null || echo "")
# anotovaný tag ukazuje na objekt tagu, ne na commit
if [ -n "$TAG_SHA" ]; then
  TYPE=$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq '.object.type')
  if [ "$TYPE" = "tag" ]; then
    TAG_SHA=$(gh api "repos/$REPO/git/tags/$TAG_SHA" --jq '.object.sha')
  fi
fi
echo "commit tagu: ${TAG_SHA:0:7}   pre-release: $IS_PRE"

# 2) Najít úspěšný běh nad TÍMTÉŽ commitem. Jinak by se do releasu dostaly
#    binárky z jiného kódu, než na který ukazuje tag.
RUN_ID=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 30 \
  --json databaseId,headSha,conclusion \
  --jq "[.[] | select(.headSha == \"$TAG_SHA\" and .conclusion == \"success\")] | first | .databaseId // empty")

if [ -z "$RUN_ID" ]; then
  echo "Pro tenhle commit zatím není hotový build, spouštím workflow…"
  gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$TAG"
  echo "Čekám, až se běh objeví…"
  for _ in $(seq 1 30); do
    sleep 10
    RUN_ID=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 10 \
      --json databaseId,headSha --jq "[.[] | select(.headSha == \"$TAG_SHA\")] | first | .databaseId // empty")
    [ -n "$RUN_ID" ] && break
  done
  if [ -z "$RUN_ID" ]; then
    echo "Chyba: běh se nespustil nebo ho nejde najít." >&2
    exit 1
  fi
  echo "Běh $RUN_ID – čekám na dokončení (trvá jednotky minut)…"
  gh run watch "$RUN_ID" --repo "$REPO" --exit-status
fi

echo "použitý běh: $RUN_ID"

# 3) Stáhnout artefakty
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN_ID" --repo "$REPO" -D "$TMP"

SETUP_EXE=$(find "$TMP" -name "jobi_*_x64-setup.exe" | head -1)
SETUP_SIG=$(find "$TMP" -name "jobi_*_x64-setup.exe.sig" | head -1)

if [ -z "$SETUP_EXE" ]; then
  echo "Chyba: v artefaktech není Jobi installer." >&2
  exit 1
fi

# 4) Mezery v názvu rozbíjejí URL ke stažení – přejmenovat.
UPLOAD=()
UPLOAD+=("$SETUP_EXE")
[ -n "$SETUP_SIG" ] && UPLOAD+=("$SETUP_SIG")

while IFS= read -r f; do
  [ -z "$f" ] && continue
  novy="$(dirname "$f")/$(basename "$f" | tr ' ' '.')"
  [ "$f" != "$novy" ] && mv "$f" "$novy"
  UPLOAD+=("$novy")
done < <(find "$TMP" -name "JobiDocs*.exe")

echo "nahrávám ${#UPLOAD[@]} souborů…"
gh release upload "$TAG" "${UPLOAD[@]}" --repo "$REPO" --clobber

# 5) latest.json – jen když máme podpis. Bez něj by updater nabídl
#    soubor, který neumí ověřit, a instalace by u uživatele selhala.
if [ -z "$SETUP_SIG" ]; then
  echo "Varování: chybí .sig, latest.json nechávám beze změny." >&2
  echo "== Hotovo (bez OTA pro Windows) =="
  exit 0
fi

if [ "$IS_PRE" = "true" ]; then
  BASE="https://github.com/$REPO/releases/download/$TAG"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

if gh release download "$TAG" --repo "$REPO" --pattern latest.json --dir "$TMP" --clobber 2>/dev/null; then
  jq --arg url "$BASE/$(basename "$SETUP_EXE")" \
     --argjson sig "$(jq -Rs . < "$SETUP_SIG")" \
     '.platforms["windows-x86_64"] = { signature: $sig, url: $url }' \
     "$TMP/latest.json" > "$TMP/latest.new.json"
  mv "$TMP/latest.new.json" "$TMP/latest.json"
  gh release upload "$TAG" "$TMP/latest.json" --repo "$REPO" --clobber
  echo "latest.json doplněn o windows-x86_64 → $BASE"
else
  echo "Varování: latest.json v releasu není, přeskakuji OTA záznam." >&2
fi

echo "== Hotovo =="
