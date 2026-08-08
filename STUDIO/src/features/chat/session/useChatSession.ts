import type { ChatSession } from '@/features/chat/session/types'
// DEMO — delete this import and the line below when the harness lands.
import { useDemoChatSession } from '@/features/chat/demo/useDemoChatSession'

/**
 * The single seam between the chat UI and whatever produces a conversation.
 *
 * Every component above this line codes against `ChatSession` and knows
 * nothing about transport. Replacing the demo with the real harness is an edit
 * to this file plus `rm -rf features/chat/demo` — not a feature flag, and not
 * a rewrite of the surface. Nothing else in the app may import from `demo/`.
 */
export function useChatSession(): ChatSession {
  return useDemoChatSession()
}
