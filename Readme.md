# Jetstream Cloudflare Worker

A Cloudflare Worker that mirrors AT Protocol records into a D1 database via the [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream) firehose. Runs on a cron schedule, applies creates/updates/deletes, and automatically backfills a user's full history when they're first seen. Records are keyed by AT URI (`at://{did}/{collection}/{rkey}`).

## Quick start

```sh
pnpm install
pnpm setup              # creates the D1 database
# paste the database_id into wrangler.toml
pnpm deploy
```

The schema is created automatically on the first cron run — no manual migration step needed.

## Configuration

Set collections in `wrangler.toml` (no code changes required):

```toml
[vars]
COLLECTIONS = "app.blento.card,app.blento.page"
```

## Development

```sh
pnpm dev
pnpm ingest  # trigger ingestion
```

## Deploy

Requires a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (included as a dev dependency).

```sh
npx wrangler login              # authenticate with Cloudflare (one-time)
pnpm setup                      # create the D1 database
```

Copy the `database_id` from the output into `wrangler.toml` under `[[d1_databases]]`, set your desired collections in the `COLLECTIONS` var, then:

```sh
pnpm deploy
```

The worker will start ingesting on its cron schedule (every minute by default). Monitor logs with:

```sh
npx wrangler tail
```

## Backfill

When a new DID appears in the Jetstream events, the worker fetches all their existing records for that collection from their PDS. Backfill is resumable — progress is saved per-page, so large repos are spread across multiple cron runs. Querying a user's records via the API also triggers backfill on demand.

## API

All endpoints return JSON. Only tracked collections are served (others return 404). Paginated endpoints support `?limit=` (default 50, max 100) and `?cursor=`.

| Endpoint | Description |
|---|---|
| `GET /records/:collection` | Records sorted by time (newest first). Optional `?did=` filter (triggers backfill). |
| `GET /users/:collection` | DIDs ranked by record count. |
| `GET /stats/:collection` | Unique user count and last record time. |
| `GET /backfill/:collection/:did` | Backfill status: `unknown`, `in_progress`, or `complete`. |
| `GET /cursor` | Current Jetstream cursor (raw, ISO date, seconds ago). |
| `GET /health` | Health check. |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Local dev server with cron support |
| `pnpm deploy` | Deploy to Cloudflare |
| `pnpm setup` | Create the D1 database |
| `pnpm db:init` | Run schema on local + remote DB |
| `pnpm db:reset` | Drop and recreate all local tables |
| `pnpm ingest` | Trigger a local ingestion cycle |

## Admin queries

Via `wrangler d1 execute jetstream-events`. Add `--local` for dev.

```sh
# Row counts
wrangler d1 execute jetstream-events --command="SELECT collection, COUNT(*) as count FROM records GROUP BY collection"

# Delete a collection's data
wrangler d1 execute jetstream-events --command="DELETE FROM records WHERE collection = '...'"

# Reset ingestion cursor
wrangler d1 execute jetstream-events --command="DELETE FROM cursor"

# Reset backfill state
wrangler d1 execute jetstream-events --command="DELETE FROM backfills"
```
