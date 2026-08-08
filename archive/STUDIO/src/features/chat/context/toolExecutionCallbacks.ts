/**
 * Builds the callback bundle `executeLocalTools` needs to drive the UI.
 *
 * ChatProvider runs the local-tool pipeline from two places — the WebSocket
 * `onLocalToolsPending` handler and the DSML tool-call interception inside
 * `handleStreamDone`. Both need an identical bundle; this is the one place it
 * is assembled so the two paths cannot drift apart.
 */

import type { ToolExecutionCallbacks } from "@/runtime";
import { recordGrant as recordToolGrant } from "@/core/permissions";
import type { ActiveToolCall, TaskItem, ToolApprovalDecision } from "./types";
import type { PermissionDecision, ManagementKind } from "@/core/permissions";

export interface ToolExecutionCallbackDeps {
  setActiveToolCalls: React.Dispatch<React.SetStateAction<ActiveToolCall[]>>;
  setSessionTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  waitForAnswer: (question: string) => Promise<string>;
  evaluatePermission: (
    server: string,
    toolName: string,
    args: Record<string, unknown>
  ) => PermissionDecision;
  requestGlobalAccess: (toolName: string) => Promise<boolean>;
  requestManagementAccess: (kind: ManagementKind) => Promise<boolean>;
  /** Resolver slot for the in-flight approval prompt; settled by the UI. */
  pendingApprovalResolveRef: React.MutableRefObject<
    ((decision: ToolApprovalDecision) => void) | null
  >;
  /** Live screenshot-URL accumulator for the current turn (passed by reference). */
  screenshotUrls: string[];
  workspaceRoot: string | null;
  convId: string | undefined;
}

export function buildToolExecutionCallbacks(
  deps: ToolExecutionCallbackDeps
): ToolExecutionCallbacks {
  const {
    setActiveToolCalls,
    setSessionTasks,
    waitForAnswer,
    evaluatePermission,
    requestGlobalAccess,
    requestManagementAccess,
    pendingApprovalResolveRef,
    screenshotUrls,
    workspaceRoot,
    convId,
  } = deps;

  return {
    setActiveToolCalls,
    setSessionTasks,
    waitForAnswer,
    evaluatePermission,
    requestApproval: () =>
      new Promise<ToolApprovalDecision>((resolve) => {
        pendingApprovalResolveRef.current = resolve;
      }),
    requestGlobalAccess,
    requestManagementAccess,
    recordGrant: (tool, scope) =>
      recordToolGrant(tool, scope, workspaceRoot, convId ?? null),
    workspaceRoot,
    screenshotUrls,
    convId,
  };
}
