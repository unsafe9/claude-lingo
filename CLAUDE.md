# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lingo is a Claude Code plugin for language learning. It captures user prompts via Claude Code hooks, analyzes them for grammar/vocabulary issues using Claude AI, and provides real-time corrections and suggestions.

## Commands

```bash
# Server (from server/ directory)
bun install                      # Install dependencies
bun run dev                      # Development with hot reload
bun run typecheck                # TypeScript type checking
pm2 start ecosystem.config.cjs   # Production with pm2
```

## Architecture

Two components communicate over HTTP on port 41765:

1. **Hooks** (`hooks/`) - Shell scripts triggered by Claude Code events:
   - `SessionStart` hook runs `ensure-process.sh` which manages the server via pm2, auto-installs pm2 if needed, handles version upgrades by comparing package.json version with stored running version, and reports status back to the user
   - `UserPromptSubmit` hook sends prompts to the server for analysis

2. **Server** (`server/`) - Bun + Hono HTTP server providing:
   - REST API for health, config, and prompt submission
   - MCP endpoint for Claude Code tool integration
   - Background queue processor for async analysis

### Claude Agent SDK Integration

The server uses `@anthropic-ai/claude-agent-sdk` to analyze prompts (`claude.ts`). It calls `query()` with `permissionMode: "bypassPermissions"` for non-interactive analysis. The SDK auto-detects the Claude executable path or uses the configured path.

### Operating Modes

- `silent` - Queue prompts for background analysis, no feedback
- `non-block` - Analyze immediately, show feedback inline
- `block` - Analyze immediately, block until acknowledged

## Configuration

Runtime config at `~/.config/lingo/config.json` with hot-reload support. Can be updated via MCP tools or REST API.

## Database

SQLite at `~/.config/lingo/data.db` with migration system. Stores analyzed prompts with corrections, categories, and spaced repetition metadata.
