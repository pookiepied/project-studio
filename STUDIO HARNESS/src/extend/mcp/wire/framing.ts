/**
 * Newline-delimited JSON framing for MCP over stdio.
 *
 * An MCP server writes one JSON value per line to stdout. The stream arrives
 * in arbitrary chunks — a message may be split across many chunks or many
 * messages may arrive in one — and a newline inside a JSON string is not a
 * separator. This module knows only that shape and nothing about policy.
 */

export const DEFAULT_MAX_MESSAGE_BYTES = 1_048_576;

export interface NdjsonDecoderOptions {
  readonly maxMessageBytes?: number;
}

export type NdjsonMessage =
  | { readonly ok: true; readonly value: unknown }
  /**
   * A line that could not become a message, and why.
   *
   * `oversize` reports rather than stays quiet on purpose. A dropped message is
   * indistinguishable from a server that said nothing, and the caller is
   * waiting on a request id that will now never be answered — so the one
   * observer who can turn that into a useful failure is the one this told
   * nothing. `raw` is truncated for an oversize line, because carrying the
   * megabyte we refused to keep would undo the limit.
   */
  | {
      readonly ok: false;
      readonly reason: "malformed" | "oversize";
      readonly raw: string;
      readonly error?: unknown;
    };

/** How much of an oversize line is kept, so a report is diagnosable but bounded. */
const RAW_PREVIEW_CHARS = 200;

// One encoder, not one per call. `byteLength` runs on every line and on every
// chunk that has not yet completed one, so allocating here allocates in the
// hottest path this module has.
const ENCODER = new TextEncoder();

function byteLength(value: string): number {
  // TextEncoder avoids a Node-specific Buffer import for a measurement that is
  // only used to bound memory.
  return ENCODER.encode(value).length;
}

/**
 * Decodes newline-delimited JSON from arbitrary byte or string chunks.
 *
 * Feed is synchronous and does no I/O — the caller supplies chunks from
 * whatever transports exists and receives the messages completed by each chunk.
 * The remainder is held internally until a terminating newline arrives.
 *
 * Multi-byte UTF-8 split across a chunk boundary is not corrupted because
 * byte chunks are decoded with a streaming TextDecoder rather than
 * `chunk.toString()` per chunk. String chunks are already decoded and are
 * appended directly.
 *
 * Empty lines are skipped. Both `\n` and `\r\n` terminate a line — lone
 * `\r` does not, because that is the MCP stdio contract rather than the SSE
 * contract that normalises every `\r`.
 *
 * A line that is not valid JSON does not throw and does not kill the stream;
 * it is reported as a malformed entry and decoding continues.
 *
 * A maximum line size bounds memory when a server never sends a newline. When a
 * line — complete or still without its terminator — exceeds the limit the
 * buffer is dropped rather than grown forever. A dropped incomplete line stays
 * dropped until its terminating newline is seen; a dropped complete line is
 * just that one line.
 */
export class NdjsonDecoder {
  readonly #maxBytes: number;
  readonly #decoder = new TextDecoder();
  #buffer = "";
  #dropping = false;

  constructor(options: NdjsonDecoderOptions = {}) {
    this.#maxBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  }

  feed(chunk: string | Uint8Array): NdjsonMessage[] {
    let text: string;
    if (typeof chunk === "string") {
      text = chunk;
    } else {
      text = this.#decoder.decode(chunk, { stream: true });
    }

    this.#buffer += text;

    const out: NdjsonMessage[] = [];

    while (true) {
      // We are discarding the remainder of an oversize line that exceeded the
      // limit without a newline. Nothing is emitted until its terminator is
      // found, and the growing buffer must not itself become the leak.
      if (this.#dropping) {
        const nl = this.#buffer.indexOf("\n");
        if (nl === -1) {
          // Still no terminator — the whole buffer is part of the line being
          // dropped. Clear it to keep memory bounded and wait for the next
          // chunk to supply the newline.
          if (this.#buffer.length > 0) {
            this.#buffer = "";
          }
          break;
        }
        this.#buffer = this.#buffer.slice(nl + 1);
        this.#dropping = false;
        continue;
      }

      const nl = this.#buffer.indexOf("\n");

      // No complete line yet — only a prefix that may still grow. If that
      // prefix already exceeds the limit it can never become a valid message
      // without first exhausting memory, so drop it and wait for its newline.
      if (nl === -1) {
        if (byteLength(this.#buffer) > this.#maxBytes) {
          out.push({
            ok: false,
            reason: "oversize",
            raw: this.#buffer.slice(0, RAW_PREVIEW_CHARS),
          });
          this.#buffer = "";
          this.#dropping = true;
        }
        break;
      }

      let line = this.#buffer.slice(0, nl);
      this.#buffer = this.#buffer.slice(nl + 1);

      // `\r\n` is a single terminator; the `\r` is not part of the JSON.
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (line.length === 0) {
        continue;
      }

      if (byteLength(line) > this.#maxBytes) {
        out.push({
          ok: false,
          reason: "oversize",
          raw: line.slice(0, RAW_PREVIEW_CHARS),
        });
        continue;
      }

      try {
        const value: unknown = JSON.parse(line);
        out.push({ ok: true, value });
      } catch (error: unknown) {
        out.push({ ok: false, reason: "malformed", raw: line, error });
      }
    }

    return out;
  }
}

/**
 * Encodes one value as a single NDJSON line.
 *
 * The decoder accepts the output of this function, and the function does not
 * inspect the value — it is a JSON string plus a trailing newline.
 */
export function encodeNdjson(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
