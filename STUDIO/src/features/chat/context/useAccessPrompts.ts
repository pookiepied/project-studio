import { useCallback, useRef, useState } from "react";
import {
  hasManagementGrant,
  recordManagementGrant,
  setGlobalGrant,
  type ManagementKind,
} from "@/core/permissions";
import type { ManagementDecision } from "@/features/permissions/components/ManagementAccessModal";

export function useAccessPrompts(conversationId: string | null) {
  const [globalAccessPrompt, setGlobalAccessPrompt] = useState<{ toolName: string } | null>(null);
  const pendingGlobalAccessResolveRef = useRef<((granted: boolean) => void) | null>(null);

  const resolveGlobalAccess = useCallback((granted: boolean) => {
    if (granted) setGlobalGrant(true, conversationId);
    setGlobalAccessPrompt(null);
    pendingGlobalAccessResolveRef.current?.(granted);
    pendingGlobalAccessResolveRef.current = null;
  }, [conversationId]);

  const requestGlobalAccess = useCallback((toolName: string): Promise<boolean> => {
    setGlobalAccessPrompt({ toolName });
    return new Promise<boolean>((resolve) => { pendingGlobalAccessResolveRef.current = resolve; });
  }, []);

  const [managementPrompt, setManagementPrompt] = useState<{ kind: ManagementKind } | null>(null);
  const pendingManagementResolveRef = useRef<((granted: boolean) => void) | null>(null);

  const resolveManagementAccess = useCallback((decision: ManagementDecision) => {
    if (managementPrompt && decision !== "deny") {
      recordManagementGrant(managementPrompt.kind, decision, conversationId);
    }
    setManagementPrompt(null);
    pendingManagementResolveRef.current?.(decision !== "deny");
    pendingManagementResolveRef.current = null;
  }, [managementPrompt, conversationId]);

  const requestManagementAccess = useCallback((kind: ManagementKind): Promise<boolean> => {
    if (hasManagementGrant(kind, conversationId)) return Promise.resolve(true);
    setManagementPrompt({ kind });
    return new Promise<boolean>((resolve) => { pendingManagementResolveRef.current = resolve; });
  }, [conversationId]);

  return {
    globalAccessPrompt,
    managementPrompt,
    resolveGlobalAccess,
    requestGlobalAccess,
    resolveManagementAccess,
    requestManagementAccess,
  };
}
