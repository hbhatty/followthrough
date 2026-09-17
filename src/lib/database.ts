import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const SCHEMA_VERSION = 3;

const databaseGlobal = globalThis as typeof globalThis & {
  followthroughDatabase?: { path: string; connection: Database.Database };
};

function initializeSchema(database: Database.Database): void {
  const migrate = database.transaction(() => {
    const version = database.pragma("user_version", { simple: true }) as number;

    if (version > SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${version} is newer than supported version ${SCHEMA_VERSION}.`,
      );
    }

    if (version === 0) {
      database.exec(`
        CREATE TABLE source_items (
          id TEXT PRIMARY KEY NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('x', 'youtube')),
          external_id TEXT NOT NULL CHECK (length(external_id) > 0),
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          saved_text TEXT NOT NULL,
          original_url TEXT NOT NULL,
          added_at TEXT NOT NULL,
          is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
          UNIQUE (source, external_id)
        ) STRICT;

        CREATE TABLE generated_enrichment (
          item_id TEXT PRIMARY KEY NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
          gist TEXT
        ) STRICT;

        CREATE TABLE personal_reviews (
          item_id TEXT PRIMARY KEY NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'to_explore'
            CHECK (status IN ('to_explore', 'finished', 'archived')),
          rating INTEGER CHECK (rating BETWEEN 1 AND 5),
          takeaway TEXT
        ) STRICT;

        CREATE INDEX source_items_added_at ON source_items (added_at DESC, id ASC);
        PRAGMA user_version = 1;
      `);
    }

    if (version < 2) {
      database.exec(`
        ALTER TABLE source_items ADD COLUMN source_sort_index TEXT
          CHECK (source_sort_index IS NULL OR
            (length(source_sort_index) > 0 AND source_sort_index NOT GLOB '*[^0-9]*'));
        ALTER TABLE source_items ADD COLUMN snapshot_json TEXT
          CHECK (snapshot_json IS NULL OR json_valid(snapshot_json));
        ALTER TABLE generated_enrichment ADD COLUMN snapshot_json TEXT
          CHECK (snapshot_json IS NULL OR json_valid(snapshot_json));
        CREATE TABLE bootstrap_exports (
          sha256 TEXT PRIMARY KEY NOT NULL,
          seeded_at TEXT NOT NULL,
          source_metadata_json TEXT NOT NULL CHECK (json_valid(source_metadata_json)),
          enrichment_metadata_json TEXT NOT NULL CHECK (json_valid(enrichment_metadata_json))
        ) STRICT;
        PRAGMA user_version = 2;
      `);
    }
    if (version < 3) {
      database.exec(`
        CREATE TABLE source_items_new (
          id TEXT PRIMARY KEY NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('x', 'youtube', 'website')),
          external_id TEXT NOT NULL CHECK (length(external_id) > 0),
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          saved_text TEXT NOT NULL,
          original_url TEXT NOT NULL,
          added_at TEXT NOT NULL,
          is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
          source_sort_index TEXT CHECK (source_sort_index IS NULL OR
            (length(source_sort_index) > 0 AND source_sort_index NOT GLOB '*[^0-9]*')),
          snapshot_json TEXT CHECK (snapshot_json IS NULL OR json_valid(snapshot_json)),
          UNIQUE (source, external_id)
        ) STRICT;
        INSERT INTO source_items_new SELECT * FROM source_items;
        DROP TABLE source_items;
        ALTER TABLE source_items_new RENAME TO source_items;
        CREATE INDEX source_items_added_at ON source_items (added_at DESC, id ASC);
        PRAGMA user_version = 3;
      `);
      if (database.prepare("PRAGMA foreign_key_check").get()) {
        throw new Error("Database migration would leave invalid source references.");
      }
    }
  });
  // Rebuilding the source constraint must not cascade-delete its child rows.
  database.pragma("foreign_keys = OFF");
  try {
    migrate.immediate();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

export function getDatabase(): Database.Database {
  const configuredPath = process.env.DATABASE_PATH;
  if (configuredPath && !isAbsolute(configuredPath)) {
    throw new Error("DATABASE_PATH must be an absolute path.");
  }
  const path = configuredPath || resolve(process.cwd(), "private-data/followthrough.sqlite");
  const cached = databaseGlobal.followthroughDatabase;

  if (cached?.path === path && cached.connection.open) {
    return cached.connection;
  }

  if (cached?.connection.open) {
    cached.connection.close();
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = new Database(path, { timeout: 5_000 });

  try {
    connection.pragma("foreign_keys = ON");
    connection.pragma("journal_mode = WAL");
    initializeSchema(connection);
  } catch (error) {
    connection.close();
    throw error;
  }

  // Keep one connection per process across Next.js development module reloads.
  databaseGlobal.followthroughDatabase = { path, connection };
  return connection;
}
