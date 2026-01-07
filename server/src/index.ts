// Initialize logger first (overrides console methods)
import "./logger.js";
import { setLogLevel } from "./logger.js";

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
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
import {
  insertPrompt,
  closeDb,
  getReviewItemsDue,
  getReviewItemById,
  updateReviewItem,
  countReviewItemsDue,
  createReviewItem,
  getStreakData,
  updateStreakAfterReview,
  recordDailyActivity,
  getHeatmapData,
  getAllCategoriesWithCounts,
  getStatsSummary,
  type ReviewItemWithPrompt,
} from "./database.js";
import {
  rateCard,
  numberToGrade,
  stateToString,
  stringToState,
  createNewCard,
  State,
  type FSRSCardState,
} from "./fsrs.js";
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

import type { AnalysisResult, AnalysisType, Explanation } from "./analyzer.js";
import type { Mode } from "./validation.js";

interface PromptResponse {
  success: boolean;
  mode?: string;
  skip?: boolean;
  autoCopyCorrections?: boolean;
  analysis?: {
    type: AnalysisType;
    text: string | null;
    explanations: Explanation[];
    summary: string | null;
  };
  error?: string;
}

function buildPromptResponse(result: AnalysisResult, mode: Mode, autoCopyCorrections: boolean): PromptResponse {
  if (result.type === "skip") {
    return { success: true, mode, skip: true };
  }
  return {
    success: true,
    mode,
    autoCopyCorrections,
    analysis: {
      type: result.type,
      text: result.text,
      explanations: result.explanations,
      summary: result.summary,
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

// ============================================
// Review API Routes (for web dashboard)
// ============================================

// Get items due for review
app.get("/api/review/due", (c) => {
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const category = c.req.query("category") || undefined;

  const items = getReviewItemsDue(limit, category);
  const totalDue = countReviewItemsDue();

  return c.json({ items, totalDue });
});

// Get review statistics
app.get("/api/review/stats", (c) => {
  const range = (c.req.query("range") || "week") as "day" | "week" | "month" | "all";
  const stats = getStatsSummary(range);
  const streaks = getStreakData();
  const dueCount = countReviewItemsDue();

  return c.json({
    ...stats,
    itemsDueForReview: dueCount,
    currentStreak: streaks.current_streak,
    bestStreak: streaks.best_streak,
  });
});

// Rate a review item (submit answer)
app.post("/api/review/:id/rate", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ success: false, error: "Invalid item ID" }, 400);
  }

  let body: { rating: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const rating = body.rating;
  if (![1, 2, 3, 4].includes(rating)) {
    return c.json({ success: false, error: "Rating must be 1-4" }, 400);
  }

  // Get the review item
  const item = getReviewItemById(id);
  if (!item) {
    return c.json({ success: false, error: "Item not found" }, 404);
  }

  // Convert DB state to FSRS card state
  const cardState: FSRSCardState = {
    state: stringToState(item.state),
    difficulty: item.difficulty,
    stability: item.stability,
    reps: item.reps,
    lapses: item.lapses,
    scheduledDays: 0,
    elapsedDays: 0,
    learningSteps: 0,
    lastReview: item.last_review ? new Date(item.last_review) : null,
    due: item.due ? new Date(item.due) : new Date(),
  };

  // Rate the card using FSRS
  const grade = numberToGrade(rating as 1 | 2 | 3 | 4);
  const now = new Date();
  const newState = rateCard(cardState, grade, now);

  // Update the database
  updateReviewItem(
    id,
    stateToString(newState.state),
    newState.difficulty,
    newState.stability,
    newState.reps,
    newState.lapses,
    newState.scheduledDays,
    newState.elapsedDays,
    newState.due.toISOString(),
    now.toISOString()
  );

  // Record daily activity and update streak
  const isCorrect = rating >= 3; // Good or Easy = correct
  recordDailyActivity(isCorrect);
  const streak = updateStreakAfterReview();

  return c.json({
    success: true,
    nextDue: newState.due.toISOString(),
    currentStreak: streak.current_streak,
  });
});

