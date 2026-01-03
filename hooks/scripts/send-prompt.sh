#!/bin/bash
set -uo pipefail

# Response for continuing (allow prompt through)
CONTINUE_RESPONSE='{"continue":true,"suppressOutput":true}'

ENDPOINT="http://localhost:41765/prompt"

# Read hook input from stdin
input=$(cat)

# Extract user prompt from input
user_prompt=$(echo "$input" | jq -r '.prompt // empty')

# Skip if no prompt
if [ -z "$user_prompt" ]; then
  echo "$CONTINUE_RESPONSE"
  exit 0
fi

# Quick filter for very short prompts (less than 5 chars)
if [ ${#user_prompt} -lt 5 ]; then
  echo "$CONTINUE_RESPONSE"
  exit 0
fi

# Extract metadata
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
cwd=$(echo "$input" | jq -r '.cwd // ""')
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build payload with full context
payload=$(jq -n \
  --arg prompt "$user_prompt" \
  --arg timestamp "$timestamp" \
  --arg session_id "$session_id" \
  --arg cwd "$cwd" \
  --arg project_dir "${CLAUDE_PROJECT_DIR:-}" \
  '{
    prompt: $prompt,
    timestamp: $timestamp,
    session_id: $session_id,
    cwd: $cwd,
    project_dir: $project_dir
  }')

# Send to endpoint - wait longer for non-block/block modes (may need Claude API call)
response=$(curl -s --max-time 30 -X POST \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$ENDPOINT" 2>&1)

curl_exit=$?

# Warn if server not available, but continue
if [ $curl_exit -ne 0 ] || echo "$response" | grep -q "Connection refused\|Failed to connect"; then
  echo "⚠️ Language learning server not available" >&2
  echo "$CONTINUE_RESPONSE"
  exit 0
fi

# Check mode and skip status
mode=$(echo "$response" | jq -r '.mode // "silent"')
is_skipped=$(echo "$response" | jq -r '.skip // false')

# Silent mode or skipped: just continue
if [ "$mode" = "silent" ] || [ "$is_skipped" = "true" ]; then
  echo "$CONTINUE_RESPONSE"
  exit 0
fi

# Extract analysis data
analysis_type=$(echo "$response" | jq -r '.analysis.type // "skip"')
analysis_text=$(echo "$response" | jq -r '.analysis.text // empty')
explanation=$(echo "$response" | jq -r '.analysis.explanation // empty')
auto_copy=$(echo "$response" | jq -r '.autoCopyCorrections // false')

# Copy to clipboard helper (macOS: pbcopy, Linux: xclip)
copy_to_clipboard() {
  local text="$1"
  if command -v pbcopy &> /dev/null; then
    echo -n "$text" | pbcopy
  elif command -v xclip &> /dev/null; then
    echo -n "$text" | xclip -selection clipboard
  fi
}

# Handle based on analysis type
case "$analysis_type" in
  "translation")
    # Copy to clipboard if enabled
    if [ "$auto_copy" = "true" ] && [ -n "$analysis_text" ]; then
      copy_to_clipboard "$analysis_text"
    fi

    if [ "$mode" = "block" ]; then
      # Block mode: block the prompt with translation
      jq -n \
        --arg text "$analysis_text" \
        '{
          "decision": "block",
          "reason": ("🌐 Lingo Translation\n\n" + $text)
        }'
    else
      # Non-block mode: show translation in systemMessage
      jq -n \
        --arg text "$analysis_text" \
        '{
          "continue": true,
          "systemMessage": ("🌐 Lingo Translation: " + $text)
        }'
    fi
    exit 0
    ;;

  "correction")
    # Copy to clipboard if enabled
    if [ "$auto_copy" = "true" ] && [ -n "$analysis_text" ]; then
      copy_to_clipboard "$analysis_text"
    fi

    if [ "$mode" = "block" ]; then
      # Block mode: block the prompt with correction
      jq -n \
        --arg text "$analysis_text" \
        --arg explanation "$explanation" \
        '{
          "decision": "block",
          "reason": ("📝 Lingo Correction\n\n" + $explanation + "\n\nImproved prompt: " + $text)
        }'
    else
      # Non-block mode: show correction in systemMessage, explanation to stderr
      echo "📝 Lingo Correction:" >&2
      echo "$explanation" >&2
      jq -n \
        --arg text "$analysis_text" \
        '{
          "continue": true,
          "systemMessage": ("📝 Lingo Correction: " + $text)
        }'
    fi
    exit 0
    ;;

  "comment")
    # Comment (minor observation): show explanation only, no text to copy
    jq -n \
      --arg explanation "$explanation" \
      '{
        "continue": true,
        "systemMessage": ("📝 Lingo Comment: " + $explanation)
      }'
    exit 0
    ;;

  "alternative")
    # Alternative suggestion
    echo "💬 Lingo Alternative:" >&2
    echo "$explanation" >&2
    jq -n \
      --arg text "$analysis_text" \
      '{
        "continue": true,
        "systemMessage": ("💬 Lingo Alternative: " + $text)
      }'
    exit 0
    ;;
esac

echo "$CONTINUE_RESPONSE"
exit 0
