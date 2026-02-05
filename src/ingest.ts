import { JetstreamSubscription } from "@atcute/jetstream";
import { EventRow } from "./db";

/**
 * Connect to Jetstream via @atcute/jetstream and collect commit events.
 * Returns the collected event rows and the last cursor seen.
 */
export async function ingestEvents(
  jetstreamUrl: string,
  wantedCollections: string[],
  cursor: number | null,
  safetyTimeoutMs: number = 25_000
): Promise<{ events: EventRow[]; lastCursor: number | null }> {
  const startTimeUs = Date.now() * 1000;
  const deadline = Date.now() + safetyTimeoutMs;
  const collected: EventRow[] = [];

  const subscription = new JetstreamSubscription({
    url: jetstreamUrl,
    wantedCollections,
    ...(cursor !== null ? { cursor } : {}),
  });

  for await (const event of subscription) {
    // Only process commit events
    if (event.kind === "commit") {
      const { commit } = event;
      const now = Date.now();

      collected.push({
        did: event.did,
        time_us: event.time_us,
        collection: commit.collection,
        operation: commit.operation,
        rkey: commit.rkey,
        cid: commit.operation === "delete" ? null : commit.cid,
        record:
          commit.operation === "delete"
            ? null
            : JSON.stringify(commit.record),
        indexed_at: now,
      });
    }

    // Caught up to present
    if (event.time_us >= startTimeUs) {
      console.log("Caught up to present, stopping ingestion");
      break;
    }

    // Safety timeout to stay within Worker limits
    if (Date.now() >= deadline) {
      console.log("Safety timeout reached, stopping ingestion");
      break;
    }
  }

  const lastCursor = subscription.cursor || null;
  return { events: collected, lastCursor };
}
