/**
 * Local tool execution engine.
 *
 * Handles every tool call that the AI worker defers to the client:
 *   - task_write        - updates React state directly
 *   - spawn_agent       - safety stub (handled server-side)
 *   - ask_user_question - pauses and shows an interactive prompt
 *   - MCP tools         - routed to Tauri subprocess via invokeMcpTool
 *
 * Local MCP calls pass through the centralized permission engine
 * (src/permissions/evaluateToolCall) before execution - allow, prompt for
 * approval, or deny. The result is serialised to the wire format expected by
 * both the HTTP relay and the new WebSocket path.
 *
 * Returns both the tool result messages (for HTTP relay) and the
 * ToolResultItems (for WebSocket tool_results).
 */

import {
  invokeMcpTool,
  extractMcpImages,
  truncateMcpOutput,
  formatMcpError,
} from "@/services/mcp/mcpInvoker";
import { logger } from "@/services/logging/logger";
import { connectionManager } from "@/services/connection";
import type { APIChatMessage, LocalToolCall, ToolResultItem } from "@/services/ai/types";
import type { TaskItem, ActiveToolCall, ToolApprovalDecision } from "./types";
import { isLocalMcpServer } from "@/permissions";
import type { PermissionDecision, GrantScope } from "@/permissions";
import { notifyPermissionRequired } from "./notifications";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeLocalTools(
  toolCalls: LocalToolCall[],
  callbacks: ToolExecutionCallbacks
): Promise<ToolExecutionResult> {
  const toolMessages:    APIChatMessage[]  = [];
  const toolResultItems: ToolResultItem[]  = [];

  for (const tc of toolCalls) {
    const toolName = tc.mcpTool ?? tc.tool;
    let resultContent: unknown;

    // Register card if not already present
    callbacks.setActiveToolCalls((prev) => {
      if (prev.find((t) => t.callId === tc.callId)) return prev;
      return [
        ...prev,
        {
          callId:       tc.callId,
          tool:         tc.tool,
          args:         tc.args,
          status:       "running",
          displayClass: undefined, // will be refined by classifyToolDisplay
        },
      ];
    });

    try {
      resultContent = await executeSingleTool(tc, toolName, callbacks);
    } catch (e: unknown) {
      resultContent = { error: (e as Error)?.message ?? String(e) };
      callbacks.setActiveToolCalls((prev) =>
        prev.map((t) =>
          t.callId === tc.callId
            ? { ...t, status: "error", result: resultContent }
            : t
        )
      );
    }

    const contentStr =
      typeof resultContent === "string"
        ? resultContent
        : JSON.stringify(resultContent);

    toolMessages.push({
      role:         "tool",
      content:      contentStr,
      tool_call_id: tc.callId,
      name:         tc.tool,
    });
    toolResultItems.push({
      call_id: tc.callId,
      content: contentStr,
      name:    tc.tool,
    });
  }

  return { toolMessages, toolResultItems };
}

// ---------------------------------------------------------------------------
// Single-tool dispatch
// ---------------------------------------------------------------------------

