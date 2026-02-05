import { backfillUser } from "./backfill";
import { getRecords, getUsersByCollection, RecordRow } from "./db";

interface Env {
  DB: D1Database;
}

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // GET /users/:collection
  const usersMatch = path.match(/^\/users\/(.+)$/);
  if (usersMatch) {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }
    return handleGetUsers(url, env.DB, usersMatch[1]);
  }

  // GET /records/:collection
  const recordsMatch = path.match(/^\/records\/(.+)$/);
  if (recordsMatch) {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }
    return handleGetRecords(url, env.DB, recordsMatch[1]);
  }

  // Health check
  if (path === "/" || path === "/health") {
    return json({ status: "ok" });
  }

  return json({ error: "Not found" }, 404);
}

async function handleGetUsers(
  url: URL,
  db: D1Database,
  collection: string
): Promise<Response> {
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor");

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (isNaN(limit) || limit < 1) {
    return json({ error: "Invalid limit parameter" }, 400);
  }

  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;
  if (cursorParam && (isNaN(cursor!) || cursor! < 0)) {
    return json({ error: "Invalid cursor parameter" }, 400);
  }

  const result = await getUsersByCollection(db, collection, limit, cursor);

  return json({
    users: result.users,
    cursor: result.cursor,
  });
}

async function handleGetRecords(
  url: URL,
  db: D1Database,
  collection: string
): Promise<Response> {
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor");
  const did = url.searchParams.get("did") || undefined;

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (isNaN(limit) || limit < 1) {
    return json({ error: "Invalid limit parameter" }, 400);
  }

  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;
  if (cursorParam && (isNaN(cursor!) || cursor! < 1)) {
    return json({ error: "Invalid cursor parameter" }, 400);
  }

  if (did) {
    const deadline = Date.now() + 10_000;
    await backfillUser(db, did, collection, deadline);
  }

  const result = await getRecords(db, collection, limit, cursor, did);

  const records = result.records.map(formatRecord);

  return json({
    records,
    cursor: result.cursor,
  });
}

function formatRecord(row: RecordRow) {
  return {
    uri: row.uri,
    did: row.did,
    collection: row.collection,
    rkey: row.rkey,
    cid: row.cid,
    record: row.record ? JSON.parse(row.record) : null,
    time_us: row.time_us,
    indexed_at: row.indexed_at,
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
