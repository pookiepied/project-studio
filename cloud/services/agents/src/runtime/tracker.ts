/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";

/**
 * Fire-and-forget telemetry for agent runs.
 *
 * Emits to the tracker worker's /ingest endpoint (same contract the chat worker
 * uses). These events are what the STUDIO UI subscribes to for live sub-agent
 * progress — watching a research agent work through its iterations — and are the
 * groundwork for the notification center (agent started / progressed / finished).
 *
 * Never throws. Safe to call from inside a Durable Object; the DO runtime keeps
 * the in-flight fetch alive without an ExecutionContext.
 */

export type AgentEvent =
  | "agent.spawned"
  | "agent.iteration"
  | "agent.resumed"
  | "agent.done"
  | "agent.failed"
  | "agent.cancelled";

export interface AgentEventPayload {
  event:     AgentEvent;
  severity?: "debug" | "info" | "warn" | "error";
  userId?:   string;
  runId?:    string;
  data?:     Record<string, unknown>;
}

export function emitAgentEvent(env: Env, e: AgentEventPayload): void {
  if (!env.TRACKER) return;
  env.TRACKER.fetch("https://tracker/ingest", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event:    e.event,
      category: "agent",
      worker:   "agents",
      severity: e.severity ?? "info",
      userId:   e.userId,
      runId:    e.runId,
      data:     e.data,
    }),
  }).catch(() => { /* fire-and-forget */ });
}
