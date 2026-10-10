import { createClient, type Client, type Transaction, type Value } from "@libsql/client";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hostedDatabaseConfig, initializeSchema } from "../src/lib/database";

const tables = [
  {
    name: "source_items",
    columns: ["id", "source", "external_id", "title", "author", "saved_text", "original_url", "added_at", "is_demo", "source_sort_index", "snapshot_json"],
    nullable: ["source_sort_index", "snapshot_json"],
  },
  {
    name: "generated_enrichment",
    columns: ["item_id", "gist", "snapshot_json"],
    nullable: ["gist", "snapshot_json"],
  },
  {
    name: "personal_reviews",
    columns: ["item_id", "status", "rating", "takeaway"],
    nullable: ["rating", "takeaway"],
  },
  {
    name: "bootstrap_exports",
    columns: ["sha256", "seeded_at", "source_metadata_json", "enrichment_metadata_json"],
    nullable: [],
  },
] as const;

type TableName = (typeof tables)[number]["name"];
export type MigrationCounts = Record<TableName, number>;

class MigrationError extends Error {}

async function validateSchema(database: Pick<Client, "execute">, isTarget = false): Promise<void> {
  if (!isTarget) {
    const version = await database.execute("PRAGMA user_version");
    if (Number(version.rows[0].user_version) !== 3) {
      throw new MigrationError("Migration requires schema version 3. Upgrade older source databases with Followthrough before copying.");
    }
  }
  const schema = await database.execute("SELECT name, type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name != '_schema_version' AND type IN ('table', 'trigger', 'view') ORDER BY name");
  const expectedNames = tables.map((table) => table.name).sort();
  if (schema.rows.length !== tables.length || schema.rows.some((row, index) => row.type !== "table" || row.name !== expectedNames[index])) {
    throw new MigrationError("Unexpected database schema; refusing to omit or alter data.");
  }
  const tableList = await database.execute("PRAGMA table_list");
  for (const table of tables) {
    const definition = tableList.rows.find((row) => row.schema === "main" && row.name === table.name);
    if (!definition || Number(definition.strict) !== 1) throw new MigrationError("Expected strict Followthrough tables.");
    const info = await database.execute(`PRAGMA table_xinfo(${table.name})`);
    const nullable: readonly string[] = table.nullable;
    if (info.rows.length !== table.columns.length || info.rows.some((row, index) => {
      const column = table.columns[index];
      const type = column === "rating" || column === "is_demo" ? "INTEGER" : "TEXT";
      return row.name !== column || row.type !== type || Number(row.hidden) !== 0 ||
        Number(row.pk) !== (index === 0 ? 1 : 0) ||
        Number(row.notnull) !== (nullable.includes(column) ? 0 : 1);
    })) {
      throw new MigrationError("Unexpected Followthrough columns; refusing a partial copy.");
    }
    const foreignKeys = await database.execute(`PRAGMA foreign_key_list(${table.name})`);
    const child = table.name === "generated_enrichment" || table.name === "personal_reviews";
    if (foreignKeys.rows.length !== (child ? 1 : 0) || (child && foreignKeys.rows.some((row) =>
      row.table !== "source_items" || row.from !== "item_id" || row.to !== "id" || row.on_delete !== "CASCADE"
    ))) {
      throw new MigrationError("Unexpected Followthrough foreign-key definitions.");
    }
  }
  const indexes = await database.execute("PRAGMA index_list(source_items)");
  let sourceUnique = false;
  for (const index of indexes.rows) {
    if (Number(index.unique) !== 1 || Number(index.partial) !== 0) continue;
    const columns = await database.execute({ sql: "SELECT name FROM pragma_index_info(?) ORDER BY seqno", args: [index.name] });
    if (columns.rows.length === 2 && columns.rows[0].name === "source" && columns.rows[1].name === "external_id") sourceUnique = true;
  }
  if (!sourceUnique) throw new MigrationError("Missing source uniqueness constraint.");
  const integrity = await database.execute("PRAGMA quick_check");
  if (integrity.rows.length !== 1 || integrity.rows[0][0] !== "ok") throw new MigrationError("Database integrity validation failed.");
  await validateForeignKeys(database);
}

