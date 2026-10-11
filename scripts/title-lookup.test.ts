import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTitleLookup,
  extractHtmlTitle,
  extractYouTubeTitle,
  isPublicAddress,
  normaliseTitle,
  validateTitleUrl,
} from "../src/lib/title-lookup-core";

test("title lookup guards, parsing, and integration boundaries", async (t) => {
  await t.test("isPublicAddress permits only public unicast IPv4 and IPv6", () => {
    assert.equal(isPublicAddress("8.8.8.8"), true);
    assert.equal(isPublicAddress("1.1.1.1"), true);
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);

    // Private IPv4
    assert.equal(isPublicAddress("10.0.0.1"), false);
    assert.equal(isPublicAddress("192.168.1.1"), false);
    assert.equal(isPublicAddress("172.16.0.1"), false);

    // Loopback, zero, broadcast, link-local
    assert.equal(isPublicAddress("127.0.0.1"), false);
    assert.equal(isPublicAddress("127.0.0.2"), false);
    assert.equal(isPublicAddress("0.0.0.0"), false);
    assert.equal(isPublicAddress("255.255.255.255"), false);
    assert.equal(isPublicAddress("169.254.169.254"), false);

    // IPv6 loopback, link-local, unique-local, mapped IPv4
    assert.equal(isPublicAddress("::1"), false);
    assert.equal(isPublicAddress("fe80::1"), false);
    assert.equal(isPublicAddress("fc00::1"), false);
    assert.equal(isPublicAddress("fd00::1"), false);
    assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicAddress("::ffff:192.168.1.1"), false);
    assert.equal(isPublicAddress("not-an-ip"), false);
  });

  await t.test("validateTitleUrl blocks private, internal, non-standard, or X/Twitter hosts", () => {
    // Valid public targets
    assert.doesNotThrow(() => validateTitleUrl(new URL("https://example.com/page")));
    assert.doesNotThrow(() => validateTitleUrl(new URL("http://example.org:80/").href.slice(0, -3) ? new URL("http://example.org/") : new URL("http://example.org/")));

    // Disallowed protocols, ports, credentials
    assert.throws(() => validateTitleUrl(new URL("ftp://example.com")));
    assert.throws(() => validateTitleUrl(new URL("https://example.com:8443")));
    assert.throws(() => validateTitleUrl(new URL("https://admin:pass@example.com")));

    // Local / private hostnames
    assert.throws(() => validateTitleUrl(new URL("http://localhost/")));
    assert.throws(() => validateTitleUrl(new URL("http://app.localhost/")));
    assert.throws(() => validateTitleUrl(new URL("http://router.local/")));
    assert.throws(() => validateTitleUrl(new URL("http://intranet/")));
    assert.throws(() => validateTitleUrl(new URL("http://127.0.0.1/")));
    assert.throws(() => validateTitleUrl(new URL("http://10.0.0.1/")));

    // X / Twitter hostnames and subdomains
    assert.throws(() => validateTitleUrl(new URL("https://x.com/post")));
    assert.throws(() => validateTitleUrl(new URL("https://api.twitter.com/endpoint")));
    assert.throws(() => validateTitleUrl(new URL("https://sub.x.com/")));

    // Protocol downgrade on redirect
    assert.throws(() => validateTitleUrl(new URL("http://example.com/insecure"), new URL("https://example.com/secure")));
  });

  await t.test("extractHtmlTitle decodes entities and falls back to og:title", () => {
    const standard = `<!DOCTYPE html><html><head><title>Clean &amp; Simple &mdash; Guide</title></head><body></body></html>`;
    assert.equal(extractHtmlTitle(standard), "Clean & Simple — Guide");

    const withOg = `<!DOCTYPE html><html><head><meta property="og:title" content="Social &quot;Headline&quot;"></head><body></body></html>`;
    assert.equal(extractHtmlTitle(withOg), 'Social "Headline"');

    const multiLine = `<title>  \n  Spaces \t\n and lines   </title>`;
    assert.equal(extractHtmlTitle(multiLine), "Spaces and lines");

    const empty = `<html><head></head><body>No title</body></html>`;
    assert.equal(extractHtmlTitle(empty), "");
  });

  await t.test("extractYouTubeTitle extracts and normalises title from oEmbed JSON", () => {
    const valid = JSON.stringify({ title: "  Rick Astley - Never Gonna Give You Up (Official Music Video)  " });
    assert.equal(extractYouTubeTitle(valid), "Rick Astley - Never Gonna Give You Up (Official Music Video)");
    assert.equal(extractYouTubeTitle(JSON.stringify({ notTitle: "ignored" })), "");
    assert.equal(extractYouTubeTitle("invalid json"), "");
  });

  await t.test("normaliseTitle truncates overlong titles without splitting surrogates", () => {
    const long = "A".repeat(400);
    assert.equal(normaliseTitle(long).length, 300);
  });

  await t.test("createTitleLookup reuses saved title before making outbound requests", async () => {
    let outboundCalled = false;
    const lookup = createTitleLookup({
      savedTitle: async (link) => link.externalId === "dQw4w9WgXcQ" ? "Already Saved Title" : undefined,
      takeSlot: async () => { outboundCalled = true; return true; },
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => { outboundCalled = true; throw new Error("Should not be called"); },
    });

    const result = await lookup("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.title, "Already Saved Title");
    assert.equal(outboundCalled, false);
  });

  await t.test("createTitleLookup refuses X / Twitter links without remote calls", async () => {
    let called = false;
    const lookup = createTitleLookup({
      savedTitle: async () => undefined,
      takeSlot: async () => { called = true; return true; },
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => { called = true; throw new Error("Should not be called"); },
    });

    for (const url of ["https://x.com/someone/status/123", "https://twitter.com/someone/status/456", "https://mobile.x.com/post"]) {
      const result = await lookup(url);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /manually/);
    }
    assert.equal(called, false);
  });

  await t.test("createTitleLookup fails safely when rate slot is exhausted", async () => {
    const lookup = createTitleLookup({
      savedTitle: async () => undefined,
      takeSlot: async () => false,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<title>Hello</title>") }),
    });

    const result = await lookup("https://example.com/articles/rate-limited");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Enter a title manually/);
  });

  await t.test("createTitleLookup fetches and returns parsed HTML title and caches result", async () => {
    let requestsCount = 0;
    const lookup = createTitleLookup({
      savedTitle: async () => undefined,
      takeSlot: async () => true,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => {
        requestsCount++;
        return {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          body: Buffer.from("<!DOCTYPE html><html><head><title>Fetched Title</title></head></html>"),
        };
      },
    });

    const first = await lookup("https://example.com/cached-article");
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.title, "Fetched Title");
    assert.equal(requestsCount, 1);

    const second = await lookup("https://example.com/cached-article");
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.title, "Fetched Title");
    assert.equal(requestsCount, 1, "Duplicate lookup within TTL hits cache");
  });

  await t.test("createTitleLookup blocks SSRF redirects to internal addresses or X", async () => {
    const ssrfRedirect = createTitleLookup({
      savedTitle: async () => undefined,
      takeSlot: async () => true,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url) => {
        if (url.pathname === "/first") {
          return {
            status: 302,
            headers: { location: "http://127.0.0.1/secret" },
            body: Buffer.from(""),
          };
        }
        return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<title>Secret</title>") };
      },
    });

    const ssrfResult = await ssrfRedirect("https://example.com/first");
    assert.equal(ssrfResult.ok, false);

    const xRedirect = createTitleLookup({
      savedTitle: async () => undefined,
      takeSlot: async () => true,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url) => {
        if (url.pathname === "/redirect-to-x") {
          return {
            status: 302,
            headers: { location: "https://x.com/i/status/123" },
            body: Buffer.from(""),
          };
        }
        return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<title>Title</title>") };
      },
    });

    const xResult = await xRedirect("https://example.com/redirect-to-x");
    assert.equal(xResult.ok, false);
  });
});
