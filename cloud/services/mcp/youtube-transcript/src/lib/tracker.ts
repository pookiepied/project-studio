// Tracker client for the youtube-transcript-mcp worker.
// Mirrors the pattern used across all workers in the project.
// Requires a TRACKER service binding (type: Fetcher) in wrangler.toml.

export type WorkerName =
  | "ai"
  | "api"
  | "auth"
  | "chats"
  | "youtube-transcript";

export type Severity = "debug" | "info" | "warn" | "error";

export interface TrackEvent {
  event: string;
  category: string;
  severity?: Severity;
  userId?: string;
  sessionId?: string;
  runId?: string;
  spanId?: string;
  parentSpanId?: string;
  data?: Record<string, unknown>;
}

interface HasTracker {
  TRACKER?: Fetcher;
}

// Fire-and-forget — never surfaces tracking failures to the caller.
// In a Durable Object context we do not have ExecutionContext.waitUntil,
// so the fetch is unawaited. The tail consumer captures console output
// as a secondary signal.
function send(env: HasTracker, path: string, body: unknown): void {
  if (!env.TRACKER) return;
  env.TRACKER.fetch(`https://tracker${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export function track(
  env: HasTracker,
  event: TrackEvent
): void {
  send(env, "/ingest", { ...event, worker: "youtube-transcript" as WorkerName });
}
