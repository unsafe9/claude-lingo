import {
  type PromptRecord,
  type TimeRange,
  type ReviewStats,
  getCorrectionsInRange,
  getAlternativesInRange,
  getItemsDueForReview,
  getStatsSummary,
  updateReviewStatus,
} from "./database.js";
import { queryClaudeAI } from "./claude.js";
import type { GroupBy } from "./validation.js";

// Error pattern categories for classification
interface ErrorPattern {
  pattern: RegExp;
  category: string;
  type: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  { pattern: /typo/i, category: "spelling", type: "typo" },
  { pattern: /spell(ing)?/i, category: "spelling", type: "spelling_error" },
  { pattern: /article.*missing|missing.*article/i, category: "grammar", type: "missing_article" },
  { pattern: /capitalization/i, category: "grammar", type: "capitalization" },
  { pattern: /grammar/i, category: "grammar", type: "grammar_error" },
  { pattern: /tense/i, category: "grammar", type: "wrong_tense" },
  { pattern: /preposition/i, category: "grammar", type: "preposition" },
  { pattern: /vocabulary|vocab|word choice/i, category: "vocabulary", type: "word_choice" },
  { pattern: /translate|translation/i, category: "translation", type: "non_target_language" },
  { pattern: /idiom(atic)?/i, category: "vocabulary", type: "idiom" },
  { pattern: /formal|informal/i, category: "register", type: "register_mismatch" },
  { pattern: /plural|singular/i, category: "grammar", type: "number_agreement" },
  { pattern: /punctuation/i, category: "punctuation", type: "punctuation" },
];

export interface ErrorAggregate {
  category: string;
  type: string;
  count: number;
  examples: Array<{
    original: string;
    corrected: string | null;
    explanation: string;
    date: string;
  }>;
}

export interface VocabularyInsight {
  original: string;
  alternative: string;
  explanation: string;
  count: number;
  lastSeen: string;
}

export interface AggregatedData {
  stats: ReviewStats;
  timeRange: TimeRange;
  errorPatterns: Map<string, ErrorAggregate>;
  vocabularyInsights: VocabularyInsight[];
  dueForReview: PromptRecord[];
}

export interface AIInsights {
  recommendations: string[];
  priorityAreas: string[];
  progressNotes: string[];
}

// Categorize an error based on analysis_result text
export function categorizeError(analysisResult: string): { category: string; type: string } {
  for (const { pattern, category, type } of ERROR_PATTERNS) {
    if (pattern.test(analysisResult)) {
      return { category, type };
    }
  }
  return { category: "other", type: "unclassified" };
}

// Aggregate error patterns from records
export function aggregateErrorPatterns(records: PromptRecord[]): Map<string, ErrorAggregate> {
  const aggregated = new Map<string, ErrorAggregate>();

  for (const record of records) {
    if (!record.analysis_result) continue;

    const { category, type } = categorizeError(record.analysis_result);
    const key = `${category}:${type}`;

    const existing = aggregated.get(key) || {
      category,
      type,
      count: 0,
      examples: [],
    };

    existing.count++;
    if (existing.examples.length < 3) {
      existing.examples.push({
        original: record.prompt,
        corrected: record.correction,
        explanation: record.analysis_result,
        date: record.created_at,
      });
    }

    aggregated.set(key, existing);
  }

  return aggregated;
}

// Aggregate vocabulary insights from alternative suggestions
export function aggregateVocabularyInsights(records: PromptRecord[]): VocabularyInsight[] {
  const insightMap = new Map<string, VocabularyInsight>();

  for (const record of records) {
    if (!record.alternative) continue;

    const key = `${record.prompt}:${record.alternative}`;
    const existing = insightMap.get(key);

    if (existing) {
      existing.count++;
      if (record.created_at > existing.lastSeen) {
        existing.lastSeen = record.created_at;
      }
    } else {
      insightMap.set(key, {
        original: record.prompt,
        alternative: record.alternative,
        explanation: record.analysis_result || "",
        count: 1,
        lastSeen: record.created_at,
      });
    }
  }

  return Array.from(insightMap.values()).sort((a, b) => b.count - a.count);
}

