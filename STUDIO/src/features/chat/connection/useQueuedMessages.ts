import { useCallback, useEffect, useRef, useState } from 'react'
import { createHarnessClient, resolveHarnessAddress } from '@/platform/harness'
import type { QueuedMessage } from '@/platform/harness/client/queued-messages'
import { forgetQueued } from './queued-messages'

/** Read the runtime's queue; cached receipts never authorize a mutation. */
export function useQueuedMessages(conversationId: string, running: boolean, onSteered?: (message: QueuedMessage) => void) {
  const currentId = useRef(conversationId)
  currentId.current = conversationId
  const [state, setState] = useState<{ id: string; messages: readonly QueuedMessage[] }>({ id: conversationId, messages: [] })
  const [restored, setRestored] = useState<{ id: string; message: QueuedMessage } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const lock = useRef(false)
  const revision = useRef(0)
  const readSequence = useRef(0)
  const steered = useRef(onSteered)
  steered.current = onSteered

  const refresh = useCallback(async () => {
    const at = revision.current
    const read = ++readSequence.current
    const address = await resolveHarnessAddress()
    if (!address) return
    const result = await createHarnessClient(address).queuedMessages(conversationId)
    if (currentId.current !== conversationId || at !== revision.current || read !== readSequence.current) return
    if (result.ok) setState({ id: conversationId, messages: result.value })
    else setError(result.error.message)
  }, [conversationId])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh()
      if (!disposed && running) timer = setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [refresh, running])

  const change = async (message: QueuedMessage, action: 'steer' | 'remove' | 'edit') => {
    if (lock.current) return
    lock.current = true
    revision.current += 1
    setChanging(true)
    setError(null)
    try {
      const address = await resolveHarnessAddress()
      if (!address) { setError('The harness is unavailable.'); return }
      const client = createHarnessClient(address)
      const result = action === 'edit'
        ? await client.editQueuedMessage(conversationId, message.submissionId)
        : await client.changeQueuedMessage(conversationId, message.submissionId, action)
      if (currentId.current !== conversationId) return
      if (!result.ok) { setError(result.error.message); return }
      forgetQueued(conversationId, new Set([message.submissionId]))
      setState((previous) => ({ id: conversationId, messages: previous.messages.filter((item) => item.submissionId !== message.submissionId) }))
      if (result.value) setRestored({ id: conversationId, message: result.value })
      if (action === 'steer') steered.current?.(message)
    } finally {
      lock.current = false
      setChanging(false)
      if (currentId.current === conversationId) {
        revision.current += 1
        await refresh()
      }
    }
  }

  return {
    messages: state.id === conversationId ? state.messages : [],
    restoredMessage: restored?.id === conversationId ? restored.message : null,
    error, changing, change, refresh,
  }
}
