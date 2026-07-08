/**
 * Content accumulator — wraps a WebSocket send function to capture
 * streamed text chunks so the completed response can be saved to DO
 * state if the client disconnects before receiving the `done` event.
 *
 * Only `{ type: "stream" }` messages contribute to the accumulated
 * content; all other message types pass through unchanged.
 */

export interface ContentAccumulator {
  /** Drop-in replacement for the raw WebSocket send function. */
  send(data: string): void;
  /** Returns all text accumulated from `stream` chunks so far. */
  getContent(): string;
}

export function createAccumulator(rawSend: (data: string) => void): ContentAccumulator {
  let content = "";

  return {
    send(data: string): void {
      rawSend(data);
      try {
        const msg = JSON.parse(data) as { type?: string; choices?: Array<{ delta?: { content?: string } }> };
        if (msg.type === "stream") {
          const chunk = msg.choices?.[0]?.delta?.content;
          if (typeof chunk === "string") content += chunk;
        }
      } catch { /* non-JSON or malformed frame — skip */ }
    },
    getContent: () => content,
  };
}
