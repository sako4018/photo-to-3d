#!/bin/bash
# Builds the downloadable files into site/downloads/ (macOS, Apple Silicon):
#   Photo-to-3D-app-arm64.zip       the full app (Electron + app code + engine source)
#   latest.json                     size and SHA-256 of that zip
#   Photo-to-3D-Installer-arm64.dmg the small installer window that downloads the zip
# Usage: scripts/build-release.sh [base-url]   (default http://localhost:8791/downloads/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${1:-http://localhost:8791/downloads/}"
OUT="$ROOT/site/downloads"
WORK="$(mktemp -d)"
ELECTRON="$ROOT/app/node_modules/electron/dist/Electron.app"
trap 'rm -rf "$WORK"' EXIT

[ -d "$ELECTRON" ] || { echo "Electron is missing: run npm install in app/"; exit 1; }
VERSION="$(node -p "require('$ROOT/app/package.json').version")"
mkdir -p "$OUT"

echo "==> Building the app code"
(cd "$ROOT/app" && npm run build >/dev/null)

# Copies Electron.app, renames it and sets its name in Info.plist.
make_shell() {
  local dest="$1" name="$2" id="$3"
  ditto "$ELECTRON" "$dest"
  rm -rf "$dest/Contents/Resources/default_app.asar"
  plutil -replace CFBundleName -string "$name" "$dest/Contents/Info.plist"
  plutil -replace CFBundleDisplayName -string "$name" "$dest/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string "$id" "$dest/Contents/Info.plist"
  plutil -replace CFBundleShortVersionString -string "$VERSION" "$dest/Contents/Info.plist"
}

echo "==> Assembling Photo to 3D.app"
APP="$WORK/pack/Photo to 3D.app"
mkdir -p "$WORK/pack"
make_shell "$APP" "Photo to 3D" "com.sako4018.photo-to-3d"
RES="$APP/Contents/Resources"
mkdir -p "$RES/app"
cp -R "$ROOT/app/out" "$RES/app/out"
cp -R "$ROOT/app/build" "$RES/app/build"
node -e "
const p = require('$ROOT/app/package.json');
require('fs').writeFileSync('$RES/app/package.json', JSON.stringify({ name: p.name, version: p.version, main: p.main }, null, 2));
"
# the app starts the engine from ../engine (next to the app folder)
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude '.ruff_cache' --exclude '.pytest_cache' \
  --exclude 'tests' "$ROOT/engine/" "$RES/engine/"
codesign --force --deep -s - "$APP"

ZIP="Photo-to-3D-app-arm64.zip"
ditto -c -k --keepParent "$APP" "$OUT/$ZIP"
SIZE="$(stat -f%z "$OUT/$ZIP")"
SHA="$(shasum -a 256 "$OUT/$ZIP" | cut -d' ' -f1)"
cat > "$OUT/latest.json" <<JSON
{ "version": "$VERSION", "file": "$ZIP", "size": $SIZE, "sha256": "$SHA" }
JSON

echo "==> Assembling the installer"
INST="$WORK/dmg/Photo-to-3D Installer.app"
mkdir -p "$WORK/dmg"
make_shell "$INST" "photo-to-3d Installer" "com.sako4018.photo-to-3d.installer"
mkdir -p "$INST/Contents/Resources/app"
cp "$ROOT/installer/"{main.js,preload.js,index.html,renderer.js,package.json} "$INST/Contents/Resources/app/"
printf '{ "baseUrl": "%s" }\n' "$BASE_URL" > "$INST/Contents/Resources/app/config.json"
codesign --force --deep -s - "$INST"

rm -f "$OUT/Photo-to-3D-Installer-arm64.dmg"
hdiutil create -quiet -volname "photo-to-3d" -srcfolder "$WORK/dmg" -format UDZO "$OUT/Photo-to-3D-Installer-arm64.dmg"

echo "==> Done"
ls -lh "$OUT"
