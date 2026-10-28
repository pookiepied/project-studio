import { useEffect, useMemo } from 'react'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { useRail } from '@/stores/rail'
import { workspaceTasks } from './workspaceTasks'
import type { QueuedMessage } from '@/platform/harness/client/queued-messages'

export function useWorkspaceTasks(conversationId: string, items: readonly TranscriptItem[], running: boolean, activeSubmissionId: string | null, queued: readonly QueuedMessage[]): void {
  const { publishTasks } = useRail()
  const tasks = useMemo(() => {
    const result = workspaceTasks(conversationId, items, running, activeSubmissionId)
    if (running && activeSubmissionId && !result.some((task) => task.id === activeSubmissionId)) {
      result.push({ id: activeSubmissionId, conversationId, title: 'Preparing the response', status: 'running', calls: [], messages: [], timestamp: null })
    }
    for (const message of queued) {
      if (!result.some((task) => task.id === message.submissionId)) result.push({ id: message.submissionId, conversationId, title: 'Queued follow-up', status: 'queued', calls: [], messages: [], timestamp: null })
    }
    return result
  }, [conversationId, items, running, activeSubmissionId, queued])
  useEffect(() => { publishTasks(conversationId, tasks) }, [conversationId, tasks, publishTasks])
}
