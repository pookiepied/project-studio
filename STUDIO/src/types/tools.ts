/**
 * Cross-cutting tool-execution DTOs.
 *
 * Neutral leaf module: shared by both the desktop-backend `runtime/` layer and
 * the `features/chat` UI layer. Depends only on `@/core/permissions` (downward),
 * never on any `@/features/**` module, keeping it a valid dependency for both.
 *
 * Historically these types lived in `features/chat/context/types.ts`; they are
 * tool-execution domain types, so they were relocated here (their canonical
 * home). `features/chat/context/types.ts` re-exports them for back-compat.
 */

import type { GrantScope, ToolRiskClass } from "@/core/permissions";

/** User decision on a per-action approval prompt: a grant scope, or deny. */
export type ToolApprovalDecision = GrantScope | "deny";

// ---------------------------------------------------------------------------
// Task list
// ---------------------------------------------------------------------------

export interface TaskItem {
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

// ---------------------------------------------------------------------------
// Tool call cards
// ---------------------------------------------------------------------------

export type ToolDisplayClass = "capsule" | "stream" | "silent";

export interface ActiveToolCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status:
    | "running"
    | "complete"
    | "error"
    | "pending_question"
    | "pending_approval";
  result?: unknown;
  displayClass?: ToolDisplayClass;
  // -- Permission approval metadata (set when status = "pending_approval") --
  /** Risk class of the tool awaiting approval. */
  riskClass?: ToolRiskClass;
  /** Human-readable reason the approval is required. */
  approvalReason?: string;
  /** Grant scopes the user may choose from in the approval prompt. */
  offeredScopes?: GrantScope[];
  /** Which resolver owns this pending approval card. */
  approvalKind?: "tool" | "global_access" | "mcp_management" | "skill_management";
  /** True when this card represents a delegated sub-agent. */
  type?: "sub_agent";
  /** callId of the spawn_agent that created this sub-agent. */
  parentCallId?: string;
  /** Live text content streamed by the sub-agent. */
  subAgentContent?: string;
}
