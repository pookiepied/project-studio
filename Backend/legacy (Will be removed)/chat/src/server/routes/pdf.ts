import { Env } from "../../env";
import { createErrorResponse } from "@gateway/middleware/response";
import { extractUserId } from "../middleware/auth";
import { generateR2PresignedUrl } from "../../utils/r2Signer";
import { logger } from "../../logger";

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB — covers most textbooks and academic PDFs
const PDF_TTL_MS   = 60 * 60 * 1000;    // 1 hour — metadata only (cleanup via docs.ts cron)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * POST /v1/pdf/upload
 *
 * Accepts a PDF as multipart/form-data (field name: "file").
 * Validates PDF magic bytes, stores in TEMP_IMAGES_BUCKET under pdfs/{uuid}.pdf,
 * and returns a 1-hour presigned R2 URL.
 *
 * The presigned URL can be passed directly to Claude's native document API:
 *   { type: "document", source: { type: "url", url: "<presignedUrl>" } }
 *
 * For vision-model OCR the client renders pages client-side via pdf.js and
 * sends them as image_url parts — this endpoint is only needed for the native
 * document path (Claude) or server-side text extraction use cases.
 */
export async function handlePDFUpload(request: Request, env: Env): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId) return createErrorResponse("Authentication required.", 401, "unauthorized_error");

  if (!env.DOCS_BUCKET) {
    return createErrorResponse(
      "Document storage not configured. Ensure DOCS_BUCKET is bound.",
      503,
      "service_unavailable"
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return createErrorResponse("Request must be multipart/form-data.", 400, "bad_request");
  }

  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") {
    return createErrorResponse('Missing "file" field in form data.', 400, "bad_request");
  }

  const uploadedFile = fileField as File;

  if (uploadedFile.size === 0) {
    return createErrorResponse("PDF file is empty.", 400, "bad_request");
  }

  if (uploadedFile.size > MAX_PDF_BYTES) {
    const mb = (uploadedFile.size / 1024 / 1024).toFixed(1);
    return createErrorResponse(`PDF too large: ${mb} MB (max 25 MB).`, 413, "payload_too_large");
  }

  // Validate PDF magic bytes
  const rawBytes = new Uint8Array(await uploadedFile.arrayBuffer());
  const header = String.fromCharCode(rawBytes[0], rawBytes[1], rawBytes[2], rawBytes[3], rawBytes[4]);
  if (!header.startsWith("%PDF-")) {
    return createErrorResponse(
      "File is not a valid PDF (missing %PDF- header).",
      400,
      "bad_request"
    );
  }

  const bytes = rawBytes;
  const pdfId = crypto.randomUUID();
  const r2Key = `pdfs/${pdfId}.pdf`;

  try {
    await env.DOCS_BUCKET!.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: {
        purpose: "gateway-pdf-temp",
        fileName: uploadedFile.name,
        fileSize: String(uploadedFile.size),
        createdAt: String(Date.now()),
        expiresAt: String(Date.now() + PDF_TTL_MS),
      },
    });
  } catch (err: any) {
    logger.error("PDF upload: R2 put failed", { pdfId, error: err.message });
    return createErrorResponse(
      `R2 storage failed: ${err.message}`,
      500,
      "storage_error"
    );
  }

  const presignedUrl = await generateR2PresignedUrl(
    env,
    "studio-docs",
    r2Key,
    3600 // 1 hour TTL
  );

  if (!presignedUrl) {
    logger.error("PDF upload: presigned URL generation failed", { pdfId });
    return createErrorResponse(
      "Failed to generate presigned URL. Ensure R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID) are configured.",
      500,
      "presign_error"
    );
  }

  logger.info("PDF uploaded to R2", {
    pdfId,
    fileName: uploadedFile.name,
    bytes: uploadedFile.size,
  });

  return new Response(
    JSON.stringify({
      pdfId,
      presignedUrl,
      fileName: uploadedFile.name,
      fileSize: uploadedFile.size,
      expiresInSeconds: 3600,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * DELETE /v1/pdf/{pdfId}
 *
 * Removes a previously uploaded PDF from R2 before its TTL expires.
 * Safe to call even if the file is already gone.
 */
export async function handlePDFDelete(pdfId: string, env: Env): Promise<Response> {
  if (!UUID_RE.test(pdfId)) {
    return createErrorResponse("Invalid PDF ID.", 400, "bad_request");
  }

  if (env.DOCS_BUCKET) {
    await env.DOCS_BUCKET.delete(`pdfs/${pdfId}.pdf`);
  }
  return new Response(null, { status: 204 });
}
