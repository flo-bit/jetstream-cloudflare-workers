import { handleRequest } from "./api";
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
  const cursor = await getLastCursor(env.DB);

  console.log(
    `Starting ingestion. Cursor: ${cursor ?? "none"}, Collections: ${WANTED_COLLECTIONS.join(", ")}`
  );

  const { events, lastCursor } = await ingestEvents(
    env.JETSTREAM_URL,
    WANTED_COLLECTIONS,
    cursor
  );

  console.log(`Received ${events.length} events from Jetstream`);

  // Batch-insert events into D1
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
}
