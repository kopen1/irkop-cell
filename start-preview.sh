#!/usr/bin/env bash
# Build frontend lalu jalankan preview proxy (serve dist/ + proxy /api ke backend).
set -e
cd "$(dirname "$0")/frontend"
echo "==> Build..."
npm run build
echo "==> Jalankan preview http://0.0.0.0:8788 ..."
cd ..
exec node /tmp/opencode/pages-proxy.mjs
