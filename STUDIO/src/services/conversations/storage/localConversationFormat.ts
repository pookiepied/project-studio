import type { ChatConversation, ChatMessage } from "../../../types";

export const LOCAL_CONVERSATION_SCHEMA_VERSION = 1 as const;

interface LocalMessageEvent {
  schemaVersion: typeof LOCAL_CONVERSATION_SCHEMA_VERSION;
  type: "message";
  conversationId: string;
  message: ChatMessage;
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function serializeMessagesJsonl(conversation: ChatConversation): string {
  return conversation.messages
    .map((message) => JSON.stringify({
      schemaVersion: LOCAL_CONVERSATION_SCHEMA_VERSION,
      type: "message",
      conversationId: conversation.id,
      message,
    } satisfies LocalMessageEvent))
    .join("\n") + (conversation.messages.length ? "\n" : "");
}

export function renderConversationTranscript(conversation: ChatConversation): string {
  const header = [
    `# ${conversation.title || "Untitled Conversation"}`,
    "",
    `- ID: ${conversation.id}`,
    `- Model: ${conversation.model}`,
    `- Created: ${new Date(conversation.createdAt).toISOString()}`,
    `- Updated: ${new Date(conversation.updatedAt).toISOString()}`,
    `- Scope: ${conversation.metadata?.storageScope ?? "local"}`,
    "",
    "---",
    "",
  ];

  const body = conversation.messages.flatMap((message) => [
    `## ${message.role === "user" ? "User" : "Assistant"} - ${new Date(message.timestamp).toISOString()}`,
    "",
    normalizeLineBreaks(message.content || "_No content_"),
    "",
  ]);

  return [...header, ...body].join("\n");
}

export function withLocalConversationMetadata(conversation: ChatConversation): ChatConversation {
  return {
    ...conversation,
    metadata: {
      ...(conversation.metadata ?? {}),
      storageScope: "local",
      owner: conversation.metadata?.owner ?? "studio",
    },
  };
}
