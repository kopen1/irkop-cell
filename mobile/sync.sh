#!/bin/bash
set -e

echo "=== Iirkop Cell - Mobile Build ==="

# 1. Build frontend
echo "[1/4] Building frontend..."
cd ../frontend
VITE_API_BASE=/api npm run build
echo "✓ Frontend built"

# 2. Install Capacitor deps
echo "[2/4] Installing Capacitor dependencies..."
cd ../mobile
npm install
echo "✓ Capacitor deps installed"

# 3. Initialize Capacitor (if android/ not exists)
if [ ! -d "android" ]; then
  echo "[3/4] Initializing Capacitor..."
  npx cap init "Iirkop Cell" "id.co.irkop.cell" --web-dir "../frontend/dist"
  npx cap add android
  echo "✓ Capacitor initialized"
else
  echo "[3/4] Capacitor already initialized, skipping..."
fi

# 4. Sync web assets to Android
echo "[4/4] Syncing web assets to Android..."
npx cap sync android
echo "✓ Sync complete"

echo ""
echo "=== Build Complete ==="
echo "Next steps:"
echo "  - Test: npx cap open android"
echo "  - Build APK: cd android && ./gradlew assembleRelease"
echo ""
