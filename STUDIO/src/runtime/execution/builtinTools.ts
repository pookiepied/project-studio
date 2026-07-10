/**
 * Builtin (in-process) tool handlers.
 *
 * Extracted from the former features/chat/context/toolExecutor.ts. These tool
 * calls are handled directly in the frontend instead of routing to a local MCP
 * subprocess:
 *   - task_write         — updates React task-list state directly
 *   - spawn_agent        — safety stub (handled server-side)
 *   - get_location       — browser geolocation API + reverse geocode
 *   - ask_user_question  — pauses and shows an interactive prompt
 *
 * `executeBuiltinTool` returns the tool result when one of these handles the
 * call, or `undefined` when the call is not a builtin (the caller then falls
 * through to the MCP execution path).
 *
 * TODO(reorg): the ToolExecutionCallbacks type references chat-state types
 * (ActiveToolCall / TaskItem); that coupling is resolved in Phase 5
 * (ChatProvider split). Type-only import — no runtime cycle.
 */

import { logger } from "@/core/logging/logger";
import { connectionManager } from "@/core/connection";
import type { LocalToolCall } from "@/types/chat";
import type { TaskItem } from "@/features/chat/context/types";
import { notifyPermissionRequired } from "./notifications";
import type { ToolExecutionCallbacks } from "./types";
import { ANSWER_TIMEOUT_MS } from "./constants";

/**
 * Returns the builtin tool result, or `undefined` if the call is not a builtin
 * (caller should fall through to MCP execution).
 */
export async function executeBuiltinTool(
  tc: LocalToolCall,
  toolName: string,
  cb: ToolExecutionCallbacks
): Promise<unknown | undefined> {
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

  // Not a builtin — caller falls through to MCP execution.
  return undefined;
}
