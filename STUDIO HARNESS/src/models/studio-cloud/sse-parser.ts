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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, DECODER_STREAM_OPTIONS);
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSseBlock(block);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
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
