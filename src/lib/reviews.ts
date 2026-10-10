import "server-only";

import { getItem } from "./collection";
import { withDatabase } from "./database";
import type { ReviewCommand, ReviewDraft, ReviewResult } from "./types";

export async function saveReview(
  itemId: string,
  draft: ReviewDraft,
  command: ReviewCommand = "save",
): Promise<ReviewResult> {
  if (typeof itemId !== "string" || !itemId.trim()) {
    return { ok: false, error: "Choose a saved item to review." };
  }
  if (command !== "save" && command !== "finish" && command !== "archive") {
    return { ok: false, error: "Choose a valid review action." };
  }
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return { ok: false, error: "Provide a rating and personal note to save." };
  }
  const { rating, takeaway } = draft;
  if (rating !== null && (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return { ok: false, error: "Choose a whole-number rating from 1 to 5, or leave it blank." };
  }
  if (typeof takeaway !== "string") {
    return { ok: false, error: "The personal note must be text." };
  }

  return withDatabase(async (database): Promise<ReviewResult> => {
    const transaction = await database.transaction("write");
    try {
      const current = await getItem(itemId, transaction);
      if (!current) {
        return { ok: false, error: "This saved item could not be found." };
      }
      const status = command === "finish" ? "finished" : command === "archive" ? "archived" : current.status;
      if (status === "finished" && (rating === null || !takeaway.trim())) {
        return { ok: false, error: "Add both a rating and a personal note before finishing this item." };
      }

      await transaction.execute({ sql: `
        INSERT INTO personal_reviews (item_id, status, rating, takeaway)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          status = excluded.status,
          rating = excluded.rating,
          takeaway = excluded.takeaway
      `, args: [itemId, status, rating, takeaway] });
      const item = await getItem(itemId, transaction);
      if (!item) throw new Error("Saved review could not be read.");
      await transaction.commit();
      return { ok: true, item };
    } finally {
      try {
        if (!transaction.closed) await transaction.rollback();
      } finally {
        transaction.close();
      }
    }
  });
}
