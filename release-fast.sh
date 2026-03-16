#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./release-fast.sh 1.0.1"
  exit 1
fi

echo "⚡ Fast release v$VERSION (arm64 only)..."

npm version $VERSION --no-git-tag-version --allow-same-version

echo "📦 Building arm64 only..."
npm run dist

ARM64_FILE="dist/Dev Dashboard-$VERSION-arm64-mac.zip"
ARM64_HASH=$(shasum -a 256 "$ARM64_FILE" | awk '{print $1}')

echo "✅ arm64: $ARM64_HASH"

git add package.json
git commit -m "Release v$VERSION"
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"

echo "📤 Uploading to GitHub Release..."
gh release create "v$VERSION" \
  "$ARM64_FILE" \
  --title "Dev Dashboard $VERSION" \
  --notes "Release v$VERSION (Apple Silicon)"

echo "✅ GitHub Release created and files uploaded!"

TAP_DIR="../homebrew-dev-dashboard"

cat > "$TAP_DIR/Casks/dev-dashboard.rb" << EOF
cask "dev-dashboard" do
  version "$VERSION"

  sha256 "$ARM64_HASH"
  url "https://github.com/VladMogwai/dev-dashboard/releases/download/v$VERSION/Dev.Dashboard-$VERSION-arm64-mac.zip"

  name "Dev Dashboard"
  desc "Developer Project Dashboard — like Docker Desktop for local dev projects"
  homepage "https://github.com/VladMogwai/dev-dashboard"

  app "Dev Dashboard.app"

  uninstall quit: "com.devdashboard.app",
            delete: "/Applications/Dev Dashboard.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Dev Dashboard.app"],
                   sudo: false
  end
end
EOF

cd "$TAP_DIR"
git add .
git commit -m "Release v$VERSION"
git push

echo ""
echo "✅ Fast release v$VERSION is live!"
echo "👉 https://github.com/VladMogwai/dev-dashboard/releases/tag/v$VERSION"
