import { getConfig } from "./config.js";
import { insertPrompt } from "./database.js";
import { queryClaudeAI, withRetry } from "./claude.js";

import type { Tone, Mode } from "./validation.js";

export type AnalysisType = "skip" | "translation" | "correction" | "comment" | "alternative";

export type ExplanationCategory =
  // Grammar
  | "article"       // a/an/the
  | "preposition"   // in/on/at/to/for
  | "tense"         // past/present/future/perfect
  | "agreement"     // subject-verb, singular/plural
  | "word_order"    // sentence structure
  // Word choice
  | "vocabulary"    // wrong word, better synonym
  | "spelling"      // typos, misspellings
  | "idiom"         // idiomatic expressions
  // Style
  | "formality"     // too casual/formal
  | "clarity"       // ambiguous, unclear
  | "redundancy"    // unnecessary words
  // Catch-all
  | "other";

const VALID_CATEGORIES: Set<string> = new Set([
  "article", "preposition", "tense", "agreement", "word_order",
  "vocabulary", "spelling", "idiom",
  "formality", "clarity", "redundancy", "other"
]);

export interface Explanation {
  category: ExplanationCategory;
  detail: string;
}

export interface AnalysisResult {
  type: AnalysisType;
  text: string | null;        // corrected/translated/alternative text
  explanations: Explanation[];
  summary: string | null;     // single comprehensive sentence for non-block mode
  sourceLang: string | null;  // preserved for translations
}

// Raw explanation from Claude API
interface RawExplanation {
  category?: string;
  detail?: string;
}

// Raw response from Claude API
interface RawAnalysisResponse {
  skip?: boolean;
  sourceLang?: string;           // Present = translation
  correction?: string;           // Present = correction/translation text
  comment?: RawExplanation;      // Present = minor observation with category
  alternative?: string;          // Present = alternative suggestion
  reason?: string;               // Explanation for alternative
  summary?: string;              // Comprehensive single-sentence explanation
  explanations?: RawExplanation[];
}

const TONE_DESC: Record<Tone, string> = {
  casual: "casual and friendly, like chatting with a colleague",
  professional: "formal and professional, suitable for business communication",
  balanced: "neutral and clear, balancing friendliness with professionalism",
};

function buildAnalysisPrompt(
  prompt: string,
  targetLang: string,
  tone: Tone,
  recentPrompts: string[] = []
): string {
  let recentContext = "";
  if (recentPrompts.length > 0) {
    recentContext = `
Recent prompts from this session (for context - avoid suggesting similar alternatives):
${recentPrompts.map((p, i) => `${i + 1}. "${p}"`).join("\n")}
`;
  }

  return `You are a language learning assistant. Analyze the following text written by a user learning ${targetLang}.
Feedback tone: ${TONE_DESC[tone]}.
${recentContext}
Text to analyze:
"""
${prompt}
"""

Respond with JSON only. Use one of these formats:

1. SKIP - For simple confirmations, commands, code, URLs, or technical content:
   {"skip": true}

2. TRANSLATION - If text contains non-${targetLang} language:
   {"sourceLang": "<detected language>", "correction": "<translated text>"}

3. CORRECTION - If text has significant grammar errors, wrong word usage, or unnatural expressions:
   {"correction": "<corrected text>", "summary": "<tip>", "explanations": [{"category": "<cat>", "detail": "<tip>"}, ...]}
   - "summary": A single comprehensive sentence covering all issues (e.g., "Use past tense 'went' and add the article 'the' before 'store'.").
   - "detail": A complete sentence for each individual issue (e.g., "Use past tense 'went' for actions that happened yesterday.").

4. COMMENT - For minor typos or small observations that don't warrant a full correction:
   {"comment": {"category": "<cat>", "detail": "<tip>"}}
   The "detail" should be a complete sentence like a tutor tip.

5. ALTERNATIVE - If text is correct and natural, suggest a significantly better way to express it:
   {"alternative": "<alternative expression>", "reason": "<tip>"}
   The "reason" should be a complete sentence explaining why this is better (e.g., "This phrasing sounds more natural in casual conversation.").
   Only suggest if it's a meaningful improvement. Skip if it's just a minor variation.

Categories for "category" field (use exactly one of these identifiers):
- article: a/an/the usage
- preposition: in/on/at/to/for etc.
- tense: past/present/future/perfect
- agreement: subject-verb, singular/plural
- word_order: sentence structure
- vocabulary: wrong word, better synonym
- spelling: typos, misspellings
- idiom: idiomatic expressions
- formality: too casual/formal
- clarity: ambiguous, unclear
- redundancy: unnecessary words
- other: anything not fitting above

IMPORTANT - Category identifiers must be lowercase with underscores (e.g., "word_order", not "Word order").

Rules:
- Keep code snippets, file paths, URLs, and technical identifiers intact
- SKIP formatting issues entirely: capitalization, punctuation, spacing. These are not worth correcting.
- Focus only on grammar errors, vocabulary issues, and unnatural expressions that affect comprehension or fluency`;
}

