import type { CollectionItem } from "./types";

export const MAX_LINK_URL_LENGTH = 2048;
export const MAX_LINK_TITLE_LENGTH = 300;

export type ParsedLink = {
  ok: true;
  url: URL;
  source: CollectionItem["source"];
  externalId: string;
};

export function isXUrl(url: URL): boolean {
  return /(?:^|\.)(?:x|twitter)\.com$/i.test(url.hostname.replace(/\.$/, ""));
}

export function parseLinkUrl(rawUrl: string): ParsedLink | { ok: false; error: string } {
  if (typeof rawUrl !== "string" || rawUrl.length > MAX_LINK_URL_LENGTH) {
    return { ok: false, error: `Enter a web address of at most ${MAX_LINK_URL_LENGTH} characters.` };
  }
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
  // Preserve meaningful query parameters and fragments for ordinary pages.
  let externalId = url.href;
  if (isXUrl(url)) {
    const post = url.pathname.match(/^\/(?:[A-Za-z0-9_]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/);
    if (post) {
      source = "x";
      externalId = BigInt(post[1]).toString();
    }
  } else {
    let videoId: string | null = null;
    const host = url.hostname.replace(/\.$/, "");
    if (/^(?:www\.)?youtu\.be$/.test(host)) {
      videoId = url.pathname.split("/")[1];
    } else if (/^(?:(?:www|m|music)\.)?youtube\.com$/.test(host)) {
      videoId = url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] ?? null;
    }
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      source = "youtube";
      externalId = videoId;
    }
  }
  return { ok: true, url, source, externalId };
}

export type LinkTitleResult =
  | { ok: true; title: string }
  | { ok: false; error: string };
