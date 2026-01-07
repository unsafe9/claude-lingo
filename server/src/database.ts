import { Database } from "bun:sqlite";
import { getDbPath, ensureConfigDir } from "./config.js";
import type { TimeRange } from "./validation.js";

// Re-export TimeRange for backward compatibility
export type { TimeRange } from "./validation.js";

export interface PromptRecord {
  id: number;
  prompt: string;
  session_id: string;
  project_dir: string | null;
  timestamp: string;
  analysis_result: string | null;
  has_correction: boolean;
  correction: string | null;
  alternative: string | null;
  created_at: string;
  // Legacy SM-2 fields (kept for migration compatibility)
  review_count: number;
  next_review_at: string | null;
  ease_factor: number;
}

// Separate table for FSRS review state
export interface ReviewItem {
  id: number;
  prompt_id: number;
  state: string; // 'new' | 'learning' | 'review' | 'relearning'
  difficulty: number;
  stability: number;
  reps: number;
  lapses: number;
  scheduled_days: number;
  elapsed_days: number;
  due: string | null;
  last_review: string | null;
  created_at: string;
}

// Combined view for API responses
export interface ReviewItemWithPrompt {
  // Review item fields
  id: number;
  prompt_id: number;
  state: string;
  difficulty: number;
  stability: number;
  reps: number;
  lapses: number;
  due: string | null;
  last_review: string | null;
  // Prompt fields
  prompt: string;
  correction: string | null;
  alternative: string | null;
  analysis_result: string | null;
  categories: string[];
}

export interface StreakData {
  current_streak: number;
  best_streak: number;
  last_review_date: string | null;
}

export interface DailyActivity {
  date: string;
  reviews_count: number;
  correct_count: number;
}

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prompts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt TEXT NOT NULL,
          session_id TEXT NOT NULL,
          project_dir TEXT,
          timestamp TEXT NOT NULL,
          analysis_result TEXT,
          has_correction INTEGER DEFAULT 0,
          correction TEXT,
          alternative TEXT,
          review_count INTEGER DEFAULT 0,
          next_review_at TEXT,
          ease_factor REAL DEFAULT 2.5,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_next_review ON prompts(next_review_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_has_correction ON prompts(has_correction)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_categories (
          prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          PRIMARY KEY (prompt_id, category)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompt_categories_category ON prompt_categories(category)`);
    },
  },
  {
    version: 2,
    name: "review_tables",
    up: (db) => {
      // Separate table for FSRS review state
      // One-to-one relationship with prompts (only items with corrections/alternatives)
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_id INTEGER NOT NULL UNIQUE REFERENCES prompts(id) ON DELETE CASCADE,
          state TEXT DEFAULT 'new',
          difficulty REAL DEFAULT 0,
          stability REAL DEFAULT 0,
          reps INTEGER DEFAULT 0,
          lapses INTEGER DEFAULT 0,
          scheduled_days INTEGER DEFAULT 0,
          elapsed_days INTEGER DEFAULT 0,
          due TEXT,
          last_review TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_review_items_due ON review_items(state, due)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_review_items_prompt ON review_items(prompt_id)`);

      // Migrate existing prompts with corrections/alternatives to review_items
      db.exec(`
        INSERT INTO review_items (prompt_id, state, reps, difficulty, stability, due)
        SELECT
          id,
          CASE WHEN review_count > 0 THEN 'review' ELSE 'new' END,
          review_count,
          CASE
            WHEN ease_factor <= 1.5 THEN 8.0
            WHEN ease_factor >= 3.0 THEN 2.0
            ELSE 10.0 - (ease_factor * 2.667)
          END,
          CASE WHEN review_count = 0 THEN 0 ELSE review_count * ease_factor END,
          COALESCE(next_review_at, datetime('now'))
        FROM prompts
        WHERE has_correction = 1 OR alternative IS NOT NULL
      `);

      // Daily activity tracking for heatmap
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_activity (
          date TEXT PRIMARY KEY,
          reviews_count INTEGER DEFAULT 0,
          correct_count INTEGER DEFAULT 0
        )
      `);

      // User streaks (single row table)
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_streaks (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          current_streak INTEGER DEFAULT 0,
          best_streak INTEGER DEFAULT 0,
          last_review_date TEXT
        )
      `);

      // Initialize the single streaks row
      db.exec(`INSERT OR IGNORE INTO user_streaks (id, current_streak, best_streak) VALUES (1, 0, 0)`);
    },
  },
];

