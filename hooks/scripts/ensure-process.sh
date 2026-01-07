#!/bin/bash
set -euo pipefail

PROCESS_NAME="lingo"
ECOSYSTEM_FILE="${CLAUDE_PLUGIN_ROOT}/server/ecosystem.config.cjs"
PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
ENDPOINT="http://localhost:41765/health"

# Check if pm2 is available, install if not
if ! command -v pm2 &> /dev/null; then
  if command -v bun &> /dev/null; then
    bun install -g pm2 &> /dev/null
  elif command -v npm &> /dev/null; then
    npm install -g pm2 &> /dev/null
  fi

  if ! command -v pm2 &> /dev/null; then
    echo "⚠️ pm2 not installed. Run: npm install -g pm2" >&2
    exit 3
  fi
  echo "📦 pm2 installed automatically." >&2
fi

# Get plugin version from plugin.json
PLUGIN_VERSION="unknown"
if [[ -f "$PLUGIN_JSON" ]] && command -v jq &> /dev/null; then
  PLUGIN_VERSION=$(jq -r '.version // "unknown"' "$PLUGIN_JSON" 2>/dev/null) || PLUGIN_VERSION="unknown"
fi

# Check if server is healthy and get its version
HEALTH_RESPONSE=$(curl -s --max-time 2 "$ENDPOINT" 2>/dev/null) || HEALTH_RESPONSE=""

if [[ -n "$HEALTH_RESPONSE" ]]; then
  SERVER_VERSION=""
  if command -v jq &> /dev/null; then
    SERVER_VERSION=$(echo "$HEALTH_RESPONSE" | jq -r '.version // ""' 2>/dev/null) || SERVER_VERSION=""
  fi

  if [[ "$PLUGIN_VERSION" != "unknown" && -n "$SERVER_VERSION" && "$SERVER_VERSION" != "$PLUGIN_VERSION" ]]; then
    # Version mismatch, restart to upgrade
    pm2 restart "$PROCESS_NAME" 2>/dev/null || true
    sleep 0.3
    NEW_HEALTH=$(curl -s --max-time 2 "$ENDPOINT" 2>/dev/null) || NEW_HEALTH=""
    if [[ -n "$NEW_HEALTH" ]]; then
      NEW_VERSION=$(echo "$NEW_HEALTH" | jq -r '.version // ""' 2>/dev/null) || NEW_VERSION=""
      echo "🔄 Lingo updated to v$NEW_VERSION" >&2
      exit 3
    fi
  else
    echo "🌐 Lingo v$SERVER_VERSION" >&2
    exit 3
  fi
fi

# Ensure web dashboard build exists before starting server
WEB_BUILD_SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/ensure-web-build.sh"
if [[ -f "$WEB_BUILD_SCRIPT" ]]; then
  bash "$WEB_BUILD_SCRIPT" 2>/dev/null || true
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

# Wait for server to become healthy (up to 5 seconds)
for i in {1..10}; do
  sleep 0.5
  if curl -s --max-time 2 "$ENDPOINT" > /dev/null 2>&1; then
    echo "▶️ Lingo v$PLUGIN_VERSION started." >&2
    exit 3
  fi
done

echo "⚠️ Lingo background process is not running." >&2
exit 3
