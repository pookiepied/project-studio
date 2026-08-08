import type { ChatConversation } from "@/types";
import { loadConversation, updateConversationTitle } from "@/features/chat/conversations/chatHistoryService";
import { chat } from "@/features/chat/services/chatService";

interface GenerateConversationTitleOptions {
  conversation: ChatConversation;
  initialContent: string;
  model: string;
  setConversation: (conversation: ChatConversation) => void;
}

function cleanGeneratedTitle(title: string): string {
  return title.trim().replace(/^["']+|["']+$/g, "").slice(0, 80);
}

export function generateConversationTitleInBackground({
  conversation,
  initialContent,
  model,
  setConversation,
}: GenerateConversationTitleOptions) {
  const snippet = initialContent.trim().slice(0, 800);

  chat(
    [
      {
        role: "system",
        content: "Generate a concise 3-5 word title for this conversation based on the user message. Reply with only the title - no quotes, no punctuation, no explanation.",
      },
      { role: "user", content: snippet },
    ],
    model,
    { max_tokens: 30, direct: true },
  ).then(async (result) => {
    if (!result.success || !result.data) return;

    const aiTitle = cleanGeneratedTitle(result.data);
    if (!aiTitle) return;

    await updateConversationTitle(conversation.id, aiTitle);
    const updated = await loadConversation(conversation.id);
    if (updated) setConversation(updated);
    window.dispatchEvent(new CustomEvent("studio:title-updated", {
      detail: { id: conversation.id, title: aiTitle },
    }));
  }).catch(() => {
    // Keep the truncated title on failure.
  });
}
