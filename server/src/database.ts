import { Database } from "bun:sqlite";
import { getDbPath, ensureConfigDir } from "./config.js";
import type { TimeRange } from "./validation.js";

// Re-export TimeRange for backward compatibility
export type { TimeRange } from "./validation.js";

export interface PromptRecord {
  id: number;
  prompt: string;
  timestamp: string;
  session_id: string;
  cwd: string;
  project_dir: string;
  analyzed: boolean;
  analysis_result: string | null;
  has_correction: boolean;
  correction: string | null;
  alternative: string | null;
  categories: string | null;  // JSON array of category strings
  created_at: string;
  // Spaced repetition fields (migration v3)
  review_count: number;
  next_review_at: string | null;
  ease_factor: number;
}

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "create_prompts_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prompts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          session_id TEXT NOT NULL,
          cwd TEXT,
          project_dir TEXT,
          analyzed INTEGER DEFAULT 0,
          analysis_result TEXT,
          has_correction INTEGER DEFAULT 0,
          correction TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_analyzed ON prompts(analyzed)`);
    },
  },
  {
    version: 2,
    name: "add_alternative_column",
    up: (db) => {
      db.exec(`ALTER TABLE prompts ADD COLUMN alternative TEXT`);
    },
  },
  {
    version: 3,
    name: "add_spaced_repetition_columns",
    up: (db) => {
      db.exec(`ALTER TABLE prompts ADD COLUMN review_count INTEGER DEFAULT 0`);
      db.exec(`ALTER TABLE prompts ADD COLUMN next_review_at TEXT`);
      db.exec(`ALTER TABLE prompts ADD COLUMN ease_factor REAL DEFAULT 2.5`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_next_review ON prompts(next_review_at)`);
    },
  },
  {
    version: 4,
    name: "add_categories_column",
    up: (db) => {
      db.exec(`ALTER TABLE prompts ADD COLUMN categories TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompts_categories ON prompts(categories)`);
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
  timestamp: string;
  session_id: string;
  cwd: string;
  project_dir: string;
  analyzed?: boolean;
  analysis_result?: string;
  has_correction?: boolean;
  correction?: string | null;
  alternative?: string | null;
  categories?: string[];
}): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO prompts (prompt, timestamp, session_id, cwd, project_dir, analyzed, analysis_result, has_correction, correction, alternative, categories)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.prompt,
    data.timestamp,
    data.session_id,
    data.cwd,
    data.project_dir,
    data.analyzed ? 1 : 0,
    data.analysis_result ?? null,
    data.has_correction ? 1 : 0,
    data.correction ?? null,
    data.alternative ?? null,
    data.categories ? JSON.stringify(data.categories) : null
  );
  return result.lastInsertRowid as number;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.info("Database closed");
  }
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
