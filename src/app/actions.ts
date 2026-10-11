"use server";

import { revalidatePath } from "next/cache";
import { deleteItem } from "../lib/collection";
import { saveReview } from "../lib/reviews";
import { saveLink, type SaveLinkResult } from "../lib/save-link";
import type { DeleteResult, ReviewCommand, ReviewDraft, ReviewResult } from "../lib/types";
import { lookupLinkTitle } from "../lib/title-lookup";
import type { LinkTitleResult } from "../lib/link-url";

export async function getLinkTitle(rawUrl: string): Promise<LinkTitleResult> {
  try {
    return await lookupLinkTitle(rawUrl);
  } catch {
    return { ok: false, error: "The title could not be retrieved. Enter a title to save this link." };
  }
}

export async function addLink(formData: FormData): Promise<SaveLinkResult> {
  const url = formData.get("url");
  const title = formData.get("title") ?? "";
  if (typeof url !== "string" || typeof title !== "string") {
    return { ok: false, error: "Enter a web address and a title." };
  }
  let result: SaveLinkResult;
  try {
    result = await saveLink(url, title);
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
    result = await saveReview(itemId, draft, command);
  } catch {
    return { ok: false, error: "The review could not be saved. Please try again." };
  }
  if (result.ok && command !== "save") {
    revalidatePath("/");
  }
  return result;
}

export async function deleteLink(itemId: string): Promise<DeleteResult> {
  let result: DeleteResult;
  try {
    result = await deleteItem(itemId);
  } catch {
    return { ok: false, error: "The link could not be deleted. Please try again." };
  }
  if (result.ok) revalidatePath("/");
  return result;
}
