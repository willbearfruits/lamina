#!/usr/bin/env bash
# Downloads a portable Electron runtime into ./.electron so ./run.sh opens LAMINA as a desktop app. Linux x64.
set -e
cd "$(dirname "$0")"
VER="${1:-33.4.11}"
URL="https://github.com/electron/electron/releases/download/v${VER}/electron-v${VER}-linux-x64.zip"
mkdir -p .electron && cd .electron
echo "Downloading $URL"
curl -L -o electron.zip "$URL"
unzip -o -q electron.zip && rm electron.zip && chmod +x electron
echo "Electron v$VER installed in $(pwd). Run ../run.sh"
