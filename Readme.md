# Jetstream Cloudflare Worker

A Cloudflare Worker that subscribes to the [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream) firehose and maintains a live mirror of AT Protocol records in a D1 database. It runs on a cron schedule, connects to Jetstream via WebSocket, and applies creates, updates, and deletes so the database always reflects the current state of records across the collections you configure.

Each record is keyed by its AT URI (`at://{did}/{collection}/{rkey}`). The worker exposes a simple JSON API for querying the stored records.

## Setup

```sh
npm install
```

Create the D1 database (first time only):

```sh
npx wrangler d1 create jetstream-events
```

Then initialize the schema:

```sh
npx wrangler d1 execute jetstream-events --file=schema.sql --local  # local dev
npx wrangler d1 execute jetstream-events --file=schema.sql          # remote
```

## Development

```sh
npm run dev
```

Trigger a manual ingestion cycle:

```sh
curl "http://localhost:8787/__scheduled?cron=*/1+*+*+*+*"
```

## Deploy

```sh
npm run deploy
```

## Configuration

Edit `src/config.ts` to choose which AT Protocol collections to track:

```ts
export const WANTED_COLLECTIONS = [
  "app.bsky.feed.like",
  "app.bsky.feed.post",
  "app.bsky.feed.repost",
  "app.bsky.graph.follow",
];
```

## API

All endpoints return JSON and support pagination via `?limit=` (default 50, max 100) and `?cursor=`.

### `GET /records/:collection`

Returns records for a collection, sorted by time (newest first).

```sh
curl "http://localhost:8787/records/app.bsky.feed.like?limit=10"
curl "http://localhost:8787/records/app.bsky.feed.like?limit=10&cursor=1738000000000"
```

### `GET /users/:collection`

Returns DIDs ranked by record count for a collection.

```sh
curl "http://localhost:8787/users/app.bsky.feed.like?limit=10"
```

### `GET /` or `GET /health`

Health check.

## Admin commands

Database management is done via `wrangler d1 execute` rather than HTTP endpoints. Add `--local` for your local dev database.

**Re-run schema** (safe to run anytime, uses `IF NOT EXISTS`):

```sh
npx wrangler d1 execute jetstream-events --file=schema.sql
```

**Delete all data for a collection:**

```sh
npx wrangler d1 execute jetstream-events \
  --command="DELETE FROM records WHERE collection = 'app.bsky.feed.repost'"
```

**Row counts per collection:**

```sh
npx wrangler d1 execute jetstream-events \
  --command="SELECT collection, COUNT(*) as count FROM records GROUP BY collection"
```

**Reset the ingestion cursor** (re-ingests from the beginning):

```sh
npx wrangler d1 execute jetstream-events \
  --command="DELETE FROM cursor"
```

**Drop everything and start fresh:**

```sh
npx wrangler d1 execute jetstream-events \
  --command="DROP TABLE IF EXISTS records; DROP TABLE IF EXISTS cursor"
npx wrangler d1 execute jetstream-events --file=schema.sql
```
