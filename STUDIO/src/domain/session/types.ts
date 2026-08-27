import type { ReasoningChoice } from '@/domain/models/types'
import type { PermissionMode } from '@/domain/permissions/modes'

type Role = 'user' | 'assistant'

/**
 * A reasoning trace.
 *
 * Held separately from the reply rather than inlined, because it is a different
 * kind of content with a different default: collapsed. Folding it into the text
 * would mean the transcript had to parse it back out to hide it.
 */
export interface Thinking {
  readonly text: string
  /** Seconds spent. Shown in the collapsed header, so it is worth the glance. */
  readonly seconds: number
}

export interface Message {
  readonly id: string
  readonly role: Role
  readonly text: string
  readonly thinking?: Thinking
  /** Which model produced this. Absent on user turns. */
  readonly modelId?: string
  readonly createdAt: number
}

export interface Conversation {
  readonly id: string
  /**
   * `null` until the first exchange.
   *
   * Load-bearing rather than a default nobody filled in: the chrome renders the
   * identity line only when there is something true to put in it, so a fresh
   * conversation shows no title at all instead of the word "Untitled".
   */
  readonly title: string | null
  readonly projectId: string | null
  readonly messages: readonly Message[]
  readonly updatedAt: number
  readonly pinned: boolean
  readonly archived: boolean
  /**
   * The model this conversation is held with, in the runtime's own
   * `<provider>/<model>` vocabulary; null for the stable default. Mapped from
   * the index so the picker restores the choice on reopening instead of
   * resetting to the default.
   */
  readonly modelId: string | null
  /** The reasoning choice it is held with; null is the same state as "default". */
  readonly reasoningLevel: ReasoningChoice | null
}

/** What the session is doing. Drives the mark, the send button, and the composer. */
export type SessionStatus = 'idle' | 'thinking' | 'streaming'

/**
 * What a turn is sent with.
 *
 * `modelId` is the runtime reference or null for the stable default; the
 * conversation index settles it at admission, and the harness refuses a model
 * nothing serves before creating anything. `reasoningLevel` carries "default"
 * or one of the model's levels. Permission modes are Task 40's.
 */
export interface TurnSettings {
  readonly modelId: string | null
  readonly reasoningLevel: ReasoningChoice
  readonly permission: PermissionMode
}
