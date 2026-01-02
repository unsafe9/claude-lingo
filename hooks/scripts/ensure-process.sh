#!/bin/bash
set -euo pipefail

PROCESS_NAME="lingo"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/../../server" && pwd)"
ECOSYSTEM_FILE="$SERVER_DIR/ecosystem.config.cjs"
ENDPOINT="http://localhost:41765/health"

# Version tracking
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/lingo"
VERSION_FILE="$CONFIG_DIR/.running-version"
SERVER_PACKAGE_JSON="$SERVER_DIR/package.json"

# Check if pm2 is available, install if not
if ! command -v pm2 &> /dev/null; then
  # Try to install pm2 globally
  if command -v bun &> /dev/null; then
    bun install -g pm2 &> /dev/null
  elif command -v npm &> /dev/null; then
    npm install -g pm2 &> /dev/null
  fi

  # Check again after install attempt
  if ! command -v pm2 &> /dev/null; then
    echo "⚠️ pm2 not installed. Run: npm install -g pm2" >&2
    exit 3
  fi
  echo "📦 pm2 installed automatically." >&2
fi

# Get current server version from package.json
get_server_version() {
  if [[ -f "$SERVER_PACKAGE_JSON" ]] && command -v jq &> /dev/null; then
    jq -r '.version // "unknown"' "$SERVER_PACKAGE_JSON" 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

# Get stored running version
get_running_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    cat "$VERSION_FILE" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# Save running version
save_running_version() {
  mkdir -p "$CONFIG_DIR"
  echo "$1" > "$VERSION_FILE"
}

SERVER_VERSION=$(get_server_version)
RUNNING_VERSION=$(get_running_version)

# Check if server is already healthy (most reliable check)
if curl -s --max-time 2 "$ENDPOINT" > /dev/null 2>&1; then
  # Server is running - check if version changed
  if [[ "$SERVER_VERSION" != "unknown" && "$RUNNING_VERSION" != "" && "$SERVER_VERSION" != "$RUNNING_VERSION" ]]; then
    # Version changed, restart
    pm2 restart "$PROCESS_NAME" 2>/dev/null || true
    sleep 0.3
    if curl -s --max-time 2 "$ENDPOINT" > /dev/null 2>&1; then
      save_running_version "$SERVER_VERSION"
      echo "🔄 Lingo updated to v$SERVER_VERSION" >&2
      exit 3
    fi
  else
    # No version change, just report status
    if [[ "$RUNNING_VERSION" == "" ]]; then
      save_running_version "$SERVER_VERSION"
    fi
    echo "🌐 Lingo v$SERVER_VERSION" >&2
    exit 3
  fi
fi

# Server not healthy - try to start it
if pm2 list 2>/dev/null | grep -q "$PROCESS_NAME"; then
  # Process registered, try to start/restart
  pm2 start "$PROCESS_NAME" 2>/dev/null || pm2 restart "$PROCESS_NAME" 2>/dev/null || true
else
  # Process not registered, use ecosystem file
  if [[ -f "$ECOSYSTEM_FILE" ]]; then
    pm2 start "$ECOSYSTEM_FILE" 2>/dev/null || true
  fi
fi

sleep 0.5
if curl -s --max-time 2 "$ENDPOINT" > /dev/null 2>&1; then
  save_running_version "$SERVER_VERSION"
  echo "▶️ Lingo v$SERVER_VERSION started." >&2
  exit 3
fi

echo "⚠️ Lingo background process is not running." >&2
exit 3
