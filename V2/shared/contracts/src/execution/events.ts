/**
 * Studio Runtime Protocol (RUNTIME-CHECKLIST.md §4–§5): the append-only event
 * stream clients consume. Frontends depend on THIS protocol, never on the
 * AI SDK's internal stream format. Every event is assigned a monotonic
 * sequence when appended to the durable log — before any broadcast — giving
 * deterministic replay, duplicate suppression, gap detection, and
 * multi-device sync.
 */

import type { RunStatus } from "./run";
import type { NormalizedRuntimeError } from "./errors";

export const RUNTIME_PROTOCOL_VERSION = 1;

/** Payload carried by each event type. */
export interface RuntimeEventPayloads {
  "run.created": {
    userId: string;
    branchId: string;
    request: string;
    modelId: string;
  };
  /** A new execution attempt began (initial, retry, or recovery). */
  "run.started": { attemptId: string };
  "run.status_changed": {
    previousStatus: RunStatus;
    nextStatus: RunStatus;
    runVersion: number;
    reason: string;
  };
  "assistant.started": { attemptId: string };
  /** Streaming output; `channel` separates visible text from reasoning. */
  "assistant.delta": { channel: "text" | "reasoning"; text: string };
  /** Accumulated assistant text at a step boundary (replay accelerator). */
  "assistant.snapshot": { step: number; text: string };
  "assistant.completed": { text: string };
  "tool.call_created": { toolCallId: string; toolName: string; input: unknown };
  "tool.started": { toolCallId: string; toolName: string };
  "tool.progress": { toolCallId: string; message: string };
  "tool.completed": { toolCallId: string; summary: string; output: unknown };
  "tool.failed": { toolCallId: string; error: string };
  "tool.external_requested": { toolCallId: string; serverId: string; toolName: string; input: unknown };
  "tool.external_resolved": { toolCallId: string };
  "client.action_requested": { toolCallId: string; action: string; input: unknown };
  "client.action_resolved": { toolCallId: string; action: string };
  "approval.required": {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    summarizedAction: string;
    riskLevel: "low" | "medium" | "high";
  };
  "approval.resolved": { approvalId: string; approved: boolean };
  "artifact.created": { artifactId: string; kind: string; name: string };
  "usage.updated": {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  "run.recovering": { attempt: number; reason: string };
  "run.progress": { message: string };
  "run.completed": { output: string };
  "run.failed": { failureSummary: string; error: NormalizedRuntimeError };
  "run.cancelled": { reason: string };
}

export type RuntimeEventType = keyof RuntimeEventPayloads;

/** One event on the wire and in the durable log. */
export interface RuntimeEvent<
  T extends RuntimeEventType = RuntimeEventType,
> {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  eventId: string;
  conversationId: string;
  runId: string;
  turnId: string;
  /** Monotonically increasing within the conversation's session. */
  sequence: number;
  /** Unix ms. */
  timestamp: number;
  type: T;
  payload: RuntimeEventPayloads[T];
}

/** The full discriminated union of every event shape. */
export type AnyRuntimeEvent = {
  [K in RuntimeEventType]: RuntimeEvent<K>;
}[RuntimeEventType];

/**
 * Messages a client may send over the WebSocket. Control (start/pause/
 * resume/cancel) stays on the HTTP surface; the socket is a subscription.
 */
export type RuntimeClientMessage =
  | {
      type: "subscribe";
      conversationId: string;
      /** Replay everything after this sequence (0 = from the beginning). */
      lastReceivedSequence: number;
    }
  | {
      /** Highest sequence the client has durably processed. */
      type: "ack";
      sequence: number;
    }
  | { type: "ping" };

/** Non-event control frames the server sends. */
export type RuntimeServerControl =
  | {
      type: "connection.snapshot";
      protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
      run: unknown | null;
      /** Latest sequence in the log at snapshot time (gap detection). */
      latestSequence: number;
    }
  | { type: "connection.end"; reason: string }
  | { type: "pong" };
