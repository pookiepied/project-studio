import { useEffect, useRef } from 'react'
import {
  browserAction,
  browserVerb,
  readBrowserCall,
} from '@/features/chat/transcript/live/browserCall'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { useRail } from '@/stores/rail'

/**
 * Keeps the rail's browser preview following the conversation.
 *
 * The transcript row already shows each frame where the work happens. This is
 * the other half of ADR 0049 §7: one entry that always holds the *latest*
 * frame, so a person who wants to watch can open it once and keep watching
 * instead of scrolling after the model.
 *
 * **It never focuses the rail.** A model browsing in the background must not
 * seize a panel somebody is reading — the transcript row is where the work
 * announces itself, and opening the preview is the person's move. What this
 * does is make sure that when they do open it, it is current.
 *
 * Read from the projected transcript rather than from the chunk stream,
 * because the projection is the one place a call and its answer have already
 * been paired. Reading the stream would mean pairing them a second time, in a
 * second way, and the two would eventually disagree.
 */
export function useBrowserPreview(
  conversationId: string,
  conversationTitle: string,
  items: readonly TranscriptItem[],
): void {
  const { showBrowser } = useRail()
  // The last call this hook has already told the rail about. Without it every
  // re-render would push the same frame again, and every push is a state
  // update that re-renders the rail.
  const seen = useRef<string | null>(null)

  useEffect(() => {
    const latest = lastBrowserCall(items)
    if (latest === null) return
    if (seen.current === latest.toolCallId) return
    seen.current = latest.toolCallId

    const view = readBrowserCall(latest.toolName, latest.output, latest.errorText)
    if (view === null) return

    showBrowser(conversationId, conversationTitle, {
      url: view.url,
      title: view.title,
      frame: view.frame,
      step: stepOf(view.action, view.url, latest.errorText),
    })
  }, [items, conversationId, conversationTitle, showBrowser])

  // A different conversation is a different browser. Forgetting here is what
  // keeps a switch away and back from deciding the last call was already
  // shown, which would leave the preview a conversation behind.
  useEffect(() => {
    seen.current = null
  }, [conversationId])
}

/** One line for the sequence in the panel: what was done, and where. */
function stepOf(action: string, url: string | null, errorText: string | null): string {
  const verb = browserVerb(action, false)
  const where = url === null ? '' : ` ${url}`
  return errorText === null ? `${verb}${where}` : `${verb}${where} - failed`
}

interface AnsweredCall {
  readonly toolCallId: string
  readonly toolName: string
  readonly output: unknown
  readonly errorText: string | null
}

/**
 * The most recent browser call that has an answer.
 *
 * Walked backwards and stopped at the first hit, because the transcript can be
 * thousands of items long and only the last one is wanted. A call still
 * running is skipped: it has no frame and no place, and pushing it would blank
 * a preview that currently shows something true.
 */
function lastBrowserCall(items: readonly TranscriptItem[]): AnsweredCall | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item === undefined || item.kind !== 'assistant') continue
    for (let segmentIndex = item.segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const segment = item.segments[segmentIndex]
      if (segment === undefined || segment.kind !== 'tools') continue
      for (let groupIndex = segment.groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
        const calls = segment.groups[groupIndex]?.calls ?? []
        for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
          const call = calls[callIndex]
          if (call === undefined) continue
          if (browserAction(call.toolName) === null) continue
          const answered = call.output !== null && call.output.present
          if (!answered && call.errorText === null) continue
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: call.output?.present === true ? call.output.value : null,
            errorText: call.errorText,
          }
        }
      }
    }
  }
  return null
}
