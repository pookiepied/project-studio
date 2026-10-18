import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserCommand, LiveBrowserState } from '@/domain/browser/live'
import { newUuid } from '@/lib/id'
import { useHarnessClient } from '@/platform/harness/react'
import type { HarnessClient, HarnessResult } from '@/platform/harness'

/** Poll only the newest screencast frame; never retry a human input. */
export function useLiveBrowser(conversationId: string) {
  const getClient = useHarnessClient()
  const client = useRef<HarnessClient | null>(null)
  const [viewerId] = useState(newUuid)
  const [state, setState] = useState<LiveBrowserState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [revision, setRevision] = useState(0)
  const epoch = useRef(0)
  const queue = useRef<BrowserCommand[]>([])
  const sending = useRef<number | null>(null)
  const connected = useRef(false)

  useEffect(() => {
    const current = ++epoch.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let sequence: number | undefined
    let failures = 0
    connected.current = true
    setState(null)
    setError(null)
    setInputError(null)
    setReconnecting(false)
    const read = async () => {
      if (epoch.current !== current) return
      const harness = await getClient()
      if (epoch.current !== current) return
      client.current = harness
      const result: HarnessResult<LiveBrowserState> = harness
        ? await harness.viewConversationBrowser(conversationId, viewerId, sequence)
        : { ok: false, error: { kind: 'not-reachable', timedOut: false, message: 'The harness is not running.' } }
      if (epoch.current !== current) return
      if (!result.ok) {
        // Only reads can be repeated. A dropped input may already have acted.
        if (result.error.kind === 'not-reachable' && failures < 5) {
          failures += 1
          connected.current = false
          queue.current = []
          setReconnecting(true)
          timer = setTimeout(() => { connected.current = true; void read() }, failures * 500)
          return
        }
        connected.current = false
        queue.current = []
        setReconnecting(false)
        setError(result.error.message)
        return
      }
      if ((failures > 0 || !connected.current) && result.value.control === 'human' && harness) {
        // Dropping queued input can also drop a key-up. Recovery releases
        // held input; it never repeats the uncertain command.
        const reset = await harness.interactConversationBrowser(conversationId, viewerId, { action: 'reset' })
        if (epoch.current !== current) return
        if (!reset.ok) setInputError(reset.error.message)
      }
      failures = 0
      connected.current = true
      setError(null)
      setReconnecting(false)
      if (result.value.frame) sequence = result.value.frame.sequence
      setState((previous) => ({ ...result.value,
        frame: result.value.frameUnavailable ? null : result.value.frame ?? (previous?.frame?.tabId === result.value.activeTabId ? previous.frame : null) }))
      timer = setTimeout(() => void read(), document.hidden ? 1500 : result.value.control === 'human' ? 40 : 100)
    }
    void read()
    return () => {
      epoch.current = current + 1
      connected.current = false
      queue.current = []
      clearTimeout(timer)
      void client.current?.interactConversationBrowser(conversationId, viewerId, { action: 'detach' })
    }
  }, [getClient, conversationId, viewerId, revision])

  const send = useCallback((command: BrowserCommand) => {
    if (!connected.current) return
    setInputError(null)
    const last = queue.current[queue.current.length - 1]
    if (command.action === 'pointer' && command.kind === 'move' && last?.action === 'pointer' && last.kind === 'move' && command.tabId === last.tabId) {
      queue.current[queue.current.length - 1] = command
    } else if (command.action === 'wheel' && last?.action === 'wheel' && command.tabId === last.tabId) {
      queue.current[queue.current.length - 1] = { ...command,
        x: Math.max(-4000, Math.min(4000, last.x + command.x)), y: Math.max(-4000, Math.min(4000, last.y + command.y)) }
    } else {
      if (queue.current.length >= 128) {
        connected.current = false
        queue.current = []
        setInputError('Browser input fell behind. Pending input was discarded.')
        setReconnecting(true)
        return
      }
      queue.current.push(command)
    }
    const current = epoch.current
    if (sending.current === current) return
    sending.current = current
    void (async () => {
      try {
        while (queue.current.length > 0 && current === epoch.current && connected.current) {
          const next = queue.current.shift()
          if (!next) break
          const harness = client.current
          if (!harness) return
          const result = await harness.interactConversationBrowser(conversationId, viewerId, next)
          if (current !== epoch.current) return
          if (!result.ok) {
            queue.current = []
            if (result.error.kind === 'not-reachable') {
              setInputError(result.error.message)
              setReconnecting(true)
              connected.current = false
            } else setInputError(result.error.message)
            return
          }
        }
      } finally { if (sending.current === current) sending.current = null }
    })()
  }, [conversationId, viewerId])

  return { state, error, inputError, reconnecting, send,
    reconnect: () => {
      setError(null)
      setRevision((value) => value + 1)
    } }
}
