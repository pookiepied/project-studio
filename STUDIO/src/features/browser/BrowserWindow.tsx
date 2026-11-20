import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, useMotionValue } from 'framer-motion'
import { Icons } from '@/components/icons'
import { Button, IconButton, MenuItem, Popover } from '@/components/primitives'
import { DURATION, EASE_OUT, ENTER, SHELL } from '@/design/tokens'
import type { BrowserCommand, LiveBrowserState } from '@/domain/browser/live'
import { cn } from '@/lib/cn'
import { startWindowDrag } from '@/platform/tauri'
import { WindowControls } from '@/shell/chrome/WindowControls'
import { windowFrame } from '@/shell/chrome/windowFrame'
import { useLiveBrowser } from './useLiveBrowser'
import { StudioCursor } from './StudioCursor'
import { SiteMark } from '@/features/artifacts/kinds/SiteMark'

const VIEW_ZOOMS = [null, 0.5, 0.75, 1] as const
const zoomLabel = (zoom: number | null) => zoom === null ? 'Fit' : `${zoom * 100}%`

export function BrowserWindow({ conversationId, embedded = false, active: visible = true, onPageTitle }: {
  conversationId: string; embedded?: boolean; active?: boolean
  onPageTitle?: (page: { conversationId: string; title: string; url: string }) => void
}) {
  const { state, error, inputError, reconnecting, starting, start, send, reconnect } = useLiveBrowser(conversationId, visible)
  const frame = windowFrame()
  const active = state?.tabs.find((tab) => tab.id === state.activeTabId)
  const [address, setAddress] = useState('')
  const [addressFocused, setAddressFocused] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null)
  const zoomTrigger = useRef<HTMLButtonElement>(null)
  const connected = state !== null
  const running = state?.running === true
  const manual = visible && running && state.control === 'human' && !error && !reconnecting
  const pageTitle = active ? active.title || (active.url === 'about:blank' ? 'New tab' : active.url) : ''
  const control = (
    <IconButton size="sm" active={manual} tooltipSide="bottom"
      label={manual ? 'Resume Studio' : state?.control === 'other' ? 'Controlled in another window' : 'Take control'}
      disabled={state?.control === 'other' || !!error || reconnecting}
      onClick={() => send({ action: manual ? 'release' : 'claim' })}>
      {manual ? <Icons.play size="sm" /> : <Icons.computerUse size="sm" />}
    </IconButton>
  )

  useEffect(() => { setAddress(active?.url === 'about:blank' ? '' : active?.url ?? '') }, [active?.url])
  useEffect(() => {
    if (visible && connected) onPageTitle?.({ conversationId, title: pageTitle, url: active?.url ?? '' })
  }, [visible, connected, onPageTitle, conversationId, pageTitle, active?.url])
  useEffect(() => {
    if (!visible || !running) { setPagesOpen(false); setZoomOpen(false) }
  }, [visible, running])
  const addressParts = /^(https?:\/\/(?:[^/?#]*@)?)([^/?#]+)(.*)$/i.exec(address)
  const emphasizeHost = !addressFocused && addressParts !== null

  return (
    <motion.div initial={embedded ? false : { opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      className={cn('flex h-full flex-col overflow-hidden bg-surface', !embedded && frame.className)} style={embedded ? undefined : frame.style}>
      {embedded ? null : <header className="flex shrink-0 items-center gap-3 px-4" style={{ height: SHELL.topStrip.height }}
        onPointerDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) void startWindowDrag()
        }}>
        <span className="pointer-events-none mr-auto min-w-0 truncate text-caption text-muted-foreground">{pageTitle || 'Studio Browser'}</span>
        <WindowControls />
      </header>}

      {running ?
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <Popover open={pagesOpen} onOpenChange={setPagesOpen} initialFocus='[role="menuitem"]:not(:disabled)' className="w-72 p-1.5" trigger={
          <IconButton label="Browser tabs" size="sm" expanded={pagesOpen} hasPopup="menu"
            onClick={() => setPagesOpen(open => !open)}><Icons.workspace size="sm" /></IconButton>
        }>
          <div className="flex flex-col gap-1">
            {manual ? null : <p className="px-2 py-1 text-caption text-muted-foreground">
              {state.control === 'other' ? 'Another window controls this browser.' : 'Take control to switch, open, or close browser tabs.'}
            </p>}
            {state.tabs.map(tab => {
              const title = tab.title || (tab.url === 'about:blank' ? 'Untitled tab' : tab.url)
              return <div key={tab.id} className={cn('flex min-w-0 items-center rounded-md', active?.id === tab.id && 'bg-selected')}>
                <button type="button" role="menuitem" aria-current={active?.id === tab.id ? 'page' : undefined} disabled={!manual}
                  onClick={() => { send({ action: 'select', tabId: tab.id }); setPagesOpen(false) }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-caption enabled:hover:bg-tint">
                  <SiteMark href={tab.url} compact /><span className="truncate">{title}</span>
                </button>
                <IconButton label={`Close ${title}`} role="menuitem" size="sm" disabled={!manual}
                  onClick={() => send({ action: 'close', tabId: tab.id })}><Icons.close size="sm" /></IconButton>
              </div>
            })}
            {state.omittedTabs ? <span className="px-2 text-micro text-muted-foreground">{state.omittedTabs} more tabs</span> : null}
            <Button role="menuitem" size="sm" variant="ghost" icon={<Icons.add size="sm" />} disabled={!manual}
              className="self-start" onClick={() => { send({ action: 'new' }); setPagesOpen(false) }}>New tab</Button>
          </div>
        </Popover>
        <form className="flex min-w-36 flex-1 items-center gap-0.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!active || !manual || !address.trim()) return
            const url = /^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`
            send({ action: 'navigate', tabId: active.id, url })
          }}>
          <IconButton label="Back" size="xs" disabled={!manual || !active} onClick={() => active && send({ action: 'back', tabId: active.id })}><Icons.back /></IconButton>
          <IconButton label="Forward" size="xs" disabled={!manual || !active} onClick={() => active && send({ action: 'forward', tabId: active.id })}>
            <span className="rotate-180"><Icons.back /></span>
          </IconButton>
          <IconButton label="Reload" size="xs" disabled={!manual || !active} onClick={() => active && send({ action: 'reload', tabId: active.id })}><Icons.reload /></IconButton>
          <div className="relative ml-1 min-w-0 flex-1">
            {emphasizeHost ? <span aria-hidden className="pointer-events-none absolute inset-x-2 top-1/2 z-10 -translate-y-1/2 truncate text-caption text-muted-foreground">
              {addressParts[1]}<strong className="font-medium text-foreground">{addressParts[2]}</strong>{addressParts[3]}
            </span> : null}
            <input aria-label="Address" value={address} onChange={(event) => setAddress(event.target.value)} readOnly={!manual}
              onFocus={() => setAddressFocused(true)} onBlur={() => setAddressFocused(false)}
              className={cn('studio-selectable w-full rounded-md bg-tint px-2 py-1.5 text-caption placeholder:text-muted-foreground focus:bg-muted',
                emphasizeHost ? 'text-transparent' : 'text-foreground')}
              placeholder="Enter a website address" spellCheck={false} />
          </div>
        </form>
        <Popover open={zoomOpen} onOpenChange={setZoomOpen} initialFocus='[aria-checked="true"]' className="w-32 p-1" align="end" trigger={
          <IconButton ref={zoomTrigger} label={`Browser view zoom: ${zoomLabel(zoom)}`} size="sm" expanded={zoomOpen} hasPopup="menu" tooltipSide="bottom"
            onClick={() => setZoomOpen(open => !open)}><Icons.expand size="sm" /></IconButton>
        }>
          {VIEW_ZOOMS.map(scale => <MenuItem key={zoomLabel(scale)} selected={zoom === scale}
            onSelect={() => { setZoom(scale); setZoomOpen(false); zoomTrigger.current?.focus() }}>{zoomLabel(scale)}</MenuItem>)}
        </Popover>
        {control}
        </div> : null}

      <AnimatePresence>
        {error && running ? <motion.div {...ENTER} role="alert" className="flex items-center gap-3 border-b border-border/50 px-5 py-3 text-caption text-muted-foreground">
          <span className="flex-1">{error}</span>
          <Button size="sm" onClick={reconnect}>Reconnect</Button>
        </motion.div> : null}
      </AnimatePresence>
      {reconnecting && running ? <p role="status" className="border-b px-3 py-1.5 text-caption text-muted-foreground">Reconnecting to the live page</p> : null}
      {inputError ? <p role="alert" className="border-b border-border/50 px-5 py-2 text-caption text-muted-foreground">{inputError}</p> : null}

      {running && state.frame && active?.id === state.frame.tabId ? (
        <BrowserSurface state={state} manual={manual} zoom={zoom} send={send} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
          <motion.div {...ENTER} className="flex max-w-sm flex-col items-center gap-2">
            <p className="text-title font-medium text-foreground">
              {error ? 'Browser disconnected' : reconnecting ? 'Reconnecting' : !state ? 'Connecting to Studio Browser' : !running ? 'No browser session' : state.tabs.length === 0 ? 'No browser tabs' : 'Waiting for the live page'}
            </p>
            {error && !running ? <>
              <p role="alert" className="text-caption text-muted-foreground">{error}</p>
              <Button size="sm" onClick={reconnect}>Reconnect</Button>
            </> : null}
            {state && !error && !reconnecting ? <p className="text-caption text-muted-foreground">
              {!running ? 'Start a browser for this conversation.'
                : state.frameUnavailable ? 'The live frame was too large to display. Wait for the next frame.'
                : state.tabs.length === 0 ? 'Take control and open a new tab.' : null}
            </p> : null}
            {state && !running && !error && !reconnecting
              ? <Button size="sm" variant="primary" busy={starting} onClick={() => void start()}>Start browser</Button>
              : null}
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}

function BrowserSurface({ state, manual, zoom, send }: {
  state: LiveBrowserState; manual: boolean; zoom: number | null; send: (command: BrowserCommand) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const keyboard = useRef<HTMLTextAreaElement>(null)
  const click = useRef({ at: 0, x: 0, y: 0, button: 0, count: 1 })
  const presence = useRef({ at: -Infinity, x: 0, y: 0 })
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [size, setSize] = useState({ width: 1280, height: 720 })
  const [pointerVisible, setPointerVisible] = useState(false)
  const [pointerPress, setPointerPress] = useState({ pressed: false, pressSequence: 0 })
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
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
    const element = page.current
    if (!element || !manual || !tabId) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      send({ action: 'wheel', tabId, x: Math.max(-4000, Math.min(4000, event.deltaX)), y: Math.max(-4000, Math.min(4000, event.deltaY)) })
    }
    // The wheel scrolls the remote document. Use the surrounding scrollbars to pan a zoomed view.
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [manual, tabId, send])

  useEffect(() => {
    if (!manual) return
    const release = () => send({ action: 'reset' })
    window.addEventListener('blur', release)
    return () => window.removeEventListener('blur', release)
  }, [manual, send])

  if (!picture || !tabId) return null
  const scale = zoom ?? Math.min(1, size.width / picture.width, size.height / picture.height)
  const cursor = state.cursor?.tabId === tabId && state.running && state.control === 'agent' ? state.cursor : null

  const pointer = (event: PointerEvent<HTMLDivElement>, kind: 'enter' | 'move' | 'down' | 'up') => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)))
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      pointerX.set(x * picture.width * scale)
      pointerY.set(y * picture.height * scale)
      if (kind === 'enter' || kind === 'move') setPointerVisible(true)
      if (kind === 'down') setPointerPress(current => ({ pressed: true, pressSequence: current.pressSequence + 1 }))
      if (kind === 'up') setPointerPress(current => ({ ...current, pressed: event.buttons !== 0 }))
    }
    if (kind === 'enter') return
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
    <div ref={area} className="relative flex min-h-0 flex-1 overflow-auto bg-background">
      <div ref={page} role="application" aria-label="Live browser page"
        className={cn('relative m-auto shrink-0 touch-none overflow-hidden', pointerVisible && 'cursor-none')}
        tabIndex={manual ? -1 : 0}
        style={{ width: picture.width * scale, height: picture.height * scale }}
        onKeyDown={() => {
          if (!manual) send({ action: 'activity', tabId, kind: 'keyboard', x: presence.current.x, y: presence.current.y })
        }}
        onPointerDown={(event) => pointer(event, 'down')} onPointerMove={(event) => pointer(event, 'move')}
        onPointerEnter={(event) => pointer(event, 'enter')}
        onPointerLeave={() => {
          setPointerVisible(false)
          setPointerPress(current => current.pressed ? { ...current, pressed: false } : current)
        }}
        onPointerUp={(event) => pointer(event, 'up')} onPointerCancel={(event) => pointer(event, 'up')}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={() => {
          if (!manual) send({ action: 'activity', tabId, kind: 'wheel', x: presence.current.x, y: presence.current.y })
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
        {cursor && !pointerVisible ? <motion.div aria-label="Studio cursor" data-cursor-kind={cursor.kind ?? 'default'} data-pressed={cursor.pressed === true} className="pointer-events-none absolute left-0 top-0 z-10"
          animate={{ x: cursor.x * picture.width * scale, y: cursor.y * picture.height * scale }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}>
          <StudioCursor key={cursor.tabId} cursor={cursor} />
        </motion.div> : null}
        {pointerVisible ? <motion.div aria-hidden data-browser-pointer className="pointer-events-none absolute left-0 top-0 z-20"
          style={{ x: pointerX, y: pointerY }}><StudioCursor cursor={pointerPress} /></motion.div> : null}
      </div>
    </div>
  )
}
