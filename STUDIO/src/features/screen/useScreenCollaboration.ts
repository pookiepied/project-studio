import { useEffect, useRef } from 'react'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { onScreenDrawingFinished, onScreenDrawn, showScreenMarks } from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'
import { freshMarkCommands, markCalls } from './markCalls'

/** How long after the last stroke Studio takes its picture, so a circle and its arrow land in one. */
const GLANCE_AFTER_INK_MS = 600

/**
 * The conversation's side of drawing on the screen (ADR 0059).
 *
 * Marks go out: each new `studio_computer_mark` answer in this transcript is
 * handed to the overlay window, the way the computer pill reads its state
 * from the transcript. Calls that were already there when the page opened
 * are history, not requests, and are never replayed.
 *
 * Ink comes in: the overlay reports each stroke's shape through Rust, and it
 * goes to the harness as what the person drew; a moment after the last
 * stroke, and again at Done, Studio asks for a picture so the agent's next
 * look shows the ink. Done also hands the desktop back from "show me".
 */
export function useScreenCollaboration(conversationId: string, items: readonly TranscriptItem[]): void {
  const { computer } = useWorkspace()
  const shown = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (shown.current === null) {
      shown.current = new Set(markCalls(items).map((call) => call.id))
      return
    }
    for (const { id, command } of freshMarkCommands(items, shown.current, Date.now())) {
      shown.current.add(id)
      void showScreenMarks(command.kind === 'clear' ? { clear: true } : command.set)
    }
  }, [items])

  // A different conversation in the same page starts from its own history.
  useEffect(() => { shown.current = null }, [conversationId])

  const computerRef = useRef(computer)
  computerRef.current = computer

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const stops: (() => void)[] = []
    const keep = (stop: () => void) => { if (live) stops.push(stop); else stop() }
    void onScreenDrawn((drawnFor, shapes) => {
      if (drawnFor !== conversationId) return
      void computerRef.current.drew(conversationId, shapes)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => void computerRef.current.glance(conversationId), GLANCE_AFTER_INK_MS)
    }).then(keep)
    void onScreenDrawingFinished((finishedFor) => {
      if (finishedFor !== conversationId) return
      if (timer !== null) clearTimeout(timer)
      void computerRef.current.control(conversationId, 'resume').then(() => computerRef.current.glance(conversationId))
    }).then(keep)
    return () => {
      live = false
      if (timer !== null) clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [conversationId])
}
