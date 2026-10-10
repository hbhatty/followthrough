# Followthrough

Turn saved links into things learned.

A personal web app for working through saved web links, including X bookmarks, YouTube videos, and other websites, recording useful takeaways, and finding them again. Run locally or deploy privately to Vercel with a Turso database.

The app uses Next.js, React, TypeScript, and SQLite through `@libsql/client`. It supports source/status filters, search, persistent ratings and notes, Finish/Archive/Skip actions, link saving and deletion, and a one-time seed command for an enriched X export.

## Review your collection

Open http://127.0.0.1:3000/ for a compact list of saved links beside the selected item's review. The desktop list scrolls independently, and the selected title is highlighted without hiding the list. Select a title to read its summary and review it, or use its original link to visit the source. On narrow screens, selecting a title opens the item view; Back to saved links returns to the list.

Source views are X (the default), YouTube, Websites, and All sources. Each item shows its title, available attribution, added date/time in UTC, original link, and generated summary when present. Original text is searchable but is not displayed. Dark mode is remembered in a local cookie; reviews are stored in SQLite.

- **Autosave:** rating changes save immediately; notes save after a short typing pause or when leaving the field. Partial reviews may have no rating or a blank note and remain To explore. Saving edits does not change status. Switching items, source/status filters, returning to the list, or adding a link first waits for the current review to save.
- **Finish:** requires both a whole-number rating from 1 to 5 and a nonblank personal note. Whitespace-only notes and generated summaries do not count. Finish saves the latest edits and marks the item Finished in one transaction, then advances to another item in the current view. The same rule is enforced server-side. Editing an already-finished item cannot save an incomplete review.
- **Archive:** saves current edits and marks the item Archived without requiring a rating or note. It leaves the active queue but remains in Archived and All; nothing is deleted locally or from the source website. Use Archive rather than Finish for something you do not want to write about. A valid archived review can later be marked Finished.
- **Skip for now:** available beside Finish and Archive for To explore items, saves pending edits and hides that item for the current page session, then advances. It does not change stored status, saved ordering, or filter counts. Deferrals apply across source/status views. Start new session restores all skipped items in normal order and returns to To explore; reloading also resets deferrals. Saving an already-saved link explicitly reopens it, even if it was skipped.
- **Delete link:** available below the notes for any item, including Archived and Finished. Confirmation names the item and warns that its saved content, rating, and notes will be permanently removed from the local collection. Existing backups, exports, and the original website are untouched. There is no undo. Deletion waits for in-flight saves but does not require saving a draft you are discarding; a failed deletion keeps the item and draft available for retry.
- **Save feedback:** Saving…, Saved, or an error is shown below the note. A failed save keeps the draft on screen and prevents navigation or skipping; Retry save retries it. Failed Finish/Archive does not advance. The browser warns before closing or reloading with unsaved work, but drafts cannot survive a forced close or crash. There is no automatic retry loop or cross-tab conflict resolution; successfully saved data survives reloads and app restarts.

The search field is always visible beside the source filters, or below them on narrow screens. Search titles, saved text, and personal notes by submitting a query; use Clear search to return to the unfiltered view. Results follow the source/status filters and remain stable while you edit a matching note; submit again to refresh the matches.

Tags, rating sort, undo, session targets, and review backup/restore controls are not implemented.

## Save a link

At `/`, use Add link in the header, paste a full HTTP or HTTPS URL, optionally enter a title, and press Save link. The form closes and opens the saved item in its source/status view. New items enter To explore and remain saved after refresh or restart; a duplicate opens the existing item without changing its title, ordering, status, rating, or note. Cancel closes the form without saving the link.

X posts and common YouTube video URLs are recognised by post/video ID, including aliases of seeded X bookmarks. Other links, including platform profiles or pages without a recognised post/video ID, go under Websites. Ordinary website identity uses the normalised URL while retaining query parameters and fragments so distinct destinations are not silently merged. Links containing embedded login credentials and non-web schemes are rejected.

This form does not fetch page titles, authors, text, summaries, or media. If the optional title is blank, the app uses a basic hostname or post/video label. YouTube timestamp parameters remain in the saved link. New links have no captured page text; use the original link in the list or the web address in the item view to visit them.

## Run locally

Requires Node.js 22.9 or newer and npm. Run from the project directory:

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

## Deploy privately to Vercel

Use a Vercel-provided `*.vercel.app` address; buying a domain is optional. The app runs on Vercel, and your collection lives in Turso rather than on your computer. Internet access is required. Provider plan limits and charges apply independently.

### 1. Create the hosted database

