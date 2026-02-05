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

CREATE TABLE IF NOT EXISTS cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_us INTEGER NOT NULL
);
