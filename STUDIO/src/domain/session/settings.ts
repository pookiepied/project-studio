import type { ReasoningChoice } from '@/domain/models/types'
import type { Conversation, TurnSettings } from '@/domain/session/types'

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
 */
export function effectiveTurnSettings(
  conversation: Conversation | null,
  settings: TurnSettings,
): { readonly modelId: string | null; readonly reasoningLevel: ReasoningChoice } {
  return {
    modelId: conversation?.modelId ?? settings.modelId,
    reasoningLevel: conversation?.reasoningLevel ?? settings.reasoningLevel,
  }
}
