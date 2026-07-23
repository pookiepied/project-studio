import { mapProviderError } from "@/platform/errors";

export function sseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  };
}

export function encodeSse(data: unknown, event?: string): Uint8Array {
  const lines = [];
  if (event) lines.push(`event: ${event}`);
  lines.push(`data: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  lines.push("");
  lines.push("");
  return new TextEncoder().encode(lines.join("\n"));
}

export function createSseResponse(
  producer: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>
): Response {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  producer(writer)
    .catch(async (error) => {
      const gatewayError = mapProviderError(error);
      await writer.write(
        encodeSse(
          {
            type: "stream.error",
            error: {
              code: gatewayError.code,
              message: gatewayError.message
            }
          },
          "stream.error"
        )
      );
    })
    .finally(() => writer.close().catch(() => undefined));

  return new Response(stream.readable, { headers: sseHeaders() });
}
