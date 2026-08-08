/**
 * Shared types for the local tool-execution engine.
 *
 * Leaf module: imports only cross-cutting DTOs and chat-state/permission types,
 * never a runtime-execution sibling. Both `executeLocalTools` and `builtinTools`
 * import from here, which is what keeps them off each other's import path.
 *
 * These types are runtime-execution-local — `ToolExecutionCallbacks` is the
 * callback bundle the executor uses to drive the chat UI, and
 * `ToolExecutionResult` is the executor's return shape — so they live beside the
 * executor rather than in the cross-cutting `src/types/` DTO folder.
 */

import type { APIChatMessage, ToolResultItem } from "@/types/chat";
import type { ActiveToolCall, TaskItem, ToolApprovalDecision } from "@/types/tools";
import type { PermissionDecision, GrantScope, ManagementKind } from "@/core/permissions";

export interface ToolExecutionCallbacks {
  /** React state setter for active tool cards. */
  setActiveToolCalls: React.Dispatch<React.SetStateAction<ActiveToolCall[]>>;
  setSessionTasks:    React.Dispatch<React.SetStateAction<TaskItem[]>>;
  /**
   * Returns a Promise that resolves when the user submits an answer to an
   * ask_user_question prompt.
   */
  waitForAnswer: (question: string) => Promise<string>;
  /**
   * Evaluate a local MCP tool call against trusted permission state.
   * Returns the engine's decision (allow / prompt / deny).
   */
  evaluatePermission: (
    server: string,
    toolName: string,
    args: Record<string, unknown>
  ) => PermissionDecision;
  /**
   * Prompt the user for approval on a `prompt` decision. Resolves with the
   * chosen grant scope, or "deny". The card metadata is already on-screen.
   */
  requestApproval: () => Promise<ToolApprovalDecision>;
  /**
   * Prompt for machine-wide file access when a global (no-project) chat needs
   * to reach outside any workspace root. Resolves `true` if the user grants it
   * (the caller persists the global grant), `false` if declined.
   */
  requestGlobalAccess: (toolName: string) => Promise<boolean>;
  /**
   * Prompt for a system-management grant (installing MCP servers / authoring
   * skills) via the full-screen management gate. Resolves `true` if the user
   * grants it (the caller persists the category grant) or already has, `false`
   * if declined. One grant covers every operation of that {@link ManagementKind}.
   */
  requestManagementAccess: (kind: ManagementKind) => Promise<boolean>;
  /** Persist an approval at the chosen scope so later calls don't re-prompt. */
  recordGrant: (toolName: string, scope: GrantScope) => void;
  /** Open project root for defaulting pathless Studio Harness calls. */
  workspaceRoot?: string | null;
  /** Screenshot URLs collected during execution (mutated in-place). */
  screenshotUrls: string[];
  /** Active conversation ID - used to emit tool timeout events to ConnectionManager. */
  convId?: string;
}

export interface ToolExecutionResult {
  /** Tool result messages in OpenAI format (for HTTP relay). */
  toolMessages: APIChatMessage[];
  /** Tool results in the wire format for WebSocket tool_results messages. */
  toolResultItems: ToolResultItem[];
}