// SM-2 Spaced Repetition Algorithm
export function calculateNextReview(
  easeFactor: number,
  reviewCount: number,
  quality: number // 0-5: 0-2 = fail, 3-5 = pass
): { nextInterval: number; newEaseFactor: number } {
  // Quality: 0 = complete failure, 5 = perfect response
  // If quality < 3, reset to beginning
  if (quality < 3) {
    return { nextInterval: 1, newEaseFactor: Math.max(1.3, easeFactor - 0.2) };
  }

  // Calculate new ease factor
  const newEaseFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  // Calculate interval
  let nextInterval: number;
  if (reviewCount === 0) {
    nextInterval = 1; // 1 day
  } else if (reviewCount === 1) {
    nextInterval = 6; // 6 days
  } else {
    // Use previous interval * ease factor
    const previousInterval = reviewCount <= 1 ? 1 : Math.pow(newEaseFactor, reviewCount - 1);
    nextInterval = Math.round(previousInterval * newEaseFactor);
  }

  return { nextInterval, newEaseFactor };
}

// Mark an item as reviewed
export function markItemReviewed(id: number, currentEaseFactor: number, currentReviewCount: number, quality: number): void {
  const { nextInterval, newEaseFactor } = calculateNextReview(currentEaseFactor, currentReviewCount, quality);
  const nextReviewAt = new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000).toISOString();
  updateReviewStatus(id, currentReviewCount + 1, newEaseFactor, nextReviewAt);
}

// Build prompt for AI analysis
function buildAIAnalysisPrompt(data: AggregatedData): string {
  const { stats, timeRange, errorPatterns, vocabularyInsights, dueForReview } = data;

  // Build error patterns summary
  const sortedErrors = Array.from(errorPatterns.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const errorSummary = sortedErrors
    .map((e) => {
      const examples = e.examples
        .slice(0, 2)
        .map((ex) => `  - "${ex.original}" → "${ex.corrected}"`)
        .join("\n");
      return `- ${e.category}/${e.type}: ${e.count} occurrences\n${examples}`;
    })
    .join("\n");

  // Build vocabulary summary
  const vocabSummary = vocabularyInsights
    .slice(0, 5)
    .map((v) => `- "${v.original}" → suggested: "${v.alternative}"`)
    .join("\n");

  return `Analyze this language learning data and provide personalized insights.

## Statistics (${timeRange})
- Total prompts: ${stats.totalPrompts}
- Corrections needed: ${stats.totalCorrections}
- Alternatives suggested: ${stats.totalAlternatives}
- Items due for review: ${stats.itemsDueForReview}

## Top Error Patterns
${errorSummary || "No errors recorded yet."}

## Vocabulary Patterns
${vocabSummary || "No vocabulary suggestions yet."}

## Items Due for Review
${dueForReview.length} items need review.

Based on this data, provide:
1. 2-3 specific study recommendations targeting the most frequent errors
2. 1-2 priority areas that need the most attention
3. 1 note about progress or encouragement

Respond in JSON format:
{
  "recommendations": ["...", "..."],
  "priorityAreas": ["...", "..."],
  "progressNotes": ["..."]
}`;
}

// Analyze with AI using Claude Agent SDK
export async function analyzeWithAI(data: AggregatedData): Promise<AIInsights> {
  const prompt = buildAIAnalysisPrompt(data);

  try {
    const resultText = await queryClaudeAI(prompt, {
      model: "sonnet", // Use sonnet for better analysis
      systemPrompt: "You are a language learning coach. Analyze the data and provide actionable, encouraging insights. Respond only with valid JSON.",
    });

    // Parse JSON response
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<AIInsights>;
      return {
        recommendations: parsed.recommendations || [],
        priorityAreas: parsed.priorityAreas || [],
        progressNotes: parsed.progressNotes || [],
      };
    }
  } catch (error) {
    console.error("AI analysis failed:", error);
  }

  // Return default insights if AI fails
  return {
    recommendations: ["Continue practicing regularly to improve your language skills."],
    priorityAreas: [],
    progressNotes: ["Keep up the good work!"],
  };
}

// Gather all review data
export async function gatherReviewData(
  timeRange: TimeRange,
  limit: number
): Promise<AggregatedData> {
  const stats = getStatsSummary(timeRange);
  const corrections = getCorrectionsInRange(timeRange, limit);
  const alternatives = getAlternativesInRange(timeRange, limit);
  const dueForReview = getItemsDueForReview(limit);

  const errorPatterns = aggregateErrorPatterns(corrections);
  const vocabularyInsights = aggregateVocabularyInsights(alternatives);

  return {
    stats,
    timeRange,
    errorPatterns,
    vocabularyInsights,
    dueForReview,
  };
}

