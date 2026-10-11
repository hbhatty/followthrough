import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { getDatabase } from "../src/lib/database";
import { saveLink } from "../src/lib/save-link";
import { MAX_LINK_TITLE_LENGTH, parseLinkUrl } from "../src/lib/link-url";
import { takeTitleLookupSlot } from "../src/lib/title-lookup-limit";
import { copyDatabase } from "./migrate-cloud";

const execute = promisify(execFile);

test("saving links requires real titles and lookup budgets are shared without changing collection data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "followthrough-titles-"));
  const keys = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "DATABASE_PATH"] as const;
  const previous = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  process.env.DATABASE_PATH = join(directory, "collection.sqlite");
  try {
    const database = await getDatabase();
    await t.test("blank titles cannot create placeholder items, including direct server calls", async () => {
      for (const url of ["https://x.com/example/status/12345", "https://youtu.be/dQw4w9WgXcQ", "https://example.com/article"]) {
        const result = await saveLink(url, " \t\n ");
        assert.equal(result.ok, false);
      }
      assert.equal((await database.execute("SELECT count(*) AS total FROM source_items")).rows[0].total, 0);
      assert.equal((await saveLink("https://example.com/article", "x".repeat(MAX_LINK_TITLE_LENGTH + 1))).ok, false);
    });
    await t.test("manual titles are retained and duplicate post variants do not overwrite them", async () => {
      const result = await saveLink("https://x.com/example/status/12345", "  Why this approach matters  ");
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.item.title, "Why this approach matters");
      assert.equal(result.item.source, "x");
      assert.equal(result.item.status, "to_explore");
      const duplicate = await saveLink("https://twitter.com/example/status/00012345?ref=share", "A different title");
      assert.equal(duplicate.ok, true);
      if (!duplicate.ok) return;
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.item.id, result.item.id);
      assert.equal(duplicate.item.title, "Why this approach matters");
      assert.equal((await database.execute("SELECT count(*) AS total FROM source_items")).rows[0].total, 1);
    });
    await t.test("manual website and video titles save without contacting their hosts", async () => {
      const website = await saveLink("https://offline.invalid/article?section=2#notes", "My website title");
      assert.equal(website.ok, true);
      if (website.ok) {
        assert.equal(website.item.title, "My website title");
        assert.equal(website.item.externalId, "https://offline.invalid/article?section=2#notes");
      }
      const video = await saveLink("https://www.youtube.com/shorts/dQw4w9WgXcQ", "My video title");
      assert.equal(video.ok, true);
      if (video.ok) {
        assert.equal(video.item.title, "My video title");
        assert.equal(video.item.source, "youtube");
        assert.equal(video.item.externalId, "dQw4w9WgXcQ");
      }
      assert.equal((await saveLink("file:///etc/passwd", "Not a website")).ok, false);
      assert.equal(parseLinkUrl("https://user:password@example.com").ok, false);
    });
    await t.test("separate processes share ten lookup slots and expired budgets recover", async () => {
      // Create the operational table before starting competing processes.
      assert.equal(await takeTitleLookupSlot(), true);
      const moduleUrl = pathToFileURL(join(process.cwd(), "src/lib/title-lookup-limit.ts")).href;
      const code = `import { takeTitleLookupSlot } from ${JSON.stringify(moduleUrl)}; const slots = []; for (let i = 0; i < 8; i++) slots.push(await takeTitleLookupSlot()); console.log(JSON.stringify(slots));`;
      const outputs = await Promise.all([0, 1].map(() => execute(process.execPath,
        ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", code],
        { env: process.env })));
      const accepted = outputs.flatMap(({ stdout }) => JSON.parse(stdout) as boolean[]).filter(Boolean);
      assert.equal(accepted.length, 9);
      assert.equal(await takeTitleLookupSlot(), false);
      await database.execute("UPDATE _title_lookup_budget SET started_at = unixepoch() - 61");
      assert.equal(await takeTitleLookupSlot(), true);
      assert.equal((await database.execute("SELECT requests FROM _title_lookup_budget")).rows[0].requests, 1);
      assert.equal((await database.execute("SELECT count(*) AS total FROM source_items")).rows[0].total, 3);
    });
    await t.test("cloud migration retains saved links but does not copy transient request budgets", async () => {
      const target = createClient({ url: pathToFileURL(join(directory, "target.sqlite")).href });
      try {
        await copyDatabase(database, target);
        assert.deepEqual((await target.execute("SELECT title FROM source_items ORDER BY title")).rows,
          (await database.execute("SELECT title FROM source_items ORDER BY title")).rows);
        assert.deepEqual((await target.execute("SELECT name FROM sqlite_schema WHERE name = '_title_lookup_budget'")).rows, []);
      } finally {
        target.close();
      }
    });
  } finally {
    (await getDatabase()).close();
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
