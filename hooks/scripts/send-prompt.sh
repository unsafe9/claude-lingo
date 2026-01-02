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

# Extract correction data
has_correction=$(echo "$response" | jq -r '.correction.hasCorrection // false')
corrected_text=$(echo "$response" | jq -r '.correction.correctedText // empty')
explanation=$(echo "$response" | jq -r '.correction.explanation // empty')
alternative=$(echo "$response" | jq -r '.correction.alternative // empty')
significant=$(echo "$response" | jq -r '.correction.significant // false')
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

# Handle corrections
if [ "$has_correction" = "true" ]; then
  # Check if this is a translation (explanation contains "Translated from")
  is_translation=false
  if echo "$explanation" | grep -qi "Translated from"; then
    is_translation=true
  fi

  # Copy to clipboard if enabled
  if [ "$auto_copy" = "true" ]; then
    copy_to_clipboard "$corrected_text"
  fi

  if [ "$mode" = "block" ] && [ "$significant" = "true" ]; then
    # Block mode with significant correction: block the prompt
    if [ "$is_translation" = "true" ]; then
      # For translations: just show title and translated text
      jq -n \
        --arg corrected "$corrected_text" \
        '{
          "decision": "block",
          "reason": ("🌐 Lingo Translation\n\n" + $corrected)
        }'
    else
      jq -n \
        --arg corrected "$corrected_text" \
        --arg explanation "$explanation" \
        '{
          "decision": "block",
          "reason": ("📝 Lingo Correction\n\n" + $explanation + "\n\nImproved prompt: " + $corrected)
        }'
    fi
    exit 0
  else
    # Non-block mode or minor correction: show via systemMessage and continue
    if [ "$is_translation" = "true" ]; then
      # Translation: single line with translated text
      jq -n \
        --arg corrected "$corrected_text" \
        '{
          "continue": true,
          "systemMessage": ("🌐 " + $corrected)
        }'
    elif [ "$significant" = "true" ]; then
      # Significant correction: corrected text in systemMessage, explanation to stderr (verbose mode)
      echo "📝 Correction:" >&2
      echo "$explanation" >&2
      jq -n \
        --arg corrected "$corrected_text" \
        '{
          "continue": true,
          "systemMessage": ("📝 " + $corrected)
        }'
    else
      # Minor fix: single line with explanation only (no corrected text)
      jq -n \
        --arg explanation "$explanation" \
        '{
          "continue": true,
          "systemMessage": ("📝 " + $explanation)
        }'
    fi
    exit 0
  fi
elif [ -n "$alternative" ] && [ "$alternative" != "null" ]; then
  # Alternative: alternative in systemMessage, explanation to stderr (verbose mode)
  echo "💬 Alternative:" >&2
  echo "$explanation" >&2
  jq -n \
    --arg alternative "$alternative" \
    '{
      "continue": true,
      "systemMessage": ("💬 " + $alternative)
    }'
  exit 0
fi

echo "$CONTINUE_RESPONSE"
exit 0
