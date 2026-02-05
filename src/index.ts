import { handleRequest } from "./api";
import { backfillUser } from "./backfill";
import { WANTED_COLLECTIONS } from "./config";
import { getLastCursor, saveCursor, applyEvents } from "./db";
import { ingestEvents } from "./ingest";

export interface Env {
  DB: D1Database;
  JETSTREAM_URL: string;
}

const BATCH_SIZE = 50;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runIngestion(env));
  },
};

async function runIngestion(env: Env): Promise<void> {
  const globalDeadline = Date.now() + 28_000;
  const cursor = await getLastCursor(env.DB);

  console.log(
    `Starting ingestion. Cursor: ${cursor ?? "none"}, Collections: ${WANTED_COLLECTIONS.join(", ")}`
  );

  const { events, lastCursor } = await ingestEvents(
    env.JETSTREAM_URL,
    WANTED_COLLECTIONS,
    cursor,
    20_000
  );

  console.log(`Received ${events.length} events from Jetstream`);

  // Batch-apply events to D1
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await applyEvents(env.DB, batch);
  }

  // Save the new cursor position
  if (lastCursor !== null) {
    await saveCursor(env.DB, lastCursor);
    console.log(`Saved cursor: ${lastCursor}`);
  }

  console.log(`Ingestion complete. Stored ${events.length} events.`);

  // Backfill new DIDs with remaining time
  const seenPairs = new Set<string>();
  for (const e of events) {
    if (e.operation !== "delete") {
      seenPairs.add(`${e.did}\0${e.collection}`);
    }
  }

  for (const pair of seenPairs) {
    if (Date.now() >= globalDeadline) break;
    const [did, collection] = pair.split("\0");
    await backfillUser(env.DB, did, collection, globalDeadline);
  }
}
