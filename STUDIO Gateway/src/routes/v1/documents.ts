/**
 * POST /v1/documents/preprocess — Smart document preprocessing.
 * Accepts multipart file upload, classifies PDF/image/text, and returns extracted text + kind.
 * This is the contract for future auto-routing; actual vision/OCR model routing is not enabled by default.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest } from "../../lib/errors.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { classifyDocument, DOCUMENT_TEXT_PREVIEW_LENGTH } from "../../providers/shared/document.ts";
import { findExposedModel } from "../../infra/db.ts";

export const documentsRoute = new Hono<{ Bindings: Env }>();

documentsRoute.post("/documents/preprocess", async (c) => {
  await authorizeGateway(c);
  const form = await c.req.formData().catch(() => null);
  if (!form) throw badRequest("multipart/form-data is required");
  const file = form.get("file") as File | null;
  if (!file) throw badRequest("file is required");
  const targetModelId = form.get("target_model") as string | null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const kind = await classifyDocument(bytes, mime);

  // Derive capabilities from D1 — never trust client-provided supports_* flags
  let supportsVision = false;
  let supportsPdf = false;
  if (targetModelId) {
    const model = await findExposedModel(c.env.DB, targetModelId);
    if (model) {
      supportsVision = !!model.supports_vision;
      // PDF considered vision-capable if model supports vision or input modalities include pdf
      try {
        const inputMods = JSON.parse(model.input_modalities) as string[];
        supportsPdf = inputMods.includes("pdf") || supportsVision;
      } catch {
        supportsPdf = supportsVision;
      }
    }
  }

  const { preprocessDocumentForModel } = await import("../../providers/shared/document.ts");
  const result = await preprocessDocumentForModel({ mimeType: mime, bytes, filename: file.name }, { supportsVision, supportsPdf });

  return c.json({
    filename: file.name,
    mime_type: mime,
    kind,
    target_model: targetModelId ?? null,
    via: result.via,
    text_preview: result.text.slice(0, DOCUMENT_TEXT_PREVIEW_LENGTH),
    text_length: result.text.length,
    note: "Smart document preprocessing contract — vision/OCR fallback is explicit, auto-routing is future",
  });
});
