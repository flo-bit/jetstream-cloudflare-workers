import { backfillUser } from "./backfill";
import { getCollections } from "./config";
import { getRecords, getUsersByCollection, RecordRow } from "./db";

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
