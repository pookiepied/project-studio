import { useCallback, useRef, useState } from "react";
import type { ChatConversation } from "@/types";
import { saveConversation } from "@/features/chat/conversations/chatHistoryService";
import type { ConversationStorageScope } from "@/core/conversations";
import { isClaudeOwnedConversation } from "@/features/chat/conversations/ownership/conversationOwnership";
import {
  saveConvProjectCtx,
  type ProjectCtx,
} from "./projectContextStorage";

interface UseProjectContextStateOptions {
  conversation: ChatConversation | null;
  conversationStorageScope: ConversationStorageScope;
  setConversation: React.Dispatch<React.SetStateAction<ChatConversation | null>>;
}

export function useProjectContextState({
  conversation,
  conversationStorageScope,
  setConversation,
}: UseProjectContextStateOptions) {
  const [projectContext, setProjectContextState] = useState<ProjectCtx | null>(null);
  const pendingProjectContextRef = useRef<ProjectCtx | null>(null);

  const setProjectContext = useCallback((ctx: ProjectCtx | null) => {
    if (conversationStorageScope === "cloud" && ctx) return;
    setProjectContextState(ctx);
    if (conversation?.id) {
      saveConvProjectCtx(conversation.id, ctx);
      if (!isClaudeOwnedConversation(conversation)) {
        const updatedConversation: ChatConversation = {
          ...conversation,
          updatedAt: Date.now(),
          metadata: {
            ...(conversation.metadata ?? {}),
            ...(ctx ? { project: ctx } : { project: undefined }),
          },
        };
        saveConversation(updatedConversation).catch(() => {});
        setConversation(updatedConversation);
      }
    } else {
      pendingProjectContextRef.current = ctx;
    }
  }, [conversation, conversationStorageScope, setConversation]);

  return {
    projectContext,
    setProjectContext,
    setProjectContextState,
    pendingProjectContextRef,
  };
}