let db: Database | null = null;

function ensureMigrationsTable(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getCurrentVersion(database: Database): number {
  const row = database
    .prepare("SELECT MAX(version) as version FROM schema_migrations")
    .get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

function applyMigration(database: Database, migration: Migration): void {
  console.info(`Applying migration ${migration.version}: ${migration.name}`);
  migration.up(database);
  database
    .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
    .run(migration.version, migration.name);
}

function runMigrations(database: Database): void {
  ensureMigrationsTable(database);
  const currentVersion = getCurrentVersion(database);

  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version
  );

  if (pendingMigrations.length === 0) {
    console.debug("Database is up to date");
    return;
  }

  console.info(`Running ${pendingMigrations.length} pending migration(s)`);

  for (const migration of pendingMigrations) {
    applyMigration(database, migration);
  }

  console.info("All migrations applied successfully");
}

function getDb(): Database {
  if (!db) {
    ensureConfigDir();
    db = new Database(getDbPath());
    runMigrations(db);
  }
  return db;
}

export function insertPrompt(data: {
  prompt: string;
  session_id: string;
  project_dir?: string;
  timestamp: string;
  analysis_result?: string;
  has_correction?: boolean;
  correction?: string | null;
  alternative?: string | null;
  categories?: string[];
}): number {
  const database = getDb();

  const stmt = database.prepare(`
    INSERT INTO prompts (prompt, session_id, project_dir, timestamp, analysis_result, has_correction, correction, alternative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.prompt,
    data.session_id,
    data.project_dir ?? null,
    data.timestamp,
    data.analysis_result ?? null,
    data.has_correction ? 1 : 0,
    data.correction ?? null,
    data.alternative ?? null
  );

  const promptId = result.lastInsertRowid as number;

  // Insert categories into junction table
  if (data.categories && data.categories.length > 0) {
    const catStmt = database.prepare(`
      INSERT OR IGNORE INTO prompt_categories (prompt_id, category) VALUES (?, ?)
    `);
    for (const category of data.categories) {
      catStmt.run(promptId, category);
    }
  }

  return promptId;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.info("Database closed");
  }
}

// Get categories for a specific prompt
export function getCategoriesForPrompt(promptId: number): string[] {
  const database = getDb();
  const rows = database
    .prepare(`SELECT category FROM prompt_categories WHERE prompt_id = ?`)
    .all(promptId) as { category: string }[];
  return rows.map((r) => r.category);
}

// Category aggregation for review
export interface CategoryCount {
  category: string;
  count: number;
}

export function getCategoryCounts(timeRange: TimeRange): CategoryCount[] {
  const database = getDb();
  const since = getTimeRangeFilter(timeRange);
  return database
    .prepare(
      `SELECT pc.category, COUNT(*) as count
       FROM prompt_categories pc
       JOIN prompts p ON pc.prompt_id = p.id
       WHERE p.created_at >= ?
       GROUP BY pc.category
       ORDER BY count DESC`
    )
    .all(since) as CategoryCount[];
}

// Get prompts with a specific category
export function getPromptsByCategory(
  category: string,
  timeRange: TimeRange,
  limit: number
): PromptRecord[] {
  const database = getDb();
  const since = getTimeRangeFilter(timeRange);
  return database
    .prepare(
      `SELECT p.* FROM prompts p
       JOIN prompt_categories pc ON p.id = pc.prompt_id
       WHERE pc.category = ? AND p.created_at >= ?
       ORDER BY p.created_at DESC
       LIMIT ?`
    )
    .all(category, since, limit) as PromptRecord[];
}

// Review query functions

function getTimeRangeFilter(timeRange: TimeRange): string {
  const now = new Date();
  switch (timeRange) {
    case "day":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return "1970-01-01T00:00:00.000Z";
  }
}

export function getCorrectionsInRange(timeRange: TimeRange, limit: number): PromptRecord[] {
  const database = getDb();
  const since = getTimeRangeFilter(timeRange);
  return database
    .prepare(
      `SELECT * FROM prompts
       WHERE has_correction = 1 AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(since, limit) as PromptRecord[];
}

export function getAlternativesInRange(timeRange: TimeRange, limit: number): PromptRecord[] {
  const database = getDb();
  const since = getTimeRangeFilter(timeRange);
  return database
    .prepare(
      `SELECT * FROM prompts
       WHERE alternative IS NOT NULL AND has_correction = 0 AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(since, limit) as PromptRecord[];
}

export function getItemsDueForReview(limit: number): PromptRecord[] {
  const database = getDb();
  const now = new Date().toISOString();
  return database
    .prepare(
      `SELECT * FROM prompts
       WHERE (has_correction = 1 OR alternative IS NOT NULL)
         AND (next_review_at IS NULL OR next_review_at <= ?)
       ORDER BY next_review_at ASC NULLS FIRST
       LIMIT ?`
    )
    .all(now, limit) as PromptRecord[];
}

export function updateReviewStatus(
  id: number,
  reviewCount: number,
  easeFactor: number,
  nextReviewAt: string
): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE prompts
       SET review_count = ?, ease_factor = ?, next_review_at = ?
       WHERE id = ?`
    )
    .run(reviewCount, easeFactor, nextReviewAt, id);
}

export interface ReviewStats {
  totalPrompts: number;
  totalCorrections: number;
  totalAlternatives: number;
  itemsDueForReview: number;
}

export function getStatsSummary(timeRange: TimeRange): ReviewStats {
  const database = getDb();
  const since = getTimeRangeFilter(timeRange);
  const now = new Date().toISOString();

  const totalPrompts = database
    .prepare(`SELECT COUNT(*) as count FROM prompts WHERE created_at >= ?`)
    .get(since) as { count: number } | undefined;

  const totalCorrections = database
    .prepare(`SELECT COUNT(*) as count FROM prompts WHERE has_correction = 1 AND created_at >= ?`)
    .get(since) as { count: number } | undefined;

  const totalAlternatives = database
    .prepare(
      `SELECT COUNT(*) as count FROM prompts WHERE alternative IS NOT NULL AND has_correction = 0 AND created_at >= ?`
    )
    .get(since) as { count: number } | undefined;

  const itemsDueForReview = database
    .prepare(
      `SELECT COUNT(*) as count FROM prompts
       WHERE (has_correction = 1 OR alternative IS NOT NULL)
         AND (next_review_at IS NULL OR next_review_at <= ?)`
    )
    .get(now) as { count: number } | undefined;

  return {
    totalPrompts: totalPrompts?.count ?? 0,
    totalCorrections: totalCorrections?.count ?? 0,
    totalAlternatives: totalAlternatives?.count ?? 0,
    itemsDueForReview: itemsDueForReview?.count ?? 0,
  };
}

// ============================================
// FSRS Review Functions (using review_items table)
// ============================================

// Get review items that are due, with their associated prompt data
export function getReviewItemsDue(limit: number, category?: string): ReviewItemWithPrompt[] {
  const database = getDb();
  const now = new Date().toISOString();

  let query = `
    SELECT
      r.id, r.prompt_id, r.state, r.difficulty, r.stability, r.reps, r.lapses,
      r.due, r.last_review,
      p.prompt, p.correction, p.alternative, p.analysis_result
    FROM review_items r
    JOIN prompts p ON r.prompt_id = p.id
    WHERE (r.due IS NULL OR r.due <= ?)
  `;

  const params: (string | number)[] = [now];

  if (category) {
    query += ` AND EXISTS (SELECT 1 FROM prompt_categories pc WHERE pc.prompt_id = p.id AND pc.category = ?)`;
    params.push(category);
  }

  query += ` ORDER BY r.due ASC NULLS FIRST LIMIT ?`;
  params.push(limit);

  const rows = database.prepare(query).all(...params) as Array<{
    id: number;
    prompt_id: number;
    state: string;
    difficulty: number;
    stability: number;
    reps: number;
    lapses: number;
    due: string | null;
    last_review: string | null;
    prompt: string;
    correction: string | null;
    alternative: string | null;
    analysis_result: string | null;
  }>;

  // Fetch categories for each item
  return rows.map((row) => ({
    ...row,
    categories: getCategoriesForPrompt(row.prompt_id),
  }));
}

// Get a single review item by ID
export function getReviewItemById(id: number): ReviewItemWithPrompt | null {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT
        r.id, r.prompt_id, r.state, r.difficulty, r.stability, r.reps, r.lapses,
        r.due, r.last_review,
        p.prompt, p.correction, p.alternative, p.analysis_result
      FROM review_items r
      JOIN prompts p ON r.prompt_id = p.id
      WHERE r.id = ?`
    )
    .get(id) as {
    id: number;
    prompt_id: number;
    state: string;
    difficulty: number;
    stability: number;
    reps: number;
    lapses: number;
    due: string | null;
    last_review: string | null;
    prompt: string;
    correction: string | null;
    alternative: string | null;
    analysis_result: string | null;
  } | null;

  if (!row) return null;

  return {
    ...row,
    categories: getCategoriesForPrompt(row.prompt_id),
  };
}

// Update review item after rating
export function updateReviewItem(
  id: number,
  state: string,
  difficulty: number,
  stability: number,
  reps: number,
  lapses: number,
  scheduledDays: number,
  elapsedDays: number,
  due: string,
  lastReview: string
): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE review_items
       SET state = ?, difficulty = ?, stability = ?, reps = ?, lapses = ?,
           scheduled_days = ?, elapsed_days = ?, due = ?, last_review = ?
       WHERE id = ?`
    )
    .run(state, difficulty, stability, reps, lapses, scheduledDays, elapsedDays, due, lastReview, id);
}

// Count items due for review
export function countReviewItemsDue(): number {
  const database = getDb();
  const now = new Date().toISOString();
  const row = database
    .prepare(`SELECT COUNT(*) as count FROM review_items WHERE due IS NULL OR due <= ?`)
    .get(now) as { count: number } | undefined;
  return row?.count ?? 0;
}

// Create a review item for a prompt (called when prompt has correction/alternative)
export function createReviewItem(promptId: number): number {
  const database = getDb();
  const now = new Date().toISOString();

  // Check if already exists
  const existing = database
    .prepare(`SELECT id FROM review_items WHERE prompt_id = ?`)
    .get(promptId) as { id: number } | undefined;

  if (existing) return existing.id;

  const result = database
    .prepare(
      `INSERT INTO review_items (prompt_id, state, due) VALUES (?, 'new', ?)`
    )
    .run(promptId, now);

  return result.lastInsertRowid as number;
}

// ============================================
// Streak Functions
// ============================================

export function getStreakData(): StreakData {
  const database = getDb();
  const row = database
    .prepare(`SELECT current_streak, best_streak, last_review_date FROM user_streaks WHERE id = 1`)
    .get() as StreakData | undefined;

  return row ?? { current_streak: 0, best_streak: 0, last_review_date: null };
}

export function updateStreakAfterReview(): StreakData {
  const database = getDb();
  const today = new Date().toISOString().split("T")[0];
  const streakData = getStreakData();

  let newStreak = streakData.current_streak;
  let newBest = streakData.best_streak;

  if (streakData.last_review_date === today) {
    // Already reviewed today, no streak change
  } else if (streakData.last_review_date) {
    const lastDate = new Date(streakData.last_review_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // Consecutive day - increment streak
      newStreak = streakData.current_streak + 1;
    } else if (diffDays > 1) {
      // Missed days - reset streak
      newStreak = 1;
    }
  } else {
    // First review ever
    newStreak = 1;
  }

  // Update best streak if current is higher
  if (newStreak > newBest) {
    newBest = newStreak;
  }

  database
    .prepare(
      `UPDATE user_streaks SET current_streak = ?, best_streak = ?, last_review_date = ? WHERE id = 1`
    )
    .run(newStreak, newBest, today);

  return { current_streak: newStreak, best_streak: newBest, last_review_date: today };
}

// ============================================
// Heatmap / Activity Functions
// ============================================

export function recordDailyActivity(correct: boolean): void {
  const database = getDb();
  const today = new Date().toISOString().split("T")[0];

  database
    .prepare(
      `INSERT INTO daily_activity (date, reviews_count, correct_count)
       VALUES (?, 1, ?)
       ON CONFLICT(date) DO UPDATE SET
         reviews_count = reviews_count + 1,
         correct_count = correct_count + ?`
    )
    .run(today, correct ? 1 : 0, correct ? 1 : 0);
}

export function getHeatmapData(months: number = 6): Record<string, number> {
  const database = getDb();
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString().split("T")[0];

  const rows = database
    .prepare(`SELECT date, reviews_count FROM daily_activity WHERE date >= ? ORDER BY date`)
    .all(sinceStr) as { date: string; reviews_count: number }[];

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.date] = row.reviews_count;
  }
  return result;
}

// Get all categories with their counts (for filtering)
export function getAllCategoriesWithCounts(): CategoryCount[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT pc.category, COUNT(*) as count
       FROM prompt_categories pc
       JOIN review_items r ON pc.prompt_id = r.prompt_id
       GROUP BY pc.category
       ORDER BY count DESC`
    )
    .all() as CategoryCount[];
}