// Format review output as markdown
export function formatReviewOutput(
  data: AggregatedData,
  aiInsights: AIInsights,
  groupBy: GroupBy
): string {
  const { stats, timeRange, errorPatterns, vocabularyInsights, dueForReview } = data;

  const timeRangeLabel = {
    day: "Past Day",
    week: "Past Week",
    month: "Past Month",
    all: "All Time",
  }[timeRange];

  let output = `## Language Learning Review (${timeRangeLabel})\n\n`;

  // Summary
  output += `### Summary\n`;
  output += `- Total prompts analyzed: ${stats.totalPrompts}\n`;
  output += `- Corrections needed: ${stats.totalCorrections}\n`;
  output += `- Alternatives suggested: ${stats.totalAlternatives}\n`;
  output += `- Items due for review: ${stats.itemsDueForReview}\n\n`;

  // Due for Review (Spaced Repetition)
  if (dueForReview.length > 0) {
    output += `### Due for Review (Spaced Repetition)\n`;
    for (const item of dueForReview.slice(0, 5)) {
      const corrected = item.correction || item.alternative;
      output += `- "${item.prompt}" → "${corrected}"\n`;
    }
    if (dueForReview.length > 5) {
      output += `- ... and ${dueForReview.length - 5} more items\n`;
    }
    output += "\n";
  }

  // Frequent Error Types
  const sortedErrors = Array.from(errorPatterns.values()).sort((a, b) => b.count - a.count);
  if (sortedErrors.length > 0) {
    output += `### Frequent Error Types\n\n`;

    if (groupBy === "error_type") {
      for (const error of sortedErrors.slice(0, 5)) {
        output += `#### ${capitalize(error.category)} - ${formatType(error.type)} (${error.count} occurrences)\n`;
        output += `| Original | Corrected |\n`;
        output += `|----------|----------|\n`;
        for (const ex of error.examples.slice(0, 3)) {
          output += `| "${truncate(ex.original, 40)}" | "${truncate(ex.corrected || "", 40)}" |\n`;
        }
        output += "\n";
      }
    } else if (groupBy === "date") {
      // Group by date
      const byDate = new Map<string, ErrorAggregate[]>();
      for (const error of sortedErrors) {
        for (const ex of error.examples) {
          const date = ex.date.split("T")[0];
          const existing = byDate.get(date) || [];
          existing.push(error);
          byDate.set(date, existing);
        }
      }
      for (const [date, errors] of Array.from(byDate.entries()).slice(0, 5)) {
        output += `#### ${date}\n`;
        for (const error of errors.slice(0, 3)) {
          output += `- ${error.category}/${error.type}: ${error.count} occurrences\n`;
        }
        output += "\n";
      }
    } else if (groupBy === "project") {
      output += `(Project grouping requires more data - showing by error type)\n\n`;
      for (const error of sortedErrors.slice(0, 5)) {
        output += `- ${capitalize(error.category)}/${formatType(error.type)}: ${error.count} occurrences\n`;
      }
      output += "\n";
    }
  }

  // Vocabulary Insights
  if (vocabularyInsights.length > 0) {
    output += `### Vocabulary Insights\n`;
    output += `| Your Expression | Better Alternative |\n`;
    output += `|-----------------|-------------------|\n`;
    for (const insight of vocabularyInsights.slice(0, 5)) {
      output += `| "${truncate(insight.original, 35)}" | "${truncate(insight.alternative, 35)}" |\n`;
    }
    output += "\n";
  }

  // AI-Generated Recommendations
  if (aiInsights.recommendations.length > 0 || aiInsights.priorityAreas.length > 0) {
    output += `### AI-Generated Study Recommendations\n`;
    for (let i = 0; i < aiInsights.recommendations.length; i++) {
      output += `${i + 1}. ${aiInsights.recommendations[i]}\n`;
    }
    if (aiInsights.priorityAreas.length > 0) {
      output += `\n**Priority Areas:** ${aiInsights.priorityAreas.join(", ")}\n`;
    }
    if (aiInsights.progressNotes.length > 0) {
      output += `\n${aiInsights.progressNotes[0]}\n`;
    }
  }

  return output;
}

// Helper functions
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
