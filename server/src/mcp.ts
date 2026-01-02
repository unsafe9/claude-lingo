import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig, saveConfig, getConfigPath, SERVER_VERSION } from "./config.js";
import { ConfigSchema, ToneSchema, LogLevelSchema, ModeSchema, TimeRangeSchema, GroupBySchema } from "./validation.js";
import { gatherReviewData, analyzeWithAI, formatReviewOutput } from "./review.js";

// Create MCP server instance
export const mcpServer = new McpServer({
  name: "lingo",
  version: SERVER_VERSION,
});

// Tool: get_config - Get current configuration
mcpServer.tool(
  "get_config",
  "Get the current language learning configuration",
  {},
  async () => {
    console.debug("MCP tool: get_config");
    const config = getConfig();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              configPath: getConfigPath(),
              config,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: update_config - Update configuration
mcpServer.tool(
  "update_config",
  "Update language learning configuration. All fields are optional - only provide the fields you want to change.",
  {
    language: z
      .string()
      .min(2)
      .max(20)
      .optional()
      .describe("The language you are learning (e.g., 'English', 'Spanish', 'Japanese')"),
    mode: ModeSchema.optional().describe(
      "Processing mode: 'silent' (background, no feedback), 'non-block' (immediate feedback), or 'block' (block until acknowledged)"
    ),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Claude model to use for analysis (e.g., 'haiku', 'sonnet')"),
    tone: ToneSchema.optional().describe(
      "Feedback tone: 'casual', 'balanced', or 'professional'"
    ),
    logLevel: LogLevelSchema.optional().describe(
      "Log level: 'debug', 'info', 'warn', or 'error'"
    ),
    queueBatchSize: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of prompts to process in each batch (1-50)"),
    queueIntervalMs: z
      .number()
      .int()
      .min(1000)
      .max(300000)
      .optional()
      .describe("Interval between batch processing in milliseconds (1000-300000)"),
  },
  async (params) => {
    console.debug("MCP tool: update_config", params);
    const currentConfig = getConfig();

    // Build updates object with only provided fields
    const updates: Record<string, unknown> = {};
    if (params.language !== undefined) updates.language = params.language;
    if (params.mode !== undefined) updates.mode = params.mode;
    if (params.model !== undefined) updates.model = params.model;
    if (params.tone !== undefined) updates.tone = params.tone;
    if (params.logLevel !== undefined) updates.logLevel = params.logLevel;
    if (params.queueBatchSize !== undefined) updates.queueBatchSize = params.queueBatchSize;
    if (params.queueIntervalMs !== undefined) updates.queueIntervalMs = params.queueIntervalMs;

    if (Object.keys(updates).length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No configuration changes provided. Current config:\n" +
              JSON.stringify(currentConfig, null, 2),
          },
        ],
      };
    }

    // Merge and validate
    const newConfig = { ...currentConfig, ...updates };
    const result = ConfigSchema.safeParse(newConfig);

    if (!result.success) {
      const errors = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      console.debug("MCP tool: update_config validation failed", errors);
      return {
        content: [
          {
            type: "text",
            text: `Configuration validation failed:\n${errors.join("\n")}`,
          },
        ],
        isError: true,
      };
    }

    // Save the validated config
    saveConfig(result.data);
    console.debug("MCP tool: update_config success", Object.keys(updates));

    return {
      content: [
        {
          type: "text",
          text: `Configuration updated successfully!\n\nUpdated fields: ${Object.keys(updates).join(", ")}\n\nNew configuration:\n${JSON.stringify(result.data, null, 2)}`,
        },
      ],
    };
  }
);

// Tool: learning_review - Get learning insights and review items
mcpServer.tool(
  "learning_review",
  "Get aggregated insights from your language learning history including frequent errors, vocabulary patterns, items due for review, and AI-generated study recommendations",
  {
    timeRange: TimeRangeSchema.optional().describe(
      "Time range to analyze: 'day', 'week', 'month', or 'all' (default: 'week')"
    ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of items per category to return (default: 10)"),
    groupBy: GroupBySchema.optional().describe(
      "How to group results: 'error_type', 'date', or 'project' (default: 'error_type')"
    ),
  },
  async (params) => {
    console.debug("MCP tool: learning_review", params);

    const timeRange = params.timeRange || "week";
    const limit = params.limit || 10;
    const groupBy = params.groupBy || "error_type";

    try {
      // Gather data from database
      const data = await gatherReviewData(timeRange, limit);

      // Get AI-generated insights
      const aiInsights = await analyzeWithAI(data);

      // Format output as markdown
      const output = formatReviewOutput(data, aiInsights, groupBy);

      console.debug(
        `MCP tool: learning_review complete - ${data.stats.totalCorrections} corrections, ${data.stats.totalAlternatives} alternatives`
      );

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error) {
      console.error("learning_review failed:", error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to generate learning review: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);
