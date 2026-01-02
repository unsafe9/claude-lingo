import { getConfig } from "./config.js";
import { insertPrompt } from "./database.js";
import { queryClaudeAI, withRetry } from "./claude.js";

import type { Tone } from "./validation.js";

export interface AnalysisResult {
  skip: boolean;
  hasCorrection: boolean;
  correction: string | null;
  explanation: string;
  alternative: string | null;
  significant: boolean; // true if correction/alternative is significant (worth learning/blocking)
  originalPrompt: string;
}

function getToneDescription(tone: Tone): string {
  switch (tone) {
    case "casual":
      return "casual and friendly, like chatting with a colleague";
    case "professional":
      return "formal and professional, suitable for business communication";
    case "balanced":
    default:
      return "neutral and clear, balancing friendliness with professionalism";
  }
}

function buildAnalysisPrompt(
  prompt: string,
  targetLang: string,
  tone: Tone,
  recentPrompts: string[] = []
): string {
  const toneDesc = getToneDescription(tone);

  // Build recent prompts context section
  let recentContext = "";
  if (recentPrompts.length > 0) {
    recentContext = `
RECENT CONTEXT (previous prompts from this session, for context only - do not analyze these):
${recentPrompts.map((p, i) => `${i + 1}. "${p}"`).join("\n")}

Use this context to:
- Understand the conversation flow
- Avoid suggesting alternatives that were already used in recent prompts
- Recognize when the user is intentionally varying their language
`;
  }

  return `You are a language learning assistant. Analyze the following text that a user wrote while using Claude Code.

The user is learning ${targetLang}. Feedback should be ${toneDesc}.
${recentContext}
Text to analyze:
"""
${prompt}
"""

FIRST, check the language of the text:
1. If the text contains ANY non-${targetLang} language (Korean, Japanese, Chinese, Spanish, etc.):
   - Translate it to ${targetLang}
   - Keep code snippets, file paths, technical identifiers, URLs, and command-line instructions intact (do not translate them)
   - Return: {"hasCorrection": true, "correction": "<translation in ${targetLang}>", "alternative": null, "significant": true, "explanation": "- Translated from [detected language]"}

THEN, check if this should be skipped:
- Simple confirmations in ${targetLang}: "yes", "no", "ok", "sure", "go ahead", "continue", "do it", "proceed"
- Brief commands in ${targetLang}: "stop", "cancel", "abort", "retry", "next", "done", "run it", "fix it"
- Acknowledgments in ${targetLang}: "thanks", "thank you", "got it", "understood", "makes sense"
- Affirmations in ${targetLang}: "lgtm", "ship it", "sounds good", "perfect", "great", "nice"
- Copied code, file paths, or technical identifiers
- Command-line instructions or shell commands
- Copied error messages or log output
- URLs, JSON, or structured data

If any skip condition matches, respond with:
{"skip": true}

OTHERWISE, analyze the ${targetLang} text:
- Keep code snippets, file paths, technical identifiers, URLs, and command-line instructions intact in corrections/alternatives

2. If the text has issues (wrong grammar, unnatural expressions, typos):
   - Ignore formatting issues: missing/extra spaces, line breaks, indentation, punctuation spacing
   - Ignore minor issues like missing capitalization or missing commas/periods (acceptable in casual coding communication)
   - Set "significant": true for grammar errors, wrong word usage, or unnatural expressions that affect meaning
   - Set "significant": false for minor typos or small mistakes that don't affect understanding
   - Return: {"hasCorrection": true, "correction": "<corrected version>", "alternative": null, "significant": <true or false>, "explanation": "<bullet-listed explanation using '- **title:** description' format, where title is 1-3 words like 'article', 'tense', 'word choice', 'unnatural'>"}

3. If the text is correct and natural, suggest an alternative way to express the same idea:
   - Set "significant": true ONLY if the alternative is significantly more natural, idiomatic, or better than the original (worth learning)
   - Set "significant": false if the alternative is just a minor variation with similar quality
   - Do NOT suggest alternatives that match or are very similar to any of the recent prompts shown above
   - Return: {"hasCorrection": false, "correction": null, "alternative": "<alternative expression>", "significant": <true or false>, "explanation": "<bullet-listed notes on nuance differences using '- **title:** description' format, where title is 1-3 words like 'tone', 'nuance', 'formality', 'idiom'>"}

Respond ONLY with valid JSON, no other text.`;
}

