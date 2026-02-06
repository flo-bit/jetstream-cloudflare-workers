# CLAUDE.md

## Project

Cloudflare Worker that mirrors AT Protocol records into D1 via the Bluesky Jetstream firehose. Records are keyed by AT URI (`at://{did}/{collection}/{rkey}`). Cron-triggered ingestion every minute with automatic backfill of new users from their PDS.

## Stack

- **Runtime**: Cloudflare Workers (D1 SQLite database)
- **Language**: TypeScript (strict mode, ES2022)
- **Package manager**: pnpm
- **AT Protocol**: `@atcute/jetstream` for firehose, `@atcute/client` for PDS queries

## Commands

- `pnpm dev` — local dev server with cron support
- `pnpm run deploy` — deploy to Cloudflare
- `npx tsc --noEmit` — type-check (no build step; wrangler bundles directly)
- `pnpm ingest` — trigger a local ingestion cycle
- `pnpm db:reset` — drop and recreate local tables

## Architecture

```
src/
  index.ts    — Worker entry point: fetch handler + cron scheduled handler
  api.ts      — REST API with route table pattern, all endpoints return JSON
  ingest.ts   — Jetstream WebSocket subscription, collects events until caught up or timeout
  db.ts       — D1 queries: upsert/delete records, pagination, cursor, schema init
  backfill.ts — Resumable per-user backfill from PDS (page-by-page with saved cursor)
  client.ts   — AT Protocol helpers: resolve DID → PDS, list records
  config.ts   — Parse COLLECTIONS env var
schema.sql    — Idempotent schema (CREATE TABLE IF NOT EXISTS)
```

## Key patterns

- **Record store, not event log**: creates/updates upsert by AT URI, deletes remove the row
- **Timestamps are microseconds** (`time_us`, `indexed_at`) — Jetstream uses microsecond epoch
- **Backfill is resumable**: `backfills` table tracks `pds_cursor` and `completed` per (did, collection). Progress saved after each page so large repos span multiple cron runs.
- **Schema auto-inits** on each cron run via `initDb()` — no manual migration step
- **Collections configured via env var** `COLLECTIONS` in `wrangler.toml` (comma-separated)
- **API routes** use a regex route table with shared collection validation and pagination parsing

## Conventions

- No build step — wrangler handles bundling
- Prefer `db.batch()` for multiple D1 operations
- All API responses include `Access-Control-Allow-Origin: *`
- Records stored as JSON strings in D1, parsed back to objects in API responses via `formatRecord()`
- Keep README concise — table format for endpoints and scripts
