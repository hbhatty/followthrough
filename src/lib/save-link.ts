import "server-only";

import { randomUUID } from "node:crypto";
import { getItem } from "./collection";
import { withDatabase } from "./database";
import type { CollectionItem } from "./types";
import { isXUrl, MAX_LINK_TITLE_LENGTH, parseLinkUrl } from "./link-url";

export type SaveLinkResult =
  | { ok: true; item: CollectionItem; created: boolean }
  | { ok: false; error: string };

export async function saveLink(rawUrl: string, title: string): Promise<SaveLinkResult> {
  const parsed = parseLinkUrl(rawUrl);
  if (!parsed.ok) return parsed;
  const { url, source, externalId } = parsed;
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle) {
    return { ok: false, error: isXUrl(url)
      ? "Enter a title for this X post."
      : "Enter a title, or find one before saving this link." };
  }
  if (cleanTitle.length > MAX_LINK_TITLE_LENGTH) {
    return { ok: false, error: `Use a title of at most ${MAX_LINK_TITLE_LENGTH} characters.` };
  }

  return withDatabase(async (database): Promise<SaveLinkResult> => {
    const transaction = await database.transaction("write");
    try {
      const { rows } = await transaction.execute({
        sql: "SELECT id FROM source_items WHERE source = ? AND external_id = ?",
        args: [source, externalId],
      });
      const existing = rows[0];
      if (existing) {
        const item = await getItem(String(existing.id), transaction);
        if (!item) throw new Error("Existing saved link could not be read.");
        await transaction.commit();
        return { ok: true, item, created: false };
      }

      const id = randomUUID();
      await transaction.execute({ sql: `
        INSERT INTO source_items (
          id, source, external_id, title, author, saved_text, original_url, added_at
        ) VALUES (?, ?, ?, ?, '', '', ?, ?)
      `, args: [id, source, externalId, cleanTitle, url.href, new Date().toISOString()] });
      await transaction.execute({
        sql: "INSERT INTO generated_enrichment (item_id) VALUES (?)",
        args: [id],
      });
      await transaction.execute({
        sql: "INSERT INTO personal_reviews (item_id, status) VALUES (?, 'to_explore')",
        args: [id],
      });
      const item = await getItem(id, transaction);
      if (!item) throw new Error("New saved link could not be read.");
      await transaction.commit();
      return { ok: true, item, created: true };
    } finally {
      try {
        if (!transaction.closed) await transaction.rollback();
      } finally {
        transaction.close();
      }
    }
  });
}
