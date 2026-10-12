#!/bin/bash
# Builds the downloadable files into site/downloads/ (run on a Mac with Apple Silicon):
#   Photo-to-3D-app-arm64.zip / Photo-to-3D-app-win-x64.zip   the full app for each system
#       (Electron + app code + engine source + uv; the Python environment is made by the installer)
#   latest.json                                               size and SHA-256 of both zips
#   Photo-to-3D-Installer-arm64.dmg / Photo-to-3D-Setup-win-x64.exe   the small installer windows
#       (the .exe is one file: a 7-Zip self-extractor that starts the installer window)
# Usage: scripts/build-release.sh [base-url]   (default http://localhost:8791/downloads/)
# The Windows files are made from the Windows build of Electron, so nothing is compiled here.
# They are not signed: Windows SmartScreen will warn on the first start.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${1:-http://localhost:8791/downloads/}"
OUT="$ROOT/site/downloads"
WORK="$(mktemp -d)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/photo-to-3d-build"
ELECTRON="$ROOT/app/node_modules/electron/dist/Electron.app"
trap 'rm -rf "$WORK"' EXIT
trap 'echo "::error::build-release.sh failed at line $LINENO: $BASH_COMMAND"' ERR

[ -d "$ELECTRON" ] || { echo "::error::Electron is missing: run npm install in app/ (looked in $ELECTRON)"; exit 1; }
VERSION="$(node -p "require('$ROOT/app/package.json').version")"
ELECTRON_VERSION="$(node -p "require('$ROOT/app/node_modules/electron/package.json').version")"
UV_VERSION="$(uv --version | cut -d' ' -f2)"
mkdir -p "$OUT" "$CACHE"

# fetch URL FILE: downloads once, then reuses the copy in the cache
fetch() {
  if [ ! -s "$CACHE/$2" ]; then
    curl -fL --progress-bar -o "$CACHE/$2.part" "$1"
    mv "$CACHE/$2.part" "$CACHE/$2"
  fi
}

echo "==> Building the app code"
(cd "$ROOT/app" && npm run build >/dev/null)

echo "==> Getting uv $UV_VERSION and Electron $ELECTRON_VERSION for Windows"
UV_URL="https://github.com/astral-sh/uv/releases/download/$UV_VERSION"
fetch "$UV_URL/uv-aarch64-apple-darwin.tar.gz" "uv-$UV_VERSION-mac.tar.gz"
fetch "$UV_URL/uv-x86_64-pc-windows-msvc.zip" "uv-$UV_VERSION-win.zip"
fetch "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-win32-x64.zip" "electron-$ELECTRON_VERSION-win.zip"
# 7-Zip (LGPL, public domain SDK): 7zz packs the Windows installer on the Mac; 7zSD.sfx from the
# LZMA SDK is the stub that unpacks it to a temp folder, runs it and removes the folder afterwards
SEVENZIP_URL="https://www.7-zip.org/a"
fetch "$SEVENZIP_URL/7z2301-mac.tar.xz" "7z2301-mac.tar.xz"
fetch "$SEVENZIP_URL/lzma2301.7z" "lzma2301.7z"
mkdir -p "$WORK/7z-mac" "$WORK/7z-win"
tar -xf "$CACHE/7z2301-mac.tar.xz" -C "$WORK/7z-mac"
"$WORK/7z-mac/7zz" e -y -o"$WORK/7z-win" "$CACHE/lzma2301.7z" bin/7zSD.sfx >/dev/null
mkdir -p "$WORK/uv-mac" "$WORK/uv-win"
tar -xzf "$CACHE/uv-$UV_VERSION-mac.tar.gz" -C "$WORK/uv-mac" --strip-components=1
unzip -q "$CACHE/uv-$UV_VERSION-win.zip" -d "$WORK/uv-win"

# put_app RESOURCES UV_FILE: app code, engine source and uv inside a Resources folder
put_app() {
  local res="$1" uv="$2"
  mkdir -p "$res/app" "$res/bin"
  cp -R "$ROOT/app/out" "$res/app/out"
  cp -R "$ROOT/app/build" "$res/app/build"
  node -e "
    const p = require('$ROOT/app/package.json');
    require('fs').writeFileSync('$res/app/package.json', JSON.stringify({ name: p.name, version: p.version, main: p.main }, null, 2));
  "
  # the app starts the engine from ../engine (next to the app folder)
  rsync -a --exclude '.venv' --exclude '__pycache__' --exclude '.ruff_cache' --exclude '.pytest_cache' \
    --exclude 'tests' "$ROOT/engine/" "$res/engine/"
  cp "$uv" "$res/bin/"
}

