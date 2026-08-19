#!/usr/bin/env bash
# Launch LAMINA as a desktop app (Electron). Falls back to the browser via serve.sh when Electron is not available.
cd "$(dirname "$0")"
if [ -x ./.electron/electron ]; then exec ./.electron/electron . "$@"; fi
if [ -x ../stickfigures/.electron/electron ]; then exec ../stickfigures/.electron/electron . "$@"; fi
if command -v electron >/dev/null 2>&1; then exec electron . "$@"; fi
if [ -x ./node_modules/.bin/electron ]; then exec ./node_modules/.bin/electron . "$@"; fi
echo "Electron not found — starting the browser version instead (./serve.sh). To get the desktop app: npm i -D electron  (or copy an electron runtime into ./.electron/)"
exec ./serve.sh
