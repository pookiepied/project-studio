import type { Env } from "../../env";
import type { DocumentStorageMetadata, StoredDocumentResult } from "./types";
import { logger } from "../../logger";

const DOC_TEMP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Store a raw document in DOCS_BUCKET.
 *
 * Key layout:
 *   uploads/permanent/{docId}  — never deleted by cron
 *   uploads/temp/{docId}       — cleaned up after 24 h by cleanupExpiredDocUploads()
 *
 * Returns null on failure so the route handler can return a 500 error.
 */
export async function storeDocument(
  env:       Env,
  bytes:     Uint8Array,
  mimeType:  string,
  fileName:  string,
  userId:    string,
  permanent: boolean,
): Promise<StoredDocumentResult | null> {
  if (!env.DOCS_BUCKET) {
    logger.warn("storeDocument: DOCS_BUCKET not configured");
    return null;
  }

  const docId  = crypto.randomUUID();
  const prefix = permanent ? "uploads/permanent" : "uploads/temp";
  const key    = `${prefix}/${docId}`;
  const now    = Date.now();

  const meta: DocumentStorageMetadata = {
    purpose:   permanent ? "doc-upload-permanent" : "doc-upload-temp",
    fileName,
    mimeType,
    fileSize:  String(bytes.length),
    userId,
    createdAt: String(now),
    ...(permanent ? {} : { expiresAt: String(now + DOC_TEMP_TTL_MS) }),
  };

  try {
    await env.DOCS_BUCKET.put(key, bytes, {
      httpMetadata:   { contentType: mimeType },
      customMetadata: meta as unknown as Record<string, string>,
    });
    logger.info("storeDocument: uploaded", { docId, key, permanent, bytes: bytes.length });
    return { docId, key, permanent, expiresAt: permanent ? undefined : now + DOC_TEMP_TTL_MS };
  } catch (err: any) {
    logger.error("storeDocument: R2 put failed", { docId, key, error: err.message });
    return null;
  }
}
