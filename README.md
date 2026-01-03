# Lingo

A Claude Code plugin for language learning. Analyzes your prompts in real-time and provides corrections and suggestions.

## Features

- **Grammar & Spelling Correction** - Catches errors and explains what's wrong
- **Translation** - Translates non-English text (Korean, Japanese, etc.)
- **Alternative Suggestions** - Offers better ways to phrase things
- **Smart Filtering** - Skips code, commands, and brief confirmations
- **Session Awareness** - Avoids repeating similar suggestions

## Modes

| Mode | Description |
|------|-------------|
| `silent` | Background analysis, no feedback |
| `non-block` | Shows feedback inline |
| `block` | Blocks until you acknowledge |

## Setup

```bash
cd server
bun install
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
