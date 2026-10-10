"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionItem, ReviewDraft, StatusFilter } from "../lib/types";
import type { SaveLinkResult } from "../lib/save-link";
import { formatAddedTimestamp, sourceLabels, statusLabels } from "./_lib/presentation";
import { addLink } from "./actions";
import { useReviews } from "./use-reviews";
import styles from "./review.module.css";

const filters: StatusFilter[] = ["to_explore", "finished", "archived", "all"];
const sources = ["x", "youtube", "website", "all"] as const;
const ratings = [1, 2, 3, 4, 5];

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
  const [focusRequest, setFocusRequest] = useState<{ itemId?: string } | null>(null);
  const handledFocus = useRef<typeof focusRequest>(null);
  const queueRef = useRef<HTMLElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [deleteState, setDeleteState] = useState<{ id: string; error?: string } | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const { drafts, saved, states, change, flush, act, remove } = useReviews();
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
  const canFinish = !!draft && draft.rating !== null && draft.takeaway.trim().length > 0;

  useEffect(() => {
    if (busy || !focusRequest || handledFocus.current === focusRequest) return;
    // The action result can arrive before the refreshed collection.
    if (focusRequest.itemId && selected?.id !== focusRequest.itemId) return;
    handledFocus.current = focusRequest;
    const target = focusRequest.itemId
      ? detailOpen ? detailTitleRef.current : selectedItemRef.current
      : queueRef.current;
    target?.focus();
  }, [busy, detailOpen, selected, focusRequest]);

  useEffect(() => {
    if (addOpen) linkInputRef.current?.focus();
  }, [addOpen]);

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

  async function decide(command: "finish" | "archive" | "skip" | "delete") {
    if (!selected || navigationLock.current) return;
    if (command === "delete" && !window.confirm(
      `Delete “${selected.title}” from followthrough?\n\nThis permanently removes the saved item, rating, and notes. It cannot be undone. The original website is not affected.`,
    )) return;
    navigationLock.current = true;
    setBusy(true);
    const item = selected;
    const position = visibleItems.findIndex((candidate) => candidate.id === item.id);
    const next = visibleItems[position + 1] ?? visibleItems.find((candidate) => candidate.id !== item.id);
    try {
      if (command === "delete") {
        setDeleteState({ id: item.id });
        const result = await remove(item);
        if (!result.ok) {
          setDeleteState({ id: item.id, error: result.error });
          return;
        }
        setDeleteState(null);
      } else if (command === "skip") {
        if (!(await flush(item))) return;
        setSkipped((previous) => new Set(previous).add(item.id));
      } else if (!(await act(item, command))) {
        return;
      }
      setSelectedId(next?.id);
      setDetailOpen(!!next);
      setFocusRequest({ itemId: next?.id });
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
          setFocusRequest({ itemId: result.item.id });
          setLinkUrl("");
          setLinkTitle("");
          setAddOpen(false);
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
    <div className={styles.collection} data-review-collection data-detail-open={detailOpen && !!selected} data-theme={darkMode ? "dark" : "light"}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}>followthrough</Link>
        <button ref={addButtonRef} type="button" className={styles.textButton} disabled={busy}
          aria-expanded={addOpen} aria-controls="add-link-form" onClick={() => setAddOpen(!addOpen)}>
          Add link
        </button>
        <label className={styles.themeToggle}>
          <input type="checkbox" checked={darkMode} onChange={(event) => changeTheme(event.target.checked)} />
          Dark mode
        </label>
      </header>

      {addOpen && (
        <form id="add-link-form" className={styles.addLink} action={submitLink}>
          <fieldset className={styles.addFields} disabled={busy || isSaving}>
            <label>
              URL
              <input ref={linkInputRef} name="url" type="url" required placeholder="https://…" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
            </label>
            <label>
              Title (optional)
              <input name="title" type="text" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} />
            </label>
            <button type="submit">{isSaving ? "Saving…" : "Save link"}</button>
            <button type="button" onClick={() => { setAddOpen(false); addButtonRef.current?.focus(); }}>Cancel</button>
          </fieldset>
          {!isSaving && saveResult && !saveResult.ok && (
            <p className={styles.saveMessage} role="alert">{saveResult.error}</p>
          )}
        </form>
      )}

      <div className={styles.toolbar}>
        <nav className={styles.sourceFilters} aria-label="Filter collection by source">
          {sources.map((value) => (
            <button key={value} type="button" disabled={busy} aria-pressed={source === value}
              onClick={() => void navigate(() => { setSource(value); setSelectedId(undefined); setDetailOpen(false); })}>
              {value === "all" ? "All sources" : value === "website" ? "Websites" : sourceLabels[value]}
            </button>
          ))}
        </nav>
        <form className={styles.searchForm} role="search" onSubmit={(event) => { event.preventDefault(); applySearch(searchText); }}>
          <label htmlFor="collection-search" className="sr-only">Search titles, saved text, and notes</label>
          <input id="collection-search" type="search" value={searchText} disabled={busy}
            onChange={(event) => setSearchText(event.target.value)} placeholder="Search links and notes" />
          <button type="submit" disabled={busy}>Search</button>
        </form>
      </div>
      <nav className={styles.filters} aria-label="Filter collection by status">
        {filters.map((status) => (
          <button key={status} type="button" disabled={busy} aria-pressed={filter === status}
            onClick={() => void navigate(() => { setFilter(status); setSelectedId(undefined); setDetailOpen(false); })}>
            {statusLabels[status]} <span>({status === "all" ? searchItems.length : searchItems.filter((item) => item.status === status).length})</span>
          </button>
        ))}
      </nav>
      {search && (
        <p className={styles.notice} role="status">
          {visibleItems.length} {visibleItems.length === 1 ? "result" : "results"} for “{search.query}” in this view.{" "}
          <button type="button" className={styles.textButton} disabled={busy} onClick={() => applySearch("")}>Clear search</button>
        </p>
      )}
      {skipped.size > 0 && (
        <p className={styles.notice}>
          {skipped.size} skipped this session. <button type="button" className={styles.textButton} disabled={busy} onClick={() => void navigate(() => {
            setSkipped(new Set()); setFilter("to_explore"); setSelectedId(undefined); setDetailOpen(false);
          })}>Start new session</button>
        </p>
      )}
      {!addOpen && saveResult?.ok && selected?.id === saveResult.item.id && (
        <p className={styles.notice} role="status">
          {saveResult.created ? "Link saved." : "Already saved; opened the existing item."}
        </p>
      )}

      <div className={styles.workspace}>
      <section ref={queueRef} tabIndex={-1} className={styles.queue} aria-label="Saved items">
        <h1 className="sr-only">Saved links</h1>
        <ul className={styles.itemList}>
          {visibleItems.map((item) => {
            const rating = drafts[item.id] ? drafts[item.id].rating : item.rating;
            return (
              <li key={item.id} className={styles.item}>
                <button ref={selected?.id === item.id ? selectedItemRef : undefined} type="button" className={styles.itemTitle} disabled={busy}
                  aria-current={selected?.id === item.id ? "true" : undefined}
                  onClick={() => void navigate(() => { setSelectedId(item.id); setDetailOpen(true); setFocusRequest({ itemId: item.id }); })}>
                  {item.title}
                </button>
                <div className={styles.itemMeta}>
                  <span>{sourceLabels[item.source]}{item.author ? ` — ${item.author}` : ""}</span>
                  <a href={item.originalUrl} target="_blank" rel="noopener noreferrer">
                    original<span className="sr-only"> ({item.isDemo ? "example link, " : ""}opens in a new tab)</span>
                  </a>
                  <span>{statusLabels[item.status]}</span>
                  {rating !== null && <span>Rated {rating}/5</span>}
                </div>
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
            <button type="button" disabled={busy} className={styles.backButton} onClick={() => void navigate(() => {
              setDetailOpen(false); setFocusRequest({ itemId: selected.id });
            })}>Back to saved links</button>
            <h2 ref={detailTitleRef} tabIndex={-1} id="review-item-title" className={styles.detailTitle}>{selected.title}</h2>
            <div className={styles.itemMeta}>
              <span>{sourceLabels[selected.source]}{selected.author ? ` — ${selected.author}` : ""}</span>
              <span>{statusLabels[selected.status]}</span>
              <span>Added <time dateTime={selected.addedAt}>{formatAddedTimestamp(selected.addedAt)}</time></span>
            </div>
            <p className={styles.originalRow}>
              <a href={selected.originalUrl} target="_blank" rel="noopener noreferrer">
                {selected.originalUrl}
                <span className="sr-only"> ({selected.isDemo ? "example link, " : ""}opens in a new tab)</span>
              </a>
            </p>
            {selected.gist && (
              <section className={styles.savedContent} aria-label="Generated summary">
                <h3>Summary <span>(generated)</span></h3>
                <p>{selected.gist}</p>
              </section>
            )}
            <section className={styles.review} aria-label="Your review">
              <fieldset className={styles.ratingField} disabled={busy}>
                <legend>Usefulness <span>(1 = not useful, 5 = very useful)</span></legend>
                <div className={styles.ratingChoices}>
                  {ratings.map((value) => (
                    <label key={value}>
                      <input type="radio" name={`rating-${selected.id}`} value={value} checked={draft.rating === value}
                        onChange={() => updateDraft({ rating: value })} aria-label={`${value} out of 5`} />
                      {value}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="review-note" className={styles.noteLabel}>Your notes</label>
              <textarea id="review-note" value={draft.takeaway} disabled={busy} onChange={(event) => updateDraft({ takeaway: event.target.value })}
                onBlur={() => { void flush(selected); }} rows={5} aria-describedby="review-requirements review-save-status" />
              <div className={styles.reviewFeedback}>
                <p id="review-requirements">Rating and notes save automatically. Both are required to finish.</p>
                <p id="review-save-status" role={reviewState?.phase === "error" ? "alert" : "status"}>
                  {reviewState?.phase === "error" ? reviewState.error : reviewState?.phase === "saving" ? "Saving…" : "Saved"}
                  {reviewState?.phase === "error" && <> <button type="button" className={styles.textButton} disabled={busy} onClick={() => void navigate(() => undefined)}>Retry save</button></>}
                </p>
              </div>
              <div className={styles.actions}>
                <button type="button" disabled={busy || !canFinish || selected.status === "finished"} onClick={() => void decide("finish")}>
                  {selected.status === "finished" ? "Finished" : "Finish"}
                </button>
                {selected.status !== "archived" && <button type="button" disabled={busy} onClick={() => void decide("archive")}>Archive</button>}
                {selected.status === "to_explore" && <button type="button" disabled={busy} onClick={() => void decide("skip")}>Skip for now</button>}
                <button type="button" className={styles.deleteButton} disabled={busy}
                  onClick={() => startTransition(async () => { await decide("delete"); })}>Delete link…</button>
              </div>
              {deleteState?.id === selected.id && (
                <p className={styles.saveMessage} role={deleteState.error ? "alert" : "status"}>
                  {deleteState.error ?? "Deleting…"}
                </p>
              )}
            </section>
          </>
        ) : <p className={styles.empty}>Select a saved link to read and review it.</p>}
      </section>
      </div>
    </div>
  );
}
