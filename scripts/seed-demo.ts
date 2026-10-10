import { getDatabase } from "../src/lib/database";
import { demoItems } from "./fixtures/demo-items";

async function seed(): Promise<void> {
  const database = await getDatabase();
  try {
    const transaction = await database.transaction("write");
    let inserted = 0;
    try {
      for (const item of demoItems) {
        const result = await transaction.execute({
          sql: `INSERT INTO source_items (
            id, source, external_id, title, author, saved_text, original_url, added_at, is_demo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT (source, external_id) DO NOTHING`,
          args: [item.id, item.source, item.externalId, item.title, item.author,
            item.savedText, item.originalUrl, item.addedAt],
        });
        // An existing source item, including all of its personal review data, is untouched.
        if (result.rowsAffected === 0) continue;
        await transaction.execute({
          sql: "INSERT INTO generated_enrichment (item_id, gist) VALUES (?, ?)",
          args: [item.id, item.gist],
        });
        await transaction.execute({
          sql: "INSERT INTO personal_reviews (item_id, status, rating, takeaway) VALUES (?, ?, ?, ?)",
          args: [item.id, item.status, item.rating, item.takeaway],
        });
        inserted += 1;
      }
      await transaction.commit();
    } catch (error) {
      if (!transaction.closed) await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
    console.log(`Added ${inserted} fictional demo item(s). Existing items were left unchanged.`);
  } finally {
    database.close();
  }
}

seed().catch(() => {
  console.error("Demo seeding failed. Check database configuration and connectivity.");
  process.exitCode = 1;
});