async function executeAnalysis(
  prompt: string,
  targetLang: string,
  tone: Tone,
  recentPrompts: string[] = []
): Promise<AnalysisResult> {
  const config = getConfig();

  console.debug(`Analyzing prompt (${prompt.length} chars, model: ${config.model}, context: ${recentPrompts.length} recent)`);

  const analysisPrompt = buildAnalysisPrompt(prompt, targetLang, tone, recentPrompts);
  const startTime = Date.now();

  const resultText = await queryClaudeAI(analysisPrompt, {
    model: config.model,
    systemPrompt: "You are a language analysis assistant. Respond only with valid JSON.",
  });

  const duration = Date.now() - startTime;

  try {
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<AnalysisResult> & { skip?: boolean };

      // Handle skip response
      if (parsed.skip) {
        console.debug(`Analysis (${duration}ms): skip=true`);
        return {
          skip: true,
          hasCorrection: false,
          correction: null,
          explanation: "",
          alternative: null,
          significant: false,
          originalPrompt: prompt,
        };
      }

      const result = {
        skip: false,
        hasCorrection: parsed.hasCorrection ?? false,
        correction: parsed.correction ?? null,
        explanation: parsed.explanation ?? "",
        alternative: parsed.alternative ?? null,
        significant: parsed.significant ?? false,
        originalPrompt: prompt,
      };

      console.debug(
        `Analysis (${duration}ms): hasCorrection=${result.hasCorrection} significant=${result.significant} alternative=${result.alternative ? 'yes' : 'no'}`
      );

      return result;
    }
  } catch (error) {
    console.warn(`Analysis (${duration}ms): JSON parse failed:`, error instanceof Error ? error.message : error);
  }

  console.debug(`Analysis (${duration}ms): parse failed, returning default result`);
  return {
    skip: false,
    hasCorrection: false,
    correction: null,
    explanation: "Failed to analyze the text.",
    alternative: null,
    significant: false,
    originalPrompt: prompt,
  };
}

export async function analyzePrompt(
  prompt: string,
  targetLang: string,
  tone: Tone,
  recentPrompts: string[] = []
): Promise<AnalysisResult> {
  return withRetry(() => executeAnalysis(prompt, targetLang, tone, recentPrompts), {
    maxRetries: 2,
    baseDelayMs: 500,
  });
}

// In-memory queue for background analysis
interface QueuedPrompt {
  prompt: string;
  timestamp: string;
  session_id: string;
  cwd: string;
  project_dir: string;
}

const analysisQueue: QueuedPrompt[] = [];

export function queuePromptForAnalysis(data: QueuedPrompt): void {
  analysisQueue.push(data);
}

export function getPendingQueueCount(): number {
  return analysisQueue.length;
}

// Background queue processing
let isProcessing = false;
let processingInterval: ReturnType<typeof setTimeout> | null = null;
let shutdownRequested = false;
let currentProcessingPromise: Promise<void> | null = null;

async function processQueue(): Promise<void> {
  if (isProcessing || shutdownRequested) return;
  isProcessing = true;

  try {
    const config = getConfig();
    const batchSize = config.queueBatchSize;
    const batch = analysisQueue.splice(0, batchSize);

    if (batch.length > 0) {
      console.debug(`Processing ${batch.length} queued prompt(s)`);
    }

    for (const record of batch) {
      if (shutdownRequested) {
        console.info("Shutdown requested, stopping queue processing");
        // Put remaining items back in queue
        analysisQueue.unshift(...batch.slice(batch.indexOf(record)));
        break;
      }

      try {
        const result = await analyzePrompt(
          record.prompt,
          config.language,
          config.tone
        );

        // Save to DB if there's a correction OR an alternative
        if (!result.skip && (result.hasCorrection || result.alternative)) {
          insertPrompt({
            prompt: record.prompt,
            timestamp: record.timestamp,
            session_id: record.session_id,
            cwd: record.cwd,
            project_dir: record.project_dir,
            analyzed: true,
            analysis_result: result.explanation,
            has_correction: result.hasCorrection,
            correction: result.correction,
            alternative: result.alternative,
          });
        }
      } catch (error) {
        console.error("Failed to analyze prompt:", error);
        // Continue with next prompt even if one fails
      }
    }
  } catch (error) {
    console.error("Error processing queue:", error);
  } finally {
    isProcessing = false;
    currentProcessingPromise = null;
  }
}

export function startBackgroundProcessor(): void {
  if (processingInterval) return;

  const config = getConfig();
  const intervalMs = config.queueIntervalMs;

  // Use recursive setTimeout instead of setInterval to prevent overlapping executions
  function scheduleNextRun(): void {
    if (shutdownRequested) return;
    processingInterval = setTimeout(async () => {
      currentProcessingPromise = processQueue();
      await currentProcessingPromise;
      scheduleNextRun();
    }, intervalMs);
  }

  scheduleNextRun();
  console.info(`Background processor started (interval: ${intervalMs}ms, batch: ${config.queueBatchSize})`);
}

export function stopBackgroundProcessor(): void {
  shutdownRequested = true;

  if (processingInterval) {
    clearTimeout(processingInterval);
    processingInterval = null;
    console.info("Background processor stopped");
  }
}

export async function waitForQueueDrain(): Promise<void> {
  if (currentProcessingPromise) {
    console.info("Waiting for current processing to complete...");
    await currentProcessingPromise;
  }
}