# put_installer RESOURCES: installer window code
put_installer() {
  local res="$1"
  mkdir -p "$res/app"
  cp "$ROOT/installer/"{main.js,steps.js,preload.js,index.html,renderer.js,package.json} "$res/app/"
  printf '{ "baseUrl": "%s" }\n' "$BASE_URL" > "$res/app/config.json"
}

# make_mac DEST NAME ID: copy of Electron.app with its own name
make_mac() {
  ditto "$ELECTRON" "$1"
  rm -rf "$1/Contents/Resources/default_app.asar"
  # Electron treats an app as installed (app.isPackaged) only when the executable is not "Electron"
  mv "$1/Contents/MacOS/Electron" "$1/Contents/MacOS/$2"
  plutil -replace CFBundleExecutable -string "$2" "$1/Contents/Info.plist"
  plutil -replace CFBundleName -string "$2" "$1/Contents/Info.plist"
  plutil -replace CFBundleDisplayName -string "$2" "$1/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string "$3" "$1/Contents/Info.plist"
  plutil -replace CFBundleShortVersionString -string "$VERSION" "$1/Contents/Info.plist"
}

# make_win DEST EXE_NAME: Windows Electron folder with the exe renamed
make_win() {
  mkdir -p "$1"
  unzip -q "$CACHE/electron-$ELECTRON_VERSION-win.zip" -d "$1"
  mv "$1/electron.exe" "$1/$2.exe"
  rm -f "$1/resources/default_app.asar"
}

echo "==> Mac: app"
APP="$WORK/mac-app/Photo to 3D.app"
mkdir -p "$WORK/mac-app"
make_mac "$APP" "Photo to 3D" "com.sako4018.photo-to-3d"
put_app "$APP/Contents/Resources" "$WORK/uv-mac/uv"
codesign --force --deep -s - "$APP" 2>/dev/null
MAC_ZIP="Photo-to-3D-app-arm64.zip"
ditto -c -k --keepParent "$APP" "$OUT/$MAC_ZIP"

echo "==> Windows: app"
WINAPP="$WORK/win-app/Photo to 3D"
make_win "$WINAPP" "Photo to 3D"
put_app "$WINAPP/resources" "$WORK/uv-win/uv.exe"
WIN_ZIP="Photo-to-3D-app-win-x64.zip"
rm -f "$OUT/$WIN_ZIP"
(cd "$WORK/win-app" && zip -qr -9 "$OUT/$WIN_ZIP" "Photo to 3D")

meta() { # FILE: "size" and "sha256" of a built file
  printf '"file": "%s", "size": %s, "sha256": "%s"' "$1" "$(stat -f%z "$OUT/$1")" "$(shasum -a 256 "$OUT/$1" | cut -d' ' -f1)"
}
cat > "$OUT/latest.json" <<JSON
{
  "version": "$VERSION",
  "files": {
    "mac": { $(meta "$MAC_ZIP") },
    "win": { $(meta "$WIN_ZIP") }
  }
}
JSON

echo "==> Mac: installer"
INST="$WORK/dmg/Photo-to-3D Installer.app"
mkdir -p "$WORK/dmg"
make_mac "$INST" "photo-to-3d Installer" "com.sako4018.photo-to-3d.installer"
put_installer "$INST/Contents/Resources"
codesign --force --deep -s - "$INST" 2>/dev/null
rm -f "$OUT/Photo-to-3D-Installer-arm64.dmg"
hdiutil create -quiet -volname "photo-to-3d" -srcfolder "$WORK/dmg" -format UDZO "$OUT/Photo-to-3D-Installer-arm64.dmg"

echo "==> Windows: installer"
WININST="$WORK/win-inst/photo-to-3d Installer"
make_win "$WININST" "photo-to-3d Installer"
put_installer "$WININST/resources"
rm -f "$OUT/Photo-to-3D-Installer-win-x64.zip" "$OUT/Photo-to-3D-Setup-win-x64.exe"
(cd "$WORK/win-inst" && "$WORK/7z-mac/7zz" a -m0=LZMA2 -mf=BCJ -mx=5 -bso0 "$WORK/installer.7z" "photo-to-3d Installer")
cat > "$WORK/sfx.txt" <<'SFX'
;!@Install@!UTF-8!
Title="photo-to-3d installer"
Directory=""
RunProgram="\"%%T\\photo-to-3d Installer\\photo-to-3d Installer.exe\""
;!@InstallEnd@!
SFX
cat "$WORK/7z-win/7zSD.sfx" "$WORK/sfx.txt" "$WORK/installer.7z" > "$OUT/Photo-to-3D-Setup-win-x64.exe"

echo "==> Done"
ls -lh "$OUT"