// Get streak data
app.get("/api/streaks", (c) => {
  const streaks = getStreakData();
  return c.json(streaks);
});

// Get heatmap data
app.get("/api/heatmap", (c) => {
  const months = parseInt(c.req.query("months") || "6", 10);
  const data = getHeatmapData(months);
  return c.json(data);
});

// Get all categories with counts
app.get("/api/categories", (c) => {
  const categories = getAllCategoriesWithCounts();
  return c.json(categories);
});

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
        return c.json(buildPromptResponse(cachedResult, config.mode, config.autoCopyCorrections));
      }

      // Check if there's an in-flight request for the same prompt
      const inFlight = getInFlightRequest(sessionId, data.prompt);
      if (inFlight) {
        console.debug(`Waiting for in-flight analysis of same prompt`);
        const result = await inFlight;
        return c.json(buildPromptResponse(result, config.mode, config.autoCopyCorrections));
      }

      // Get recent prompts for context
      const recentPrompts = getRecentPrompts(sessionId, data.prompt);

      // Create and register the analysis promise
      const analysisPromise = analyzePrompt(
        data.prompt,
        config.language,
        config.tone,
        config.mode,
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
      // Pass corrected text to addRecentPrompt so corrected text is tracked instead of original
      cacheResult(sessionId, data.prompt, result);
      const correctedText = result.type === "translation" || result.type === "correction" ? result.text : null;
      addRecentPrompt(sessionId, data.prompt, correctedText);

      // Save to DB if there's something worth saving (not skip)
      if (result.type !== "skip") {
        setImmediate(() => {
          try {
            const hasCorrection = result.type === "translation" || result.type === "correction" || result.type === "comment";
            const correction = result.type === "translation" || result.type === "correction" ? result.text : null;
            const alternative = result.type === "alternative" ? result.text : null;
            const categories = result.explanations.map(e => e.category);

            const promptId = insertPrompt({
              ...promptData,
              analysis_result: result.explanations.map(e => e.detail).join("; "),
              has_correction: hasCorrection,
              correction,
              alternative,
              categories,
            });

            // Create review item for spaced repetition if there's something to learn
            if (hasCorrection || alternative) {
              createReviewItem(promptId);
            }
          } catch (error) {
            console.error("Failed to insert prompt:", error);
          }
        });
      }

      return c.json(buildPromptResponse(result, config.mode, config.autoCopyCorrections));
    } catch (error) {
      console.error("Analysis error:", error);
      return c.json({ success: false, mode: config.mode, error: "Analysis failed" } as PromptResponse, 500);
    }
  }
);

// ============================================
// Dashboard Static File Serving (Production)
// ============================================

// Serve static assets from web/build at root
// This comes after all API routes, so API routes take precedence
app.use("/*", serveStatic({
  root: "../web/build",
}));

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

    try {
      // Connect to MCP server
      await mcpServer.connect(transport);

      // Handle the request
      return transport.handleRequest(c.req.raw);
    } catch (error) {
      // Clean up transport on connection failure
      console.error("MCP connection failed:", error);
      try {
        await transport.close();
      } catch {
        // Ignore close errors
      }
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal error: MCP connection failed",
          },
          id: null,
        },
        500
      );
    }
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
      return c.json({ success: true }, 200);
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
console.info(`Dashboard: http://localhost:${SERVER_PORT}/`);

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

// Shutdown state
let isShuttingDown = false;

// Graceful shutdown (SIGTERM and SIGINT)
async function gracefulShutdown() {
  if (isShuttingDown) {
    console.warn("Shutdown already in progress, forcing exit...");
    process.exit(1);
  }
  isShuttingDown = true;

  console.info("Shutting down gracefully...");

  // Stop accepting new connections
  server.stop();

  // Close all MCP transports
  for (const [id, transport] of mcpTransports) {
    try {
      await transport.close();
      console.debug(`MCP session closed: ${id}`);
    } catch (error) {
      console.warn(`Failed to close MCP session ${id}:`, error);
    }
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

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
