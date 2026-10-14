# followthrough

## Why I built it

i've been continuously adding to my twitter bookmarks of things that i'll eventually come back and read. i've now accumulated 200+ articles that are either outdated or goldmines waiting to be read. i've said enough is enough and i need to clear out my bookmarks and accumulate knowledge.

i exported 214 bookmarks with xarchive 1.1.0 as a schema 2 snapshot. before importing them, we generated titles, summaries, and classifications, then sorted them newest to oldest using x's timeline order. everything started in to explore so i could decide what was actually worth keeping inside the app. we loaded them into sqlite with the one-time `npm run seed:x` script. a proper import flow in the app is still a wip and a future task.

this isn't just scoped to bookmarks though, i've also held links and yt videos in playlists that I haven't touched in so long. my use case was mostly tech related content, but this could probably be scoped to anything.

the ui kinda sux right now and is a wip but i tried my best to capture a simple feel that you would've seen from sites in the 2010s (i hope at least).

## How I use it

i add links as i find them and come back when i actually have time to read or watch them. after going through something, i give it a usefulness rating and write down anything i want to remember. if it isn't worth keeping, i can archive or delete it and move on.

the point isn't to review everything perfectly. it's just a way to slowly clear out the pile and keep the useful stuff somewhere i can search later.

on phones, the list and item details appear one at a time, with a back button to return to saved links. the mobile layout uses larger tap targets and 16px text in form fields; desktop keeps the side-by-side view.

## Optional private deployment

you don't need vercel or turso to use followthrough. the local sqlite setup is enough. if you want to access the same collection from other devices, you can deploy the app privately with vercel and keep the database in turso.

1. create an empty turso database and copy `.env.example` to `.env.local`.
2. add the turso database url and read/write token as `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
3. if you already have a local collection, stop the app and migrate it:

   ```sh
   npm run migrate:cloud -- "/absolute/path/to/private-data/followthrough.sqlite"
   ```

4. import the repository into vercel using node.js 22.x or newer.
5. enable **vercel authentication → all deployments** before publishing. the app doesn't have its own login, so leaving this off would expose the collection.
6. add the turso credentials and the vercel deployment-check variables listed in `.env.example` to the project.

the build checks that all-deployments protection is enabled when it runs on vercel. for preview deployments, use a separate disposable turso database so previews can't change the real collection.

the migration is a one-time copy, not automatic syncing. after migrating, the hosted database becomes the main copy and the old local database should be kept as a backup.

## Run locally

you only need node.js 22.9 or newer and npm. vercel and turso aren't required.

```sh
npm ci
npm run dev
```

open http://127.0.0.1:3000/. if that port is already being used, next.js will print the new port it picked.

by default, everything is stored in `private-data/followthrough.sqlite`. the directory is created automatically and ignored by git.

if you want to try the app with four fictional links, run:

```sh
npm run seed:demo
```

the seed command uses whichever database is configured in `.env.local`, so check that file first if you've also set up turso.

## Development

the app is built with Next.js, React, TypeScript, SQLite through `@libsql/client`, and IBM Plex Sans.

The browser-tab icon is a blue bookmark with a white checkmark, defined in `src/app/icon.svg`. Next.js automatically adds it to the page metadata.

run the project checks with:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```
