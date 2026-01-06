/**
 * Claude Code Transcript Reader
 *
 * Reads and parses Claude Code conversation history from ~/.claude/projects/
 * JSONL format with base64-encoded message content.
 *
 * Note: This is based on reverse-engineering the undocumented format.
 * The format may change in future Claude Code versions.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// ============================================================================
// Types
// ============================================================================

/** Raw message structure from JSONL (partial - only known fields) */
interface RawMessage {
  type: "user" | "assistant" | "system" | string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  // Some messages have content at top level
  content?: string | ContentBlock[];
  timestamp?: string;
  // Tool use messages
  toolUse?: {
    name: string;
    input: unknown;
  };
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | string;
  text?: string;
  // Base64 encoded in some cases
  data?: string;
}

/** Parsed user prompt from transcript */
export interface TranscriptPrompt {
  /** The user's prompt text */
  text: string;
  /** When the message was sent (if available) */
  timestamp?: Date;
  /** Index in the conversation (0-based) */
  index: number;
}

/** Session metadata */
export interface SessionInfo {
  /** Session ID (filename without .jsonl) */
  sessionId: string;
  /** Project directory path (decoded from folder name) */
  projectPath: string;
  /** File modification time */
  modifiedAt: Date;
  /** File size in bytes */
  sizeBytes: number;
  /** Full path to the JSONL file */
  filePath: string;
}

/** Options for listing sessions */
export interface ListSessionsOptions {
  /** Filter by project path (partial match) */
  projectFilter?: string;
  /** Only sessions modified after this date */
  modifiedAfter?: Date;
  /** Only sessions modified before this date */
  modifiedBefore?: Date;
  /** Maximum number of sessions to return */
  limit?: number;
  /** Sort order: 'newest' or 'oldest' first */
  sortOrder?: "newest" | "oldest";
}

/** Options for reading prompts */
export interface ReadPromptsOptions {
  /** Maximum number of prompts to return */
  limit?: number;
  /** Skip prompts shorter than this length */
  minLength?: number;
  /** Skip prompts longer than this length */
  maxLength?: number;
  /** Filter function for custom filtering */
  filter?: (prompt: string) => boolean;
}

/** Result from reading a transcript */
export interface TranscriptResult {
  sessionId: string;
  projectPath: string;
  prompts: TranscriptPrompt[];
  totalMessages: number;
  errors: string[];
}

// ============================================================================
// Path Utilities
// ============================================================================

/** Get the Claude Code projects directory */
export function getClaudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/** Decode project folder name back to path */
export function decodeProjectPath(folderName: string): string {
  // Claude Code encodes paths by replacing / with -
  // e.g., "-Users-wshan-workspace-myproject" -> "/Users/wshan/workspace/myproject"
  if (folderName.startsWith("-")) {
    return folderName.replace(/-/g, "/");
  }
  return folderName;
}

/** Encode a path to Claude Code's folder name format */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

// ============================================================================
// Session Discovery
// ============================================================================

/** List all available sessions */
export async function listSessions(
  options: ListSessionsOptions = {}
): Promise<SessionInfo[]> {
  const { projectFilter, modifiedAfter, modifiedBefore, limit, sortOrder = "newest" } = options;

  const projectsDir = getClaudeProjectsDir();
  const sessions: SessionInfo[] = [];

  try {
    const projectFolders = await readdir(projectsDir);

    for (const folder of projectFolders) {
      const projectPath = decodeProjectPath(folder);

      // Apply project filter
      if (projectFilter && !projectPath.includes(projectFilter)) {
        continue;
      }

      const folderPath = join(projectsDir, folder);
      const folderStat = await stat(folderPath).catch(() => null);

      if (!folderStat?.isDirectory()) {
        continue;
      }

      // List session files in this project folder
      const files = await readdir(folderPath).catch(() => []);

      for (const file of files) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }

        const filePath = join(folderPath, file);
        const fileStat = await stat(filePath).catch(() => null);

        if (!fileStat?.isFile()) {
          continue;
        }

        // Apply date filters
        if (modifiedAfter && fileStat.mtime < modifiedAfter) {
          continue;
        }
        if (modifiedBefore && fileStat.mtime > modifiedBefore) {
          continue;
        }

        sessions.push({
          sessionId: file.replace(".jsonl", ""),
          projectPath,
          modifiedAt: fileStat.mtime,
          sizeBytes: fileStat.size,
          filePath,
        });
      }
    }
  } catch (error) {
    // Projects directory doesn't exist or isn't readable
    console.debug("Could not read Claude projects directory:", error);
    return [];
  }

  // Sort by modification time
  sessions.sort((a, b) => {
    const diff = b.modifiedAt.getTime() - a.modifiedAt.getTime();
    return sortOrder === "newest" ? diff : -diff;
  });

  // Apply limit
  if (limit && limit > 0) {
    return sessions.slice(0, limit);
  }

  return sessions;
}

