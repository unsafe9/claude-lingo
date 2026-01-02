import { Database } from "bun:sqlite";
import { getDbPath, ensureConfigDir } from "./config.js";

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
  created_at: string;
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

export function getDb(): Database {
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
}): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO prompts (prompt, timestamp, session_id, cwd, project_dir, analyzed, analysis_result, has_correction, correction, alternative)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.alternative ?? null
  );
  return result.lastInsertRowid as number;
}

export function getRecentPrompts(limit = 50): PromptRecord[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM prompts ORDER BY id DESC LIMIT ?
  `);
  return stmt.all(limit) as PromptRecord[];
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.info("Database closed");
  }
}
