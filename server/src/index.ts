// Initialize logger first (overrides console methods)
import "./logger.js";
import { setLogLevel } from "./logger.js";

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpServer } from "./mcp.js";
import {
  getConfig,
  getConfigPath,
  SERVER_VERSION,
  saveConfig,
  startConfigWatcher,
  stopConfigWatcher,
  onConfigChange,
  SERVER_PORT,
} from "./config.js";
import { insertPrompt, closeDb } from "./database.js";
import { analyzePrompt, startBackgroundProcessor, stopBackgroundProcessor, waitForQueueDrain, queuePromptForAnalysis, getPendingQueueCount } from "./analyzer.js";
import { PromptRequestSchema, ConfigUpdateSchema, formatZodErrors } from "./validation.js";
import {
  getCachedResult,
  cacheResult,
  getInFlightRequest,
  setInFlightRequest,
  clearInFlightRequest,
  addRecentPrompt,
  getRecentPrompts,
  startSessionCleanup,
  stopSessionCleanup,
  getSessionStats,
} from "./session-cache.js";

interface PromptResponse {
  success: boolean;
  mode?: string;
  skip?: boolean;
  correction?: {
    hasCorrection: boolean;
    correctedText: string | null;
    alternative: string | null;
    significant: boolean;
    explanation: string;
  };
  error?: string;
}

import type { AnalysisResult } from "./analyzer.js";

function buildPromptResponse(result: AnalysisResult, mode: string): PromptResponse {
  if (result.skip) {
    return { success: true, mode, skip: true };
  }
  return {
    success: true,
    mode,
    correction: {
      hasCorrection: result.hasCorrection,
      correctedText: result.correction,
      alternative: result.alternative,
      significant: result.significant,
      explanation: result.explanation,
    },
  };
}

const app = new Hono();

// Request logging middleware (skip /mcp - too frequent with streamable HTTP)
app.use("*", async (c, next) => {
  const path = c.req.path;

  if (path === "/mcp") {
    return next();
  }

  const start = Date.now();
  const method = c.req.method;

  console.debug(`→ ${method} ${path}`);

  await next();

  const duration = Date.now() - start;
  console.debug(`← ${method} ${path} ${c.res.status} (${duration}ms)`);
});

// Health check endpoint
app.get("/health", (c) => {
  const config = getConfig();
  const sessionStats = getSessionStats();
  return c.json({
    status: "ok",
    version: SERVER_VERSION,
    configPath: getConfigPath(),
    pendingPrompts: getPendingQueueCount(),
    mode: config.mode,
    activeSessions: sessionStats.sessions,
    cachedPrompts: sessionStats.totalCached,
  });
});

// Get current config
app.get("/config", (c) => {
  const config = getConfig();
  return c.json(config);
});

// Update config
app.put(
  "/config",
  zValidator("json", ConfigUpdateSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, errors: formatZodErrors(result.error) }, 400);
    }
  }),
  (c) => {
    const updates = c.req.valid("json");
    const config = getConfig();
    const newConfig = { ...config, ...updates };

    // Save config (watcher will auto-reload)
    saveConfig(newConfig);

    return c.json({ success: true, config: newConfig });
  }
);

// Main prompt endpoint
app.post(
  "/prompt",
  zValidator("json", PromptRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, errors: formatZodErrors(result.error) } as PromptResponse, 400);
    }
  }),
  async (c) => {
    const data = c.req.valid("json");
    const config = getConfig();
    const sessionId = data.session_id || "unknown";
    const promptData = {
      prompt: data.prompt,
      timestamp: data.timestamp || new Date().toISOString(),
      session_id: sessionId,
      cwd: data.cwd || "",
      project_dir: data.project_dir || "",
    };

    if (config.mode === "silent") {
      // Silent mode: queue for background analysis, respond immediately
      queuePromptForAnalysis(promptData);
      addRecentPrompt(sessionId, data.prompt);
      return c.json({ success: true, mode: "silent" });
    }

    // Non-block & Block modes: analyze immediately, return result
    try {
      // Check cache first
      const cachedResult = getCachedResult(sessionId, data.prompt);
      if (cachedResult) {
        return c.json(buildPromptResponse(cachedResult, config.mode));
      }

      // Check if there's an in-flight request for the same prompt
      const inFlight = getInFlightRequest(sessionId, data.prompt);
      if (inFlight) {
        console.debug(`Waiting for in-flight analysis of same prompt`);
        const result = await inFlight;
        return c.json(buildPromptResponse(result, config.mode));
      }

      // Get recent prompts for context
      const recentPrompts = getRecentPrompts(sessionId, data.prompt);

      // Create and register the analysis promise
      const analysisPromise = analyzePrompt(
        data.prompt,
        config.language,
        config.tone,
        recentPrompts
      );
      setInFlightRequest(sessionId, data.prompt, analysisPromise);

      let result: AnalysisResult;
      try {
        result = await analysisPromise;
      } finally {
        clearInFlightRequest(sessionId, data.prompt);
      }

      // Cache the result and track in recent history
      // Pass correction to addRecentPrompt so corrected text is tracked instead of original
      cacheResult(sessionId, data.prompt, result);
      addRecentPrompt(sessionId, data.prompt, result.correction);

      // Save to DB if there's a correction OR an alternative
      if (!result.skip && (result.hasCorrection || result.alternative)) {
        setImmediate(() => {
          try {
            insertPrompt({
              ...promptData,
              analyzed: true,
              analysis_result: result.explanation,
              has_correction: result.hasCorrection,
              correction: result.correction,
              alternative: result.alternative,
            });
          } catch (error) {
            console.error("Failed to insert prompt:", error);
          }
        });
      }

      return c.json(buildPromptResponse(result, config.mode));
    } catch (error) {
      console.error("Analysis error:", error);
      return c.json({ success: false, mode: config.mode, error: "Analysis failed" } as PromptResponse, 500);
    }
  }
);

