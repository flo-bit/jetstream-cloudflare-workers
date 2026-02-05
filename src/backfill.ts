import { type Did } from "@atcute/lexicons";
import { getClient, type Collection } from "./client";
import { type IngestEvent, applyEvents } from "./db";

const PAGE_SIZE = 100;
const BATCH_SIZE = 50;

/**
 * Backfill records for a user+collection, resumable across cron runs.
 * Fetches one page at a time from the user's PDS and saves the
 * pagination cursor after each page so we can pick up where we left off.
 */
export async function backfillUser(
  db: D1Database,
  did: string,
  collection: string,
  deadline: number
): Promise<number> {
  if (Date.now() >= deadline) return 0;

  const status = await db
    .prepare(
      "SELECT completed, pds_cursor FROM backfills WHERE did = ? AND collection = ?"
    )
    .bind(did, collection)
    .first<{ completed: number; pds_cursor: string | null }>();

  if (status?.completed) return 0;

  // Create row if first attempt, then re-read to handle races
  if (!status) {
    await db
      .prepare(
        "INSERT INTO backfills (did, collection, completed) VALUES (?, ?, 0) ON CONFLICT DO NOTHING"
      )
      .bind(did, collection)
      .run();
    const current = await db
      .prepare(
        "SELECT completed, pds_cursor FROM backfills WHERE did = ? AND collection = ?"
      )
      .bind(did, collection)
      .first<{ completed: number; pds_cursor: string | null }>();
    if (current?.completed) return 0;
  }

  let currentCursor: string | undefined = status?.pds_cursor ?? undefined;

  console.log(
    `Backfilling ${collection} for ${did} (cursor: ${currentCursor ?? "start"})`
  );

  let client;
  try {
    client = await getClient({ did: did as Did });
  } catch (err) {
    console.error(`Failed to get client for ${did}: ${err}`);
    return 0;
  }

  let totalInserted = 0;
  let done = false;

  while (Date.now() < deadline) {
    let response;
    try {
      response = await client.get("com.atproto.repo.listRecords", {
        params: {
          repo: did as Did,
          collection: collection as Collection,
          limit: PAGE_SIZE,
          cursor: currentCursor,
        },
      });
    } catch (err) {
      console.error(
        `Failed to fetch records for ${did}/${collection}: ${err}`
      );
      break;
    }

    if (!response.ok || response.data.records.length === 0) {
      done = true;
      break;
    }

    const now = Date.now();
    const events: IngestEvent[] = response.data.records.map((r) => ({
      uri: r.uri,
      did,
      collection,
      rkey: r.uri.split("/").pop()!,
      operation: "create" as const,
      cid: r.cid,
      record: JSON.stringify(r.value),
      time_us: now * 1000,
      indexed_at: now * 1000,
    }));

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      await applyEvents(db, batch);
      totalInserted += batch.length;
    }

    currentCursor = response.data.cursor ?? undefined;

    // Save progress after each page
    await db
      .prepare(
        "UPDATE backfills SET pds_cursor = ? WHERE did = ? AND collection = ?"
      )
      .bind(currentCursor ?? null, did, collection)
      .run();

    if (!currentCursor) {
      done = true;
      break;
    }
  }

  if (done) {
    await db
      .prepare(
        "UPDATE backfills SET completed = 1 WHERE did = ? AND collection = ?"
      )
      .bind(did, collection)
      .run();
    console.log(
      `Backfill complete: ${totalInserted} records for ${did}/${collection}`
    );
  } else {
    console.log(
      `Backfill paused: ${totalInserted} records for ${did}/${collection}, will resume`
    );
  }

  return totalInserted;
}
