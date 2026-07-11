import type { ConversationContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Conversation layer (§19.1): current message, relevant history, prior tool
 * results, attachments. Pulls from Studio Data — relevant slices only, never
 * the full raw history.
 */
export async function buildConversationContext(
  _env: Env,
  _userId: string,
  _conversationId: string | undefined,
  _task: string,
): Promise<ConversationContext> {
  throw new Error("not_implemented");
}
