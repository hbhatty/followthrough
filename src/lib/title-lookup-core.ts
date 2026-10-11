import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { Parser } from "htmlparser2";
import ipaddr from "ipaddr.js";
import { MAX_LINK_TITLE_LENGTH, MAX_LINK_URL_LENGTH, parseLinkUrl, type LinkTitleResult, type ParsedLink } from "./link-url";

export const TITLE_LOOKUP_LIMITS = {
  deadlineMs: 5_000,
  bodyBytes: 256 * 1024,
  headerBytes: 16 * 1024,
  headerCount: 100,
  redirects: 3,
  dnsAddresses: 32,
  concurrency: 4,
  cacheEntries: 128,
  successTtlMs: 5 * 60_000,
  failureTtlMs: 30_000,
} as const;

const MANUAL_TITLE = "Couldn't retrieve a title safely. Enter a title manually.";
const failure = (): LinkTitleResult => ({ ok: false, error: MANUAL_TITLE });
const xHostname = /(?:^|\.)(?:x|twitter)\.com$/;
const redirects = new Set([301, 302, 303, 307, 308]);
type Address = { address: string; family: number };
type Resolve = (hostname: string) => Promise<Address[]>;

export function isPublicAddress(address: string): boolean {
  if (!isIP(address) || address.includes("%")) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== "unicast") return false;
  // Only currently allocated global-unicast IPv6 space is eligible. This also
  // excludes IPv4 translation, mapped addresses and future reserved ranges.
  return parsed.kind() === "ipv4" || parsed.match(ipaddr.parse("2000::"), 3);
}

export function validateTitleUrl(url: URL, previous?: URL): void {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.href.length > MAX_LINK_URL_LENGTH || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.port || !hostname ||
      xHostname.test(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || !hostname.includes(".") && !isIP(hostname) ||
      previous?.protocol === "https:" && url.protocol !== "https:") {
    throw new Error("Ineligible title URL");
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error("Non-public address");
}

export async function resolveTitleAddress(url: URL, signal: AbortSignal,
  resolve: Resolve = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })): Promise<Address> {
  validateTitleUrl(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await abortable(resolve(hostname), signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.length > TITLE_LOOKUP_LIMITS.dnsAddresses ||
      addresses.some((entry) => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) {
    throw new Error("Non-public DNS answer");
  }
  return addresses[0];
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Lookup timed out"));
    if (signal.aborted) {
      void work.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function normaliseTitle(value: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/gu, " ").trim();
  const title = text.slice(0, MAX_LINK_TITLE_LENGTH);
  return title.replace(/[\uD800-\uDBFF]$/, "");
}

export function extractHtmlTitle(html: string): string {
  let inTitle = false;
  let title = "";
  let titleSeen = false;
  let ogTitle = "";
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "title" && !titleSeen) { inTitle = true; titleSeen = true; }
      if (name === "meta" && !ogTitle && (attributes.property ?? attributes.name)?.toLowerCase() === "og:title") {
        ogTitle = attributes.content ?? "";
      }
    },
    ontext(text) { if (inTitle) title += text; },
    onclosetag(name) { if (name === "title") inTitle = false; },
  }, { decodeEntities: true });
  parser.end(html);
  return normaliseTitle(title) || normaliseTitle(ogTitle);
}

export function extractYouTubeTitle(json: string): string {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || !("title" in value) || typeof value.title !== "string") return "";
    // oEmbed titles are JSON plain text, not HTML entities.
    return normaliseTitle(value.title);
  } catch {
    return "";
  }
}

type Response = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
export type TitleRequest = (url: URL, address: Address, signal: AbortSignal) => Promise<Response>;

export const requestTitlePage: TitleRequest = (url, address, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const transport = url.protocol === "https:" ? https : http;
  const request = transport.request(url, {
    method: "GET",
    agent: false,
    signal,
    maxHeaderSize: TITLE_LOOKUP_LIMITS.headerBytes,
    family: address.family,
    // Keep the URL hostname for Host, SNI and certificate verification; only
    // the socket address is pinned, with no second DNS resolution.
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    headers: { Accept: "text/html, application/json", "Accept-Encoding": "identity", "User-Agent": "Followthrough-TitleLookup/1.0" },
  }, (response) => {
    const fail = (message: string) => {
      reject(new Error(message));
      response.destroy();
      request.destroy();
    };
    response.on("error", reject);
    response.on("aborted", () => reject(new Error("Incomplete response")));
    if (response.rawHeaders.length / 2 > TITLE_LOOKUP_LIMITS.headerCount) return fail("Too many headers");
    const encoding = response.headers["content-encoding"];
    if (encoding && encoding.trim().toLowerCase() !== "identity") return fail("Compressed response");
    const status = response.statusCode ?? 0;
    if (redirects.has(status)) {
      resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
      response.destroy();
      request.destroy();
      return;
    }
    if (status !== 200) return fail("Unsuccessful response");
    const declaredSize = response.headers["content-length"];
    if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > TITLE_LOOKUP_LIMITS.bodyBytes)) {
      return fail("Oversized response");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > TITLE_LOOKUP_LIMITS.bodyBytes) return fail("Oversized response");
      chunks.push(chunk);
    });
    response.on("end", () => {
      if (!response.complete) return fail("Incomplete response");
      resolve({ status, headers: response.headers, body: Buffer.concat(chunks, size) });
    });
  });
  request.maxHeadersCount = TITLE_LOOKUP_LIMITS.headerCount + 1;
  request.on("error", reject);
  request.end();
});

