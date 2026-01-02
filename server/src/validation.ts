import { z } from "zod";

// Log level type
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

// Tone type for feedback style
export const ToneSchema = z.enum(["casual", "balanced", "professional"]);
export type Tone = z.infer<typeof ToneSchema>;

// Mode type for processing behavior
// - silent: queue for background analysis, respond immediately, no user feedback
// - non-block: analyze immediately, show feedback without blocking user
// - block: analyze immediately, block until user acknowledges
export const ModeSchema = z.enum(["silent", "non-block", "block"]);
export type Mode = z.infer<typeof ModeSchema>;

// Config validation schema
export const ConfigSchema = z.object({
  language: z.string().min(2).max(20),
  mode: ModeSchema,
  model: z.string().min(1),
  claudeExecutablePath: z.string(),
  queueBatchSize: z.number().int().min(1).max(50),
  queueIntervalMs: z.number().int().min(1000).max(300000),
  logLevel: LogLevelSchema,
  tone: ToneSchema,
  autoCopyCorrections: z.boolean(),
});

// Known config keys for filtering unknown fields
export const KNOWN_CONFIG_KEYS = Object.keys(ConfigSchema.shape) as (keyof Config)[];

export type Config = z.infer<typeof ConfigSchema>;

// Prompt request validation schema
export const PromptRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  timestamp: z.string().optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  project_dir: z.string().optional(),
});

export type ValidatedPromptRequest = z.infer<typeof PromptRequestSchema>;

// Config update validation (partial)
export const ConfigUpdateSchema = ConfigSchema.partial();

export type ValidatedConfigUpdate = z.infer<typeof ConfigUpdateSchema>;

// Helper to format Zod errors for API response
export function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
}
