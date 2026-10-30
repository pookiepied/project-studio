import { useCallback } from 'react'
import { computerAction } from '@/features/chat/transcript/live/computerCall'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { useWorkspace } from '@/stores/workspace'
import type { DelegatedComputerUse } from './useDelegatedComputerUse'
import { useComputerPresence } from '@/features/screen/useComputerPresence'

/**
 * Chat Stop joins model cancellation with driver cleanup. Desktop presence
 * is owned by ComputerPresenceMonitor and the live lease, never this log.
 */
export function useComputerIndicator(
  conversationId: string,
  items: readonly TranscriptItem[],
  running: boolean,
  stopTurn: () => void,
  delegated: readonly DelegatedComputerUse[] = [],
): () => void {
  const { computer, tasks } = useWorkspace()
  const presence = useComputerPresence()
  const ownsComputer = presence?.conversationId === conversationId
  // Chat and desktop Stop share cleanup. Cancelling the model alone cannot
  // release input already sent to the separate computer MCP process.
  const stop = useCallback(() => {
    if (ownsComputer || (running && drivesComputer(items)) || delegated.length > 0) void computer.stop(conversationId)
    // A voice task stops by cancelling it, and so does a delegate inside
    // one: the delegate has no submission of its own to cancel.
    const workers = new Set(delegated.flatMap((task) => task.agentName === 'voice-work' ? [task.id] : task.owner === undefined ? [] : [task.owner]))
    for (const id of workers) void tasks.cancel(id)
    stopTurn()
  }, [computer, tasks, conversationId, items, running, delegated, stopTurn, ownsComputer])
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
