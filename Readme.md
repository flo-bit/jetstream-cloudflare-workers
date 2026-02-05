# Jetstream Cloudflare Worker

A Cloudflare Worker that mirrors AT Protocol records into a D1 database via the [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream) firehose. Runs on a cron schedule, applies creates/updates/deletes, and automatically backfills a user's full history when they're first seen. Records are keyed by AT URI (`at://{did}/{collection}/{rkey}`).

## Setup

```sh
npm install
npx wrangler d1 create jetstream-events
npx wrangler d1 execute jetstream-events --file=schema.sql        # remote
npx wrangler d1 execute jetstream-events --file=schema.sql --local # local
```

## Development

```sh
npm run dev
curl "http://localhost:8787/__scheduled?cron=*/1+*+*+*+*"  # trigger ingestion
```

## Configuration

Edit `src/config.ts` to choose which collections to track:

```ts
export const WANTED_COLLECTIONS = ["app.blento.card", "app.blento.page"];
```

## Backfill

When a new DID appears in the Jetstream events, the worker automatically fetches all their existing records for that collection from their PDS. Backfill is resumable: progress is saved per-page, so large repos are spread across multiple cron runs. Querying a specific user's records via the API also triggers backfill on demand.

## API

All endpoints return JSON with `?limit=` (default 50, max 100) and `?cursor=` pagination.

| Endpoint | Description |
|---|---|
| `GET /records/:collection` | Records sorted by time (newest first). Optional `?did=` filter (triggers backfill if needed). |
| `GET /users/:collection` | DIDs ranked by record count. |
| `GET /health` | Health check. |

## Admin

All via `wrangler d1 execute jetstream-events`. Add `--local` for dev.

```sh
# Re-run schema (idempotent)
npx wrangler d1 execute jetstream-events --file=schema.sql

# Row counts
npx wrangler d1 execute jetstream-events --command="SELECT collection, COUNT(*) as count FROM records GROUP BY collection"

# Delete a collection's data
npx wrangler d1 execute jetstream-events --command="DELETE FROM records WHERE collection = '...'"

# Reset ingestion cursor
npx wrangler d1 execute jetstream-events --command="DELETE FROM cursor"

# Reset backfill state (re-fetches all users)
npx wrangler d1 execute jetstream-events --command="DELETE FROM backfills"

# Drop everything
npx wrangler d1 execute jetstream-events --command="DROP TABLE IF EXISTS records; DROP TABLE IF EXISTS backfills; DROP TABLE IF EXISTS cursor"
npx wrangler d1 execute jetstream-events --file=schema.sql
```
