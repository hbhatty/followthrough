import "server-only";

import type { Client, Row } from "@libsql/client";
import { withDatabase } from "./database";
import type { CollectionItem, DeleteResult } from "./types";

const itemSelection = `
  SELECT
    item.id,
    item.source,
    item.external_id AS externalId,
    item.source_sort_index AS sourceSortIndex,
    item.title,
    item.author,
    item.saved_text AS savedText,
    enrichment.gist,
    item.original_url AS originalUrl,
    item.added_at AS addedAt,
    COALESCE(review.status, 'to_explore') AS status,
    review.rating,
    review.takeaway,
    item.is_demo AS isDemo
  FROM source_items AS item
  LEFT JOIN generated_enrichment AS enrichment ON enrichment.item_id = item.id
  LEFT JOIN personal_reviews AS review ON review.item_id = item.id
`;
const ordering = "ORDER BY item.added_at DESC, item.id ASC";

function toCollectionItem(row: Row): CollectionItem {
  return {
    id: String(row.id),
    source: row.source as CollectionItem["source"],
    externalId: String(row.externalId),
    sourceSortIndex: row.sourceSortIndex === null ? null : String(row.sourceSortIndex),
    title: String(row.title),
    author: String(row.author),
    savedText: String(row.savedText),
    gist: row.gist === null ? null : String(row.gist),
    originalUrl: String(row.originalUrl),
    addedAt: String(row.addedAt),
    status: row.status as CollectionItem["status"],
    rating: row.rating === null ? null : Number(row.rating),
    takeaway: row.takeaway === null ? null : String(row.takeaway),
    isDemo: Number(row.isDemo) === 1,
  };
}

export async function listItems(): Promise<CollectionItem[]> {
  return withDatabase(async (database) => {
    const { rows } = await database.execute(`${itemSelection} ${ordering}`);
    return rows.map(toCollectionItem);
  });
}

export async function getItem(
  id: string,
  executor?: Pick<Client, "execute">,
): Promise<CollectionItem | undefined> {
  if (!executor) return withDatabase((database) => getItem(id, database));
  const { rows } = await executor.execute({
    sql: `${itemSelection} WHERE item.id = ?`,
    args: [id],
  });
  return rows[0] ? toCollectionItem(rows[0]) : undefined;
}

export async function deleteItem(id: string): Promise<DeleteResult> {
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, error: "Choose a saved item to delete." };
  }
  // Foreign keys remove the item's enrichment and review in the same statement.
  return withDatabase(async (database): Promise<DeleteResult> => {
    await database.execute({ sql: "DELETE FROM source_items WHERE id = ?", args: [id] });
    return { ok: true };
  });
}
