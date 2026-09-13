import type { ReasoningChoice } from '@/domain/models/types'
import type { PermissionMode } from '@/domain/permissions/modes'
import type { Conversation, TurnSettings } from '@/domain/conversation/types'

/**
 * The settings the next turn from a surface will actually go out with.
 *
 * One derivation, used by the picker that displays it and by the send paths
 * that use it, so the two can never disagree. A conversation's own settled
 * choice - the index row's, mapped into the record - outranks the window's,
 * which is what makes reopening a conversation restore the model it was held
 * with rather than reset to the default. On a surface with no conversation
 * (home, a project page) the window's settings are the whole story, and null
 * modelId is the harness's own default.
 *
 * `permission` follows the same rule: the conversation's stored mode when it
 * has one, the window's otherwise. The mode is a consent held per
 * conversation on the harness side, so the sentence "what is on screen is
 * what is sent" applies to it more strictly than to the other two.
 */
export function effectiveTurnSettings(
  conversation: Conversation | null,
  settings: TurnSettings,
): {
  readonly modelId: string | null
  readonly reasoningLevel: ReasoningChoice | null
  readonly permission: PermissionMode
} {
  return {
    modelId: conversation?.modelId ?? settings.modelId,
    reasoningLevel: conversation?.reasoningLevel ?? settings.reasoningLevel,
    permission: conversation?.permissionMode ?? settings.permission,
  }
}
