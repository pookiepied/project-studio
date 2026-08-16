import type { ChatSession } from '@/features/chat/session/types'
import { useFlueChatSession } from '@/features/chat/session/useFlueChatSession'

/**
 * The single seam between the chat UI and whatever produces a conversation.
 *
 * Every component above this line codes against `ChatSession` and knows
 * nothing about transport. The demo has been removed; this now delegates to
 * the real Harness-backed session.
 */
export function useChatSession(): ChatSession {
  return useFlueChatSession()
}
