import "server-only";

import { randomUUID } from "node:crypto";
import { getItem } from "./collection";
import { getDatabase } from "./database";
import type { CollectionItem } from "./types";

export type SaveLinkResult =
  | { ok: true; item: CollectionItem; created: boolean }
  | { ok: false; error: string };

export function saveLink(rawUrl: string, title: string): SaveLinkResult {
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

  const database = getDatabase();
  return database.transaction((): SaveLinkResult => {
    const existing = database.prepare<[string, string], { id: string }>(
      "SELECT id FROM source_items WHERE source = ? AND external_id = ?",
    ).get(source, externalId);
    if (existing) {
      const item = getItem(existing.id);
      if (!item) throw new Error("Existing saved link could not be read.");
      return { ok: true, item, created: false };
    }

    const id = randomUUID();
    database.prepare(`
      INSERT INTO source_items (
        id, source, external_id, title, author, saved_text, original_url, added_at
      ) VALUES (?, ?, ?, ?, '', '', ?, ?)
    `).run(id, source, externalId, title.trim() || fallbackTitle, url.href, new Date().toISOString());
    database.prepare("INSERT INTO generated_enrichment (item_id) VALUES (?)").run(id);
    database.prepare("INSERT INTO personal_reviews (item_id, status) VALUES (?, 'to_explore')").run(id);
    const item = getItem(id);
    if (!item) throw new Error("New saved link could not be read.");
    return { ok: true, item, created: true };
  }).immediate();
}
