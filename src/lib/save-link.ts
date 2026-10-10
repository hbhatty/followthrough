import "server-only";

import { randomUUID } from "node:crypto";
import { getItem } from "./collection";
import { withDatabase } from "./database";
import type { CollectionItem } from "./types";

export type SaveLinkResult =
  | { ok: true; item: CollectionItem; created: boolean }
  | { ok: false; error: string };

export async function saveLink(rawUrl: string, title: string): Promise<SaveLinkResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "Enter a full web address starting with http:// or https://." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only HTTP and HTTPS links can be saved." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Use a link without embedded login credentials." };
  }

  let source: CollectionItem["source"] = "website";
  // Keep meaningful query parameters and fragments for ordinary website pages.
  let externalId = url.href;
  let fallbackTitle = url.hostname;
  if (/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname)) {
    const post = url.pathname.match(/^\/(?:[A-Za-z0-9_]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/);
    if (post) {
      source = "x";
      externalId = BigInt(post[1]).toString();
      fallbackTitle = `X post ${externalId}`;
    }
  } else {
    let videoId: string | null = null;
    if (/^(?:www\.)?youtu\.be$/.test(url.hostname)) {
      videoId = url.pathname.split("/")[1];
    } else if (/^(?:(?:www|m|music)\.)?youtube\.com$/.test(url.hostname)) {
      videoId = url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] ?? null;
    }
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      source = "youtube";
      externalId = videoId;
      fallbackTitle = `YouTube video ${videoId}`;
    }
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
      `, args: [id, source, externalId, title.trim() || fallbackTitle, url.href, new Date().toISOString()] });
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
