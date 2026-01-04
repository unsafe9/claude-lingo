# Lingo

A Claude Code plugin for language learning. Analyzes your prompts in real-time and provides corrections and suggestions.

## Features

- **Grammar & Spelling Correction** - Catches errors and explains what's wrong
- **Translation** - Translates non-English text (Korean, Japanese, etc.)
- **Alternative Suggestions** - Offers better ways to phrase things
- **Smart Filtering** - Skips code, commands, and brief confirmations
- **Session Awareness** - Avoids repeating similar suggestions

## Operating Modes

All modes use identical Claude-powered analysis—the difference is timing and presentation.

### Silent

Prompts are queued for background analysis with no immediate feedback. The background processor runs every 30 seconds (configurable via `queueIntervalMs`), analyzing batches of prompts and saving results to the database. Use MCP tools to review stored analysis later. Best for passive learning with minimal distraction.

**Output:** None—prompt continues immediately.

### Non-Block (Default)

Analysis happens immediately when you submit a prompt (adds 1-3 seconds delay). Feedback appears as an inline system message, then your prompt continues to Claude automatically. Results are cached for 5 minutes to avoid re-analyzing identical prompts. Best for active learning while maintaining workflow.

**Output by response type:**
- **Correction:** Comprehensive summary to stderr, corrected text in system message
  ```
  📝 Lingo Correction: Use past tense "went" and add the article "the" before "store".
  ──────────────────────────────────────────────────
  📝 Lingo Correction: I went to the store yesterday
  ```
- **Translation:** Translated text in system message
  ```
  🌐 Lingo Translation: Hello, how are you?
  ```
- **Alternative:** Explanation to stderr, suggested text in system message
  ```
  💬 Lingo Alternative: This phrasing sounds more natural in casual conversation.
  ──────────────────────────────────────────────────
  💬 Lingo Alternative: Can you help me with this?
  ```
- **Comment:** Explanation in system message (no corrected text)
  ```
  📝 Lingo Comment: Adding "please" would make this sound more polite.
  ```

### Block

Same immediate analysis as non-block (1-3 seconds delay), but corrections and translations display a blocking dialog requiring acknowledgment before continuing. Shows all detected issues with detailed explanations (not just the first one). Comments and alternatives remain non-blocking. Best for focused learning where you want to review every correction.

**Output by response type:**
- **Correction:** Blocks with all explanations and corrected text
  ```
  📝 Lingo Correction

  - Verb tense: Use past tense "went" for actions that happened yesterday
  - Subject verb agreement: Match verb form to subject

  Improved prompt: I went to the store yesterday
  ```
- **Translation:** Blocks with translated text
  ```
  🌐 Lingo Translation

  Hello, how are you?
  ```
- **Alternative/Comment:** Same as non-block (non-blocking)

## Installation

Install from the Claude Code marketplace:
```
/plugin marketplace add unsafe9/my-terminal
/plugin install lingo
```

The server starts automatically via pm2 when you open Claude Code.

## Configuration

Config file: `~/.config/lingo/config.json`

Update via MCP in Claude Code:
```
Update lingo config: mode block, language Japanese
```

| Option | Default | Description |
|--------|---------|-------------|
| `language` | `English` | Language you're learning |
| `mode` | `non-block` | Feedback mode |
| `model` | `haiku` | Claude model for analysis |
| `tone` | `balanced` | Feedback tone (casual/balanced/professional) |
