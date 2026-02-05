CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  did TEXT NOT NULL,
  time_us INTEGER NOT NULL,
  collection TEXT NOT NULL,
  operation TEXT NOT NULL,
  rkey TEXT NOT NULL,
  cid TEXT,
  record TEXT,
  indexed_at INTEGER NOT NULL
);

CREATE INDEX idx_events_collection_id ON events(collection, id DESC);

CREATE TABLE cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_us INTEGER NOT NULL
);
