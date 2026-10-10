import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createClient, type Client, type TransactionMode } from "@libsql/client";
import { initializeSchema } from "../src/lib/database";
import { copyDatabase } from "./migrate-cloud";

async function withDatabases(run: (source: Client, target: Client) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "followthrough-migration-"));
  const source = createClient({ url: pathToFileURL(join(directory, "source.sqlite")).href });
  const target = createClient({ url: pathToFileURL(join(directory, "target.sqlite")).href });
  try {
    await initializeSchema(source);
    await initializeSchema(target);
    await source.batch([
      { sql: `INSERT INTO source_items
        (id, source, external_id, title, author, saved_text, original_url, added_at, source_sort_index, snapshot_json)
        VALUES (?, 'x', ?, 'Fictional bookmark', 'Fictional author', 'Saved text', 'https://example.com/post', '2026-10-01T00:00:00.000Z', ?, ?)`,
        args: ["fictional-id", "900719925474099312345", "999999999999999999999", '{"context":"quoted post"}'] },
      { sql: "INSERT INTO generated_enrichment (item_id, gist, snapshot_json) VALUES (?, ?, ?)",
        args: ["fictional-id", "Generated summary", '{"title":"Enriched title"}'] },
      { sql: "INSERT INTO personal_reviews (item_id, status, rating, takeaway) VALUES (?, 'finished', 4, ?)",
        args: ["fictional-id", "  Exact personal note.\nSecond line.  "] },
      { sql: "INSERT INTO bootstrap_exports VALUES (?, ?, ?, ?)",
        args: ["fictional-checksum", "2026-10-01T00:00:00.000Z", '{"source":"fixture"}', '{"model":"fixture"}'] },
    ], "write");
    await run(source, target);
  } finally {
    source.close();
    target.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const tables = ["source_items", "generated_enrichment", "personal_reviews", "bootstrap_exports"];

test("cloud migration preserves complete snapshots, precise IDs, provenance, and exact reviews", async () => {
  await withDatabases(async (source, target) => {
    const before = await Promise.all(tables.map((table) => source.execute(`SELECT * FROM ${table}`)));
    await copyDatabase(source, target);
    for (const [index, table] of tables.entries()) {
      assert.deepEqual((await target.execute(`SELECT * FROM ${table}`)).rows, before[index].rows);
      assert.deepEqual((await source.execute(`SELECT * FROM ${table}`)).rows, before[index].rows);
    }
    await target.execute("DELETE FROM source_items WHERE id = 'fictional-id'");
    assert.deepEqual((await target.execute("SELECT * FROM personal_reviews")).rows, []);
    assert.deepEqual((await target.execute("SELECT * FROM generated_enrichment")).rows, []);
  });
});

test("migration refuses a used destination without replacing its reviews", async () => {
  await withDatabases(async (source, target) => {
    await copyDatabase(source, target);
    await target.execute("UPDATE personal_reviews SET takeaway = 'New cloud note'");
    await assert.rejects(copyDatabase(source, target));
    assert.equal((await target.execute("SELECT takeaway FROM personal_reviews")).rows[0].takeaway, "New cloud note");
  });
});

test("a failed review insert rolls back all imported tables", async () => {
  await withDatabases(async (source, target) => {
    const transaction = target.transaction.bind(target);
    target.transaction = async (mode?: TransactionMode) => {
      const current = await transaction(mode);
      const batch = current.batch.bind(current);
      current.batch = async (statements) => {
        if (statements.some((statement) => typeof statement !== "string" && statement.sql.startsWith("INSERT INTO personal_reviews"))) {
          throw new Error("Simulated failed review request");
        }
        return batch(statements);
      };
      return current;
    };
    await assert.rejects(copyDatabase(source, target), /Simulated failed review request/);
    for (const table of tables) {
      assert.deepEqual((await target.execute(`SELECT * FROM ${table}`)).rows, []);
    }
    assert.equal((await source.execute("SELECT takeaway FROM personal_reviews")).rows[0].takeaway,
      "  Exact personal note.\nSecond line.  ");
  });
});
