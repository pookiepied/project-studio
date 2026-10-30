import { useEffect, useRef } from 'react'
import { useComputerPresence } from '@/features/screen/useComputerPresence'
import { parseDelegatedComputerUse } from '@/features/chat/useDelegatedComputerUse'
import { resolveHarnessAddress } from '@/platform/harness'
import { createConversationClient } from '@/platform/harness/conversation'
import { createRequester } from '@/platform/harness/client/request'
import { hideComputerIndicator, onComputerStopRequested, reportComputerStopResult, showComputerIndicator } from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'

/** Lives in the main window so navigation and detached chats cannot hide another owner's sign. */
export function ComputerPresenceMonitor() {
  const presence = useComputerPresence()
  const { computer, tasks, approvals, questions } = useWorkspace()
  const current = useRef({ computer, tasks, approvals, questions })
  current.current = { computer, tasks, approvals, questions }
  const conversationId = presence?.conversationId ?? null
  const mode = presence?.mode ?? 'active'
  useEffect(() => {
    const refresh = () => {
      const command = conversationId === null ? hideComputerIndicator() : showComputerIndicator(conversationId, mode)
      void command.catch(() => undefined)
    }
    refresh()
    if (conversationId === null) return
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [conversationId, mode])
  useEffect(() => {
    let live = true
    let unlisten: (() => void) | undefined
    void onComputerStopRequested((id, requestId) => {
      void current.current.computer.stop(id).then(
        (result) => reportComputerStopResult(requestId, !result.ok || result.value === 'unavailable'),
        () => reportComputerStopResult(requestId, true),
      ).catch(() => undefined)
      void current.current.questions.stop(id)
      void current.current.approvals.list().then((result) => {
        if (!result.ok) return
        for (const approval of result.value) {
          if (approval.conversationId === id) void current.current.approvals.cancel(approval.id)
        }
      })
      void createConversationClient({ conversationId: id }).abortRun().catch(() => undefined)
      void (async () => {
        const address = await resolveHarnessAddress()
        if (address === null) return
        const request = createRequester(address)
        const result = await request.json('GET', `/api/tasks/activity?parentConversationId=${encodeURIComponent(id)}`, undefined, parseDelegatedComputerUse)
        if (result.ok) {
          const workers = new Set(result.value.flatMap((task) => task.owner ? [task.owner] : task.agentName === 'voice-work' ? [task.id] : []))
          for (const worker of workers) void current.current.tasks.cancel(worker)
        }
      })().catch(() => undefined)
    }).then((stop) => { if (live) unlisten = stop; else stop() })
    return () => { live = false; unlisten?.(); void hideComputerIndicator().catch(() => undefined) }
  }, [])
  return null
}
