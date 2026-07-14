import { Env } from "../../env";
import { createErrorResponse } from "@gateway/middleware/response";
import { extractUserId } from "../middleware/auth";
import { indexContent, IndexResult } from "../../tools/retrieval/indexing";
import { logger } from "../../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INDEX_CHARS   = 300_000;
const MAX_DOCS_PER_USER = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// GET /v1/kb
// ---------------------------------------------------------------------------

/**
 * List all persistent KB documents for the authenticated user.
 */
export async function handleKbList(request: Request, env: Env): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId) return createErrorResponse("Authentication required.", 401, "unauthorized_error");

  const rows = await env.CHAT_DB
    .prepare(
      "SELECT id, name, size, mime_type, chunk_count, truncated, created_at " +
      "FROM user_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .bind(userId)
    .all();

  const docs = (rows.results ?? []).map((r: any) => ({
    id:         r.id         as string,
    name:       r.name       as string,
    size:       r.size       as number,
    mimeType:   r.mime_type  as string,
    chunkCount: r.chunk_count as number,
    truncated:  r.truncated  === 1,
    createdAt:  r.created_at as number,
  }));

  const totalBytes = docs.reduce((s, d) => s + (d.size ?? 0), 0);

  return new Response(JSON.stringify({ docs, totalBytes, count: docs.length }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// POST /v1/kb/index
// ---------------------------------------------------------------------------

interface KbIndexBody {
  text:      string;
  fileName:  string;
  mimeType?: string;
  size?:     number;
}

/**
 * Index a document into the user's persistent knowledge base.
 *
 * Unlike /v1/docs/index (which is session-scoped and expires after 24 h),
 * KB documents are stored permanently in DOCS_BUCKET/permanent/{userId}/{docId}
 * and their Vectorize vectors are keyed with user_id as the session_id so the
 * rag tool can query them cross-session: rag(action="query", session_id="{userId}").
 */
export async function handleKbIndex(
  request: Request, env: Env, ctx?: ExecutionContext
): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId) return createErrorResponse("Authentication required.", 401, "unauthorized_error");

  if (!env.VECTORIZE) return createErrorResponse("VECTORIZE binding not configured.", 503, "service_unavailable");
  if (!env.AI)        return createErrorResponse("AI binding not configured.", 503, "service_unavailable");

  // Enforce per-user document cap
  const countRow = await env.CHAT_DB
    .prepare("SELECT COUNT(*) as n FROM user_documents WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();

  if ((countRow?.n ?? 0) >= MAX_DOCS_PER_USER) {
    return createErrorResponse(
      `Knowledge base limit reached (${MAX_DOCS_PER_USER} documents). Delete some before adding more.`,
      409, "conflict_error"
    );
  }

  let body: KbIndexBody;
  try {
    body = await request.json() as KbIndexBody;
  } catch {
    return createErrorResponse("Request body must be valid JSON.", 400, "bad_request");
  }

  const { text, fileName, mimeType = "text/plain", size = 0 } = body;
  if (!text?.trim()) return createErrorResponse('"text" must be a non-empty string.', 400, "bad_request");
  if (!fileName)     return createErrorResponse('"fileName" is required.', 400, "bad_request");

  const truncated  = text.length > MAX_INDEX_CHARS;
  const indexText  = truncated ? text.slice(0, MAX_INDEX_CHARS) : text;
  const docId      = crypto.randomUUID();
  const r2Key      = `permanent/${userId}/${docId}`;

  // Store raw text in R2 (no expiry metadata — permanent)
  if (env.DOCS_BUCKET) {
    await env.DOCS_BUCKET.put(r2Key, indexText, {
      httpMetadata:   { contentType: "text/plain; charset=utf-8" },
      customMetadata: { fileName, userId, mimeType, originalSize: String(size), createdAt: String(Date.now()) },
    }).catch((err: any) => {
      logger.error("kb/index: R2 put failed", { docId, error: err.message });
    });
  }

  // Chunk, embed, and insert
  let indexResult: IndexResult;
  try {
    indexResult = await indexContent(indexText, userId, fileName, {
      docId,
      env,
      extraMeta: { user_id: userId, scope: "persistent" },
    });
  } catch (err: any) {
    logger.error("kb/index: embedding failed", { docId, error: err.message });
    if (env.DOCS_BUCKET) env.DOCS_BUCKET.delete(r2Key).catch(() => {});
    return createErrorResponse(`Embedding failed: ${err.message}`, 502, "api_error");
  }

  // Record in D1
  await env.CHAT_DB
    .prepare(
      "INSERT INTO user_documents (id, user_id, name, size, mime_type, r2_key, chunk_count, truncated, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(docId, userId, fileName, size, mimeType, r2Key, indexResult.chunks, truncated ? 1 : 0, Date.now())
    .run();

  logger.info("kb/index: complete", { docId, fileName, chunks: indexResult.chunks, truncated, userId });

  return new Response(
    JSON.stringify({ docId, fileName, chunkCount: indexResult.chunks, truncated, size }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// DELETE /v1/kb/:docId
// ---------------------------------------------------------------------------

/**
 * Permanently delete a KB document: removes D1 row, R2 object, and all
 * Vectorize vectors (reconstructed from chunk_count as {docId}-0..N-1).
 */
export async function handleKbDelete(
  docId: string, request: Request, env: Env
): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId) return createErrorResponse("Authentication required.", 401, "unauthorized_error");
  if (!UUID_RE.test(docId)) return createErrorResponse("Invalid document ID.", 400, "bad_request");

  const row = await env.CHAT_DB
    .prepare("SELECT r2_key, chunk_count FROM user_documents WHERE id = ? AND user_id = ?")
    .bind(docId, userId)
    .first<{ r2_key: string; chunk_count: number }>();

  if (!row) return new Response(null, { status: 204 }); // already gone — idempotent

  // Delete Vectorize vectors
  if (env.VECTORIZE && row.chunk_count > 0) {
    const vectorIds = Array.from({ length: row.chunk_count }, (_, i) => `${docId}-${i}`);
    await env.VECTORIZE.deleteByIds(vectorIds).catch(() => {});
  }

  // Delete R2 object
  if (env.DOCS_BUCKET && row.r2_key) {
    await env.DOCS_BUCKET.delete(row.r2_key).catch(() => {});
  }

  // Delete D1 row
  await env.CHAT_DB
    .prepare("DELETE FROM user_documents WHERE id = ? AND user_id = ?")
    .bind(docId, userId)
    .run();

  return new Response(null, { status: 204 });
}
