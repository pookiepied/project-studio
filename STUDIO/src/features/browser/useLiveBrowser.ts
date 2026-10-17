import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserCommand, LiveBrowserState } from '@/domain/browser/live'
import { newUuid } from '@/lib/id'
import { useWorkspace } from '@/stores/workspace'

/** Poll only the newest screencast frame; never retry a human input. */
export function useLiveBrowser(conversationId: string) {
  const { browser, storePhase, ensureStore } = useWorkspace()
  const ready = storePhase.status === 'ready'
  const [viewerId] = useState(newUuid)
  const [state, setState] = useState<LiveBrowserState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const epoch = useRef(0)
  const queue = useRef<BrowserCommand[]>([])
  const sending = useRef(false)
  const connected = useRef(false)

  useEffect(() => {
    if (!ready) return
    const current = ++epoch.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let sequence: number | undefined
    connected.current = true
    setError(null)
    const read = async () => {
      if (!connected.current || epoch.current !== current) return
      const result = await browser.view(conversationId, viewerId, sequence)
      if (epoch.current !== current) return
      if (!result.ok) {
        connected.current = false
        queue.current = []
        setError(result.error.message)
        return
      }
      if (result.value.frame) sequence = result.value.frame.sequence
      setState((previous) => ({ ...result.value,
        frame: result.value.frameUnavailable ? null : result.value.frame ?? (previous?.frame?.tabId === result.value.activeTabId ? previous.frame : null) }))
      timer = setTimeout(() => void read(), document.hidden ? 1500 : 120)
    }
    void read()
    return () => {
      epoch.current = current + 1
      connected.current = false
      queue.current = []
      clearTimeout(timer)
      void browser.interact(conversationId, viewerId, { action: 'detach' })
    }
  }, [browser, conversationId, viewerId, revision, ready])

  const send = useCallback((command: BrowserCommand) => {
    if (!connected.current) return
    const last = queue.current[queue.current.length - 1]
    if (command.action === 'pointer' && command.kind === 'move' && last?.action === 'pointer' && last.kind === 'move') {
      queue.current[queue.current.length - 1] = command
    } else {
      if (queue.current.length >= 128) {
        connected.current = false
        queue.current = []
        setError('Browser input fell behind. Reconnect before continuing.')
        return
      }
      queue.current.push(command)
    }
    if (sending.current) return
    const current = epoch.current
    sending.current = true
    void (async () => {
      try {
        while (queue.current.length > 0 && current === epoch.current && connected.current) {
          const next = queue.current.shift()
          if (!next) break
          const result = await browser.interact(conversationId, viewerId, next)
          if (current !== epoch.current) return
          if (!result.ok) {
            queue.current = []
            setError(result.error.message)
            connected.current = false
            return
          }
        }
      } finally { sending.current = false }
    })()
  }, [browser, conversationId, viewerId])

  const unavailable = storePhase.status === 'no-harness' ? 'The harness is not running.'
    : storePhase.status === 'failed' ? storePhase.error?.message ?? 'The workspace could not load.' : null
  return { state: ready ? state : null, error: ready ? error : unavailable, send,
    reconnect: () => {
      setError(null)
      if (!ready) void ensureStore()
      setRevision((value) => value + 1)
    } }
}
