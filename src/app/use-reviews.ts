"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CollectionItem, DeleteResult, ReviewDraft, ReviewResult } from "../lib/types";
import { deleteLink, updateReview } from "./actions";

type ReviewState = { phase: "saving" | "saved" | "error"; error?: string };
type Transition = "finish" | "archive";
type PendingTransition = {
  command: Transition;
  resolve: (item: CollectionItem | undefined) => void;
};
type ReviewEntry = {
  id: string;
  draft: ReviewDraft;
  revision: number;
  dirty: boolean;
  saved?: CollectionItem;
  error?: string;
  timer?: number;
  running: Promise<void> | null;
  transitions: PendingTransition[];
};
type ReviewSnapshot = {
  drafts: Record<string, ReviewDraft>;
  saved: Record<string, CollectionItem>;
  states: Record<string, ReviewState>;
};

function cancelDebounce(entry: ReviewEntry) {
  if (entry.timer !== undefined) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
}

function isUnsaved(entry: ReviewEntry) {
  return entry.dirty || entry.running !== null || !!entry.error || entry.transitions.length > 0;
}

export function useReviews() {
  const entries = useRef(new Map<string, ReviewEntry>());
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>({
    drafts: {},
    saved: {},
    states: {},
  });

  const getEntry = useCallback((item: CollectionItem) => {
    let entry = entries.current.get(item.id);
    if (!entry) {
      entry = {
        id: item.id,
        draft: { rating: item.rating, takeaway: item.takeaway ?? "" },
        revision: 0,
        dirty: false,
        running: null,
        transitions: [],
      };
      entries.current.set(item.id, entry);
    }
    return entry;
  }, []);

  const publish = useCallback((entry: ReviewEntry) => {
    if (!mounted.current) return;
    const draft = entry.draft;
    const saved = entry.saved;
    const state: ReviewState = entry.error
      ? { phase: "error", error: entry.error }
      : { phase: isUnsaved(entry) ? "saving" : "saved" };
    setSnapshot((previous) => ({
      drafts: { ...previous.drafts, [entry.id]: draft },
      saved: saved && previous.saved[entry.id] !== saved ? { ...previous.saved, [entry.id]: saved } : previous.saved,
      states: { ...previous.states, [entry.id]: state },
    }));
  }, []);

  const run = useCallback((entry: ReviewEntry): Promise<void> => {
    if (entry.running) return entry.running;
    if (!entry.dirty && entry.transitions.length === 0) return Promise.resolve();
    cancelDebounce(entry);

    // Defer the worker so its promise is installed before any completion path.
    entry.running = Promise.resolve().then(async () => {
      try {
        while (entry.dirty || entry.transitions.length > 0) {
          cancelDebounce(entry);
          const transition = entry.transitions.shift();
          const draft = entry.draft;
          const revision = entry.revision;
          entry.error = undefined;
          publish(entry);

          let result: ReviewResult;
          try {
            result = await updateReview(entry.id, draft, transition?.command ?? "save");
          } catch {
            result = {
              ok: false,
              error: "Could not reach the app. Your review is still here; try saving again.",
            };
          }

          if (!result.ok) {
            entry.error = result.error;
            entry.dirty = true;
            cancelDebounce(entry);
            transition?.resolve(undefined);
            publish(entry);
            // Only an explicitly queued command may follow a failed request.
            // Dirty drafts alone never trigger an automatic retry.
            if (entry.transitions.length === 0) break;
            continue;
          }

          entry.saved = result.item;
          entry.dirty = entry.revision !== revision;
          entry.error = undefined;
          transition?.resolve(result.item);
          publish(entry);
          // Changes made during the request are coalesced into the latest full
          // draft. A queued transition takes priority over another autosave.
        }
      } finally {
        entry.running = null;
        publish(entry);
      }
    });
    publish(entry);
    return entry.running;
  }, [publish]);

  const change = useCallback((item: CollectionItem, patch: Partial<ReviewDraft>, immediate = false) => {
    const entry = getEntry(item);
    const draft = { ...entry.draft, ...patch };
    if (draft.rating === entry.draft.rating && draft.takeaway === entry.draft.takeaway) return;
    entry.draft = draft;
    entry.revision += 1;
    entry.dirty = true;
    cancelDebounce(entry);
    publish(entry);

    // Preserve failures until an explicit flush or action retries the draft.
    if (entry.error || entry.running) return;
    if (immediate) {
      void run(entry);
    } else {
      entry.timer = window.setTimeout(() => {
        entry.timer = undefined;
        void run(entry);
      }, 400);
    }
  }, [getEntry, publish, run]);

  const flush = useCallback(async (item: CollectionItem): Promise<boolean> => {
    const entry = getEntry(item);
    cancelDebounce(entry);
    // Joining a failing request must return false, not silently retry it.
    // Calling flush again after failure starts a fresh, explicit attempt.
    await run(entry);
    return !isUnsaved(entry);
  }, [getEntry, run]);

  const act = useCallback((item: CollectionItem, command: Transition): Promise<CollectionItem | undefined> => {
    const entry = getEntry(item);
    cancelDebounce(entry);
    const { promise, resolve } = Promise.withResolvers<CollectionItem | undefined>();
    entry.transitions.push({ command, resolve });
    void run(entry);
    return promise;
  }, [getEntry, run]);

  const remove = useCallback(async (item: CollectionItem): Promise<DeleteResult> => {
    const entry = getEntry(item);
    cancelDebounce(entry);
    // Let in-flight saves settle, but do not require saving a draft being deleted.
    await entry.running;
    let result: DeleteResult;
    try {
      result = await deleteLink(item.id);
    } catch {
      result = { ok: false, error: "Could not reach the app. Try deleting the link again." };
    }
    if (!result.ok) {
      if (entry.dirty && !entry.error) void run(entry);
      return result;
    }
    entries.current.delete(item.id);
    setSnapshot((previous) => {
      const drafts = { ...previous.drafts };
      const saved = { ...previous.saved };
      const states = { ...previous.states };
      delete drafts[item.id];
      delete saved[item.id];
      delete states[item.id];
      return { drafts, saved, states };
    });
    return result;
  }, [getEntry, run]);

  useEffect(() => {
    mounted.current = true;
    const currentEntries = entries.current;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!Array.from(currentEntries.values()).some(isUnsaved)) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", warnBeforeUnload);
      for (const entry of currentEntries.values()) {
        cancelDebounce(entry);
        // Navigation flushes explicitly; this is only a best-effort fallback.
        if (entry.dirty && !entry.error) void run(entry);
      }
    };
  }, [run]);

  return { ...snapshot, change, flush, act, remove };
}
