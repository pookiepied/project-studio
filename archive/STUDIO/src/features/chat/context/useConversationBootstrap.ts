import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ChatConversation, ChatMessage } from "@/types";
import {
  getAllConversations,
  loadConversation,
} from "@/features/chat/conversations/chatHistoryService";
import { fetchPendingCompletion, clearPendingCompletion } from "@/features/chat/services/pendingCompletion";
import { maybeCompact } from "./contextCompactor";
import { applyCatchUp } from "./catchUp";

interface UseConversationBootstrapOptions {
  loadInitialMessages: (conversationId: string, totalCount: number) => Promise<void>;
  appendToDisplayedMessages: (message: ChatMessage) => void;
  getContextLimit: (modelId: string) => number;
  isSummarizingRef: MutableRefObject<boolean>;
  setConversation: Dispatch<SetStateAction<ChatConversation | null>>;
  setCurrentModel: Dispatch<SetStateAction<string>>;
  setIsSummarizing: Dispatch<SetStateAction<boolean>>;
}

export function useConversationBootstrap({
  loadInitialMessages,
  appendToDisplayedMessages,
  getContextLimit,
  isSummarizingRef,
  setConversation,
  setCurrentModel,
  setIsSummarizing,
}: UseConversationBootstrapOptions) {
  const conversationLoadedRef = useRef(false);

  const loadMostRecentConversation = useCallback(async () => {
    if (conversationLoadedRef.current) return;
    const all = await getAllConversations();
    if (all.length > 0) {
      const conv = await loadConversation(all[0].id);
      if (conv) {
        conversationLoadedRef.current = true;
        setConversation(conv);
        setCurrentModel(conv.model);
        await loadInitialMessages(conv.id, conv.messages.length);
        maybeCompact(conv, conv.model, getContextLimit, isSummarizingRef, setIsSummarizing, setConversation).catch(() => {});

        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg?.role === "user") {
          fetchPendingCompletion(conv.id).then(async (content) => {
            if (!content) return;
            await applyCatchUp(conv.id, content, setConversation, appendToDisplayedMessages);
            clearPendingCompletion(conv.id).catch(() => {});
          }).catch(() => {});
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadMostRecentConversation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => loadMostRecentConversation();
    window.addEventListener("studio:storage-ready", handler);
    return () => window.removeEventListener("studio:storage-ready", handler);
  }, [loadMostRecentConversation]);
}
