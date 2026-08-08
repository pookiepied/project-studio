/**
 * catchUp — applies a completed response that the ChatAgent DO saved while
 * the client was disconnected (browser closed, navigation, new conversation).
 *
 * Mirrors the tail of ChatProvider.handleStreamDone: saves the message to
 * unified storage (Tauri FS / R2 depending on platform) and appends it to
 * the displayed messages list so the user sees it immediately on load.
 */

import type { Dispatch, SetStateAction } from "react";
import type { ChatConversation, ChatMessage }  from "@/types";
import { addMessage, loadConversation }         from "@/features/chat/conversations/chatHistoryService";
import { parseChatResponse }                    from "@/lib/chatParser";

export async function applyCatchUp(
  conversationId:          string,
  rawContent:              string,
  setConversation:         Dispatch<SetStateAction<ChatConversation | null>>,
  appendToDisplayedMessages: (msg: ChatMessage) => void
): Promise<void> {
  const parsed       = parseChatResponse(rawContent);
  const finalContent = parsed?.trim() ? parsed : rawContent.trim();
  if (!finalContent) return;

  const catchUpMsg = {
    id:        `ai-catchup-${Date.now()}`,
    timestamp: Date.now(),
    role:      "assistant" as const,
    content:   finalContent,
  };

  await addMessage(conversationId, catchUpMsg);

  const fresh = await loadConversation(conversationId);
  if (!fresh) return;

  setConversation(fresh);
  const last = fresh.messages[fresh.messages.length - 1];
  if (last?.role === "assistant") appendToDisplayedMessages(last);
}
