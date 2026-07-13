import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ActiveToolCall, ToolApprovalDecision } from "@/features/chat/context/types";
import { toolLabel } from "@/runtime";
import { RISK_CLASS_META, extractTargetPaths } from "@/core/permissions";

const ACTION_TYPE_ID = "studio-permission-request";
const ACTION_ALLOW_ONCE = "allow_once";
const ACTION_ALLOW_CHAT = "allow_chat";
const ACTION_DENY = "deny";

interface NotificationActionPayload {
  actionId?: string;
  action?: string;
  id?: string;
  response?: string;
  extra?: Record<string, unknown>;
}

function notificationActionId(payload: unknown): string | null {
  const p = payload as NotificationActionPayload | null;
  if (!p) return null;
  const direct = p.actionId ?? p.action ?? p.id ?? p.response;
  if (typeof direct === "string") return direct;
  const extraAction = p.extra?.actionId ?? p.extra?.action ?? p.extra?.id;
  return typeof extraAction === "string" ? extraAction : null;
}

function buildToastBody(toolCall: ActiveToolCall): string {
  if (toolCall.approvalKind === "global_access") {
    return `${toolLabel(toolCall.tool)} needs machine-wide access for this chat.`;
  }
  if (toolCall.approvalKind === "mcp_management") {
    return `manage MCP servers (${toolLabel(toolCall.tool)}).`;
  }
  if (toolCall.approvalKind === "skill_management") {
    return `manage skills (${toolLabel(toolCall.tool)}).`;
  }

  const name = toolLabel(toolCall.tool);
  const riskMeta = toolCall.riskClass ? RISK_CLASS_META[toolCall.riskClass] : undefined;
  const target =
    extractTargetPaths(toolCall.tool, toolCall.args ?? {})[0] ??
    (toolCall.args?.command as string | undefined);
  const tail = riskMeta ? ` (${riskMeta.label})` : "";
  if (target) {
    return `${name}${tail}: ${target.length > 96 ? `${target.slice(0, 96)}...` : target}`;
  }
  return `${name}${tail}`;
}

interface UsePermissionNotificationsOptions {
  activeToolCalls: ActiveToolCall[];
  onDecision: (decision: ToolApprovalDecision) => void;
  onGlobalAccessDecision: (granted: boolean) => void;
  notificationsEnabled: boolean;
}

export function usePermissionNotifications({
  activeToolCalls,
  onDecision,
  onGlobalAccessDecision,
  notificationsEnabled,
}: UsePermissionNotificationsOptions): void {
  const onDecisionRef = useRef(onDecision);
  const onGlobalAccessDecisionRef = useRef(onGlobalAccessDecision);
  const pendingRef = useRef<ActiveToolCall | null>(null);
  const setupRef = useRef(false);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onDecisionRef.current = onDecision;
  }, [onDecision]);

  useEffect(() => {
    onGlobalAccessDecisionRef.current = onGlobalAccessDecision;
  }, [onGlobalAccessDecision]);

  useEffect(() => {
    pendingRef.current = activeToolCalls.find((tc) => tc.status === "pending_approval") ?? null;
    if (!pendingRef.current && notifiedRef.current.size > 0) notifiedRef.current.clear();
  }, [activeToolCalls]);

  useEffect(() => {
    if (!notificationsEnabled) return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (setupRef.current) return;
    setupRef.current = true;

    let disposed = false;
    let unlisten: (() => Promise<void>) | undefined;

    (async () => {
      try {
        const { registerActionTypes, onAction } = await import("@tauri-apps/plugin-notification");

        await registerActionTypes([
          {
            id: ACTION_TYPE_ID,
            actions: [
              { id: ACTION_ALLOW_ONCE, title: "Allow once", foreground: false },
              { id: ACTION_ALLOW_CHAT, title: "Allow for chat", foreground: false },
              { id: ACTION_DENY, title: "Deny", destructive: true, foreground: false },
            ],
          },
        ]);

        const listener = await onAction(async (payload) => {
          const pending = pendingRef.current;
          if (!pending) return;

          const actionId = notificationActionId(payload);
          if (!actionId) {
            await getCurrentWindow().setFocus();
            return;
          }

          if (pending.approvalKind === "global_access") {
            if (actionId === ACTION_DENY) onGlobalAccessDecisionRef.current(false);
            if (actionId === ACTION_ALLOW_ONCE || actionId === ACTION_ALLOW_CHAT) {
              onGlobalAccessDecisionRef.current(true);
            }
            return;
          }

          // Management grants are a scope choice (this chat / always), not the
          // once/chat/deny quick-actions — so the toast only refocuses the window
          // and the user decides in the full-screen management gate.
          if (
            pending.approvalKind === "mcp_management" ||
            pending.approvalKind === "skill_management"
          ) {
            await getCurrentWindow().setFocus();
            return;
          }

          if (actionId === ACTION_DENY) onDecisionRef.current("deny");
          if (actionId === ACTION_ALLOW_ONCE) onDecisionRef.current("once");
          if (actionId === ACTION_ALLOW_CHAT) onDecisionRef.current("session");
        });

        if (disposed) void listener.unregister();
        else unlisten = () => listener.unregister();
      } catch {
        setupRef.current = false;
      }
    })();

    return () => {
      disposed = true;
      void unlisten?.();
      setupRef.current = false;
    };
  }, [notificationsEnabled]);

  useEffect(() => {
    if (!notificationsEnabled) return;
    if (!("__TAURI_INTERNALS__" in window)) return;

    const pending = activeToolCalls.find((tc) => tc.status === "pending_approval");
    if (!pending) return;
    if (notifiedRef.current.has(pending.callId)) return;
    notifiedRef.current.add(pending.callId);

    (async () => {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } =
          await import("@tauri-apps/plugin-notification");
        let granted = await isPermissionGranted();
        if (!granted) {
          try {
            granted = (await requestPermission()) === "granted";
          } catch {
            granted = false;
          }
        }
        if (!granted) return;

        const win = getCurrentWindow();
        if (await win.isFocused()) return;

        sendNotification({
          title: "STUDIO - Permission required",
          body: `AI wants to ${buildToastBody(pending)}`,
          actionTypeId: ACTION_TYPE_ID,
          autoCancel: true,
          extra: { callId: pending.callId },
        });
      } catch {
        // The in-app approval card remains the source of truth.
      }
    })();
  }, [activeToolCalls, notificationsEnabled]);
}
