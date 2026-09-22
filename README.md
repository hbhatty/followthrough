# Followthrough

Turn saved links into things learned.

A personal local web app for working through saved web links, including X bookmarks, YouTube videos, and other websites, recording useful takeaways, and finding them again.

The app uses Next.js, React, TypeScript, and SQLite. It supports source/status filters, search, persistent ratings and notes, Finish/Archive/Skip actions, link saving and deletion, and a one-time seed command for an enriched X export.

## Review your collection

Open http://127.0.0.1:3000/ for the collection and adjacent review panel. The desktop list scrolls independently; on narrow screens, select a row to open its review and use Back to items to return.

Source views are X (the default), YouTube, Websites, and All sources. Each item shows its title, available attribution, added date/time in UTC, original link, and generated summary when present. Original text is searchable but is not displayed. Dark mode is remembered in a local cookie; reviews are stored in SQLite.

- **Autosave:** rating changes save immediately; notes save after a short typing pause or when leaving the field. Partial reviews may have no rating or a blank note and remain To explore. Saving edits does not change status. Switching items, source/status filters, returning to the list, or adding a link first waits for the current review to save.
- **Finish:** requires both a whole-number rating from 1 to 5 and a nonblank personal note. Whitespace-only notes and generated summaries do not count. Finish saves the latest edits and marks the item Finished in one transaction, then advances to another item in the current view. The same rule is enforced server-side. Editing an already-finished item cannot save an incomplete review.
- **Archive:** under More, saves current edits and marks the item Archived without requiring a rating or note. It leaves the active queue but remains in Archived and All; nothing is deleted locally or from the source website. Use Archive rather than Finish for something you do not want to write about. A valid archived review can later be marked Finished.
- **Skip for now:** under More for To explore items, saves pending edits and hides that item for the current page session, then advances. It does not change stored status, saved ordering, or filter counts. Deferrals apply across source/status views. Start new session restores all skipped items in normal order and returns to To explore; reloading also resets deferrals. Saving an already-saved link explicitly reopens it, even if it was skipped.
- **Delete from Followthrough:** under More for any item, including Archived and Finished. Confirmation names the item and warns that its saved content, rating, and notes will be permanently removed from the local collection. Existing backups, exports, and the original website are untouched. There is no undo. Deletion waits for in-flight saves but does not require saving a draft you are discarding; a failed deletion keeps the item and draft available for retry.
- **Save feedback:** Saving…, Saved, or an error is shown below the note. A failed save keeps the draft on screen and prevents navigation or skipping; Retry save retries it. Failed Finish/Archive does not advance. The browser warns before closing or reloading with unsaved work, but drafts cannot survive a forced close or crash. There is no automatic retry loop or cross-tab conflict resolution; successfully saved data survives reloads and app restarts.

Open the small Search control beside the source filters to search titles, saved text, and personal notes. Submit a query to apply it; the active query and Clear search remain visible even when the field is collapsed. Results follow the source/status filters and remain stable while you edit a matching note; submit again to refresh the matches.

Tags, rating sort, undo, session targets, and review backup/restore controls are not implemented.

## Save a link

At `/`, use the Add link button in the header, paste a full HTTP or HTTPS URL, optionally enter a title, and press Save. The form closes and opens the saved item in its source/status view. New items enter To explore and remain saved after refresh or restart; a duplicate opens the existing item without changing its title, ordering, status, rating, or note. Cancel closes the form without saving the link.

X posts and common YouTube video URLs are recognised by post/video ID, including aliases of seeded X bookmarks. Other links, including platform profiles or pages without a recognised post/video ID, go under Websites. Ordinary website identity uses the normalised URL while retaining query parameters and fragments so distinct destinations are not silently merged. Links containing embedded login credentials and non-web schemes are rejected.

This form does not fetch page titles, authors, text, summaries, or media. If the optional title is blank, the app uses a basic hostname or post/video label. YouTube timestamp parameters remain in the saved link. New links have no captured page text; use Open website, Open original, or Watch video to visit them.

## Run locally

Requires Node.js 22 or newer and npm. Run from the project directory:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000/. Both development and production servers bind to localhost, not the local network. To disable Next.js framework telemetry, prefix the command with `NEXT_TELEMETRY_DISABLED=1`.

An empty database stays empty until you save or explicitly seed items. For a disposable demo collection, `npm run seed:demo` adds four clearly fictional items with example.com links, including a stored sample rating and takeaway. Repeating it leaves existing items and personal review data unchanged. Do not run it against your personal collection unless you want those samples added.

To run the production build:

```sh
npm run build
npm run start
```

## One-time X bootstrap

The enriched JSON is a shortcut for establishing an existing bookmark collection, not the ongoing saving workflow. Keep the file outside this repository and back up an existing database before seeding:

```sh
npm run seed:x -- "/absolute/path/to/enriched-export.json"
```

This command accepts a non-empty, enriched xarchive schema 2 export. It preserves generated titles and summaries, saved post text, authors, original links, exact decimal ordering keys, full source/enrichment snapshots, and export provenance. New bookmarks enter To explore without a personal rating or note. Media, quoted context, and destination links remain in the stored snapshots; the current detail pane does not render those additional fields yet.

The complete input is validated before database changes. Seeding is transactional and replaces fictional demo records with the real collection. Existing source/ID pairs and their reviews are left unchanged, so rerunning the command is safe; this is a bootstrap, not a source-refresh importer. Output contains counts, not bookmark contents. Ongoing saving uses the Add link form for X, YouTube, or other websites.

Deleting an item does not edit the original export. Running the seed command again can re-add items that were deleted locally.

## Storage and privacy

Next.js reads and writes SQLite server-side through `better-sqlite3`. Source content, generated enrichment, and personal reviews are stored separately. The default database is `private-data/followthrough.sqlite`; `DATABASE_PATH` can override it with an absolute path.

The database survives app restarts. Its directory, SQLite sidecars, backups, local environment files, and named X exports are excluded from Git and production dependency traces. This is local storage, not encryption; there is no authentication layer. Do not expose the server publicly or put personal exports in the repository. Personal bootstrap data stays in the local database, not in application fixtures or source files.

The app does not automatically fetch remote pages, media, or fonts. In the X view, manually added links appear first in added-to-Followthrough order, followed by seeded bookmarks in exact descending bookmark-key order. These are separate groups, not a comparison between timestamps and opaque bookmark keys. YouTube, Websites, and All sources use added-to-Followthrough order. Seeding time is not presented as a bookmark timestamp.

The displayed Added to Followthrough timestamp comes from `added_at`: for manually saved links, their actual save time in this app; for seeded bookmarks, the bootstrap time. It is not the original X bookmark time or the post's publication time. The prepared export does not provide the original bookmark timestamp.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
