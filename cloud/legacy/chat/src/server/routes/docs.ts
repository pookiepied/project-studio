import { Env } from "../../env";
import { createErrorResponse } from "@gateway/middleware/response";
import { extractUserId } from "../middleware/auth";
import { indexContent, IndexResult } from "../../tools/retrieval/indexing";
import { logger } from "../../logger";
import { emitError } from "../../tracking";
import { VECTORIZE_EMBEDDING_MODEL } from "../../constants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum raw text accepted for a single index request (~300K chars ≈ 75K tokens ≈ ~100 dense pages). */
const MAX_INDEX_CHARS = 300_000;

/** How long raw documents live in DOCS_BUCKET before cron cleanup. */
const DOC_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// POST /v1/docs/index
// ---------------------------------------------------------------------------

interface DocsIndexBody {
  text: string;
  fileName: string;
  sessionId: string;  // conversation ID from the frontend — used to scope Vectorize queries
}

/**
 * Index a document for RAG retrieval.
 *
 * The frontend extracts text from the file (pdf.js for PDFs, file.text() for
 * plain text), then sends it here. This handler:
 *   1. Validates the payload.
 *   2. Truncates text to MAX_INDEX_CHARS (documents larger than ~100 pages are
 *      truncated; the frontend warns the user).
 *   3. Chunks the text using the existing paragraph-aware chunkText() function.
 *   4. Embeds all chunks via Workers AI (@cf/baai/bge-base-en-v1.5) in batches
 *      to stay within model token limits.
 *   5. Inserts vectors into Vectorize under the caller's session_id so the RAG
 *      tool can query them using filter: { session_id }.
 *   6. Stores the raw (possibly truncated) text in DOCS_BUCKET/temp/{sessionId}/{docId}
 *      with 24-hour TTL metadata for potential full-text retrieval.
 *
 * The existing `rag` tool in the agent handles all queries — no new tool needed.
 */
export async function handleDocsIndex(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId) return createErrorResponse("Authentication required.", 401, "unauthorized_error");

  if (!env.VECTORIZE) {
    return createErrorResponse("RAG unavailable: VECTORIZE binding not configured.", 503, "service_unavailable");
  }
  if (!env.AI) {
    return createErrorResponse("RAG unavailable: AI binding not configured.", 503, "service_unavailable");
  }

  let body: DocsIndexBody;
  try {
    body = await request.json() as DocsIndexBody;
  } catch {
    return createErrorResponse("Request body must be valid JSON.", 400, "bad_request");
  }

  const { text, fileName, sessionId } = body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return createErrorResponse('"text" is required and must be a non-empty string.', 400, "bad_request");
  }
  if (!fileName || typeof fileName !== "string") {
    return createErrorResponse('"fileName" is required.', 400, "bad_request");
  }
  if (!sessionId || typeof sessionId !== "string") {
    return createErrorResponse('"sessionId" is required.', 400, "bad_request");
  }

  const truncated = text.length > MAX_INDEX_CHARS;
  const indexText  = truncated ? text.slice(0, MAX_INDEX_CHARS) : text;
  const docId      = crypto.randomUUID();

  // ── 1. Store raw text in DOCS_BUCKET ──────────────────────────────────────
  if (env.DOCS_BUCKET) {
    try {
      await env.DOCS_BUCKET.put(
        `temp/${sessionId}/${docId}`,
        indexText,
        {
          httpMetadata: { contentType: "text/plain; charset=utf-8" },
          customMetadata: {
            fileName,
            sessionId,
            originalLength: String(text.length),
            indexedLength:  String(indexText.length),
            truncated:      String(truncated),
            createdAt:      String(Date.now()),
            expiresAt:      String(Date.now() + DOC_TTL_MS),
          },
        }
      );
    } catch (err: any) {
      logger.error("docs/index: DOCS_BUCKET put failed", { docId, error: err.message });
      // Non-fatal — indexing can proceed without raw storage
    }
  }

  // ── 2. Chunk, embed, and insert ───────────────────────────────────────────
  let indexResult: IndexResult;
  try {
    indexResult = await indexContent(indexText, sessionId, fileName, {
      docId,
      env,
      extraMeta: { doc_id: docId },
    });
    logger.info("docs/index: complete", { docId, fileName, vectors: indexResult.chunks });
  } catch (err: any) {
    logger.error("docs/index: embedding or vectorize failed", { docId, error: err.message });
    emitError(env, ctx, 'provider.error', {
      provider:    'cloudflare',
      model:       VECTORIZE_EMBEDDING_MODEL,
      requestType: 'embedding',
      error:       err.message,
    });
    return createErrorResponse(`Embedding failed: ${err.message}`, 502, "api_error");
  }

  return new Response(
    JSON.stringify({
      docId,
      sessionId,
      fileName,
      chunkCount:       indexResult.chunks,
      chaptersDetected: indexResult.chapters_detected,
      truncated,
      originalLength:   text.length,
      indexedLength:    indexText.length,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// DELETE /v1/docs/{docId}
// ---------------------------------------------------------------------------

/**
 * Remove a document's raw file from DOCS_BUCKET.
 * Vectorize vectors are scoped by session_id and naturally expire when the
 * session is no longer queried; no explicit vector deletion needed.
 */
export async function handleDocsDelete(docId: string, sessionId: string, env: Env): Promise<Response> {
  if (!UUID_RE.test(docId)) {
    return createErrorResponse("Invalid document ID.", 400, "bad_request");
  }
  if (env.DOCS_BUCKET) {
    await env.DOCS_BUCKET.delete(`temp/${sessionId}/${docId}`);
  }
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Cron cleanup
// ---------------------------------------------------------------------------

/**
 * Daily cron cleanup — removes expired documents from DOCS_BUCKET/temp/.
 * Documents that have passed their 24-hour expiresAt metadata are deleted.
 * Called from the 0 2 daily cron in index.ts alongside cleanupExpiredImages.
 */
export async function cleanupExpiredDocs(env: Env): Promise<void> {
  if (!env.DOCS_BUCKET) return;

  const now = Date.now();
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const listed = await env.DOCS_BUCKET.list({
      prefix: "temp/",
      limit: 200,
      cursor,
    });

    const toDelete: string[] = [];
    for (const obj of listed.objects) {
      // Primary signal: R2 built-in upload timestamp + 24h
      const uploadedAt = obj.uploaded?.getTime() ?? 0;
      if (uploadedAt > 0 && now - uploadedAt > DOC_TTL_MS) {
        toDelete.push(obj.key);
        continue;
      }
      // Secondary signal: expiresAt in custom metadata
      const head = await env.DOCS_BUCKET.head(obj.key);
      const expiresAt = head?.customMetadata?.expiresAt;
      if (expiresAt && parseInt(expiresAt, 10) < now) {
        toDelete.push(obj.key);
      }
    }

    if (toDelete.length > 0) {
      await Promise.all(toDelete.map(k => env.DOCS_BUCKET!.delete(k)));
      deleted += toDelete.length;
    }

    cursor = listed.truncated ? (listed as any).cursor : undefined;
  } while (cursor);

  if (deleted > 0) {
    logger.info("cleanupExpiredDocs: removed expired documents", { count: deleted });
  }
}
