/**
 * The chat surface's view of a conversation.
 *
 * These shapes mirror Flue's conversation model rather than inventing one:
 * messages are parts-based, and status is a union rather than a set of
 * booleans. When `useFlueAgent` replaces the demo behind `useChatSession`,
 * this narrows to a re-export instead of a translation layer — see
 * documentation/architecture/frontend-backend-contract.md §4.
 */

export type ChatRole = 'user' | 'assistant'

/**
 * Rendered parts of one message. `reasoning` is the model's thinking, shown in
 * its own block above the answer. `dynamic-tool` and `file` parts arrive with
 * the tool-rendering slice; every future capability (MCP, subagents, sandbox)
 * surfaces through those same parts rather than a new channel.
 */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }

export interface ChatMessage {
  id: string
  role: ChatRole
  parts: ChatPart[]
}

/**
 * Where the conversation is right now, as one union so the composer can never
 * show two contradictory states at once. `thinking` is distinct from
 * `streaming`: the model is working but no answer text exists yet, which is
 * what the thinking block renders against.
 */
export type ChatStatus = 'idle' | 'submitting' | 'thinking' | 'streaming' | 'error'

/**
 * Reasoning effort. These are the harness's real levels — the slider in the
 * composer selects among exactly these, and `max` is the top stop that earns
 * the gradient treatment.
 */
export type Effort = 'low' | 'medium' | 'high' | 'max'

/**
 * How much autonomy a turn is granted. The real modes land with the
 * permissions slice; until then these are deliberately named as placeholders
 * so nothing reads as a real policy that is silently unenforced.
 */
export type PermissionMode = 'placeholder-one' | 'placeholder-two' | 'placeholder-three'

/** Everything chosen in the composer that travels with a turn. */
export interface TurnSettings {
  modelId: string
  effort: Effort
  permission: PermissionMode
}

export interface ChatSession {
  messages: readonly ChatMessage[]
  status: ChatStatus
  /** Present only when `status === 'error'`. */
  error?: string
  send: (text: string, settings: TurnSettings) => void
  /** Requests the in-flight turn stop at its next halt point. */
  stop: () => void
}
