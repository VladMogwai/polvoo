#!/bin/bash
set -e

echo "🔨 Building local DMG..."
npm run build:local

DMG="dist/Dev Dashboard-$(node -p "require('./package.json').version")-arm64.dmg"

echo "📦 Installing..."
# Close app if running
pkill -f "Dev Dashboard" 2>/dev/null || true
sleep 1

# Mount DMG
MOUNT=$(hdiutil attach "$DMG" -nobrowse 2>/dev/null | grep '/Volumes/' | grep -o '/Volumes/.*')

# Copy app
rm -rf "/Applications/Dev Dashboard.app"
cp -R "$MOUNT/Dev Dashboard.app" /Applications/

# Unmount
hdiutil detach "$MOUNT" -quiet

# Remove quarantine
xattr -cr "/Applications/Dev Dashboard.app"

echo "✅ Installed! Launching..."
open "/Applications/Dev Dashboard.app"