async function validateForeignKeys(database: Pick<Client, "execute">): Promise<void> {
  if ((await database.execute("PRAGMA foreign_key_check")).rows.length) {
    throw new MigrationError("Database contains invalid foreign-key references.");
  }
}

async function rollback(transaction: Transaction | undefined): Promise<void> {
  if (transaction && !transaction.closed) await transaction.rollback();
}

/** Copy an entire consistent source snapshot, never merging with existing target data.
 * Clients are caller-owned; accepting clients allows tests without a production local-target bypass.
 */
export async function copyDatabase(source: Client, target: Client): Promise<MigrationCounts> {
  let sourceSnapshot: Transaction | undefined;
  let destination: Transaction | undefined;
  try {
    sourceSnapshot = await source.transaction("read");
    await validateSchema(sourceSnapshot);
    // Schema installation may commit separately; all personal data stays atomic below.
    await initializeSchema(target);
    destination = await target.transaction("write");
    await validateSchema(destination, true);
    for (const table of tables) {
      const existing = await destination.execute(`SELECT count(*) AS count FROM ${table.name}`);
      if (Number(existing.rows[0].count) !== 0) {
        throw new MigrationError("The target database is not empty. Migration never merges or overwrites existing data.");
      }
    }
    const counts = {} as MigrationCounts;
    for (const table of tables) {
      const select = `SELECT ${table.columns.join(", ")} FROM ${table.name} ORDER BY ${table.columns[0]} COLLATE BINARY`;
      const original = await sourceSnapshot.execute(select);
      const insert = `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`;
      // Bound each request while keeping the entire copy in one write transaction.
      for (let offset = 0; offset < original.rows.length; offset += 100) {
        await destination.batch(original.rows.slice(offset, offset + 100).map((row) => ({
          sql: insert,
          args: table.columns.map((column) => row[column]),
        })));
      }
      const copied = await destination.execute(select);
      if (copied.rows.length !== original.rows.length || copied.rows.some((row, index) =>
        table.columns.some((column) => !sameValue(row[column], original.rows[index][column]))
      )) {
        throw new MigrationError("Copied contents do not exactly match the source; migration rolled back.");
      }
      counts[table.name] = original.rows.length;
    }
    await validateForeignKeys(destination);
    // Settle the read-only snapshot before committing the verified destination.
    await sourceSnapshot.commit();
    await destination.commit();
    return counts;
  } catch (error) {
    try {
      await rollback(destination);
    } finally {
      await rollback(sourceSnapshot);
    }
    throw error;
  } finally {
    destination?.close();
    sourceSnapshot?.close();
  }
}

function sameValue(left: Value, right: Value): boolean {
  // The only integer columns are small review ratings and the demo flag. Decimal
  // external IDs / sort indices and every JSON snapshot remain exact text values.
  if (typeof left === "bigint" && typeof right === "number") return left === BigInt(right);
  if (typeof left === "number" && typeof right === "bigint") return BigInt(left) === right;
  return left === right;
}

async function main(): Promise<void> {
  const [argument, ...extra] = process.argv.slice(2);
  if (extra.length || (argument && !isAbsolute(argument))) {
    throw new MigrationError("Usage: npm run migrate:cloud -- /absolute/path/to/followthrough.sqlite");
  }
  const path = argument || resolve(process.cwd(), "private-data/followthrough.sqlite");
  if (!statSync(path).isFile()) throw new MigrationError("The source must be an existing SQLite file.");
  const remoteConfig = hostedDatabaseConfig();
  let source: Client | undefined;
  let target: Client | undefined;
  try {
    // A single connection keeps query_only enabled for the snapshot transaction.
    // SQLite reads its own live WAL; no database/WAL files are copied or renamed.
    source = createClient({ url: pathToFileURL(path).href, concurrency: 1, timeout: 5_000 });
    await source.execute("PRAGMA query_only = ON");
    target = createClient(remoteConfig);
    const counts = await copyDatabase(source, target);
    for (const table of tables) console.log(`${table.name}: ${counts[table.name]} row(s) copied and verified.`);
  } finally {
    target?.close();
    source?.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // Driver errors can contain private SQL values, URLs or tokens; never print them.
    console.error(error instanceof MigrationError ? error.message : "Migration failed. Check source access, database configuration and connectivity; no partial data copy was committed.");
    process.exitCode = 1;
  });
}
