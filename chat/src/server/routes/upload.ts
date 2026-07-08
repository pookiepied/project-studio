import { Env } from "../../env";
import { createErrorResponse } from "@gateway/middleware/response";
import { extractUserId } from "../middleware/auth";
import { storeDocument } from "../../inputs/document";
import { logger } from "../../logger";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const DOC_TEMP_TTL_MS  = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isAllowedMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("text/"))        return true;
  if (mimeType.startsWith("application/")) {
    return [
      "application/pdf",
      "application/json",
      "application/xml",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(mimeType);
  }
  return false;
}

// ---------------------------------------------------------------------------
// POST /v1/upload/document
// ---------------------------------------------------------------------------

/**
 * Upload any supported document to DOCS_BUCKET for persistent storage.
 *
 * Multipart fields:
 *   file      — the document binary
 *   permanent — "true" for permanent storage, "false" for 24-hour TTL
 *
 * Returns: { docId, fileName, fileSize, mimeType, permanent, expiresAt }
 */
export async function handleDocumentUpload(request: Request, env: Env): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId) return createErrorResponse("Authentication required.", 401, "unauthorized_error");

  if (!env.DOCS_BUCKET) {
    return createErrorResponse("Document storage not configured.", 503, "service_unavailable");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return createErrorResponse("Request must be multipart/form-data.", 400, "bad_request");
  }

  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") {
    return createErrorResponse('Missing "file" field.', 400, "bad_request");
  }

  const permanent  = formData.get("permanent") === "true";
  const uploadFile = fileField as File;

  if (uploadFile.size === 0) {
    return createErrorResponse("File is empty.", 400, "bad_request");
  }

  if (uploadFile.size > MAX_UPLOAD_BYTES) {
    const mb = (uploadFile.size / 1024 / 1024).toFixed(1);
    return createErrorResponse(`File too large: ${mb} MB (max 100 MB).`, 413, "payload_too_large");
  }

  const mimeType = uploadFile.type || "application/octet-stream";
  if (!isAllowedMimeType(mimeType)) {
    return createErrorResponse(`Unsupported file type: ${mimeType}.`, 415, "unsupported_media_type");
  }

  const bytes  = new Uint8Array(await uploadFile.arrayBuffer());
  const result = await storeDocument(env, bytes, mimeType, uploadFile.name, userId, permanent);

  if (!result) {
    return createErrorResponse("Storage write failed. Check DOCS_BUCKET binding.", 500, "storage_error");
  }

  logger.info("handleDocumentUpload: stored", {
    docId:    result.docId,
    fileName: uploadFile.name,
    bytes:    bytes.length,
    permanent,
  });

  return new Response(
    JSON.stringify({
      docId:     result.docId,
      fileName:  uploadFile.name,
      fileSize:  uploadFile.size,
      mimeType,
      permanent: result.permanent,
      expiresAt: result.expiresAt ?? null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// DELETE /v1/upload/document/:docId
// ---------------------------------------------------------------------------

export async function handleDocumentUploadDelete(docId: string, env: Env): Promise<Response> {
  if (!UUID_RE.test(docId)) {
    return createErrorResponse("Invalid document ID.", 400, "bad_request");
  }

  if (env.DOCS_BUCKET) {
    await Promise.all([
      env.DOCS_BUCKET.delete(`uploads/permanent/${docId}`),
      env.DOCS_BUCKET.delete(`uploads/temp/${docId}`),
    ]);
  }
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Cron cleanup — removes expired temp uploads from DOCS_BUCKET/uploads/temp/
// ---------------------------------------------------------------------------

export async function cleanupExpiredDocUploads(env: Env): Promise<void> {
  if (!env.DOCS_BUCKET) return;

  const now    = Date.now();
  let cursor: string | undefined;
  let deleted  = 0;

  do {
    const listed = await env.DOCS_BUCKET.list({ prefix: "uploads/temp/", limit: 200, cursor });

    const toDelete: string[] = [];
    for (const obj of listed.objects) {
      // Primary check: upload timestamp + 24h
      const uploadedAt = obj.uploaded?.getTime() ?? 0;
      if (uploadedAt > 0 && now - uploadedAt > DOC_TEMP_TTL_MS) {
        toDelete.push(obj.key);
        continue;
      }
      // Fallback: expiresAt in custom metadata
      const head      = await env.DOCS_BUCKET.head(obj.key);
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
    logger.info("cleanupExpiredDocUploads: removed temp uploads", { count: deleted });
  }
}
