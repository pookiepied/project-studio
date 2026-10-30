import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'
import { DURATION, EASE_OUT, ENTER, SHELL } from '@/design/tokens'
import type { BrowserCommand, LiveBrowserState } from '@/domain/browser/live'
import { cn } from '@/lib/cn'
import { startWindowDrag } from '@/platform/tauri'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { windowFrame } from '@/shell/chrome/windowFrame'
import { useLiveBrowser } from './useLiveBrowser'
import { StudioCursor } from './StudioCursor'

export function BrowserWindow({ conversationId }: { conversationId: string }) {
  const { state, error, inputError, reconnecting, send, reconnect } = useLiveBrowser(conversationId)
  const frame = windowFrame()
  const active = state?.tabs.find((tab) => tab.id === state.activeTabId)
  const [address, setAddress] = useState('')
  const manual = state?.control === 'human' && !error && !reconnecting

  useEffect(() => { setAddress(active?.url === 'about:blank' ? '' : active?.url ?? '') }, [active?.url])

  return (
    <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      className={cn('flex h-full flex-col overflow-hidden bg-surface', frame.className)} style={frame.style}>
      <header className="flex shrink-0 items-center gap-4 px-4" style={{ height: SHELL.topStrip.height }}
        onPointerDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) void startWindowDrag()
        }}>
        <TrafficLights />
        <span className="pointer-events-none text-caption text-muted-foreground">Studio Browser</span>
        <span className="ml-auto text-micro text-muted-foreground" role="status">
          {reconnecting ? 'Reconnecting' : error ? 'Disconnected' : !state ? 'Connecting' : !state.running ? 'Session ended' : manual ? 'You have control' : state.control === 'other' ? 'Controlled in another window' : 'Studio has control'}
        </span>
        <button type="button" disabled={!state?.running || state.control === 'other' || !!error || reconnecting}
          onClick={() => send({ action: manual ? 'release' : 'claim' })}
          className="rounded-full bg-tint px-3 py-1 text-caption text-muted-foreground transition-colors duration-base hover:bg-muted disabled:opacity-40">
          {manual ? 'Resume Studio' : 'Take control'}
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pb-1" aria-label="Browser tabs">
        {state?.tabs.map((tab) => (
          <motion.div layout key={tab.id} transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className={cn('group flex min-w-24 max-w-52 shrink-0 items-center rounded-lg', active?.id === tab.id && 'bg-tint')}>
            <button type="button" aria-pressed={active?.id === tab.id} disabled={!manual}
              onClick={() => send({ action: 'select', tabId: tab.id })}
              className="min-w-0 flex-1 truncate px-3 py-2 text-left text-caption text-muted-foreground">
              {tab.title || (tab.url === 'about:blank' ? 'New tab' : tab.url)}
            </button>
            <IconButton label={`Close ${tab.title || 'tab'}`} size="sm" disabled={!manual}
              onClick={() => send({ action: 'close', tabId: tab.id })}><Icons.close /></IconButton>
          </motion.div>
        ))}
        <IconButton label="New tab" disabled={!manual} onClick={() => send({ action: 'new' })}><Icons.add /></IconButton>
        {state?.omittedTabs ? <span className="px-2 text-micro text-muted-foreground">{state.omittedTabs} more tabs</span> : null}
      </div>

      <form className="flex shrink-0 items-center gap-1 border-b border-border/50 px-3 pb-3 pt-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (!active || !manual || !address.trim()) return
          const url = /^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`
          send({ action: 'navigate', tabId: active.id, url })
        }}>
        <IconButton label="Back" disabled={!manual || !active} onClick={() => active && send({ action: 'back', tabId: active.id })}><Icons.back /></IconButton>
        <IconButton label="Forward" disabled={!manual || !active} onClick={() => active && send({ action: 'forward', tabId: active.id })}>
          <span className="rotate-180"><Icons.back /></span>
        </IconButton>
        <IconButton label="Reload" disabled={!manual || !active} onClick={() => active && send({ action: 'reload', tabId: active.id })}><Icons.reload /></IconButton>
        <input aria-label="Address" value={address} onChange={(event) => setAddress(event.target.value)} readOnly={!manual}
          className="studio-selectable ml-2 min-w-0 flex-1 rounded-full bg-tint px-4 py-2 text-caption text-foreground outline-none transition-colors duration-base placeholder:text-muted-foreground focus:bg-muted"
          placeholder="Enter a website address" spellCheck={false} />
      </form>

      <AnimatePresence>
        {error ? <motion.div {...ENTER} role="alert" className="flex items-center gap-3 border-b border-border/50 px-5 py-3 text-caption text-muted-foreground">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={reconnect} className="rounded-full bg-tint px-3 py-1">Reconnect</button>
        </motion.div> : null}
      </AnimatePresence>
      {inputError ? <p role="alert" className="border-b border-border/50 px-5 py-2 text-caption text-muted-foreground">{inputError}</p> : null}

      {state?.frame && active?.id === state.frame.tabId ? (
        <BrowserSurface state={state} manual={manual} send={send} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-10 text-center">
          <motion.div {...ENTER} className="flex max-w-sm flex-col gap-2">
            <p className="studio-heading text-foreground">{state && !state.running ? 'This session has ended' : state?.tabs.length === 0 ? 'A little room to explore' : 'Opening your browser'}</p>
            <p className="text-caption text-muted-foreground">{state?.frameUnavailable ? 'This live frame exceeded the delivery limit. Resize the window or wait for the next frame.' : state && !state.running ? 'Ask Studio to open a page, then reconnect here.' : state?.tabs.length === 0 ? 'Take control and open a new tab.' : 'The live page will appear here.'}</p>
          </motion.div>
        </div>
      )}
      <footer className="flex shrink-0 items-center justify-between px-4 py-2 text-micro text-muted-foreground">
        <span>{manual ? 'Click the page to type. Paste and keyboard shortcuts are available.' : 'Take control to interact with the page.'}</span>
        <span>Private to this conversation</span>
      </footer>
    </motion.div>
  )
}

function BrowserSurface({ state, manual, send }: {
  state: LiveBrowserState; manual: boolean; send: (command: BrowserCommand) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const keyboard = useRef<HTMLTextAreaElement>(null)
  const click = useRef({ at: 0, x: 0, y: 0, button: 0, count: 1 })
  const presence = useRef({ at: -Infinity, x: 0, y: 0 })
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [size, setSize] = useState({ width: 1280, height: 800 })
  const picture = state.frame
  const tabId = state.activeTabId

  useEffect(() => () => {
    if (activityTimer.current !== null) clearTimeout(activityTimer.current)
    activityTimer.current = null
  }, [tabId, manual, send])

  useEffect(() => {
    const element = area.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!manual || !tabId) return
    const timer = setTimeout(() => send({ action: 'resize', tabId,
      width: Math.max(320, Math.min(2560, Math.round(size.width))),
      height: Math.max(320, Math.min(2560, Math.round(size.height))) }), 180)
    return () => clearTimeout(timer)
  }, [manual, tabId, size.width, size.height, send])

  useEffect(() => {
    if (!manual) return
    const release = () => send({ action: 'reset' })
    window.addEventListener('blur', release)
    return () => window.removeEventListener('blur', release)
  }, [manual, send])

  if (!picture || !tabId) return null
  const scale = Math.min(1, size.width / picture.width, size.height / picture.height)
  const cursor = state.cursor?.tabId === tabId && state.running && state.control === 'agent' ? state.cursor : null

  const pointer = (event: PointerEvent<HTMLDivElement>, kind: 'move' | 'down' | 'up') => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)))
    if (!manual) {
      presence.current.x = x; presence.current.y = y
      if (kind === 'down') event.currentTarget.focus({ preventScroll: true })
      if (kind === 'up') return
      const elapsed = performance.now() - presence.current.at
      if (kind === 'move' && elapsed < 125) {
        if (activityTimer.current === null) activityTimer.current = setTimeout(() => {
          activityTimer.current = null
          presence.current.at = performance.now()
          send({ action: 'activity', tabId, kind: 'move', x: presence.current.x, y: presence.current.y })
        }, 125 - elapsed)
        return
      }
      if (activityTimer.current !== null) { clearTimeout(activityTimer.current); activityTimer.current = null }
      presence.current.at = performance.now()
      send({ action: 'activity', tabId, kind: kind === 'move' ? 'move' : 'button', x, y })
      return
    }
    event.preventDefault()
    if (kind === 'down') {
      const previous = click.current
      const repeated = performance.now() - previous.at < 500 && previous.button === event.button
        && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 5
      click.current = { at: performance.now(), x: event.clientX, y: event.clientY, button: event.button,
        count: repeated ? previous.count % 3 + 1 : 1 }
      keyboard.current?.focus({ preventScroll: true })
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    send({ action: 'pointer', tabId, kind,
      x, y,
      button: event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left', clicks: click.current.count })
  }

  const key = (event: KeyboardEvent<HTMLTextAreaElement>, kind: 'down' | 'up') => {
    if (!manual || event.nativeEvent.isComposing || event.key === 'Process') return
    // The native paste event carries clipboard text; forwarding Ctrl+V as well
    // would paste twice, potentially from a different clipboard in Chromium.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return
    event.preventDefault()
    send({ action: 'key', tabId, kind, key: event.key })
  }

  return (
    <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background">
      <div role="application" aria-label="Live browser page" className="relative shrink-0 touch-none overflow-hidden"
        tabIndex={manual ? -1 : 0}
        style={{ width: picture.width * scale, height: picture.height * scale }}
        onKeyDown={() => {
          if (!manual) send({ action: 'activity', tabId, kind: 'keyboard', x: presence.current.x, y: presence.current.y })
        }}
        onPointerDown={(event) => pointer(event, 'down')} onPointerMove={(event) => pointer(event, 'move')}
        onPointerUp={(event) => pointer(event, 'up')} onPointerCancel={(event) => pointer(event, 'up')}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          if (manual) send({ action: 'wheel', tabId, x: Math.max(-4000, Math.min(4000, event.deltaX)), y: Math.max(-4000, Math.min(4000, event.deltaY)) })
          else send({ action: 'activity', tabId, kind: 'wheel', x: presence.current.x, y: presence.current.y })
        }}>
        <img src={`data:image/jpeg;base64,${picture.data}`} alt="Live browser page" draggable={false} className="pointer-events-none h-full w-full select-none" />
        <textarea ref={keyboard} aria-label="Browser keyboard input" tabIndex={manual ? 0 : -1} readOnly={!manual}
          className="absolute left-0 top-0 h-px w-px resize-none opacity-0" autoComplete="off" autoCapitalize="off" spellCheck={false}
          onKeyDown={(event) => key(event, 'down')} onKeyUp={(event) => key(event, 'up')}
          onBlur={() => {
            if (manual) send({ action: 'reset' })
          }}
          onCompositionEnd={(event) => {
            if (manual) send({ action: 'text', tabId, text: event.data })
            event.currentTarget.value = ''
          }}
          onPaste={(event) => {
            event.preventDefault()
            if (manual) send({ action: 'text', tabId, text: event.clipboardData.getData('text/plain').slice(0, 16384) })
          }} />
        {cursor ? <motion.div aria-label="Studio cursor" data-cursor-kind={cursor.kind ?? 'default'} data-pressed={cursor.pressed === true} className="pointer-events-none absolute left-0 top-0 z-10"
          animate={{ x: cursor.x * picture.width * scale, y: cursor.y * picture.height * scale }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}>
          <StudioCursor key={cursor.tabId} cursor={cursor} />
        </motion.div> : null}
      </div>
    </div>
  )
}