async function executeSingleTool(
  tc:         LocalToolCall,
  toolName:   string,
  cb:         ToolExecutionCallbacks
): Promise<unknown> {
  // -- task_write - handled entirely in-process -------------------------
  if (toolName === "task_write") {
    const rawTasks = (tc.args.todos ?? []) as TaskItem[];
    const nextTasks = rawTasks.every((t) => t.status === "completed")
      ? []
      : rawTasks;
    cb.setSessionTasks(nextTasks);
    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId
          ? { ...t, status: "complete", result: nextTasks }
          : t
      )
    );
    return "Tasks have been updated successfully.";
  }

  // -- spawn_agent - should never reach the client -----------------------
  if (toolName === "spawn_agent") {
    logger.warn("toolExecutor", "spawn_agent reached client - handled server-side");
    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId ? { ...t, status: "error" } : t
      )
    );
    return { error: "spawn_agent must be handled by the AI Worker." };
  }

  // -- get_location - browser geolocation API ---------------------------
  if (toolName === "get_location") {
    if (!navigator.geolocation) {
      const result = { error: "Geolocation is not supported by this browser.", source: "unavailable" };
      cb.setActiveToolCalls((prev) =>
        prev.map((t) => t.callId === tc.callId ? { ...t, status: "error", result } : t)
      );
      return result;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        });
      });

      const { latitude, longitude, accuracy } = position.coords;

      let city: string | undefined;
      let country: string | undefined;
      let address: string | undefined;
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
          { headers: { "User-Agent": "Studio-AI/1.0" } }
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json() as Record<string, any>;
          const addr = geoData.address as Record<string, string> | undefined;
          city    = addr?.city ?? addr?.town ?? addr?.village;
          country = addr?.country;
          address = geoData.display_name as string | undefined;
        }
      } catch {
        // reverse geocode failed - coordinates still returned
      }

      const result = {
        latitude,
        longitude,
        accuracy: Math.round(accuracy),
        source: "browser",
        ...(city    ? { city }    : {}),
        ...(country ? { country } : {}),
        ...(address ? { address } : {}),
      };

      cb.setActiveToolCalls((prev) =>
        prev.map((t) => t.callId === tc.callId ? { ...t, status: "complete", result } : t)
      );
      return result;
    } catch (err: unknown) {
      const geoErr = err as GeolocationPositionError;
      const denied = geoErr?.code === 1; // PERMISSION_DENIED
      const result = {
        error: denied
          ? "Location access denied by user."
          : `Geolocation failed: ${geoErr?.message ?? "Unknown error"}`,
        source: denied ? "denied" : "error",
      };
      cb.setActiveToolCalls((prev) =>
        prev.map((t) => t.callId === tc.callId ? { ...t, status: "error", result } : t)
      );
      return result;
    }
  }

  // -- ask_user_question - interactive prompt ----------------------------
  if (tc.server === "studio-harness" && toolName === "ask_user_question") {
    await notifyPermissionRequired(
      typeof tc.args?.question === "string"
        ? `AI has a question: ${(tc.args.question as string).slice(0, 80)}`
        : "AI has a question for you"
    );
    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId ? { ...t, status: "pending_question" } : t
      )
    );
    // 5-minute timeout - if user doesn't answer, return a safe fallback so
    // the AI can explain the situation rather than hanging forever.
    const ANSWER_TIMEOUT_MS = 5 * 60 * 1000;
    const answer = await Promise.race([
      cb.waitForAnswer(typeof tc.args?.question === "string" ? tc.args.question : "AI has a question for you"),
      new Promise<string>((resolve) =>
        setTimeout(() => {
          connectionManager.emit({ type: "tool:answer_timeout", timestamp: Date.now(), convId: cb.convId, toolName: tc.tool });
          resolve("[No response after 5 minutes. Let the user know you're waiting for their answer, or ask them to continue the conversation.]");
        }, ANSWER_TIMEOUT_MS)
      ),
    ]);
    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId
          ? { ...t, status: "complete", result: answer }
          : t
      )
    );
    return answer;
  }

  // -- MCP tools ---------------------------------------------------------
  if (tc.server) {
    return executeMcpTool(tc, toolName, cb);
  }

  // -- Unknown -----------------------------------------------------------
  const result = {
    error: `Unknown local tool '${tc.tool}'. Use the Studio Harness MCP tools for local operations.`,
  };
  cb.setActiveToolCalls((prev) =>
    prev.map((t) =>
      t.callId === tc.callId ? { ...t, status: "error", result } : t
    )
  );
  return result;
}

// ---------------------------------------------------------------------------
// MCP tool execution with permission gates
// ---------------------------------------------------------------------------

function applyWorkspaceDefaults(
  server: string,
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string | null
): Record<string, unknown> {
  if (server !== "studio-harness" || !workspaceRoot) return args;

  const next = { ...args };
  const setIfMissing = (key: string) => {
    if (typeof next[key] !== "string" || (next[key] as string).trim().length === 0) {
      next[key] = workspaceRoot;
    }
  };

  switch (toolName) {
    case "bash":
    case "powershell":
    case "git_status":
    case "git_diff":
    case "git_log":
    case "git_commit":
    case "git_push":
    case "git_pull":
    case "git_fetch":
    case "git_show":
    case "git_branch":
    case "git_stash":
    case "git_worktree":
      setIfMissing("cwd");
      break;
    case "ls":
    case "grep":
    case "glob":
      setIfMissing("path");
      break;
    case "index_codebase":
    case "explore_codebase":
    case "search_symbol":
      setIfMissing("root_dir");
      break;
    case "outline_file":
      setIfMissing("workspace_root");
      break;
  }

  return next;
}