/** Get session info for a specific session ID */
export async function getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
  const sessions = await listSessions();
  return sessions.find((s) => s.sessionId === sessionId) ?? null;
}

/** Find sessions for a specific project path */
export async function getSessionsForProject(
  projectPath: string,
  options: Omit<ListSessionsOptions, "projectFilter"> = {}
): Promise<SessionInfo[]> {
  const folderName = encodeProjectPath(projectPath);
  const folderPath = join(getClaudeProjectsDir(), folderName);

  try {
    const files = await readdir(folderPath);
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(folderPath, file);
      const fileStat = await stat(filePath).catch(() => null);

      if (!fileStat?.isFile()) continue;

      if (options.modifiedAfter && fileStat.mtime < options.modifiedAfter) continue;
      if (options.modifiedBefore && fileStat.mtime > options.modifiedBefore) continue;

      sessions.push({
        sessionId: file.replace(".jsonl", ""),
        projectPath,
        modifiedAt: fileStat.mtime,
        sizeBytes: fileStat.size,
        filePath,
      });
    }

    sessions.sort((a, b) => {
      const diff = b.modifiedAt.getTime() - a.modifiedAt.getTime();
      return options.sortOrder === "oldest" ? -diff : diff;
    });

    if (options.limit && options.limit > 0) {
      return sessions.slice(0, options.limit);
    }

    return sessions;
  } catch {
    return [];
  }
}

// ============================================================================
// Transcript Reading
// ============================================================================

/** Decode base64 content if needed */
function decodeContent(content: unknown): string {
  if (typeof content === "string") {
    // Check if it looks like base64
    if (/^[A-Za-z0-9+/]+=*$/.test(content) && content.length > 50) {
      try {
        const decoded = Buffer.from(content, "base64").toString("utf-8");
        // Verify it decoded to valid UTF-8 text
        if (/^[\x20-\x7E\s]+$/.test(decoded.slice(0, 100))) {
          return decoded;
        }
      } catch {
        // Not valid base64, return as-is
      }
    }
    return content;
  }
  return "";
}

/** Extract text from content blocks */
function extractTextFromContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";

  if (typeof content === "string") {
    return decodeContent(content);
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => decodeContent(block.text))
      .join("\n");
  }

  return "";
}

/** Parse a single line from JSONL */
function parseTranscriptLine(line: string): RawMessage | null {
  if (!line.trim()) return null;

  try {
    return JSON.parse(line) as RawMessage;
  } catch {
    return null;
  }
}

/** Check if a message is a user prompt */
function isUserPrompt(message: RawMessage): boolean {
  return (
    message.type === "user" ||
    message.message?.role === "user" ||
    (message.type === "message" && message.message?.role === "user")
  );
}

