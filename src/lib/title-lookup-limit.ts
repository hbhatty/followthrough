import "server-only";

import { withDatabase } from "./database";

/** Shared across processes and deployments that use this collection's database. */
export async function takeTitleLookupSlot(): Promise<boolean> {
  try {
    return await withDatabase(async (database) => {
      // Operational state, not collection data: additive to schema v3 so an older
      // deployed app can keep using a database shared with a local development app.
      await database.execute(`CREATE TABLE IF NOT EXISTS _title_lookup_budget (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        started_at INTEGER NOT NULL,
        requests INTEGER NOT NULL CHECK (requests BETWEEN 1 AND 10)
      ) STRICT`);
      const result = await database.execute(`
        INSERT INTO _title_lookup_budget (id, started_at, requests)
        VALUES (1, unixepoch(), 1)
        ON CONFLICT(id) DO UPDATE SET
          started_at = CASE WHEN started_at <= unixepoch() - 60 THEN unixepoch() ELSE started_at END,
          requests = CASE WHEN started_at <= unixepoch() - 60 THEN 1 ELSE requests + 1 END
        WHERE started_at <= unixepoch() - 60 OR requests < 10
      `);
      return result.rowsAffected === 1;
    });
  } catch {
    // A missing budget store must never turn into unrestricted outbound requests.
    return false;
  }
}
