export interface RecordRow {
  uri: string;
  did: string;
  collection: string;
  rkey: string;
  cid: string | null;
  record: string | null;
  time_us: number;
  indexed_at: number;
}

export interface IngestEvent {
  uri: string;
  did: string;
  collection: string;
  rkey: string;
  operation: "create" | "update" | "delete";
  cid: string | null;
  record: string | null;
  time_us: number;
  indexed_at: number;
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

export async function applyEvents(
  db: D1Database,
  events: IngestEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const upsertStmt = db.prepare(
    "INSERT INTO records (uri, did, collection, rkey, cid, record, time_us, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uri) DO UPDATE SET cid = excluded.cid, record = excluded.record, time_us = excluded.time_us, indexed_at = excluded.indexed_at"
  );
  const deleteStmt = db.prepare("DELETE FROM records WHERE uri = ?");

  const batch = events.map((e) => {
    if (e.operation === "delete") {
      return deleteStmt.bind(e.uri);
    }
    return upsertStmt.bind(
      e.uri,
      e.did,
      e.collection,
      e.rkey,
      e.cid,
      e.record,
      e.time_us,
      e.indexed_at
    );
  });

  await db.batch(batch);
}

export async function getRecords(
  db: D1Database,
  collection: string,
  limit: number,
  cursor?: number,
  did?: string
): Promise<{ records: RecordRow[]; cursor?: string }> {
  const clampedLimit = Math.min(Math.max(1, limit), 100);

  const conditions = ["collection = ?"];
  const bindings: (string | number)[] = [collection];

  if (did) {
    conditions.push("did = ?");
    bindings.push(did);
  }
  if (cursor) {
    conditions.push("time_us < ?");
    bindings.push(cursor);
  }

  const where = conditions.join(" AND ");
  const query = `SELECT uri, did, collection, rkey, cid, record, time_us, indexed_at FROM records WHERE ${where} ORDER BY time_us DESC LIMIT ?`;
  bindings.push(clampedLimit);

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<RecordRow>();

  const records = result.results ?? [];
  const nextCursor =
    records.length === clampedLimit
      ? String(records[records.length - 1].time_us)
      : undefined;

  return { records, cursor: nextCursor };
}

export interface UserRecord {
  did: string;
  record_count: number;
}

export async function getUsersByCollection(
  db: D1Database,
  collection: string,
  limit: number,
  cursor?: number
): Promise<{ users: UserRecord[]; cursor?: string }> {
  const clampedLimit = Math.min(Math.max(1, limit), 100);

  let query: string;
  let bindings: (string | number)[];

  if (cursor) {
    query =
      "SELECT did, COUNT(*) AS record_count FROM records WHERE collection = ? GROUP BY did ORDER BY record_count DESC LIMIT ? OFFSET ?";
    bindings = [collection, clampedLimit, cursor];
  } else {
    query =
      "SELECT did, COUNT(*) AS record_count FROM records WHERE collection = ? GROUP BY did ORDER BY record_count DESC LIMIT ?";
    bindings = [collection, clampedLimit];
  }

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<UserRecord>();

  const users = result.results ?? [];
  const nextOffset = cursor ? cursor + clampedLimit : clampedLimit;
  const nextCursor =
    users.length === clampedLimit ? String(nextOffset) : undefined;

  return { users, cursor: nextCursor };
}

export async function deleteCollectionData(
  db: D1Database,
  collection: string
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM records WHERE collection = ?")
    .bind(collection)
    .run();
  return result.meta?.changes ?? 0;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  collection TEXT NOT NULL,
  rkey TEXT NOT NULL,
  cid TEXT,
  record TEXT,
  time_us INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_collection_time ON records(collection, time_us DESC);
CREATE INDEX IF NOT EXISTS idx_records_collection_did ON records(collection, did);
CREATE TABLE IF NOT EXISTS backfills (
  did TEXT NOT NULL,
  collection TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  pds_cursor TEXT,
  PRIMARY KEY (did, collection)
);
CREATE TABLE IF NOT EXISTS cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_us INTEGER NOT NULL
);
`;

export async function initDb(db: D1Database): Promise<void> {
  const statements = SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  await db.batch(statements.map((s) => db.prepare(s)));
}
