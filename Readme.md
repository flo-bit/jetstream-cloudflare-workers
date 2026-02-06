# Jetstream Cloudflare Worker

easy to use cloudflare worker that 
- listens for jetstream events on selected collections (updates every minute on a cron job)
- saves records from those collections in a D1 db
- backfills users automatically
- exposes a basic json api (see [api](#api))

warning: this pretty much completely vibe coded (but seems to work so far?).

## Quick start

```sh
pnpm install
pnpm setup              # creates the D1 database
# paste the database_id into wrangler.toml
pnpm run deploy
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
pnpm run deploy
```

The worker will start ingesting on its cron schedule (every minute by default). Monitor logs with:

```sh
npx wrangler tail
```

## Backfill

When a new DID appears in the Jetstream events, the worker fetches all their existing records for that collection from their PDS. Backfill is resumable — progress is saved per-page, so large repos are spread across multiple cron runs. Querying a user's records via the API also triggers backfill on demand.

## API

All endpoints return JSON. Only tracked collections are served (others return 404).

| Endpoint | Params | Description |
|---|---|---|
| `GET /records/:collection` | `?did=` `?limit=` `?cursor=` | Records sorted by time (newest first). `did` filter triggers backfill. |
| `GET /users/:collection` | `?limit=` `?cursor=` | DIDs ranked by record count. |
| `GET /stats/:collection` | | Unique user count and last record time. |
| `GET /backfill/:collection/:did` | | Backfill status: `unknown`, `in_progress`, or `complete`. |
| `GET /cursor` | | Current Jetstream cursor (`time_us`, ISO date, seconds ago). |
| `GET /health` | | Health check. |

`limit` defaults to 50. `cursor` is the `time_us` value from the previous page's response.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Local dev server with cron support |
| `pnpm run deploy` | Deploy to Cloudflare |
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
