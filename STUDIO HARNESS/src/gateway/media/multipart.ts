/**
 * Multipart form bodies, built once and owned once.
 *
 * The transcription endpoints (OpenAI's `/audio/transcriptions`, ElevenLabs'
 * Scribe) are file uploads, not JSON. Node has no FormData-to-buffer path
 * without `fetch`, and the harness's one outbound client deliberately is not
 * fetch - so the encoding is spelled out here, once, where both drivers can
 * read it.
 *
 * The whole body is bytes because the audio part is bytes: a string body
 * would re-encode them as UTF-8 and corrupt anything that is not text.
 */

const BOUNDARY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface MultipartPart {
  readonly name: string;
  /** Text when `filename` is absent, a file part when it is present. */
  readonly value: string | Uint8Array;
  readonly filename?: string;
  readonly contentType?: string;
}

/** A fresh boundary per body: collision across 62^24 is not a thing to manage. */
function freshBoundary(): string {
  let boundary = "studio";
  for (let at = 0; at < 24; at += 1) {
    boundary += BOUNDARY_ALPHABET[Math.floor(Math.random() * BOUNDARY_ALPHABET.length)];
  }
  return boundary;
}

export interface MultipartBody {
  readonly bytes: Uint8Array;
  /** The value `Content-Type` carries: `multipart/form-data; boundary=...`. */
  readonly contentType: string;
}

export function multipartBody(parts: readonly MultipartPart[]): MultipartBody {
  const boundary = freshBoundary();
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const push = (text: string): void => {
    chunks.push(encoder.encode(text));
  };

  for (const part of parts) {
    push(`--${boundary}\r\n`);
    push(
      part.filename === undefined
        ? `Content-Disposition: form-data; name="${part.name}"\r\n`
        : `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
    );
    if (part.contentType !== undefined) push(`Content-Type: ${part.contentType}\r\n`);
    push("\r\n");
    if (typeof part.value === "string") push(part.value);
    else chunks.push(part.value);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, contentType: `multipart/form-data; boundary=${boundary}` };
}