/** Read and parse a transcript file */
export async function readTranscript(
  sessionOrPath: string | SessionInfo,
  options: ReadPromptsOptions = {}
): Promise<TranscriptResult> {
  const { limit, minLength = 0, maxLength = Infinity, filter } = options;

  // Resolve session info
  let session: SessionInfo;
  if (typeof sessionOrPath === "string") {
    // Check if it's a file path or session ID
    if (sessionOrPath.endsWith(".jsonl")) {
      // It's a file path
      const pathParts = sessionOrPath.split("/");
      const fileName = pathParts.pop() ?? "";
      const folderName = pathParts.pop() ?? "";
      session = {
        sessionId: fileName.replace(".jsonl", ""),
        projectPath: decodeProjectPath(folderName),
        modifiedAt: new Date(),
        sizeBytes: 0,
        filePath: sessionOrPath,
      };
    } else {
      // It's a session ID - need to find it
      const found = await getSessionInfo(sessionOrPath);
      if (!found) {
        return {
          sessionId: sessionOrPath,
          projectPath: "unknown",
          prompts: [],
          totalMessages: 0,
          errors: [`Session not found: ${sessionOrPath}`],
        };
      }
      session = found;
    }
  } else {
    session = sessionOrPath;
  }

  const prompts: TranscriptPrompt[] = [];
  const errors: string[] = [];
  let totalMessages = 0;
  let promptIndex = 0;

  try {
    const content = await readFile(session.filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const message = parseTranscriptLine(line);
      if (!message) continue;

      totalMessages++;

      if (!isUserPrompt(message)) continue;

      // Extract the prompt text
      let text = "";
      if (message.message?.content) {
        text = extractTextFromContent(message.message.content);
      } else if (message.content) {
        text = extractTextFromContent(message.content);
      }

      if (!text) continue;

      // Apply filters
      if (text.length < minLength) continue;
      if (text.length > maxLength) continue;
      if (filter && !filter(text)) continue;

      // Parse timestamp if available
      let timestamp: Date | undefined;
      if (message.timestamp) {
        timestamp = new Date(message.timestamp);
        if (isNaN(timestamp.getTime())) {
          timestamp = undefined;
        }
      }

      prompts.push({
        text,
        timestamp,
        index: promptIndex++,
      });

      // Check limit
      if (limit && prompts.length >= limit) {
        break;
      }
    }
  } catch (error) {
    errors.push(`Failed to read transcript: ${error}`);
  }

  return {
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    prompts,
    totalMessages,
    errors,
  };
}

// ============================================================================
// Batch Operations
// ============================================================================

/** Read prompts from multiple sessions */
export async function readMultipleSessions(
  sessions: SessionInfo[],
  options: ReadPromptsOptions = {}
): Promise<Map<string, TranscriptResult>> {
  const results = new Map<string, TranscriptResult>();

  for (const session of sessions) {
    const result = await readTranscript(session, options);
    results.set(session.sessionId, result);
  }

  return results;
}

/** Get all prompts from recent sessions */
export async function getRecentPrompts(
  options: ListSessionsOptions & ReadPromptsOptions = {}
): Promise<TranscriptPrompt[]> {
  const sessions = await listSessions(options);
  const allPrompts: TranscriptPrompt[] = [];

  for (const session of sessions) {
    const result = await readTranscript(session, options);
    allPrompts.push(...result.prompts);

    // Check overall limit
    if (options.limit && allPrompts.length >= options.limit) {
      return allPrompts.slice(0, options.limit);
    }
  }

  return allPrompts;
}

// ============================================================================
// Filtering Utilities
// ============================================================================

/** Common filters for prompt analysis */
export const promptFilters = {
  /** Skip very short prompts (likely commands or confirmations) */
  minLength: (min: number) => (prompt: string) => prompt.length >= min,

  /** Skip very long prompts (likely code dumps) */
  maxLength: (max: number) => (prompt: string) => prompt.length <= max,

  /** Skip slash commands */
  noSlashCommands: (prompt: string) => !prompt.trim().startsWith("/"),

  /** Skip simple yes/no confirmations */
  noConfirmations: (prompt: string) =>
    !/^(y|n|yes|no|ok|done|sure|thanks|thank you|thx|ty)$/i.test(prompt.trim()),

  /** Skip prompts that are mostly code */
  notMostlyCode: (prompt: string) => {
    const codeIndicators = /```|function\s+\w+|const\s+\w+\s*=|import\s+{|export\s+/g;
    const matches = prompt.match(codeIndicators) ?? [];
    return matches.length < 3;
  },

  /** Skip system-injected messages (from hooks, caveats, etc.) */
  noSystemInjected: (prompt: string) => {
    // Skip messages starting with XML-like system tags
    if (/^<(bash-|command-|local-|system-)/.test(prompt.trim())) return false;
    // Skip messages containing system tags
    if (/<(system-reminder|local-command)/.test(prompt)) return false;
    // Skip caveats
    if (prompt.startsWith("Caveat:")) return false;
    return true;
  },

  /** Skip interrupted requests */
  noInterrupted: (prompt: string) =>
    !prompt.includes("[Request interrupted by user]"),

  /** Combine multiple filters */
  all:
    (...filters: ((prompt: string) => boolean)[]) =>
    (prompt: string) =>
      filters.every((f) => f(prompt)),
};

/** Default filter for language learning analysis */
export const defaultAnalysisFilter = promptFilters.all(
  promptFilters.minLength(20),
  promptFilters.maxLength(2000),
  promptFilters.noSlashCommands,
  promptFilters.noConfirmations,
  promptFilters.noSystemInjected,
  promptFilters.noInterrupted
);
