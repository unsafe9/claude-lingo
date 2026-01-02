import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { getConfig } from "./config.js";

// Cached Claude executable path
let cachedClaudePath: string | null = null;

export function detectClaudeExecutable(): string | undefined {
  if (cachedClaudePath !== null) {
    return cachedClaudePath || undefined;
  }

  const commonPaths = [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.npm-global/bin/claude`,
  ];

  try {
    const whichResult = execSync("which claude", { encoding: "utf-8" }).trim();
    if (whichResult && existsSync(whichResult)) {
      cachedClaudePath = whichResult;
      return cachedClaudePath;
    }
  } catch {
    // which failed, try common paths
  }

  for (const path of commonPaths) {
    if (existsSync(path)) {
      cachedClaudePath = path;
      return cachedClaudePath;
    }
  }

  cachedClaudePath = "";
  return undefined;
}

export interface QueryOptions {
  model?: string;
  systemPrompt?: string;
  claudeExecutablePath?: string;
}

// Generic Claude query function
export async function queryClaudeAI(prompt: string, options: QueryOptions = {}): Promise<string> {
  const config = getConfig();
  const executablePath = options.claudeExecutablePath || config.claudeExecutablePath || detectClaudeExecutable();

  const queryOptions: Parameters<typeof query>[0]["options"] = {
    model: options.model || config.model,
    maxTurns: 1,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    systemPrompt: options.systemPrompt || "You are a helpful assistant. Respond only with valid JSON.",
  };

  if (executablePath) {
    queryOptions.pathToClaudeCodeExecutable = executablePath;
  }

  let resultText = "";

  for await (const message of query({ prompt, options: queryOptions })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          resultText += block.text;
        }
      }
    }
    if (message.type === "result" && message.subtype === "success" && message.result) {
      resultText = message.result;
    }
  }

  if (!resultText.trim()) {
    throw new Error("Claude API returned empty response");
  }

  return resultText;
}

// Retry with exponential backoff
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10000 } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        console.warn(
          `Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms:`,
          lastError.message
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
