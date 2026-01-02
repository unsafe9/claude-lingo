import type { AnalysisResult } from "./analyzer.js";

interface CachedResult {
  result: AnalysisResult;
  timestamp: number;
}

interface SessionData {
  // Cache: prompt -> cached result
  cache: Map<string, CachedResult>;
  // In-flight requests: prompt -> promise that resolves with result
  inFlight: Map<string, Promise<AnalysisResult>>;
  // Recent prompts for context (newest first)
  recentPrompts: string[];
}

// Session data keyed by session_id
const sessions = new Map<string, SessionData>();

// Config
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECENT_PROMPTS = 5;
const MAX_CACHE_SIZE_PER_SESSION = 100; // Prevent unbounded memory growth
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Track last activity per session for cleanup
const sessionLastActivity = new Map<string, number>();

function getOrCreateSession(sessionId: string): SessionData {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      cache: new Map(),
      inFlight: new Map(),
      recentPrompts: [],
    };
    sessions.set(sessionId, session);
  }
  sessionLastActivity.set(sessionId, Date.now());
  return session;
}

/**
 * Get cached result for a prompt if it exists and is still valid
 */
export function getCachedResult(sessionId: string, prompt: string): AnalysisResult | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const cached = session.cache.get(prompt);
  if (!cached) return null;

  // Check if cache is still valid
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    session.cache.delete(prompt);
    return null;
  }

  console.debug(`Cache hit for session ${sessionId.slice(0, 8)}...`);
  return cached.result;
}

/**
 * Cache a result for a prompt.
 * If there's a correction, also cache the corrected text as "skip" to avoid re-analyzing it.
 */
export function cacheResult(sessionId: string, prompt: string, result: AnalysisResult): void {
  const session = getOrCreateSession(sessionId);
  const now = Date.now();

  // Enforce max cache size by removing oldest entries if needed
  if (session.cache.size >= MAX_CACHE_SIZE_PER_SESSION) {
    // Remove oldest entries (first 10% of cache)
    const entriesToRemove = Math.ceil(MAX_CACHE_SIZE_PER_SESSION * 0.1);
    const iterator = session.cache.keys();
    for (let i = 0; i < entriesToRemove; i++) {
      const key = iterator.next().value;
      if (key) session.cache.delete(key);
    }
    console.debug(`Cache limit reached for session ${sessionId.slice(0, 8)}..., evicted ${entriesToRemove} entries`);
  }

  // Cache the original prompt's result
  session.cache.set(prompt, {
    result,
    timestamp: now,
  });

  // If there's a correction, cache the corrected text as "skip" so it won't be analyzed again
  if (result.hasCorrection && result.correction) {
    const skipResult: AnalysisResult = {
      skip: true,
      hasCorrection: false,
      correction: null,
      explanation: "",
      alternative: null,
      significant: false,
      originalPrompt: result.correction,
    };
    session.cache.set(result.correction, {
      result: skipResult,
      timestamp: now,
    });
  }
}

/**
 * Check if there's an in-flight request for a prompt
 */
export function getInFlightRequest(sessionId: string, prompt: string): Promise<AnalysisResult> | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return session.inFlight.get(prompt) || null;
}

/**
 * Register an in-flight request
 */
export function setInFlightRequest(sessionId: string, prompt: string, promise: Promise<AnalysisResult>): void {
  const session = getOrCreateSession(sessionId);
  session.inFlight.set(prompt, promise);
}

/**
 * Clear an in-flight request (call after analysis completes)
 */
export function clearInFlightRequest(sessionId: string, prompt: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.inFlight.delete(prompt);
  }
}

/**
 * Add a prompt to recent history (for context).
 * If a correction was made, track the corrected version instead to avoid suggesting it as alternative.
 */
export function addRecentPrompt(sessionId: string, prompt: string, correctedPrompt?: string | null): void {
  const session = getOrCreateSession(sessionId);

  // Use the corrected version if available, otherwise the original
  const textToAdd = correctedPrompt || prompt;

  // Don't add duplicates of the most recent prompt
  if (session.recentPrompts[0] === textToAdd) return;

  // Add to front
  session.recentPrompts.unshift(textToAdd);

  // Trim to max size
  if (session.recentPrompts.length > MAX_RECENT_PROMPTS) {
    session.recentPrompts.pop();
  }
}

/**
 * Get recent prompts for context (excluding the current prompt)
 */
export function getRecentPrompts(sessionId: string, excludePrompt?: string): string[] {
  const session = sessions.get(sessionId);
  if (!session) return [];

  if (excludePrompt) {
    return session.recentPrompts.filter((p) => p !== excludePrompt);
  }
  return [...session.recentPrompts];
}

/**
 * Cleanup old sessions
 */
function cleanupSessions(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, lastActivity] of sessionLastActivity) {
    if (now - lastActivity > SESSION_MAX_AGE_MS) {
      sessions.delete(sessionId);
      sessionLastActivity.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.debug(`Cleaned up ${cleaned} inactive session(s)`);
  }
}

// Start cleanup interval
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanupSessions, SESSION_CLEANUP_INTERVAL_MS);
  console.debug("Session cleanup started");
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.debug("Session cleanup stopped");
  }
}

/**
 * Get stats for debugging/health check
 */
export function getSessionStats(): { sessions: number; totalCached: number } {
  let totalCached = 0;
  for (const session of sessions.values()) {
    totalCached += session.cache.size;
  }
  return {
    sessions: sessions.size,
    totalCached,
  };
}
