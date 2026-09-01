/**
 * One worker, two doors.
 *
 *   tail()  — Cloudflare hands us an event for every request of every worker
 *             that names us in `tail_consumers`. Out of band, after the
 *             response. Cannot add latency, cannot take a request down, and
 *             still sees requests that crashed.
 *
 *   fetch() — everything outside Cloudflare: a desktop build, a web project,
 *             a future service. Same normalisation, same store.
 *
 * Write path only. The console never posts here and this worker never reads
 * back — see ADR-0001 §Telemetry.
 */

import { probe, summarize, type HealthReport } from "@pookiepied/core";

export interface Env {
  EVENTS: AnalyticsEngineDataset;
  INGEST_KEYS: string;
}

interface Normalized {
  source: string;
  event: string;
  status: number;
  durationMs: number;
  path: string;
  outcome: string;
  fields: Record<string, unknown>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 100;

/** Length-independent comparison, so a wrong key leaks nothing through timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function authorize(req: Request, env: Env): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const presented = header.slice(7).trim();
  if (!presented) return null;

  let keys: Record<string, string>;
  try {
    keys = JSON.parse(env.INGEST_KEYS) as Record<string, string>;
  } catch {
    console.error(JSON.stringify({ evt: "ingest_keys_malformed" }));
    return null;
  }
  // Every candidate is compared, so the work done does not depend on which
  // source matched or on how early it appears in the map.
  let matched: string | null = null;
  for (const [source, key] of Object.entries(keys)) {
    if (safeEqual(presented, key)) matched = source;
  }
  return matched;
}

function write(env: Env, n: Normalized): void {
  env.EVENTS.writeDataPoint({
    indexes: [n.source],
    blobs: [n.event, n.path, n.outcome, JSON.stringify(n.fields).slice(0, 5000)],
    doubles: [n.status, n.durationMs],
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Versioned from day one: /v1/otlp can appear beside this without the
    // hostname or the existing contract changing.
    if (req.method !== "POST" || url.pathname !== "/v1/events") {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const source = authorize(req, env);
    if (!source) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
    }

    const items = Array.isArray(body) ? body : [body];
    if (items.length > MAX_BATCH) {
      return new Response(JSON.stringify({ error: "batch_too_large" }), { status: 400 });
    }

    let accepted = 0;
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const event = typeof rec.evt === "string" ? rec.evt : null;
      if (!event) continue;
      const { evt: _evt, status, duration_ms, path, ...fields } = rec;
      write(env, {
        // The source is taken from the key that authenticated, never from the
        // body — a caller cannot report as somebody else.
        source,
        event,
        status: typeof status === "number" ? status : 0,
        durationMs: typeof duration_ms === "number" ? duration_ms : 0,
        path: typeof path === "string" ? path.slice(0, 512) : "",
        outcome: "ok",
        fields,
      });
      accepted++;
    }

    return new Response(JSON.stringify({ accepted }), {
      headers: { "content-type": "application/json" },
    });
  },

  tail(events: TraceItem[], env: Env): void {
    for (const trace of events) {
      const source = trace.scriptName ?? "unknown";
      const req = trace.event && "request" in trace.event ? trace.event.request : undefined;
      const res =
        trace.event && "response" in trace.event
          ? (trace.event.response as { status?: number } | undefined)
          : undefined;
      const path = req ? new URL(req.url).pathname : "";

      write(env, {
        source,
        event: "request",
        status: res?.status ?? 0,
        durationMs: trace.wallTime ?? 0,
        path,
        outcome: trace.outcome,
        fields: {
          cpu_ms: trace.cpuTime,
          exceptions: trace.exceptions.map((e) => e.name),
          method: req?.method,
        },
      });

      // Structured lines emitted by core's `track()` arrive as logs; each one
      // becomes its own row so app-level events (not just HTTP envelopes) are
      // queryable.
      for (const log of trace.logs) {
        const first = log.message?.[0];
        if (typeof first !== "string" || !first.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(first) as Record<string, unknown>;
          if (typeof parsed.evt !== "string" || parsed.evt === "request") continue;
          const { evt, status, duration_ms, path: p, ...fields } = parsed;
          write(env, {
            source,
            event: evt,
            status: typeof status === "number" ? status : 0,
            durationMs: typeof duration_ms === "number" ? duration_ms : 0,
            path: typeof p === "string" ? p : path,
            outcome: trace.outcome,
            fields,
          });
        } catch {
          // A log line that is not our JSON is not an error; skip it.
        }
      }

      for (const ex of trace.exceptions) {
        write(env, {
          source,
          event: "exception",
          status: 500,
          durationMs: 0,
          path,
          outcome: trace.outcome,
          fields: { name: ex.name, message: ex.message },
        });
      }
    }
  },

  /**
   * Heartbeat. The write probe is the point: this worker's whole job is the
   * write path, so a check that does not exercise writeDataPoint would confirm
   * nothing worth confirming.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const started = Date.now();

    const writes = await probe("analytics_write", "Analytics Engine", "analytics", async () => {
      env.EVENTS.writeDataPoint({
        indexes: ["pookiepied-telemetry"],
        blobs: ["heartbeat_probe", "", "ok", "{}"],
        doubles: [0, 0],
      });
      return { detail: { dataset: "pookiepied_events" } };
    });

    const keys = await probe("ingest_keys", "Ingest write keys", "internal", async () => {
      const parsed = JSON.parse(env.INGEST_KEYS) as Record<string, string>;
      const sources = Object.keys(parsed);
      const weak = sources.filter((s) => (parsed[s] ?? "").length < 24);
      if (sources.length === 0) throw new Error("no ingest keys configured");
      return {
        // A short key is not an outage, but it is worth seeing before it is one.
        status: weak.length > 0 ? ("degraded" as const) : ("ok" as const),
        detail: { sources: sources.join(", "), source_count: sources.length, weak_keys: weak.length },
      };
    });

    const report: HealthReport = summarize("pookiepied-telemetry", [writes, keys], started);
    env.EVENTS.writeDataPoint({
      indexes: ["pookiepied-telemetry"],
      blobs: ["health", "", report.status, JSON.stringify(report).slice(0, 5000)],
      doubles: [0, report.durationMs],
    });
  },
};