async function executeMcpTool(
  tc:       LocalToolCall,
  toolName: string,
  cb:       ToolExecutionCallbacks
): Promise<unknown> {
  if (!tc.server) {
    const result = { error: `Tool '${toolName}' is missing a server identifier.` };
    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId ? { ...t, status: "error", result } : t
      )
    );
    return result;
  }

  // -- Centralized permission gate (local MCP servers only) --------------
  // Cloud MCP servers (e.g. google-workspace) are not machine-bound and are
  // not governed by the local permission engine.
  const effectiveArgs = applyWorkspaceDefaults(tc.server, toolName, tc.args ?? {}, cb.workspaceRoot ?? null);

  if (isLocalMcpServer(tc.server)) {
    let decision = cb.evaluatePermission(tc.server, toolName, effectiveArgs);
    logger.info(
      "toolExecutor",
      `permission: ${tc.server}/${toolName} -> ${decision.outcome} (${decision.code}, risk=${decision.riskClass})`
    );

    // Machine-wide access request - a global (no-project) chat reaching outside
    // any workspace. Show the full-screen grant gate; if granted, the global
    // grant is now persisted, so re-evaluate and continue normal handling
    // (which may still surface an ordinary per-action approval).
    if (decision.outcome === "prompt" && decision.code === "global_access_required") {
      cb.setActiveToolCalls((prev) =>
        prev.map((t) =>
          t.callId === tc.callId
            ? {
                ...t,
                status: "pending_approval",
                approvalKind: "global_access",
                approvalReason: decision.reason,
                offeredScopes: ["session"],
              }
            : t
        )
      );
      await notifyPermissionRequired(`AI wants machine-wide access for: ${toolName}`);

      const GLOBAL_ACCESS_TIMEOUT_MS = 5 * 60 * 1000;
      let globalTimedOut = false;
      const granted = await Promise.race([
        cb.requestGlobalAccess(toolName),
        new Promise<boolean>((resolve) =>
          setTimeout(() => {
            globalTimedOut = true;
            connectionManager.emit({ type: "tool:approval_timeout", timestamp: Date.now(), convId: cb.convId, toolName });
            resolve(false);
          }, GLOBAL_ACCESS_TIMEOUT_MS)
        ),
      ]);

      if (!granted) {
        const result = {
          error: globalTimedOut
            ? `Machine-access request for '${toolName}' timed out after 5 minutes. Ask the user to retry.`
            : `User declined machine-wide access for ${toolName}. Ask them to open a project folder to scope the work.`,
        };
        cb.setActiveToolCalls((prev) =>
          prev.map((t) => (t.callId === tc.callId ? { ...t, status: "error", result } : t))
        );
        return result;
      }

      // Global grant is now active - re-evaluate against the updated state.
      decision = cb.evaluatePermission(tc.server, toolName, effectiveArgs);
    }

    // Hard block - never runs. Return a structured, LLM-readable error.
    if (decision.outcome === "deny") {
      const result = {
        status: "error",
        server: tc.server,
        tool:   toolName,
        error:  decision.reason,
        hint:   "This call was blocked by your permission settings, not a tool failure.",
      };
      cb.setActiveToolCalls((prev) =>
        prev.map((t) =>
          t.callId === tc.callId ? { ...t, status: "error", result } : t
        )
      );
      return result;
    }

    // Needs user approval - surface the prompt above the composer and wait.
    if (decision.outcome === "prompt") {
      cb.setActiveToolCalls((prev) =>
        prev.map((t) =>
          t.callId === tc.callId
            ? {
                ...t,
                status:         "pending_approval",
                approvalKind:   "tool",
                riskClass:      decision.riskClass,
                approvalReason: decision.reason,
                offeredScopes:  decision.offeredScopes,
              }
            : t
        )
      );
      await notifyPermissionRequired(`AI wants to run: ${toolName}`);

      // 5-minute timeout - auto-deny if unanswered so the turn doesn't hang.
      const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
      let approvalTimedOut = false;
      const choice = await Promise.race([
        cb.requestApproval(),
        new Promise<ToolApprovalDecision>((resolve) =>
          setTimeout(() => {
            approvalTimedOut = true;
            connectionManager.emit({ type: "tool:approval_timeout", timestamp: Date.now(), convId: cb.convId, toolName });
            resolve("deny");
          }, APPROVAL_TIMEOUT_MS)
        ),
      ]);

      if (choice === "deny") {
        const result = {
          error: approvalTimedOut
            ? `Permission request for '${toolName}' timed out after 5 minutes. Ask the user to retry.`
            : `User denied permission to run ${toolName}.`,
        };
        cb.setActiveToolCalls((prev) =>
          prev.map((t) =>
            t.callId === tc.callId ? { ...t, status: "error", result } : t
          )
        );
        return result;
      }

      cb.recordGrant(toolName, choice);
    }
  }

  // -- Execute ----------------------------------------------------------
  cb.setActiveToolCalls((prev) =>
    prev.map((t) =>
      t.callId === tc.callId ? { ...t, status: "running" } : t
    )
  );

  try {
    logger.info("toolExecutor", `invoke: ${tc.server}/${toolName}`, effectiveArgs);
    const mcpResult = await invokeMcpTool(tc.server, toolName, effectiveArgs);
    logger.info("toolExecutor", `invoke done: ${tc.server}/${toolName}`, mcpResult);
    const { dataUrls, textOnly } = extractMcpImages(mcpResult);

    if (dataUrls.length > 0) {
      cb.screenshotUrls.push(...dataUrls);
    }

    const result = dataUrls.length > 0
      ? { content: [{ type: "text", text: textOnly || "Screenshot captured successfully." }] }
      : truncateMcpOutput(mcpResult);

    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId ? { ...t, status: "complete", result } : t
      )
    );
    return result;
  } catch (err: unknown) {
    const result = formatMcpError(tc.server, toolName, err as Error);
    cb.setActiveToolCalls((prev) =>
      prev.map((t) =>
        t.callId === tc.callId ? { ...t, status: "error", result } : t
      )
    );
    return result;
  }
}
