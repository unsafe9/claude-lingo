#!/bin/bash
# Ensure web dashboard build exists
# 1. Check if build/ exists
# 2. Try downloading from GitHub release
# 3. Fall back to building locally

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_DIR/web"
BUILD_DIR="$WEB_DIR/build"

# Get version from server package.json
VERSION=$(grep '"version"' "$PROJECT_DIR/server/package.json" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')

# GitHub release URL
REPO="unsafe9/claude-lingo"
RELEASE_URL="https://github.com/$REPO/releases/download/v$VERSION/build.tar.gz"

# Check if build already exists
if [ -d "$BUILD_DIR" ] && [ -f "$BUILD_DIR/index.html" ]; then
    echo "Web build exists at $BUILD_DIR"
    exit 0
fi

echo "Web build not found, attempting to download..."

# Try downloading from GitHub release
mkdir -p "$BUILD_DIR"
cd "$WEB_DIR"

if curl -fsSL "$RELEASE_URL" -o build.tar.gz 2>/dev/null; then
    echo "Downloaded build from release v$VERSION"
    tar -xzf build.tar.gz
    rm build.tar.gz
    echo "Web build extracted successfully"
    exit 0
fi

echo "Release not found, building locally..."

# Fall back to building locally
if ! command -v bun &> /dev/null; then
    echo "Error: bun is required to build the web dashboard"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "$WEB_DIR/node_modules" ]; then
    echo "Installing web dependencies..."
    bun install
fi

# Build
echo "Building web dashboard..."
bun run build

echo "Web build complete"
