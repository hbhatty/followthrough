import "server-only";

import { withDatabase } from "./database";
import { createTitleLookup } from "./title-lookup-core";
import { takeTitleLookupSlot } from "./title-lookup-limit";
import type { LinkTitleResult, ParsedLink } from "./link-url";

async function getSavedTitle(link: ParsedLink): Promise<string | undefined> {
  return withDatabase(async (database) => {
    const { rows } = await database.execute({
      sql: "SELECT title FROM source_items WHERE source = ? AND external_id = ? LIMIT 1",
      args: [link.source, link.externalId],
    });
    const row = rows[0];
    return typeof row?.title === "string" ? row.title : undefined;
  });
}

export const lookupLinkTitle: (rawUrl: string) => Promise<LinkTitleResult> = createTitleLookup({
  savedTitle: getSavedTitle,
  takeSlot: takeTitleLookupSlot,
});
