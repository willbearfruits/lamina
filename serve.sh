#!/usr/bin/env bash
# Serve LAMINA locally (no build step). Usage: ./serve.sh [port]   → http://localhost:8790
cd "$(dirname "$0")"
PORT="${1:-8790}"
if command -v node >/dev/null; then exec node serve.mjs "$PORT"; fi
echo "node not found — falling back to python (browser may cache files; hard-reload with Ctrl+Shift+R)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
