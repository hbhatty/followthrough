"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionItem, ReviewDraft, StatusFilter } from "../lib/types";
import type { SaveLinkResult } from "../lib/save-link";
import { formatAddedTimestamp, sourceLabels, statusLabels } from "./_lib/presentation";
import { addLink } from "./actions";
import { useReviews } from "./use-reviews";
import styles from "./review.module.css";

const filters: StatusFilter[] = ["to_explore", "finished", "archived", "all"];
const sources = ["x", "youtube", "website", "all"] as const;
const ratings = [1, 2, 3, 4, 5];

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
      <path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.08 6.28L12 17.36l-5.63 2.97 1.08-6.28L2.9 9.6l6.3-.9L12 3Z" />
    </svg>
  );
}

export default function ReviewCollection({ items, initialDarkMode }: { items: readonly CollectionItem[]; initialDarkMode: boolean }) {
  const [darkMode, setDarkMode] = useState(initialDarkMode);
  const [source, setSource] = useState<(typeof sources)[number]>("x");
  const [filter, setFilter] = useState<StatusFilter>("to_explore");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState<{ query: string; ids: Set<string> } | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const navigationLock = useRef(false);
  const pendingFocus = useRef(false);
  const queueRef = useRef<HTMLElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const { drafts, saved, states, change, flush, act } = useReviews();
  const sourceItems = useMemo(() => {
    const matching = items.map((item) => saved[item.id] ?? item)
      .filter((item) => source === "all" || item.source === source);
    if (source === "x") {
      matching.sort((a, b) => {
        const left = a.sourceSortIndex;
        const right = b.sourceSortIndex;
        // Newly added links precede the separately ordered bookmark snapshot.
        if (left === null) return right === null ? 0 : -1;
        if (right === null) return 1;
        return right.length - left.length || (left < right ? 1 : left > right ? -1 : 0);
      });
    }
    return matching;
  }, [items, saved, source]);
  const searchItems = search ? sourceItems.filter((item) => search.ids.has(item.id)) : sourceItems;
  const visibleItems = searchItems.filter((item) =>
    (filter === "all" || item.status === filter) && !skipped.has(item.id));
  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0];
  const draft = selected ? drafts[selected.id] ?? { rating: selected.rating, takeaway: selected.takeaway ?? "" } : null;
  const reviewState = selected ? states[selected.id] : undefined;
  const hasBookmarkOrder = source === "x" && !!sourceItems.at(-1)?.sourceSortIndex;
  const canFinish = !!draft && draft.rating !== null && draft.takeaway.trim().length > 0;

  useEffect(() => {
    if (busy || !pendingFocus.current || (detailOpen && !selected)) return;
    pendingFocus.current = false;
    if (!window.matchMedia("(max-width: 650px)").matches) return;
    const target = detailOpen ? detailTitleRef.current : selectedItemRef.current ?? queueRef.current;
    target?.focus();
  }, [busy, detailOpen, selected]);

  async function navigate(changeView: () => void) {
    if (navigationLock.current) return;
    navigationLock.current = true;
    setBusy(true);
    try {
      if (selected && !(await flush(selected))) return;
      changeView();
    } finally {
      navigationLock.current = false;
      setBusy(false);
    }
  }

  function applySearch(value: string) {
    void navigate(() => {
      const query = value.trim();
      const needle = query.toLowerCase();
      const ids = new Set<string>();
      if (needle) {
        for (const original of items) {
          const item = saved[original.id] ?? original;
          const note = drafts[item.id]?.takeaway ?? item.takeaway ?? "";
          if (item.title.toLowerCase().includes(needle) ||
              item.savedText.toLowerCase().includes(needle) ||
              note.toLowerCase().includes(needle)) ids.add(item.id);
        }
      }
      // Keep submitted matches stable while a matching note is being edited.
      setSearch(query ? { query, ids } : null);
      setSearchText(query);
      setSelectedId(undefined);
      setDetailOpen(false);
    });
  }

  function updateDraft(patch: Partial<ReviewDraft>) {
    if (selected && !navigationLock.current) change(selected, patch, "rating" in patch);
  }

  async function decide(command: "finish" | "archive" | "skip") {
    if (!selected || navigationLock.current) return;
    navigationLock.current = true;
    setBusy(true);
    const item = selected;
    const position = visibleItems.findIndex((candidate) => candidate.id === item.id);
    const next = visibleItems[position + 1] ?? visibleItems.find((candidate) => candidate.id !== item.id);
    try {
      if (command === "skip") {
        if (!(await flush(item))) return;
        setSkipped((previous) => new Set(previous).add(item.id));
      } else if (!(await act(item, command))) {
        return;
      }
      setSelectedId(next?.id);
      setDetailOpen(!!next);
      pendingFocus.current = true;
    } finally {
      navigationLock.current = false;
      setBusy(false);
    }
  }

  const [saveResult, submitLink, isSaving] = useActionState<SaveLinkResult | null, FormData>(
    async (_previous, formData) => {
      if (navigationLock.current) return { ok: false, error: "Wait for the current review to save." };
      navigationLock.current = true;
      setBusy(true);
      try {
        if (selected && !(await flush(selected))) {
          return { ok: false, error: "Your review could not be saved. Retry it before adding another link." };
        }
        const result = await addLink(formData);
        if (result.ok) {
          setSkipped((previous) => {
            const next = new Set(previous);
            next.delete(result.item.id);
            return next;
          });
          setSearch(null);
          setSearchText("");
          setSource(result.item.source);
          setFilter(result.item.status);
          setSelectedId(result.item.id);
          setDetailOpen(true);
          pendingFocus.current = true;
          setLinkUrl("");
          setLinkTitle("");
        }
        return result;
      } catch {
        return { ok: false, error: "Could not reach the app. Your link has not been cleared; try again." };
      } finally {
        navigationLock.current = false;
        setBusy(false);
      }
    },
    null,
  );

  function changeTheme(checked: boolean) {
    setDarkMode(checked);
    document.cookie = `followthrough-dark=${checked ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <div className={styles.collection} data-review-collection data-detail-open={detailOpen} data-theme={darkMode ? "dark" : "light"}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}>Followthrough</Link>
        <div className={styles.preferences}>
          <label className={styles.themeToggle}>
            <input type="checkbox" checked={darkMode} onChange={(event) => changeTheme(event.target.checked)} />
            Dark mode
          </label>
        </div>
      </header>

      <p id="review-requirements" className={styles.reviewNotice}>Ratings and notes autosave. Finish requires both.</p>

      <details className={styles.addLink}>
        <summary>Add link</summary>
        <form action={submitLink}>
          <fieldset className={styles.addFields} disabled={busy || isSaving}>
            <label>
              URL
              <input name="url" type="url" required placeholder="https://…" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
            </label>
            <label>
              Title (optional)
              <input name="title" type="text" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} />
            </label>
            <button type="submit">{isSaving ? "Saving…" : "Save"}</button>
          </fieldset>
          {!isSaving && saveResult && (
            <p className={styles.saveMessage} role={saveResult.ok ? "status" : "alert"}>
              {saveResult.ok ? saveResult.created ? "Saved." : "Already saved; opened the existing item." : saveResult.error}
            </p>
          )}
        </form>
      </details>

      <form className={styles.searchForm} role="search" onSubmit={(event) => { event.preventDefault(); applySearch(searchText); }}>
        <label htmlFor="collection-search">Search</label>
        <input id="collection-search" type="search" value={searchText} disabled={busy}
          onChange={(event) => setSearchText(event.target.value)} placeholder="Titles, saved text, notes" />
        <button type="submit" disabled={busy}>Search</button>
        {(search || searchText) && <button type="button" disabled={busy} onClick={() => applySearch("")}>Clear</button>}
      </form>
      {search && (
        <p className={styles.searchNotice} role="status">
          {visibleItems.length} {visibleItems.length === 1 ? "result" : "results"} for “{search.query}” in this view. Search again to refresh edited notes.
        </p>
      )}

      <nav className={styles.sourceFilters} aria-label="Filter collection by source">
        {sources.map((value) => (
          <button key={value} type="button" disabled={busy} aria-pressed={source === value}
            onClick={() => void navigate(() => { setSource(value); setSelectedId(undefined); setDetailOpen(false); })}>
            {value === "all" ? "All sources" : value === "website" ? "Websites" : sourceLabels[value]}
          </button>
        ))}
      </nav>
      <nav className={styles.filters} aria-label="Filter collection by status">
        {filters.map((status) => (
          <button key={status} type="button" disabled={busy} aria-pressed={filter === status}
            onClick={() => void navigate(() => { setFilter(status); setSelectedId(undefined); setDetailOpen(false); })}>
            {statusLabels[status]}
            <span>({status === "all" ? searchItems.length : searchItems.filter((item) => item.status === status).length})</span>
          </button>
        ))}
      </nav>
      {skipped.size > 0 && (
        <p className={styles.sessionNotice}>
          {skipped.size} skipped this session. <button type="button" disabled={busy} onClick={() => void navigate(() => {
            setSkipped(new Set()); setFilter("to_explore"); setSelectedId(undefined); setDetailOpen(false);
          })}>Start new session</button>
        </p>
      )}

      <div className={styles.workspace}>
        <section ref={queueRef} tabIndex={-1} className={styles.queue} aria-label="Saved items">
          <h1 className="sr-only">Saved items</h1>
          <p className={styles.orderLabel}>{hasBookmarkOrder ? sourceItems[0].sourceSortIndex === null ? "New links, then bookmarked" : "Bookmark order (newest first)" : "Added to Followthrough"}</p>
          <ul className={styles.itemList}>
            {visibleItems.map((item) => {
              const rating = drafts[item.id] ? drafts[item.id].rating : item.rating;
              return (
                <li key={item.id}>
                  <button ref={selected?.id === item.id ? selectedItemRef : undefined} type="button" className={styles.item} disabled={busy} aria-current={selected?.id === item.id ? "true" : undefined}
                    onClick={() => void navigate(() => { setSelectedId(item.id); setDetailOpen(true); pendingFocus.current = true; })}>
                    <span className={styles.itemMeta}>{sourceLabels[item.source]}</span>
                    <span className={styles.itemTitle}>{item.title}</span>
                    {rating !== null && (
                      <span className={styles.smallRating} aria-label={`${rating} out of 5 usefulness`}>
                        {ratings.map((value) => <Star key={value} filled={value <= rating} />)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {visibleItems.length === 0 && <p className={styles.empty}>
            {search ? "No matches in this view. Try All sources or All, or clear the search." : `No items in this view${skipped.size ? " for this session" : ""}.`}
          </p>}
        </section>

        <section className={styles.detail} aria-label="Selected item" aria-labelledby={selected ? "review-item-title" : undefined}>
          {selected && draft ? (
            <>
              <button type="button" disabled={busy} className={styles.mobileBack} onClick={() => void navigate(() => { setDetailOpen(false); pendingFocus.current = true; })}>← Back to items</button>
              <div>
                <h2 ref={detailTitleRef} tabIndex={-1} id="review-item-title" className={styles.detailTitle}>{selected.title}</h2>
                <div className={styles.detailMeta}>
                  <span data-source={selected.source}>{sourceLabels[selected.source]}</span>
                  {selected.author && <span>· {selected.author}</span>}
                  <span className={styles.status}>{statusLabels[selected.status]}</span>
                </div>
                <p className={styles.addedAt}>Added to Followthrough · <time dateTime={selected.addedAt}>{formatAddedTimestamp(selected.addedAt)}</time></p>
                <div className={styles.originalRow}>
                  <a href={selected.originalUrl} target="_blank" rel="noopener noreferrer" className={styles.originalLink}>
                    {selected.source === "youtube" ? "Watch video" : selected.source === "website" ? "Open website" : "Open original"}
                    <span className="sr-only"> ({selected.isDemo ? "example link, " : ""}opens in a new tab)</span>
                  </a>
                </div>
                {selected.gist && <section className={styles.savedContent} aria-label="Generated summary"><p>{selected.gist}</p></section>}
              </div>

              <section className={styles.review} aria-label="Your review">
                <fieldset className={styles.ratingField} disabled={busy}>
                  <legend>Rating <span>(required to finish)</span></legend>
                  <div className={styles.ratingLine}>
                    <div className={styles.stars}>
                      {ratings.map((value) => (
                        <label key={value} className={styles.star} data-filled={draft.rating !== null && value <= draft.rating}>
                          <input type="radio" name={`rating-${selected.id}`} value={value} checked={draft.rating === value}
                            onChange={() => updateDraft({ rating: value })} aria-label={`${value} ${value === 1 ? "star" : "stars"}`} />
                          <Star filled={draft.rating !== null && value <= draft.rating} />
                        </label>
                      ))}
                    </div>
                    <span className={styles.ratingValue} aria-live="polite">{draft.rating === null ? "" : `${draft.rating}/5`}</span>
                  </div>
                  <p className="sr-only">1 means not useful to you; 5 means very useful.</p>
                </fieldset>

                <label htmlFor="review-note" className={styles.noteLabel}>Note <span>(required to finish)</span></label>
                <textarea id="review-note" value={draft.takeaway} disabled={busy} onChange={(event) => updateDraft({ takeaway: event.target.value })}
                  onBlur={() => { void flush(selected); }} rows={3} aria-describedby="review-requirements review-save-status" />
                <p id="review-save-status" className={styles.saveMessage} role={reviewState?.phase === "error" ? "alert" : "status"}>
                  {reviewState?.phase === "error" ? reviewState.error : reviewState?.phase === "saving" ? "Saving…" : "Saved"}
                  {reviewState?.phase === "error" && <><span> </span><button type="button" className={styles.retryButton} disabled={busy} onClick={() => void navigate(() => undefined)}>Retry save</button></>}
                </p>
                <div className={styles.actions}>
                  <button type="button" disabled={busy || !canFinish || selected.status === "finished"} className={styles.finishButton} onClick={() => void decide("finish")}>
                    {selected.status === "finished" ? "Finished" : "Finish"}
                  </button>
                  {selected.status !== "archived" && (
                    <details key={selected.id} className={styles.moreActions}>
                      <summary>More</summary>
                      <div className={styles.moreMenu}>
                        <button type="button" disabled={busy} onClick={() => void decide("archive")}>Archive</button>
                        {selected.status === "to_explore" && <button type="button" disabled={busy} onClick={() => void decide("skip")}>Skip for now</button>}
                      </div>
                    </details>
                  )}
                </div>
              </section>
            </>
          ) : <p className={styles.empty}>Select an item to see its content and review.</p>}
        </section>
      </div>
    </div>
  );
}
