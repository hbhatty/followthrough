import { getDatabase } from "../src/lib/database";
import { demoItems } from "./fixtures/demo-items";

const database = getDatabase();

try {
  const insertSource = database.prepare(`
    INSERT INTO source_items (
      id, source, external_id, title, author, saved_text, original_url, added_at, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT (source, external_id) DO NOTHING
  `);
  const insertEnrichment = database.prepare(`
    INSERT INTO generated_enrichment (item_id, gist) VALUES (?, ?)
  `);
  const insertReview = database.prepare(`
    INSERT INTO personal_reviews (item_id, status, rating, takeaway) VALUES (?, ?, ?, ?)
  `);

  const inserted = database.transaction(() => {
    let count = 0;
    for (const item of demoItems) {
      const result = insertSource.run(
        item.id,
        item.source,
        item.externalId,
        item.title,
        item.author,
        item.savedText,
        item.originalUrl,
        item.addedAt,
      );

      // An existing source item, including all of its personal review data, is untouched.
      if (result.changes === 0) continue;

      insertEnrichment.run(item.id, item.gist);
      insertReview.run(item.id, item.status, item.rating, item.takeaway);
      count += 1;
    }
    return count;
  }).immediate();

  console.log(
    `Added ${inserted} fictional demo item(s) to ${database.name}. Existing items were left unchanged.`,
  );
} finally {
  database.close();
}
