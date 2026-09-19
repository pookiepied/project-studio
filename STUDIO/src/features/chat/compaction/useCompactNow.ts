import { useCallback } from 'react'
import { createHarnessClient, resolveHarnessAddress } from '@/platform/harness'
import { useLiveWork } from '@/stores/workspace'

/**
 * Compacting a conversation by hand, from anywhere in the window.
 *
 * Two controls ask for it - "Compact now" in the model menu and `/compact`
 * in the composer - and both must mark the conversation as compacting in
 * the store (so the other control disables and the page shows the state)
 * and bump its context revision when it ends (so the meter re-reads). One
 * hook, so they cannot disagree about either. The harness decides whether
 * the compaction may run; a refusal comes back as its sentence.
 */
export function useCompactNow(): {
  readonly compacting: ReadonlySet<string>
  /** Resolves to the refusal to show, or null when the conversation was compacted. */
  readonly compactNow: (conversationId: string) => Promise<string | null>
} {
  const { compacting, markCompacting, bumpContext } = useLiveWork()

  const compactNow = useCallback(
    async (conversationId: string): Promise<string | null> => {
      if (compacting.has(conversationId)) return 'Already compacting.'
      markCompacting(conversationId, true)
      try {
        const address = await resolveHarnessAddress()
        if (address === null) return 'No harness is configured.'
        const result = await createHarnessClient(address).compactConversation(conversationId)
        return result.ok ? null : result.error.message
      } finally {
        markCompacting(conversationId, false)
        bumpContext(conversationId)
      }
    },
    [compacting, markCompacting, bumpContext],
  )

  return { compacting, compactNow }
}
