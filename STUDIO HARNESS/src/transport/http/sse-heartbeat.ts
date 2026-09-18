import type { MiddlewareHandler } from "hono";

/**
 * The bytes a run's readers were promised and did not have.
 *
 * Both readers of a run's stream — the desktop's Rust `service_stream` and the
 * browser's `httpStream` — give the harness 45 seconds between bytes and
 * declare the read broken past that, and both docs say the same thing about
 * why: "the harness heartbeats its stream". It never did. The effort that
 * documented the habit did not ship the habit, and nothing below three
 * quarters of a minute of silence ever noticed — until a reasoning model
 * started thinking for 86 seconds before its first token, and a 400-line-
 * clipped shell tool ran for 88, and every such stretch broke the read, which
 * read to the person at the keyboard as the harness dying. Measured from this
 * morning's conversations: the first token 86.4s after the submission, the
 * deltas arriving 0.0s apart, nothing at all between.
 *
 * The fix is the half the parsers were already written for: an SSE comment
 * block. Both grammars skip a comment line ("used by servers as heartbeats",
 * says the TypeScript one, its Rust twin pinned to the same list), so a
 * comment costs two parsers nothing and both idles reset on the bytes. Fifteen
 * seconds, so three missed beats is the 45 the readers already call dead.
 */

/** One beat. Three of these missed is what the readers call broken. */
export const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

/** The comment block itself, re-encoded per beat so no consumer shares a buffer. */
const HEARTBEAT_BYTES = new TextEncoder().encode(": keep-alive\n\n");

/**
 * Wraps one stream so a comment leaves it every `intervalMs`, whatever the
 * upstream is doing.
 *
 * The upstream's own bytes pass through untouched — the control frames the
 * protocol speaks and the records the turn writes — and the comment rides
 * *between* them, because the reader counts bytes, not events, and the thing
 * this exists for is precisely the long quiet where there are no events.
 *
 * Output is pushed rather than pulled. The uplink is a long-lived
 * `text/event-stream` read by exactly two consumer shapes, both of which
 * drain continuously, and the beats are twenty bytes; honouring
 * backpressure here would time the heartbeat on the consumer's mood instead
 * of the clock, which is the one thing it must not depend on.
 */
export function heartbeats(
  body: ReadableStream<Uint8Array>,
  intervalMs: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let closing = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  // One flag, one interval, one cleanup, however this ends: the upstream
  // finishing, the upstream erroring, the consumer cancelling, or the
  // consumer vanishing mid-write. Every path reaches `stop()` exactly once
  // more than it needs to, which the flag makes free.
  const stop = (): void => {
    closing = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (closing) return;
        // The consumer may have gone away without cancelling. A failed
        // enqueue is that news arriving; the read loop below meets the same
        // fact on its next read, so it does not need the error repeated.
        try {
          controller.enqueue(HEARTBEAT_BYTES.slice());
        } catch {
          /* the read loop owns the error path */
        }
      }, intervalMs);

      void (async () => {
        try {
          for (;;) {
            if (closing) break;
            const next = await reader.read();
            if (next.done || closing) break;
            try {
              controller.enqueue(next.value);
            } catch {
              break;
            }
          }
          stop();
          try {
            controller.close();
          } catch {
            /* the consumer cancelled; the stream is already shut */
          }
        } catch (error) {
          stop();
          try {
            controller.error(error);
          } catch {
            /* the consumer cancelled; the stream is already shut */
          }
        }
      })();
    },
    cancel() {
      stop();
      // Ends the upstream read too, so a consumer that cancels does not
      // leave the run's own writer pushing into a nobody. The same shape the
      // browser reader gives the harness, for the same reason.
      void reader.cancel().catch(() => undefined);
    },
  });
}

/**
 * The middleware: every `text/event-stream` answer, and nothing else, carries
 * the beat.
 *
 * It sits on the agent routes rather than inside Flue's, because the readers'
 * 45 seconds is a fact about everything a run can hold open — the model's
 * thinking as much as a tool's — and the agent mount is the one place both
 * arrive. Rebuilding the Response rather than mutating its body keeps every
 * other header (the offsets, the readiness marks Flue sets) exactly as they
 * were.
 */
export function streamHeartbeat(): MiddlewareHandler {
  return async (context, next) => {
    await next();
    const response = context.res;
    const contentType = response.headers.get("content-type");
    if (contentType === null || !contentType.startsWith("text/event-stream")) return;
    if (response.body === null) return;
    context.res = new Response(
      heartbeats(response.body, STREAM_HEARTBEAT_INTERVAL_MS),
      response,
    );
  };
}