function decodeBody(body: Buffer, contentType: string): string {
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? "utf-8";
  return new TextDecoder(charset, { fatal: true }).decode(body);
}

export async function fetchRemoteTitle(link: ParsedLink, signal: AbortSignal,
  takeSlot: () => Promise<boolean>, resolve?: Resolve, request: TitleRequest = requestTitlePage): Promise<string> {
  validateTitleUrl(link.url);
  const youtube = link.source === "youtube";
  let url = youtube
    ? new URL(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.externalId}`)}&format=json`)
    : new URL(link.url);
  url.hash = "";
  for (let hop = 0; ; hop++) {
    validateTitleUrl(url);
    signal.throwIfAborted();
    if (!await abortable(takeSlot(), signal)) throw new Error("Title lookup budget exhausted");
    signal.throwIfAborted();
    const address = await resolveTitleAddress(url, signal, resolve);
    const response = await abortable(request(url, address, signal), signal);
    if (redirects.has(response.status)) {
      if (hop >= TITLE_LOOKUP_LIMITS.redirects || !response.headers.location) throw new Error("Too many redirects");
      const next = new URL(response.headers.location, url);
      validateTitleUrl(next, url);
      // oEmbed must remain on the fixed endpoint; never scrape a video page.
      if (youtube && (next.origin !== "https://www.youtube.com" || next.pathname !== "/oembed")) {
        throw new Error("Unexpected oEmbed redirect");
      }
      if (!youtube && parseLinkUrl(next.href).ok && /(?:^|\.)(?:youtube\.com|youtu\.be)$/.test(next.hostname)) {
        throw new Error("Video redirect requires a video link");
      }
      url = next;
      continue;
    }
    if (response.status !== 200) throw new Error("Unsuccessful response");
    const contentType = response.headers["content-type"] ?? "";
    const mime = contentType.split(";", 1)[0].trim().toLowerCase();
    if (youtube ? mime !== "application/json" : mime !== "text/html") throw new Error("Unsupported response type");
    const title = youtube ? extractYouTubeTitle(decodeBody(response.body, contentType)) : extractHtmlTitle(decodeBody(response.body, contentType));
    if (!title) throw new Error("Missing title");
    return title;
  }
}

export function createTitleLookup(dependencies: {
  savedTitle: (link: ParsedLink) => Promise<string | undefined>;
  takeSlot: () => Promise<boolean>;
  resolve?: Resolve;
  request?: TitleRequest;
  now?: () => number;
}): (rawUrl: string) => Promise<LinkTitleResult> {
  const cache = new Map<string, { result: LinkTitleResult; expires: number }>();
  const pending = new Map<string, Promise<LinkTitleResult>>();
  const now = dependencies.now ?? Date.now;
  return async (rawUrl) => {
    const link = parseLinkUrl(rawUrl);
    if (!link.ok) return link;
    if (xHostname.test(link.url.hostname.replace(/\.$/, ""))) {
      return { ok: false, error: "X and Twitter links need a title entered manually." };
    }
    try { validateTitleUrl(link.url); } catch { return failure(); }
    const canonical = new URL(link.url);
    canonical.hash = "";
    const key = link.source === "youtube" ? `youtube:${link.externalId}` : canonical.href;
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= TITLE_LOOKUP_LIMITS.concurrency) return failure();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Title lookup timed out")), TITLE_LOOKUP_LIMITS.deadlineMs);
    const work = (async (): Promise<LinkTitleResult> => {
      try {
        const saved = await abortable(dependencies.savedTitle(link), controller.signal);
        controller.signal.throwIfAborted();
        if (saved?.trim()) return { ok: true, title: saved };
        const cached = cache.get(key);
        if (cached && cached.expires > now()) return cached.result;
        cache.delete(key);
        return { ok: true, title: await fetchRemoteTitle(link, controller.signal, dependencies.takeSlot, dependencies.resolve, dependencies.request) };
      } catch { return failure(); }
    })().then((result) => {
      const cached = cache.get(key);
      // Do not extend a cached result's TTL on each access.
      if (!cached || cached.expires <= now()) {
        cache.delete(key);
        if (cache.size >= TITLE_LOOKUP_LIMITS.cacheEntries) cache.delete(cache.keys().next().value!);
        cache.set(key, { result, expires: now() + (result.ok ? TITLE_LOOKUP_LIMITS.successTtlMs : TITLE_LOOKUP_LIMITS.failureTtlMs) });
      }
      return result;
    }).finally(() => { clearTimeout(timer); pending.delete(key); });
    pending.set(key, work);
    return work;
  };
}
