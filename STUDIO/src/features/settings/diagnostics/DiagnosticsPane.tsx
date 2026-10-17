import { useCallback, useEffect, useState } from 'react'
import { Pane, Row } from '@/features/settings/panes/Pane'
import { useHarnessClient } from '@/platform/harness/react'
import type { DiagnosticHealth, DiagnosticPolicy } from '@/platform/harness/client/diagnostics'
import { isTauri } from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'
import { clearNativeCapture, readNativeCapture, syncNativeCapture } from '@/platform/diagnostics/native'

const BUTTON = 'rounded-md border px-3 py-1.5 text-ui hover:bg-tint disabled:opacity-50'

export function DiagnosticsPane() {
  const connect = useHarnessClient()
  const { conversations } = useWorkspace()
  const [health, setHealth] = useState<DiagnosticHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const local = isTauri()

  const refresh = useCallback(async () => {
    const client = await connect()
    if (!client) { setError('The harness is not running.'); return }
    const result = await client.getDiagnostics()
    if (result.ok) { setHealth(result.value); setError(null) }
    else setError(result.error.message)
  }, [connect])

  useEffect(() => {
    if (!local) return
    let live = true
    const load = async () => {
      const client = await connect()
      if (!live) return
      if (!client) { setError('The harness is not running.'); return }
      const result = await client.getDiagnostics()
      if (!live) return
      if (result.ok) setHealth(result.value)
      else setError(result.error.message)
    }
    void load()
    return () => { live = false }
  }, [connect, local])

  const change = async (policy: Partial<DiagnosticPolicy>) => {
    setBusy(true); setCopied(false)
    try {
      const client = await connect()
      if (!client) { setError('The harness is not running.'); return }
      const result = await client.configureDiagnostics(policy, health?.captureId)
      if (result.ok) {
        setHealth(result.value)
        setError(await syncNativeCapture(result.value.policy.enabled) ? null : 'Native recording could not follow the capture policy. Refresh to try again.')
      }
      else setError(result.error.message)
    } finally { setBusy(false) }
  }

  const clear = async () => {
    setBusy(true); setCopied(false)
    try {
      const client = await connect()
      if (!client) return
      const result = await client.clearDiagnostics()
      if (!result.ok) setError(result.error.message)
      else { await clearNativeCapture(); await syncNativeCapture(health?.policy.enabled ?? false); await refresh() }
    } catch { setError('The captured native events could not be cleared.')
    } finally { setBusy(false) }
  }

  const copy = async () => {
    if (!health) return
    setBusy(true); setCopied(false)
    try {
      const client = await connect()
      if (!client) return
      // Stop without clearing, so the exported window cannot move under pagination.
      const stopped = await client.configureDiagnostics({ enabled: false }, health.captureId)
      if (!stopped.ok) { setError(stopped.error.message); return }
      setHealth(stopped.value)
      await syncNativeCapture(false)
      let native: Readonly<Record<string, unknown>> | null = null
      let nativeUnavailable = false
      try { native = await readNativeCapture() } catch { nativeUnavailable = true }
      const events: Readonly<Record<string, unknown>>[] = []
      let after = 0; let gap = false
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const result = await client.readDiagnostics(after, stopped.value.bootId)
        if (!result.ok) { setError(result.error.message); return }
        if (result.value.health.bootId !== stopped.value.bootId) { setError('The harness restarted. Refresh before copying.'); return }
        if (result.value.health.captureId !== stopped.value.captureId) { setError('The captured window changed. Refresh and try again.'); return }
        if (JSON.stringify(result.value.health.policy) !== JSON.stringify(stopped.value.policy)) {
          setError('Recording settings changed while copying. Refresh and try again.'); return
        }
        gap ||= result.value.gap
        events.push(...result.value.events)
        if (result.value.nextSequence <= after || result.value.events.length === 0) break
        after = result.value.nextSequence
        if (after >= result.value.health.latestSequence) break
      }
      await navigator.clipboard.writeText(JSON.stringify({ format: 'project-studio.diagnostics', version: 1,
        exportedAt: new Date().toISOString(), health: stopped.value, gap, events, native, nativeUnavailable }, null, 2))
      setCopied(true); setError(null)
    } catch { setError('The captured events could not be copied. Recording is stopped.') }
    finally { setBusy(false) }
  }

  const copyHost = async () => {
    setBusy(true); setCopied(false)
    try {
      const native = await readNativeCapture()
      await navigator.clipboard.writeText(JSON.stringify({ format: 'project-studio.native-diagnostics', version: 1,
        exportedAt: new Date().toISOString(), native }, null, 2))
      setCopied(true); setError(null)
    } catch { setError('The host diagnostic window could not be copied.') }
    finally { setBusy(false) }
  }

  return <Pane title="Diagnostics" description="Record a bounded local window to investigate Studio behavior. Nothing is uploaded.">
    {!local ? <Row label="Open this page on the desktop" hint="Diagnostic recordings are available on the local Studio host." /> : <>
      {error ? <p role="alert" className="py-3 text-ui text-muted-foreground">{error}</p> : null}
      <Row label="Host evidence" hint="Native lifecycle and transport events survive a harness restart until Studio quits.">
        <button className={BUTTON} disabled={busy} onClick={() => void copyHost()}>Copy host events</button>
      </Row>
      {!health ? <Row label="Reading recording status..." /> : <>
        <Row label="Recording" hint="Starts off each time the harness launches. Stopping keeps the captured window until you clear it or quit.">
          <button className={BUTTON} disabled={busy} onClick={() => void change({ enabled: !health.policy.enabled })}>{health.policy.enabled ? 'Stop recording' : 'Start recording'}</button>
        </Row>
        <Row label="Conversation content" hint="May include prompts, reasoning and tool results. Choose conversations below. Changing content consent or scope clears the previous window.">
          <input aria-label="Capture conversation content" type="checkbox" disabled={busy} checked={health.policy.captureContent}
            onChange={(event) => void change({ captureContent: event.target.checked })} />
        </Row>
        {health.policy.captureContent ? <Row label="Conversations to capture" hint="Only selected conversations include content.">
          <select aria-label="Conversations to capture" multiple className="max-w-64 rounded-md border bg-surface p-2 text-ui" disabled={busy}
            value={[...health.policy.conversations]} onChange={(event) => void change({ conversations: Array.from(event.target.selectedOptions, (option) => option.value) })}>
            {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title ?? 'Untitled conversation'}</option>)}
          </select>
        </Row> : null}
        <Row label="Captured window" hint={`${health.retainedEvents} events / ${Math.ceil(health.retainedBytes / 1024)} KB / ${health.evictedEvents} evicted / ${health.droppedEvents} dropped`}>
          <button className={BUTTON} disabled={busy} onClick={() => void refresh()}>Refresh</button>
        </Row>
        <Row label="Window size" hint="Older events are evicted when either the event or byte limit is reached.">
          <select aria-label="Maximum captured events" className="rounded-md border bg-surface p-1 text-ui" disabled={busy} value={health.policy.maxEvents}
            onChange={(event) => void change({ maxEvents: Number(event.target.value) })}>
            {[500, 2000, 10000].map((limit) => <option key={limit} value={limit}>{limit.toLocaleString()} events</option>)}
          </select>
        </Row>
        <Row label="Captured events" hint="Copying stops recording and includes any captured conversation content. The window is lost when the harness exits.">
          <div className="flex gap-2">
            <button className={BUTTON} disabled={busy} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy events'}</button>
            <button className={BUTTON} disabled={busy} onClick={() => void clear()}>Clear events</button>
          </div>
        </Row>
      </>}
    </>}
  </Pane>
}