// Determine analysis type from raw response
function inferType(raw: RawAnalysisResponse): AnalysisType {
  if (raw.skip) return "skip";
  if (raw.sourceLang) return "translation";
  if (raw.correction) return "correction";
  if (raw.comment) return "comment";
  if (raw.alternative) return "alternative";
  return "skip"; // fallback
}

// Validate and normalize a category string
function normalizeCategory(cat: string | undefined): ExplanationCategory {
  if (cat && VALID_CATEGORIES.has(cat)) {
    return cat as ExplanationCategory;
  }
  return "other";
}

// Parse raw explanation into validated Explanation
function parseExplanation(raw: RawExplanation | undefined): Explanation | null {
  if (!raw || !raw.detail) return null;
  return {
    category: normalizeCategory(raw.category),
    detail: raw.detail,
  };
}

// Parse array of raw explanations
function parseExplanations(raw: RawExplanation[] | undefined): Explanation[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map(parseExplanation)
    .filter((e): e is Explanation => e !== null);
}

async function executeAnalysis(
  prompt: string,
  targetLang: string,
  tone: Tone,
  mode: Mode,
  recentPrompts: string[] = []
): Promise<AnalysisResult> {
  const config = getConfig();

  console.debug(`Analyzing prompt (${prompt.length} chars, model: ${config.model}, mode: ${mode}, context: ${recentPrompts.length} recent)`);

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
      const raw = JSON.parse(jsonMatch[0]) as RawAnalysisResponse;
      const type = inferType(raw);

      // Determine text, explanations, and summary based on type
      let text: string | null = null;
      let explanations: Explanation[] = [];
      let summary: string | null = null;

      switch (type) {
        case "skip":
          break;
        case "translation":
          text = raw.correction ?? null;
          explanations = [{ category: "other", detail: `Translated from ${raw.sourceLang}` }];
          break;
        case "correction":
          text = raw.correction ?? null;
          explanations = parseExplanations(raw.explanations);
          summary = raw.summary ?? null;
          break;
        case "comment": {
          const parsed = parseExplanation(raw.comment);
          explanations = parsed ? [parsed] : [];
          // Use detail as summary for comments
          summary = parsed?.detail ?? null;
          break;
        }
        case "alternative":
          text = raw.alternative ?? null;
          if (raw.reason) {
            explanations = [{ category: "other", detail: raw.reason }];
            summary = raw.reason;
          }
          break;
      }

      const result: AnalysisResult = {
        type,
        text,
        explanations,
        summary,
        sourceLang: raw.sourceLang ?? null,
      };

      console.debug(`Analysis (${duration}ms): type=${type} text=${text ? 'yes' : 'no'}`);

      return result;
    }
  } catch (error) {
    console.warn(`Analysis (${duration}ms): JSON parse failed:`, error instanceof Error ? error.message : error);
  }

  console.debug(`Analysis (${duration}ms): parse failed, returning default`);
  return {
    type: "skip",
    text: null,
    explanations: [],
    summary: null,
    sourceLang: null,
  };
}

export async function analyzePrompt(
  prompt: string,
  targetLang: string,
  tone: Tone,
  mode: Mode,
  recentPrompts: string[] = []
): Promise<AnalysisResult> {
  return withRetry(() => executeAnalysis(prompt, targetLang, tone, mode, recentPrompts), {
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
          config.tone,
          config.mode
        );

        // Save to DB if there's something worth saving (not skip)
        if (result.type !== "skip") {
          const hasCorrection = result.type === "translation" || result.type === "correction" || result.type === "comment";
          const correction = result.type === "translation" || result.type === "correction" ? result.text : null;
          const alternative = result.type === "alternative" ? result.text : null;
          const categories = result.explanations.map(e => e.category);

          insertPrompt({
            prompt: record.prompt,
            timestamp: record.timestamp,
            session_id: record.session_id,
            cwd: record.cwd,
            project_dir: record.project_dir,
            analyzed: true,
            analysis_result: result.explanations.map(e => e.detail).join("; "),
            has_correction: hasCorrection,
            correction,
            alternative,
            categories,
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
