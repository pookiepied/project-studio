/** One decoded server-sent event. */
export interface SseFrame {
  /** The `event:` name, or undefined for an unnamed frame. */
  readonly event: string | undefined;
  /** Joined `data:` lines, newline-separated as the SSE spec requires. */
  readonly data: string;
}

const DECODER_STREAM_OPTIONS = { stream: true } as const;

/**
 * Parses a byte stream as server-sent events.
 *
 * The Studio gateway frames its events itself, so this only has to be a
 * correct SSE reader: it handles CRLF and LF line endings, comment lines,
 * multi-line `data:`, and a truncated trailing frame (which is discarded
 * rather than emitted half-parsed).
 *
 * The reader is always released, and cancelling the consumer cancels the
 * underlying stream, which closes the upstream HTTP connection.
 */
export async function* parseSseFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /**
   * A trailing `\r` held back until the next chunk arrives.
   *
   * At the end of a chunk a lone `\r` is ambiguous: it is either a CR line
   * break, or the first half of a `\r\n` whose `\n` is in the next chunk.
   * Normalising it immediately resolves the ambiguity the wrong way — one line
   * break becomes two, the frame splits in half, and the first half has no
   * `data:` line, so it is dropped and takes the `event:` name with it.
   *
   * Holding it back costs one character of latency and removes the guess.
   */
  let carriageReturn = "";

  /** Emits every complete frame sitting in the buffer, and keeps the rest. */
  function* drainFrames(): Generator<SseFrame> {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const frame = parseSseBlock(block);
      if (frame) yield frame;
      boundary = buffer.indexOf("\n\n");
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Nothing is coming to disambiguate the held-back `\r`, so it was a CR
        // line break after all. Without this, a stream whose last bytes are
        // `…\r` loses its final frame, because the boundary it completes never
        // gets written to the buffer.
        if (carriageReturn) {
          buffer += "\n";
          carriageReturn = "";
          yield* drainFrames();
        }
        break;
      }

      let chunk = carriageReturn + decoder.decode(value, DECODER_STREAM_OPTIONS);
      carriageReturn = "";

      if (chunk.endsWith("\r")) {
        carriageReturn = "\r";
        chunk = chunk.slice(0, -1);
      }

      buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      yield* drainFrames();
    }
  } finally {
    reader.releaseLock();
    await stream.cancel().catch(() => undefined);
  }
}

export function parseSseBlock(block: string): SseFrame | undefined {
  let event: string | undefined;
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  if (data.length === 0) return undefined;
  return { event, data: data.join("\n") };
}
