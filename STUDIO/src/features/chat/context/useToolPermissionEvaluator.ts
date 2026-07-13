import { useCallback, useEffect, useRef } from "react";
import type { ConversationStorageScope } from "@/core/conversations";
import {
  buildGrantLookupForConversation,
  chatModeFromStorageScope,
  deriveLocalContext,
  evaluateToolCall,
  getWorkspaceTrust,
  hasGlobalGrant,
  type ActionMode,
  type PermissionDecision,
} from "@/core/permissions";
import { getLocalMcpServer, readLocalMcpPermission } from "@/runtime";
import type { ProjectCtx } from "./projectContextStorage";

interface UseToolPermissionEvaluatorOptions {
  conversationId: string | null;
  conversationStorageScope: ConversationStorageScope;
  projectContext: ProjectCtx | null;
  autopilotMode: boolean;
  isStreaming: boolean;
}

export function useToolPermissionEvaluator({
  conversationId,
  conversationStorageScope,
  projectContext,
  autopilotMode,
  isStreaming,
}: UseToolPermissionEvaluatorOptions) {
  const liveActionModeRef = useRef<ActionMode>("review");
  liveActionModeRef.current =
    projectContext?.accessMode ?? (autopilotMode ? "autonomous" : "review");

  const frozenActionModeRef = useRef<ActionMode | null>(null);
  useEffect(() => {
    if (isStreaming) {
      if (frozenActionModeRef.current === null) {
        frozenActionModeRef.current = liveActionModeRef.current;
      }
    } else {
      frozenActionModeRef.current = null;
    }
  }, [isStreaming]);

  return useCallback(
    (server: string, toolName: string, args: Record<string, unknown>): PermissionDecision => {
      const workspaceRoot = projectContext?.path ?? null;
      const actionMode = frozenActionModeRef.current ?? liveActionModeRef.current;
      const def = getLocalMcpServer(server);

      return evaluateToolCall({
        chatMode: chatModeFromStorageScope(conversationStorageScope),
        localContext: deriveLocalContext(conversationStorageScope, !!projectContext),
        server,
        toolName,
        args,
        mcpEnabled: def ? readLocalMcpPermission(def) === true : false,
        workspaceRoot,
        workspaceTrust: getWorkspaceTrust(workspaceRoot),
        grantedRoots: workspaceRoot ? [workspaceRoot] : [],
        hasGlobalGrant: hasGlobalGrant(conversationId),
        actionMode,
        existingGrants: buildGrantLookupForConversation(workspaceRoot, conversationId),
      });
    },
    [conversationStorageScope, conversationId, projectContext]
  );
}
