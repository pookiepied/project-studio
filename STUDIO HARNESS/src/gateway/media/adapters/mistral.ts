import { HttpError, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import type { DriverEndpoint } from "../drivers/types.js";
import type { DocumentPage, DocumentReadingInput, DocumentReadingResult, MediaAdapter } from "./types.js";

/**
 * Mistral's media family, which today is one thing: the Document AI OCR
 * processor, checked against docs.mistral.ai on 2026-09-22.
 *
 * `POST /ocr` takes the document inline as a data URL - `document_url` for
 * a PDF or an Office file, `image_url` for a picture - and answers
 * `pages[]`, each with an `index` (zero-based) and its `markdown`. It is
 * the one vendor here whose answer is already pages, so nothing is cut;
 * the index is shifted by one to the caller's counting. `pages` in the
 * request picks page indices, so a caller that wants three scanned pages
 * of a long PDF pays for three.
 *
 * The vendor's ceilings are 50 MB and 1,000 pages per file; the byte one is
 * checked here before the upload, the page one is the vendor's own refusal
 * with its own sentence. The key rides the bearer header and nowhere else.
 */

const AUTHOR: UrlAuthor = "user";
/** OCR of a long PDF is slow work; the vendor's own examples take minutes. */
const OCR_TIMEOUT_MS = 300_000;
const OCR_MAX_ANSWER_BYTES = 64 * 1024 * 1024;
/** The processor's documented ceiling for one file. */
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function headers(endpoint: DriverEndpoint): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(endpoint.credential === undefined ? {} : { authorization: `Bearer ${endpoint.credential}` }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return undefined;
    if (typeof parsed.message === "string") return parsed.message;
    if (isRecord(parsed.error) && typeof parsed.error.message === "string") return parsed.error.message;
    return undefined;
  } catch {
    return undefined;
  }
}

async function readDocument(
  input: DocumentReadingInput,
  endpoint: DriverEndpoint,
): Promise<DocumentReadingResult> {
  if (input.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new MediaError("document-too-large", "The document is over 50 MB, Mistral's ceiling for one file.");
  }
  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const document = input.mimeType.startsWith("image/")
    ? { type: "image_url", image_url: dataUrl }
    : { type: "document_url", document_url: dataUrl, document_name: input.fileName };
  const body = {
    model: input.modelId,
    document,
    ...(input.pages === undefined || input.pages.length === 0
      ? {}
      : { pages: input.pages.map((page) => page - 1) }),
  };
  const answered = await requestDirect({
    url: `${origin(endpoint)}/ocr`,
    author: AUTHOR,
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify(body),
    timeoutMs: endpoint.timeoutMs ?? OCR_TIMEOUT_MS,
    maxBytes: OCR_MAX_ANSWER_BYTES,
  }).catch((error: unknown) => {
    throw new MediaError(
      "provider-refused",
      error instanceof HttpError ? error.message : "Mistral could not be reached for the document.",
      { retryable: error instanceof HttpError && error.retryable },
    );
  });
  if (answered.status >= 400) {
    const detail = refusalDetail(answered.body);
    throw new MediaError(
      "provider-refused",
      detail === undefined
        ? `Mistral answered ${String(answered.status)} to the document with no explanation.`
        : `Mistral refused the document: ${detail}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "Mistral's document answer was not JSON.");
  }
  const pages: DocumentPage[] = [];
  const listed = isRecord(parsed) && Array.isArray(parsed.pages) ? parsed.pages : [];
  for (const page of listed) {
    if (!isRecord(page) || typeof page.index !== "number" || typeof page.markdown !== "string") continue;
    pages.push({ number: page.index + 1, markdown: page.markdown.trim() });
  }
  if (pages.length === 0) {
    throw new MediaError("provider-refused", "Mistral's document answer carried no pages.");
  }
  return { pages };
}

export const mistralMedia: MediaAdapter = {
  protocol: "mistral",
  readDocument,
};
