import { useCallback, useEffect, useRef } from 'react'
import { computerAction } from '@/features/chat/transcript/live/computerCall'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import {
  hideComputerIndicator,
  onComputerStopRequested,
  showComputerIndicator,
} from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'
import type { DelegatedComputerUse } from './useDelegatedComputerUse'

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
 *
 * Any agent of the conversation raises it, not only the main turn: a
 * delegate or a voice task at the desktop is the same hand on the same
 * mouse. Their calls are not in this transcript, so `delegated` - the
 * harness's task activity - names them, and Stop also cancels the voice
 * tasks among them; an inline delegate ends with the turn `stopTurn` ends.
 */
export function useComputerIndicator(
  conversationId: string,
  items: readonly TranscriptItem[],
  running: boolean,
  stopTurn: () => void,
  delegated: readonly DelegatedComputerUse[] = [],
): () => void {
  const { computer, tasks } = useWorkspace()
  const driving = (running && drivesComputer(items)) || delegated.length > 0
  const shown = useRef(false)
  // Chat and desktop Stop share cleanup. Cancelling the model alone cannot
  // release input already sent to the separate computer MCP process.
  const stop = useCallback(() => {
    if (drivesComputer(items) || delegated.length > 0) void computer.stop(conversationId)
    for (const task of delegated) if (task.agentName === 'voice-work') void tasks.cancel(task.id)
    stopTurn()
  }, [computer, tasks, conversationId, items, delegated, stopTurn])
  const stopRef = useRef(stop)
  stopRef.current = stop

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
      stopRef.current()
    }).then((stop) => {
      if (live) unlisten = stop
      else stop()
    })
    return () => {
      live = false
      unlisten?.()
    }
  }, [conversationId])
  return stop
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
