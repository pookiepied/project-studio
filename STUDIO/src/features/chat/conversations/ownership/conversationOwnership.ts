import type { ChatConversation, ConversationMetadata } from "@/types";
import type { ChatEngine } from "@/cliBridges/types";

type ConversationOwner = "studio" | "claude";

function getConversationOwner(metadata?: ConversationMetadata): ConversationOwner {
  if (metadata?.owner) return metadata.owner;
  return "studio";
}

export function isClaudeOwnedConversation(conversation: ChatConversation | null | undefined): boolean {
  return getConversationOwner(conversation?.metadata) === "claude";
}

export function canContinueWithEngine(
  metadata: ConversationMetadata | undefined,
  engine: ChatEngine
): boolean {
  const owner = getConversationOwner(metadata);
  if (owner === "claude") return engine === "claude";
  return true;
}

export function normalizeEngineForConversationOwner(
  metadata: ConversationMetadata | undefined,
  requested: ChatEngine
): ChatEngine {
  return canContinueWithEngine(metadata, requested) ? requested : "claude";
}
