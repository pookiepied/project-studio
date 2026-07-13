import { useCallback, useState } from "react";
import type { ChatConversation, ChatMessage } from "@/types";
import { getConversationMessages } from "@/features/chat/conversations/chatHistoryService";
import { MESSAGES_PER_PAGE } from "./constants";

interface UseConversationDisplayOptions {
  conversation: ChatConversation | null;
}

export function useConversationDisplay({
  conversation,
}: UseConversationDisplayOptions) {
  const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [messageOffset, setMessageOffset] = useState(0);

  const appendToDisplayedMessages = useCallback((message: ChatMessage) => {
    setDisplayedMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = message;
        return next;
      }
      return [...prev, message];
    });
  }, []);

  const loadInitialMessages = useCallback(async (conversationId: string, totalCount: number) => {
    const msgs = await getConversationMessages(conversationId, MESSAGES_PER_PAGE, 0);
    setDisplayedMessages(msgs.reverse());
    setMessageOffset(MESSAGES_PER_PAGE);
    setHasMoreMessages(totalCount > MESSAGES_PER_PAGE);
  }, []);

  const loadMoreMessages = useCallback(async () => {
    if (!conversation || isLoadingMore || !hasMoreMessages) return;
    setIsLoadingMore(true);
    try {
      const more = await getConversationMessages(conversation.id, MESSAGES_PER_PAGE, messageOffset);
      if (more.length > 0) {
        setDisplayedMessages((prev) => [...more.reverse(), ...prev]);
        setMessageOffset((prev) => prev + more.length);
        setHasMoreMessages(more.length === MESSAGES_PER_PAGE);
      } else {
        setHasMoreMessages(false);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversation, isLoadingMore, hasMoreMessages, messageOffset]);

  return {
    displayedMessages,
    hasMoreMessages,
    isLoadingMore,
    appendToDisplayedMessages,
    loadInitialMessages,
    loadMoreMessages,
    setDisplayedMessages,
    setHasMoreMessages,
    setMessageOffset,
  };
}
