export type ItemStatus = "to_explore" | "finished" | "archived";
export type StatusFilter = ItemStatus | "all";

export interface CollectionItem {
  id: string;
  source: "x" | "youtube" | "website";
  externalId: string;
  sourceSortIndex: string | null;
  title: string;
  author: string;
  savedText: string;
  gist: string | null;
  originalUrl: string;
  addedAt: string;
  status: ItemStatus;
  rating: number | null;
  takeaway: string | null;
  isDemo: boolean;
}

export interface ReviewDraft {
  rating: number | null;
  takeaway: string;
}

export type ReviewCommand = "save" | "finish" | "archive";

export type ReviewResult =
  | { ok: true; item: CollectionItem }
  | { ok: false; error: string };
