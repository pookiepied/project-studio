import { useEffect, useRef } from 'react'
import { computerAction } from '@/features/chat/transcript/live/computerCall'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import {
  hideComputerIndicator,
  onComputerStopRequested,
  showComputerIndicator,
} from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'

/**
 * Puts the "Studio is using your computer" pill up while this conversation's
 * running turn drives the desktop, and takes it down when the turn ends
 * (ADR 0055 §7).
 *
 * The rule is read from the transcript, like the rail's preview: the pill is
 * up when the turn is running and its assistant item holds at least one
 * computer call. Not "while a call is in flight", because between two calls
 * the model is deciding what to do next to the same desktop, and a sign that
 * flickered off in those gaps would say the model had stopped when it had
 * not. Not "for the whole turn" either: a turn that never touched the
 * computer shows nothing.
 *
 * The pill's Stop comes back here as a native event carrying the conversation
 * id. The window showing that conversation stops the driver and the run; the
 * pill goes down with the turn, by the same rule as above.
 */
export function useComputerIndicator(
  conversationId: string,
  items: readonly TranscriptItem[],
  running: boolean,
  stopTurn: () => void,
): void {
  const { computer } = useWorkspace()
  const driving = running && drivesComputer(items)
  const shown = useRef(false)

  useEffect(() => {
    if (driving) {
      shown.current = true
      void showComputerIndicator(conversationId)
      return
    }
    if (!shown.current) return
    shown.current = false
    void hideComputerIndicator()
  }, [driving, conversationId])

  // Unmounting while up: the sign must not outlive the window that raised it.
  useEffect(
    () => () => {
      if (shown.current) void hideComputerIndicator()
    },
    [],
  )

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let live = true
    void onComputerStopRequested((stopped) => {
      if (stopped !== conversationId) return
      void computer.stop(conversationId)
      stopTurn()
    }).then((stop) => {
      if (live) unlisten = stop
      else stop()
    })
    return () => {
      live = false
      unlisten?.()
    }
  }, [conversationId, computer, stopTurn])
}

/** Whether the newest assistant item - the running turn - has a computer call. */
function drivesComputer(items: readonly TranscriptItem[]): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item === undefined || item.kind !== 'assistant') continue
    for (const segment of item.segments) {
      if (segment.kind !== 'tools') continue
      for (const group of segment.groups) {
        for (const call of group.calls) {
          if (computerAction(call.toolName) !== null) return true
        }
      }
    }
    return false
  }
  return false
}
