import "server-only";

import type Database from "better-sqlite3";
import { getDatabase } from "./database";
import type { CollectionItem } from "./types";

type ItemRow = Omit<CollectionItem, "isDemo"> & { isDemo: number };

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

interface CollectionQueries {
  all: Database.Statement<[], ItemRow>;
  item: Database.Statement<[string], ItemRow>;
}

const preparedQueries = new WeakMap<Database.Database, CollectionQueries>();

function getQueries() {
  const database = getDatabase();
  let queries = preparedQueries.get(database);
  if (!queries) {
    queries = {
      all: database.prepare<[], ItemRow>(`${itemSelection} ${ordering}`),
      item: database.prepare<[string], ItemRow>(`${itemSelection} WHERE item.id = ?`),
    };
    preparedQueries.set(database, queries);
  }
  return queries;
}

export function listItems(): CollectionItem[] {
  const rows = getQueries().all.all();
  return rows.map((row) => ({ ...row, isDemo: row.isDemo === 1 }));
}

export function getItem(id: string): CollectionItem | undefined {
  const row = getQueries().item.get(id);
  return row ? { ...row, isDemo: row.isDemo === 1 } : undefined;
}
