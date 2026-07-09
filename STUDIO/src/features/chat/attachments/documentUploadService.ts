import { createHeaders } from "@/lib/api";
import { API_ENDPOINTS } from "@/core/config/tauriConfig";

export interface UploadedDocument {
  docId:     string;
  fileName:  string;
  fileSize:  number;
  mimeType:  string;
  permanent: boolean;
  expiresAt: number | null; // unix ms, null if permanent
}

/**
 * Upload a document file to the chat worker's R2 store.
 *
 * @param file      The File object to upload.
 * @param permanent true → stored forever; false → deleted after 24 h by cron.
 */
export async function uploadDocument(file: File, permanent: boolean): Promise<UploadedDocument> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("permanent", permanent ? "true" : "false");

  // createHeaders returns auth headers — strip Content-Type so the browser sets
  // the multipart boundary automatically when FormData is the body.
  const headers = await createHeaders(true) as Record<string, string>;
  delete headers["content-type"];
  delete headers["Content-Type"];

  const response = await fetch(`${API_ENDPOINTS.adapter.base}/upload/document`, {
    method:  "POST",
    headers,
    body:    formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Document upload failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<UploadedDocument>;
}

/**
 * Remove a previously uploaded document from the server.
 * Safe to call even if the document has already expired or was deleted.
 */
export async function deleteUploadedDocument(docId: string): Promise<void> {
  const headers = await createHeaders(true) as Record<string, string>;
  await fetch(`${API_ENDPOINTS.adapter.base}/upload/document/${docId}`, {
    method: "DELETE",
    headers,
  }).catch(() => {}); // fire-and-forget
}