// MCP Streamable HTTP endpoint
// Store transports by session ID for session management
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

// MCP endpoint - handles all HTTP methods (GET, POST, DELETE)
app.all("/mcp", async (c) => {
  // Get session ID from header
  const sessionId = c.req.header("mcp-session-id");

  // For POST without session ID (initialization), create new transport
  if (c.req.method === "POST" && !sessionId) {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        mcpTransports.set(id, transport);
        console.debug(`MCP session initialized: ${id}`);
      },
    });

    // Connect to MCP server
    await mcpServer.connect(transport);

    // Handle the request
    return transport.handleRequest(c.req.raw);
  }

  // For requests with session ID, use existing transport
  if (sessionId) {
    const transport = mcpTransports.get(sessionId);

    // Session not found (e.g., server restarted) - return JSON-RPC error
    // Client should retry without session ID to establish a new session
    if (!transport) {
      console.debug(`MCP session not found: ${sessionId} (server may have restarted)`);
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Session expired or not found. Please reinitialize.",
          },
          id: null,
        },
        404
      );
    }

    // Handle DELETE for session cleanup
    if (c.req.method === "DELETE") {
      await transport.close();
      mcpTransports.delete(sessionId);
      console.debug(`MCP session closed: ${sessionId}`);
    }

    return transport.handleRequest(c.req.raw);
  }

  // Non-POST requests without session ID
  return c.json({ error: "Missing mcp-session-id header" }, 400);
});

// Start server
const config = getConfig();

// Set log level from config
setLogLevel(config.logLevel);

// Register config change listener
onConfigChange((newConfig) => {
  console.info(`Mode: ${newConfig.mode}`);
  console.info(`Language: ${newConfig.language}`);
  setLogLevel(newConfig.logLevel);
});

console.info(`Lingo server v${SERVER_VERSION} running on http://localhost:${SERVER_PORT}`);
console.info(`Config: ${getConfigPath()}`);
console.info(`Mode: ${config.mode}`);
console.info(`Language: ${config.language}`);
console.info(`Log level: ${config.logLevel}`);
console.info(`MCP endpoint: http://localhost:${SERVER_PORT}/mcp`);

// Start background processor for queue mode
startBackgroundProcessor();

// Start config file watcher for hot reload
startConfigWatcher();

// Start session cleanup
startSessionCleanup();

const server = Bun.serve({
  port: SERVER_PORT,
  fetch: app.fetch,
});

// Graceful shutdown (SIGTERM)
async function gracefulShutdown() {
  console.info("Shutting down gracefully...");

  // Stop accepting new connections
  server.stop();

  // Close all MCP transports
  for (const [id, transport] of mcpTransports) {
    await transport.close();
    console.debug(`MCP session closed: ${id}`);
  }
  mcpTransports.clear();

  // Stop background processor (sets shutdown flag)
  stopBackgroundProcessor();

  // Wait for current processing to complete
  await waitForQueueDrain();

  // Stop config watcher
  stopConfigWatcher();

  // Stop session cleanup
  stopSessionCleanup();

  // Close database
  closeDb();

  console.info("Shutdown complete");
  process.exit(0);
}

// Force shutdown (SIGINT / Ctrl+C)
function forceShutdown() {
  console.warn("Force shutdown...");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", forceShutdown);
