import { backfillUser } from "./backfill";
import { getCollections } from "./config";
import { getLastCursor, getRecords, getUsersByCollection, RecordRow } from "./db";

interface Env {
  DB: D1Database;
  COLLECTIONS: string;
}

type Handler = (
  params: URLSearchParams,
  db: D1Database,
  match: RegExpMatchArray
) => Promise<Response>;

const routes: { pattern: RegExp; handler: Handler }[] = [
  { pattern: /^\/records\/(.+)$/, handler: handleGetRecords },
  { pattern: /^\/users\/(.+)$/, handler: handleGetUsers },
  { pattern: /^\/stats\/(.+)$/, handler: handleGetStats },
  { pattern: /^\/backfill\/([^/]+)\/(.+)$/, handler: handleGetBackfillStatus },
];

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/" || path === "/health") {
    return json({ status: "ok" });
  }

  if (path === "/cursor") {
    return handleGetCursor(env.DB);
  }

  const collections = getCollections(env);

  for (const route of routes) {
    const match = path.match(route.pattern);
    if (!match) continue;

    const collection = match[1];
    if (!collections.includes(collection)) {
      return json({ error: "Collection not tracked" }, 404);
    }

    return route.handler(url.searchParams, env.DB, match);
  }

  return json({ error: "Not found" }, 404);
}

function parsePagination(params: URLSearchParams): {
  limit: number;
  cursor: number | undefined;
  error?: string;
} {
  const limitParam = params.get("limit");
  const cursorParam = params.get("cursor");

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (isNaN(limit) || limit < 1) {
    return { limit: 0, cursor: undefined, error: "Invalid limit parameter" };
  }

  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;
  if (cursorParam && (isNaN(cursor!) || cursor! < 0)) {
    return { limit: 0, cursor: undefined, error: "Invalid cursor parameter" };
  }

  return { limit, cursor };
}

async function handleGetRecords(
  params: URLSearchParams,
  db: D1Database,
  match: RegExpMatchArray
): Promise<Response> {
  const { limit, cursor, error } = parsePagination(params);
  if (error) return json({ error }, 400);

  const collection = match[1];
  const did = params.get("did") || undefined;

  if (did) {
    const deadline = Date.now() + 10_000;
    await backfillUser(db, did, collection, deadline);
  }

  const result = await getRecords(db, collection, limit, cursor, did);

  return json({
    records: result.records.map(formatRecord),
    cursor: result.cursor,
  });
}

async function handleGetUsers(
  params: URLSearchParams,
  db: D1Database,
  match: RegExpMatchArray
): Promise<Response> {
  const { limit, cursor, error } = parsePagination(params);
  if (error) return json({ error }, 400);

  const result = await getUsersByCollection(db, match[1], limit, cursor);

  return json({
    users: result.users,
    cursor: result.cursor,
  });
}

async function handleGetBackfillStatus(
  _params: URLSearchParams,
  db: D1Database,
  match: RegExpMatchArray
): Promise<Response> {
  const [, collection, did] = match;

  const row = await db
    .prepare(
      "SELECT completed FROM backfills WHERE did = ? AND collection = ?"
    )
    .bind(did, collection)
    .first<{ completed: number }>();

  return json({
    did,
    collection,
    status: !row ? "unknown" : row.completed ? "complete" : "in_progress",
  });
}

async function handleGetStats(
  _params: URLSearchParams,
  db: D1Database,
  match: RegExpMatchArray
): Promise<Response> {
  const collection = match[1];

  const [userCount, lastRecord] = await db.batch([
    db
      .prepare(
        "SELECT COUNT(DISTINCT did) as user_count FROM records WHERE collection = ?"
      )
      .bind(collection),
    db
      .prepare(
        "SELECT MAX(time_us) as last_time FROM records WHERE collection = ?"
      )
      .bind(collection),
  ]);

  return json({
    collection,
    unique_users: (userCount.results[0] as { user_count: number }).user_count,
    last_record_time_us:
      (lastRecord.results[0] as { last_time: number | null }).last_time,
  });
}

async function handleGetCursor(db: D1Database): Promise<Response> {
  const cursor = await getLastCursor(db);

  if (cursor === null) {
    return json({ cursor: null });
  }

  const dateMs = Math.floor(cursor / 1000);
  const secondsAgo = Math.floor((Date.now() - dateMs) / 1000);

  return json({
    time_us: cursor,
    date: new Date(dateMs).toISOString(),
    seconds_ago: secondsAgo,
  });
}

function formatRecord(row: RecordRow) {
  let record = null;
  if (row.record) {
    try {
      record = JSON.parse(row.record);
    } catch {
      record = row.record;
    }
  }

  return {
    uri: row.uri,
    did: row.did,
    collection: row.collection,
    rkey: row.rkey,
    cid: row.cid,
    record,
    time_us: row.time_us,
  };
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
