import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getDatabase } from "../src/lib/database";

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${field} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
  return value;
}

function decimal(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^\d+$/.test(result)) throw new Error(`${field} must be a decimal string, not a number.`);
  return result.replace(/^0+(?=\d)/, "");
}

function postUrl(value: unknown, field: string): string {
  const result = text(value, field);
  try {
    const url = new URL(result);
    if (url.protocol === "https:" && ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) && !url.username && !url.password) {
      return result;
    }
  } catch {
    // Do not include potentially private input in URL errors.
  }
  throw new Error(`${field} must be an HTTPS X or Twitter URL.`);
}

async function seed(): Promise<void> {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error("Usage: npm run seed:x -- /path/to/enriched-export.json");
  const bytes = readFileSync(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The export must be valid JSON.");
  }
  const data = object(parsed, "Export");
  const metadata = object(data.export_metadata, "export_metadata");
  if (metadata.schema_version !== 2) throw new Error("Expected an xarchive schema 2 export.");
  const enrichmentMetadata = object(data.enrichment_metadata, "enrichment_metadata");
  if (!Array.isArray(data.bookmarks) || data.bookmarks.length === 0) {
    throw new Error("Expected a non-empty bookmarks array.");
  }

  // Validate the complete batch before opening or modifying the database.
  const seen = new Set<string>();
  const items = data.bookmarks.map((value: unknown, index: number) => {
    const prefix = `Bookmark ${index + 1}`;
    const bookmark = object(value, prefix);
    const enrichment = object(bookmark.enrichment, `${prefix}.enrichment`);
    const author = object(bookmark.author, `${prefix}.author`);
    const externalId = decimal(bookmark.tweet_id, `${prefix}.tweet_id`);
    if (seen.has(externalId)) throw new Error(`${prefix} repeats an earlier tweet ID.`);
    seen.add(externalId);
    const handle = text(author.screen_name, `${prefix}.author.screen_name`);
    const name = text(author.name, `${prefix}.author.name`, true);
    const sourceSnapshot = { ...bookmark };
    delete sourceSnapshot.enrichment;
    return {
      id: `x-${externalId}`,
      externalId,
      sourceSortIndex: decimal(bookmark.sort_index ?? enrichment.source_sort_index, `${prefix}.sort_index`),
      title: text(enrichment.auto_title, `${prefix}.enrichment.auto_title`),
      author: name ? `${name} (@${handle})` : `@${handle}`,
      savedText: text(bookmark.full_text, `${prefix}.full_text`, true),
      originalUrl: postUrl(enrichment.original_post_url ?? enrichment.stable_post_url ?? `https://x.com/i/web/status/${externalId}`, `${prefix}.original_post_url`),
      gist: text(enrichment.auto_gist, `${prefix}.enrichment.auto_gist`, true),
      sourceSnapshot: JSON.stringify(sourceSnapshot),
      enrichmentSnapshot: JSON.stringify(enrichment),
    };
  });
  const sourceMetadata = { ...data };
  delete sourceMetadata.bookmarks;
  delete sourceMetadata.enrichment_metadata;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const addedAt = new Date().toISOString(); // Added to followthrough, not a bookmark timestamp.
  const database = await getDatabase().catch(() => {
    throw new Error("Bookmark seeding failed. Check database configuration and connectivity.");
  });

  try {
    const transaction = await database.transaction("write");
    let inserted = 0;
    let removedDemo = 0;
    try {
      removedDemo = (await transaction.execute("DELETE FROM source_items WHERE is_demo = 1")).rowsAffected;
      for (const item of items) {
        const result = await transaction.execute({
          sql: `INSERT INTO source_items (
            id, source, external_id, title, author, saved_text, original_url, added_at,
            source_sort_index, snapshot_json
          ) VALUES (?, 'x', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (source, external_id) DO NOTHING`,
          args: [item.id, item.externalId, item.title, item.author, item.savedText,
            item.originalUrl, addedAt, item.sourceSortIndex, item.sourceSnapshot],
        });
        // Bootstrap only: never replace an existing item or its personal review.
        if (!result.rowsAffected) continue;
        await transaction.execute({
          sql: "INSERT INTO generated_enrichment (item_id, gist, snapshot_json) VALUES (?, ?, ?)",
          args: [item.id, item.gist, item.enrichmentSnapshot],
        });
        await transaction.execute({
          sql: "INSERT INTO personal_reviews (item_id, status) VALUES (?, 'to_explore')",
          args: [item.id],
        });
        inserted += 1;
      }
      await transaction.execute({
        sql: `INSERT INTO bootstrap_exports (sha256, seeded_at, source_metadata_json, enrichment_metadata_json)
          VALUES (?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING`,
        args: [sha256, addedAt, JSON.stringify(sourceMetadata), JSON.stringify(enrichmentMetadata)],
      });
      await transaction.commit();
    } catch {
      if (!transaction.closed) await transaction.rollback();
      throw new Error("Bookmark seeding failed. Check database configuration and connectivity.");
    } finally {
      transaction.close();
    }
    const result = { inserted, skipped: items.length - inserted, removedDemo };
    console.log(`Seeded ${result.inserted} X bookmark(s); left ${result.skipped} existing item(s) unchanged; removed ${result.removedDemo} fictional item(s).`);
  } catch {
    throw new Error("Bookmark seeding failed. Check database configuration and connectivity.");
  } finally {
    database.close();
  }
}

seed().catch((error: unknown) => {
  // Validation errors are constructed locally; never print a transport error or its URL.
  console.error(error instanceof Error && !("code" in error) ? error.message : "Bookmark seeding failed.");
  process.exitCode = 1;
});
