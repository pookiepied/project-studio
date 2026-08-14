/**
 * Document preprocessing — smart document handling for the Gateway.
 * Handles: digital PDFs, scanned PDFs, images, mixed content.
 * Future auto-routing is intentionally not implemented here; this is the preprocessing contract.
 */

export const DOCUMENT_CLASSIFY_BYTES = 8000;
export const DOCUMENT_SCANNED_THRESHOLD_BYTES = 4000;
export const DOCUMENT_TEXT_MIN_LENGTH = 200;
export const DOCUMENT_MAX_TEXT_LENGTH = 60000;
export const DOCUMENT_TEXT_PREVIEW_LENGTH = 8000;
export const DOCUMENT_FALLBACK_MIN_TEXT_LENGTH = 100;

export type DocumentKind = "digital_pdf" | "scanned_pdf" | "image" | "text" | "mixed_pdf";

export async function classifyDocument(bytes: Uint8Array, mimeType: string): Promise<DocumentKind> {
  if (mimeType.includes("pdf")) {
    const text = new TextDecoder().decode(bytes.slice(0, DOCUMENT_CLASSIFY_BYTES));
    // Simple heuristic: if PDF contains a lot of extractable text markers, treat as digital
    const hasText = (text.match(/\/Type\s*\/Page/g) ?? []).length > 0 && bytes.length > DOCUMENT_SCANNED_THRESHOLD_BYTES;
    // Very small scanned PDFs often have minimal text
    if (!hasText) return "scanned_pdf";
    // If text extraction would yield meaningful content, treat as digital for now
    return "digital_pdf";
  }
  if (mimeType.startsWith("image/")) return "image";
  return "text";
}

export async function extractDigitalPdfText(bytes: Uint8Array): Promise<string> {
  // Minimal text extraction — gateway does not bundle a full PDF parser to keep bundle small.
  // We return a best-effort decode for now; a proper implementation would use a WASM PDF extractor
  // or delegate to a vision model. This keeps the contract stable while allowing swap-in.
  try {
    const text = new TextDecoder().decode(bytes);
    // Strip binary and keep printable
    const cleaned = text.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length > DOCUMENT_TEXT_MIN_LENGTH) return cleaned.slice(0, DOCUMENT_MAX_TEXT_LENGTH);
    return "";
  } catch {
    return "";
  }
}

export async function preprocessDocumentForModel(
  req: { mimeType: string; bytes: Uint8Array; filename?: string },
  opts: { supportsVision: boolean; supportsPdf: boolean },
): Promise<{ text: string; kind: DocumentKind; via: string }> {
  const kind = await classifyDocument(req.bytes, req.mimeType);
  if (kind === "digital_pdf" && opts.supportsPdf) {
    const text = await extractDigitalPdfText(req.bytes);
    if (text.length > DOCUMENT_FALLBACK_MIN_TEXT_LENGTH) return { text, kind, via: "digital_pdf_extract" };
  }
  if (kind === "scanned_pdf" || kind === "image" || kind === "mixed_pdf") {
    if (opts.supportsVision) {
      return { text: `[Document preprocessing: ${kind} with ${req.mimeType} — vision-capable model will handle directly]`, kind, via: "vision_direct" };
    }
    return { text: `[Document preprocessing: ${kind} requires vision/OCR preprocessing before non-vision model]`, kind, via: "vision_fallback_needed" };
  }
  const text = new TextDecoder().decode(req.bytes).slice(0, DOCUMENT_MAX_TEXT_LENGTH);
  return { text, kind, via: "text_direct" };
}
