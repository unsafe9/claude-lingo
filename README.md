# Lingo Plugin

A Claude Code plugin that captures user prompts for language learning analysis. Provides real-time grammar corrections, translations, and alternative suggestions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │           Hooks               │
           │  ┌─────────────────────────┐  │
           │  │ SessionStart            │  │ ← Ensures server is running
           │  │ UserPromptSubmit        │  │ ← Sends prompts to server
           │  └─────────────────────────┘  │
           └───────────────┬───────────────┘
                           │ HTTP POST /prompt
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Lingo Server (Bun + Hono)                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  REST API    │  │  MCP Server  │  │  Background Queue    │  │
│  │  /health     │  │  /mcp        │  │  (silent mode)       │  │
│  │  /config     │  │              │  │                      │  │
│  │  /prompt     │  │  get_config  │  │  Batch processing    │  │
│  │              │  │  update_cfg  │  │  with intervals      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Analyzer                               │  │
│  │  Claude Agent SDK → haiku/sonnet → JSON response         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│         ┌─────────────────┴─────────────────┐                  │
│         ▼                                   ▼                  │
│  ┌──────────────┐                  ┌──────────────┐            │
│  │ Session Cache│                  │   SQLite DB  │            │
│  │ (in-memory)  │                  │  (persistent)│            │
│  └──────────────┘                  └──────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Description |
|-----------|-------------|
| `hooks/` | Claude Code hooks for session/prompt events |
| `server/src/index.ts` | Hono HTTP server with REST + MCP endpoints |
| `server/src/analyzer.ts` | Claude Agent SDK integration for analysis |
| `server/src/mcp.ts` | MCP server with config tools |
| `server/src/database.ts` | SQLite storage for corrections |
| `server/src/session-cache.ts` | In-memory cache, deduplication |
| `server/src/config.ts` | Hot-reloadable configuration |

## Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `silent` | Queue prompts, analyze in background, no feedback | Non-intrusive learning |
| `non-block` | Analyze immediately, show feedback | Active learning |
| `block` | Analyze immediately, block until acknowledged | Strict correction |

## Setup

```bash
cd claude-plugins/lingo/server
bun install
pm2 start ecosystem.config.cjs  # Production
bun run dev                      # Development (hot reload)
```

## Configuration

**Location:** `~/.config/lingo/config.json`

```json
{
  "language": "English",
  "mode": "non-block",
  "model": "haiku",
  "tone": "balanced",
  "logLevel": "info",
  "queueBatchSize": 5,
  "queueIntervalMs": 30000
}
```

**Update via MCP (in Claude Code):**
```
Update lingo config: mode block, logLevel debug
```

**Update via API:**
```bash
curl -X PUT http://localhost:41765/config \
  -H "Content-Type: application/json" \
  -d '{"mode": "block", "logLevel": "debug"}'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status, queue count, active sessions |
| `/config` | GET | Current configuration |
| `/config` | PUT | Update configuration |
| `/prompt` | POST | Submit prompt for analysis |
| `/mcp` | ALL | MCP streamable HTTP endpoint |

## Analysis Features

- Grammar and spelling correction
- Non-English text translation (Korean, Japanese, etc.)
- Alternative phrasing suggestions
- Configurable tone (casual, balanced, professional)
- Session context awareness (avoids repeating suggestions)
- Skips code, commands, and brief confirmations
