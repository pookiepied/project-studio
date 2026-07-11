import type { ExecutionLimits, ExecutionUsage } from "./policy";

/**
 * Execution run model (ARCHITECTURE.md §6–§7): the durable, resumable unit of
 * work owned by an execution session. The durable state is authoritative;
 * WebSocket streams are a view over it.
 */

/**
 * Granular run state machine (RUNTIME-CHECKLIST.md §3). A boolean
 * `isStreaming` cannot represent a run; each phase is explicit so recovery,
 * approvals, and concurrency policies can reason about exactly where a run is.
 */
export type RunStatus =
  | "queued"
  | "starting"
  | "reasoning"
  | "tool_calls_pending"
  | "tools_running"
  | "waiting_for_approval"
  | "waiting_for_external_result"
  | "responding"
  | "pausing"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "recovering"
  | "completed"
  | "failed"
  | "expired";

/**
 * Stable identities (RUNTIME-CHECKLIST.md §2). A conversation is NOT a run:
 * it can hold many turns, regenerations, branches, and retried attempts.
 * Every identity is separate so no layer ever overloads another's id.
 */
export interface ExecutionIdentity {
  conversationId: string;
  /** Conversation branch this run belongs to ("main" by default). */
  branchId: string;
  /** One user submission = one turn; regeneration creates a new run in the same turn. */
  turnId: string;
  runId: string;
  /** New attempt id per execution attempt (initial + each retry/recovery). */
  attemptId: string;
}

/** A recorded state transition — every status change produces one. */
export interface RunTransition {
  previousStatus: RunStatus;
  nextStatus: RunStatus;
  runVersion: number;
  reason: string;
  timestamp: string;
}

export interface RunState extends ExecutionIdentity {
  userId: string;
  status: RunStatus;
  /** Why the run entered its current status (last transition reason). */
  statusReason: string;
  /**
   * Monotonic version, bumped on every transition. Commands carry the version
   * they observed; stale commands are rejected (compare-and-swap).
   */
  runVersion: number;
  /** Client-supplied key: duplicate submissions never create duplicate runs. */
  idempotencyKey: string;
  request: string;
  /** Gateway v2 model id the run executes with. */
  modelId: string;
  currentStep: number;
  completedSteps: RunStep[];
  pendingSteps: RunStep[];
  activeToolCalls: ToolCallRecord[];
  completedToolCalls: ToolCallRecord[];
  retryAttempts: number;
  /** Optional safety policy for this run. Undefined fields mean unlimited. */
  limits?: ExecutionLimits;
  /** Runtime-observed usage and progress counters. */
  usage: ExecutionUsage;
  /** Last checkpoint the run can safely resume from. */
  lastCheckpointId?: string;
  failureSummary?: string;
  location: "cloud" | "local";
  createdAt: string;
  updatedAt: string;
}

export interface RunStep {
  stepId: string;
  kind: "model" | "tool" | "delegation";
  description: string;
  status: "pending" | "active" | "completed" | "failed";
}

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "active" | "completed" | "failed";
  resultSummary?: string;
  /** Idempotency key so recovered runs never re-execute a completed call. */
  idempotencyKey: string;
}

/**
 * Durable checkpoint (RUNTIME-CHECKLIST.md §6). Written incrementally at
 * every boundary — before the model call, at each step end, around tool
 * execution — never only at the end. A restarted DO resumes from the latest
 * one; the event log fills in anything after it.
 */
export interface RunCheckpoint {
  checkpointId: string;
  runId: string;
  /** Monotonic per run — later version always wins. */
  version: number;
  status: RunStatus;
  nextStepNumber: number;
  /** SHA-256 of the serialized message history this checkpoint stores. */
  modelMessagesHash: string;
  completedToolCallIds: string[];
  pendingToolCallIds: string[];
  activeApprovalId?: string;
  /** Visible assistant text accumulated so far in this attempt. */
  partialAssistantText?: string;
  createdAt: string;
}
