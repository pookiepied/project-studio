import { invoke } from '@tauri-apps/api/core'
import { httpHarnessStatus } from '@/platform/harness/connection'
import { createConversationClient, type ConversationClient } from '@/platform/harness/conversation'
import { isTauri } from '@/platform/tauri/window'
import { isRecord } from '@/lib/guards'

/** What one contact attempt found. `starting` is a fact, not an absence. */
export type HarnessContact =
  | { readonly kind: 'ready'; readonly client: ConversationClient }
  | { readonly kind: 'starting' }
  | { readonly kind: 'absent' }

export type ContactHarness = () => Promise<HarnessContact>

/**
 * Asks the supervisor whether there is anything to attach to.
 *
 * A per-conversation factory rather than a shared function because the id is
 * a property of the call: ids are caller-chosen (ADR 0045), and the client
 * built here is one per conversation by construction. Outside Tauri the ask
 * goes to the listener that served the page, which answers for its own
 * supervisor; a page with no Studio behind it gets no answer, and the shipped
 * no-harness behaviour applies there as it always did.
 *
 * Whatever comes back must be stable across renders — it is an effect
 * dependency, like the settings pane's connect seam.
 */
export function defaultContactFor(conversationId: string): ContactHarness {
  return async () => {
    if (!isTauri()) {
      const report = await httpHarnessStatus()
      if (report === null) return { kind: 'absent' }
      if (report.state === 'starting') return { kind: 'starting' }
      if (report.state !== 'running') return { kind: 'absent' }
      return { kind: 'ready', client: createConversationClient({ conversationId }) }
    }
    let state: unknown
    try {
      const report: unknown = await invoke('get_harness_status')
      state = isRecord(report) ? report['state'] : null
    } catch {
      // A status that cannot be answered is not a harness either.
      return { kind: 'absent' }
    }
    if (state === 'starting') return { kind: 'starting' }
    if (state !== 'running') return { kind: 'absent' }
    return { kind: 'ready', client: createConversationClient({ conversationId }) }
  }
}
