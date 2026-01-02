# Lingo Server

Background server for the lingo Claude Code plugin. Captures and analyzes user prompts for language learning purposes using the Claude Agent SDK.

## Features

- **Prompt Capture**: Saves prompts with corrections/significant alternatives to SQLite
- **Background Analysis**: Processes prompts asynchronously using Claude Haiku
- **Three Modes**: `silent` (background), `non-block` (show feedback), `block` (require acknowledgment)
- **Configurable Languages**: Set your mother language and learning language

## Installation

```bash
cd lingo-server
bun install
```

## Running

### Development
```bash
bun run dev
```

### Production (with pm2)
```bash
pm2 start ecosystem.config.cjs
```

## Configuration

Configuration is stored at `~/.config/lingo/config.json`:

```json
{
  "language": "English",
  "mode": "non-block",
  "model": "haiku",
  "claudeExecutablePath": "",
  "queueBatchSize": 5,
  "queueIntervalMs": 30000,
  "logLevel": "info",
  "tone": "balanced"
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `language` | `"English"` | Language you're learning (other languages will be translated) |
| `mode` | `"non-block"` | `"silent"` (background), `"non-block"` (show feedback), `"block"` (require acknowledgment) |
| `model` | `"haiku"` | Claude model for analysis |
| `claudeExecutablePath` | `""` | Path to Claude Code executable (optional) |
| `queueBatchSize` | `5` | Number of prompts to process in each batch |
| `queueIntervalMs` | `30000` | Interval between batch processing (ms) |
| `logLevel` | `"info"` | Log level: `"debug"`, `"info"`, `"warn"`, `"error"` |
| `tone` | `"balanced"` | Feedback tone: `"casual"`, `"balanced"`, `"professional"` |

### Changing Config at Runtime

```bash
# Get current config
curl http://localhost:41765/config

# Enable block mode
curl -X PUT http://localhost:41765/config \
  -H "Content-Type: application/json" \
  -d '{"mode": "block"}'
```

## API Endpoints

### `GET /health`
Health check endpoint.

### `GET /config`
Returns current configuration.

### `PUT /config`
Update configuration. Body: partial config object.

### `POST /prompt`
Receive a prompt for analysis.

**Request:**
```json
{
  "prompt": "user's prompt text",
  "timestamp": "2024-01-01T12:00:00Z",
  "session_id": "abc123",
  "cwd": "/path/to/current/directory",
  "project_dir": "/path/to/project"
}
```

**Response (silent mode):**
```json
{
  "success": true,
  "mode": "silent"
}
```

**Response (non-block/block mode, with correction):**
```json
{
  "success": true,
  "mode": "block",
  "correction": {
    "hasCorrection": true,
    "correctedText": "corrected version",
    "alternative": "alternative phrasing",
    "alternativeSignificant": false,
    "explanation": "explanation of corrections"
  }
}
```

## Data Storage

- **Database**: `~/.config/lingo/data.db`
- **Config**: `~/.config/lingo/config.json`

## Related

- [lingo plugin](../lingo) - Claude Code plugin that sends prompts to this server
