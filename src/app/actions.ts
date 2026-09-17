"use server";

import { revalidatePath } from "next/cache";
import { saveReview } from "../lib/reviews";
import { saveLink, type SaveLinkResult } from "../lib/save-link";
import type { ReviewCommand, ReviewDraft, ReviewResult } from "../lib/types";

export async function addLink(formData: FormData): Promise<SaveLinkResult> {
  const url = formData.get("url");
  const title = formData.get("title") ?? "";
  if (typeof url !== "string" || typeof title !== "string") {
    return { ok: false, error: "Enter a web address and an optional title." };
  }
  let result: SaveLinkResult;
  try {
    result = saveLink(url, title);
  } catch {
    return { ok: false, error: "The link could not be saved. Please try again." };
  }
  if (result.ok) {
    revalidatePath("/");
  }
  return result;
}

export async function updateReview(
  itemId: string,
  draft: ReviewDraft,
  command: ReviewCommand = "save",
): Promise<ReviewResult> {
  let result: ReviewResult;
  try {
    result = saveReview(itemId, draft, command);
  } catch {
    return { ok: false, error: "The review could not be saved. Please try again." };
  }
  if (result.ok && command !== "save") {
    revalidatePath("/");
  }
  return result;
}
