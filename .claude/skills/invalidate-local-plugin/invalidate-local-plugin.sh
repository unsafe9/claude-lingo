#!/bin/bash
set -e

echo "=== Invalidating Local Plugin Cache ==="

# Stop the lingo server via pm2
echo "Stopping lingo server..."
if command -v pm2 &> /dev/null; then
    pm2 stop lingo 2>/dev/null || echo "Server not running or already stopped"
    pm2 delete lingo 2>/dev/null || echo "No pm2 process to delete"
else
    echo "pm2 not found, skipping server stop"
fi

# Find and delete only the lingo plugin directory
PLUGIN_CACHE_DIR="$HOME/.claude/plugins"
echo "Searching for lingo plugin in: $PLUGIN_CACHE_DIR"

LINGO_DIR=""
for dir in $(find "$PLUGIN_CACHE_DIR" -type d -name "lingo" 2>/dev/null); do
    PLUGIN_JSON="$dir/.claude-plugin/plugin.json"
    if [ -f "$PLUGIN_JSON" ]; then
        NAME=$(jq -r '.name' "$PLUGIN_JSON" 2>/dev/null)
        AUTHOR=$(jq -r '.author.name' "$PLUGIN_JSON" 2>/dev/null)
        if [ "$NAME" = "lingo" ] && [ "$AUTHOR" = "unsafe9" ]; then
            LINGO_DIR="$dir"
            break
        fi
    fi
done

if [ -n "$LINGO_DIR" ]; then
    echo "Found lingo plugin at: $LINGO_DIR"
    rm -rf "$LINGO_DIR"
    echo "Lingo plugin cache deleted"
else
    echo "Lingo plugin directory not found in: $PLUGIN_CACHE_DIR"
fi

echo ""
echo "=== Done ==="
echo "Now restart Claude Code to re-download the plugin"
