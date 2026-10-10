import { createClient, type Client, type Config, type InStatement } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 3;

const databaseGlobal = globalThis as typeof globalThis & {
  followthroughDatabase?: { key: string; connection: Client; initialized: Promise<Client> };
  followthroughDatabaseQueues?: WeakMap<Client, Promise<void>>;
};
async function getSchemaVersion(database: Client): Promise<number> {
  // Turso Cloud makes PRAGMA user_version read-only; use schema table if present, fallback to pragma.
  const tableRes = await database.execute(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = '_schema_version'"
  );
  if (tableRes.rows.length > 0) {
    const vRes = await database.execute("SELECT version FROM _schema_version LIMIT 1");
    return Number(vRes.rows[0].version);
  }
  const pragmaRes = await database.execute("PRAGMA user_version");
  return Number(pragmaRes.rows[0].user_version);
}

export async function initializeSchema(database: Client): Promise<void> {
  const version = await getSchemaVersion(database);
  if (version > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${version} is newer than supported version ${SCHEMA_VERSION}.`);
  }
  const statements: InStatement[] = [];
  if (version === 0) {
    statements.push(
      `CREATE TABLE source_items (
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
      ) STRICT`,
      `CREATE TABLE generated_enrichment (
        item_id TEXT PRIMARY KEY NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
        gist TEXT
      ) STRICT`,
      `CREATE TABLE personal_reviews (
        item_id TEXT PRIMARY KEY NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'to_explore'
          CHECK (status IN ('to_explore', 'finished', 'archived')),
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        takeaway TEXT
      ) STRICT`,
      "CREATE INDEX source_items_added_at ON source_items (added_at DESC, id ASC)",
    );
  }
  if (version < 2) {
    statements.push(
      `ALTER TABLE source_items ADD COLUMN source_sort_index TEXT
        CHECK (source_sort_index IS NULL OR
          (length(source_sort_index) > 0 AND source_sort_index NOT GLOB '*[^0-9]*'))`,
      `ALTER TABLE source_items ADD COLUMN snapshot_json TEXT
        CHECK (snapshot_json IS NULL OR json_valid(snapshot_json))`,
      `ALTER TABLE generated_enrichment ADD COLUMN snapshot_json TEXT
        CHECK (snapshot_json IS NULL OR json_valid(snapshot_json))`,
      `CREATE TABLE bootstrap_exports (
        sha256 TEXT PRIMARY KEY NOT NULL,
        seeded_at TEXT NOT NULL,
        source_metadata_json TEXT NOT NULL CHECK (json_valid(source_metadata_json)),
        enrichment_metadata_json TEXT NOT NULL CHECK (json_valid(enrichment_metadata_json))
      ) STRICT`,
    );
  }
  if (version < 3) {
    statements.push(
      `CREATE TABLE source_items_new (
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
      ) STRICT`,
      "INSERT INTO source_items_new SELECT * FROM source_items",
      "DROP TABLE source_items",
      "ALTER TABLE source_items_new RENAME TO source_items",
      "CREATE INDEX source_items_added_at ON source_items (added_at DESC, id ASC)",
      // A SQL assertion fails inside the migration, before it can commit invalid references.
      "CREATE TEMP TABLE migration_foreign_keys_valid (invalid_count INTEGER CHECK (invalid_count = 0))",
      "INSERT INTO migration_foreign_keys_valid SELECT count(*) FROM pragma_foreign_key_check",
      "DROP TABLE migration_foreign_keys_valid",
    );
  }
  if (statements.length) {
    // Both update _schema_version table and PRAGMA user_version (if allowed locally)
    statements.push(
      "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)",
      "DELETE FROM _schema_version",
      `INSERT INTO _schema_version (version) VALUES (${SCHEMA_VERSION})`,
    );
    await database.migrate(statements);
    // Best effort on pragma for local file clients
    try {
      await database.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } catch {
      // Ignored on cloud providers where user_version is read-only
    }
  }
}

export function hostedDatabaseConfig(): Config {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for the hosted database.");
  }
  try {
    const parsed = new URL(url);
    if (!["libsql:", "https:"].includes(parsed.protocol) || !parsed.hostname ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error();
    }
  } catch {
    throw new Error("TURSO_DATABASE_URL must be a hosted libsql:// or https:// URL without embedded credentials or query parameters.");
  }
  return { url, authToken };
}

export async function getDatabase(): Promise<Client> {
  const hosted = Boolean(process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN || process.env.VERCEL);
  let config: Config;
  let path: string | undefined;
  if (hosted) {
    config = hostedDatabaseConfig();
  } else {
    const configuredPath = process.env.DATABASE_PATH;
    if (configuredPath && !isAbsolute(configuredPath)) {
      throw new Error("DATABASE_PATH must be an absolute path.");
    }
    path = configuredPath || resolve(process.cwd(), "private-data/followthrough.sqlite");
    config = { url: pathToFileURL(path).href, timeout: 5_000, concurrency: 1 };
  }
  const key = JSON.stringify(config);
  const cached = databaseGlobal.followthroughDatabase;
  if (cached?.key === key && !cached.connection.closed) return cached.initialized;
  if (cached && !cached.connection.closed) cached.connection.close();
  if (path) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = createClient(config);
  const initialized = (async () => {
    try {
      await connection.execute("PRAGMA foreign_keys = ON");
      if (path) await connection.execute("PRAGMA journal_mode = WAL");
      await initializeSchema(connection);
      return connection;
    } catch (error) {
      connection.close();
      if (databaseGlobal.followthroughDatabase?.connection === connection) {
        delete databaseGlobal.followthroughDatabase;
      }
      throw error;
    }
  })();
  // Cache initialization as well as the client across concurrent requests and HMR.
  databaseGlobal.followthroughDatabase = { key, connection, initialized };
  return initialized;
}

export async function withDatabase<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const database = await getDatabase();
  if (database.protocol !== "file") return operation(database);

  // Keep whole local operations together: a transaction owns the sole file
  // connection until it settles. Retain the queue across development reloads.
  const queues = databaseGlobal.followthroughDatabaseQueues ??= new WeakMap<Client, Promise<void>>();
  const previous = queues.get(database) ?? Promise.resolve();
  const result = previous.then(() => operation(database));
  queues.set(database, result.then(() => undefined, () => undefined));
  return result;
}
