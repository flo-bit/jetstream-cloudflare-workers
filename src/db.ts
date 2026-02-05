export interface EventRow {
  did: string;
  time_us: number;
  collection: string;
  operation: string;
  rkey: string;
  cid: string | null;
  record: string | null;
  indexed_at: number;
}

export interface StoredEvent extends EventRow {
  id: number;
}

export async function getLastCursor(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT time_us FROM cursor WHERE id = 1")
    .first<{ time_us: number }>();
  return row ? row.time_us : null;
}

export async function saveCursor(
  db: D1Database,
  timeUs: number
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO cursor (id, time_us) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET time_us = excluded.time_us"
    )
    .bind(timeUs)
    .run();
}

export async function insertEvents(
  db: D1Database,
  events: EventRow[]
): Promise<void> {
  if (events.length === 0) return;

  const stmt = db.prepare(
    "INSERT INTO events (did, time_us, collection, operation, rkey, cid, record, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const batch = events.map((e) =>
    stmt.bind(
      e.did,
      e.time_us,
      e.collection,
      e.operation,
      e.rkey,
      e.cid,
      e.record,
      e.indexed_at
    )
  );

  await db.batch(batch);
}

export async function getRecords(
  db: D1Database,
  collection: string,
  limit: number,
  cursor?: number
): Promise<{ records: StoredEvent[]; cursor?: string }> {
  const clampedLimit = Math.min(Math.max(1, limit), 100);

  let query: string;
  let bindings: (string | number)[];

  if (cursor) {
    query =
      "SELECT id, did, time_us, collection, operation, rkey, cid, record, indexed_at FROM events WHERE collection = ? AND id < ? ORDER BY id DESC LIMIT ?";
    bindings = [collection, cursor, clampedLimit];
  } else {
    query =
      "SELECT id, did, time_us, collection, operation, rkey, cid, record, indexed_at FROM events WHERE collection = ? ORDER BY id DESC LIMIT ?";
    bindings = [collection, clampedLimit];
  }

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<StoredEvent>();

  const records = result.results ?? [];
  const nextCursor =
    records.length === clampedLimit
      ? String(records[records.length - 1].id)
      : undefined;

  return { records, cursor: nextCursor };
}
