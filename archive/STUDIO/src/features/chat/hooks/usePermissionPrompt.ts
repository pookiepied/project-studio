import { useState, useEffect } from "react";
import type { ActiveToolCall } from "@/features/chat/context/types";

interface UsePermissionPromptResult {
  pendingPermission: string | null;
  setPendingPermission: (tool: string | null) => void;
}

export function usePermissionPrompt(activeToolCalls: ActiveToolCall[]): UsePermissionPromptResult {
  const [pendingPermission, setPendingPermission] = useState<string | null>(null);

  useEffect(() => {
    for (const tc of activeToolCalls) {
      if (tc.status === "complete") {
        const r = tc.result as any;
        if (r?.status === "permission_required" && r?.tool) {
          setPendingPermission(r.tool);
          return;
        }
      }
    }
  }, [activeToolCalls]);

  return { pendingPermission, setPendingPermission };
}
