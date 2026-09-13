import type { ReasoningChoice } from '@/domain/models/types'
import type { PermissionMode } from '@/domain/permissions/modes'

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
  /** The reasoning level it is held with; null means the user has not picked one and the harness rests it on medium. */
  readonly reasoningLevel: ReasoningChoice | null
  /**
   * The execution mode the conversation is held with - the consent its runs
   * are decided under. Mapped from the index like the model, so the picker
   * shows the mode the harness actually holds rather than the window's.
   */
  readonly permissionMode: PermissionMode
}

/**
 * What a turn is sent with.
 *
 * `modelId` is the runtime reference or null for the stable default; the
 * conversation index settles it at admission, and the harness refuses a model
 * nothing serves before creating anything. `reasoningLevel` carries one of
 * the model's levels, or null when the user has not picked one - the harness
 * then rests the turn on medium. `permission` is the picker's word for the
 * execution mode - the submission path translates it into the harness's
 * vocabulary at the wire boundary, and nowhere else.
 */
export interface TurnSettings {
  readonly modelId: string | null
  readonly reasoningLevel: ReasoningChoice | null
  readonly permission: PermissionMode
}