Create an **empty** database in [Turso](https://turso.tech/) and obtain its database URL and read/write database token. Copy `.env.example` to the Git-ignored `.env.local`, then set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Never prefix credentials with `NEXT_PUBLIC_`, commit them, or paste them into an issue.

Stop the local app while transferring the collection, then run:

```sh
npm run migrate:cloud -- "/absolute/path/to/private-data/followthrough.sqlite"
```

The command reads a consistent SQLite snapshot, including committed WAL data, without changing the local collection. It validates the schema, copies source items, generated enrichment, reviews and export provenance, compares every copied value, and commits the data together. It refuses a non-empty destination rather than merging or overwriting it; failures roll back the data transfer. Logs show counts only. The source must already be schema version 3; older databases must first be upgraded by running the local app without Turso variables.

Keep the local database and its existing backups as your pre-migration copy. Once migrated, use the hosted collection as the authoritative copy: subsequent cloud edits do not sync back to the old local file. Do not rerun the seed commands merely to deploy.

### 2. Configure private access before publishing

Import this repository into a Vercel project using the Next.js preset and Node.js 22.x or newer. In **Settings → Deployment Protection**, enable **Vercel Authentication → All Deployments**. Standard Protection is insufficient: it leaves production domains public. Keep protection enabled, restrict project membership, and do not create public exceptions or shareable bypass links. See [Vercel's protection documentation](https://vercel.com/docs/deployment-protection).

Set these server-side environment variables on the Vercel project:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | Hosted `libsql://` or `https://` database URL |
| `TURSO_AUTH_TOKEN` | Database read/write token |
| `VERCEL_API_TOKEN` | Vercel API token with access to read this project's settings |
| `VERCEL_PROJECT_ID` | Actual `prj_…` project ID from project settings; Vercel may already expose it |
| `VERCEL_TEAM_ID` | Owning team ID when required to scope the API request |

Set the database credentials for **Production**. If you want preview deployments, give Preview a separate disposable Turso database so preview actions cannot change your real collection. The protection-check variables are required for every Vercel build environment.

`npm run build` checks the project's protection settings through Vercel's API when `VERCEL=1`. Missing credentials, an inaccessible API, a mismatched project ID, or anything other than All Deployments protection stops the build. An initial import may therefore fail until these settings are configured; then redeploy. For a manual check with values in `.env.local`, run `npm run check:deployment`.

This is a **build-time check**, not an application login or continuous security monitor. Vercel enforces authentication on page requests and Server Actions. Disabling protection after deployment would expose the app; keep it enabled. API-token expiry blocks future builds, not the running app.

### 3. Deploy and verify

Deploy the configured project, sign in with your Vercel account, and bookmark its production address. Confirm the collection and notes are present, save a review and reload, and open the same address in a signed-out/private browser window: it must require Vercel authentication before showing any collection data. Verify both the production domain and deployment URL.

Vercel must have both Turso variables. It never falls back to a local file database there. Local development still defaults to `private-data/followthrough.sqlite` when neither variable is set; setting either requires a complete hosted configuration. Seeding and migration commands load `.env.local`, so check the destination before running them.

## One-time X bootstrap

The enriched JSON is a shortcut for establishing an existing bookmark collection, not the ongoing saving workflow. Keep the file outside this repository and back up an existing database before seeding:

```sh
npm run seed:x -- "/absolute/path/to/enriched-export.json"
```

This command accepts a non-empty, enriched xarchive schema 2 export. It preserves generated titles and summaries, saved post text, authors, original links, exact decimal ordering keys, full source/enrichment snapshots, and export provenance. New bookmarks enter To explore without a personal rating or note. Media, quoted context, and destination links remain in the stored snapshots; the current detail pane does not render those additional fields yet.

The complete input is validated before database changes. Seeding is transactional and replaces fictional demo records with the real collection. Existing source/ID pairs and their reviews are left unchanged, so rerunning the command is safe; this is a bootstrap, not a source-refresh importer. Output contains counts, not bookmark contents. Ongoing saving uses the Add link form for X, YouTube, or other websites.

Deleting an item does not edit the original export. Running the seed command again can re-add items that were deleted locally.

## Storage and privacy

Next.js reads and writes SQLite server-side through `@libsql/client`. Source content, generated enrichment, and personal reviews are stored separately. Without Turso configuration, the default database is `private-data/followthrough.sqlite`; `DATABASE_PATH` can override it with an absolute path. With Turso configuration, the database is hosted and survives Vercel deployments.

Local database files, SQLite sidecars, backups, environment files, and named X exports are excluded from Git, Vercel CLI uploads, and production dependency traces. Local storage is not encryption. Hosted deployment sends your saved content and reviews to Turso and serves them through Vercel. There is no application-level authentication: use Vercel Authentication for all deployment URLs and never expose the local server publicly. Review backup/restore controls remain unimplemented; the migration command is a one-time transfer, not ongoing backup or sync.

The app does not automatically fetch remote pages, media, or fonts. In the X view, manually added links appear first in added-to-Followthrough order, followed by seeded bookmarks in exact descending bookmark-key order. These are separate groups, not a comparison between timestamps and opaque bookmark keys. YouTube, Websites, and All sources use added-to-Followthrough order. Seeding time is not presented as a bookmark timestamp.

The displayed Added to Followthrough timestamp comes from `added_at`: for manually saved links, their actual save time in this app; for seeded bookmarks, the bootstrap time. It is not the original X bookmark time or the post's publication time. The prepared export does not provide the original bookmark timestamp.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run build
```
