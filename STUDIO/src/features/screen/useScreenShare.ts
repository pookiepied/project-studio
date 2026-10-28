import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri, onScreenDrawingFinished, resetScreenOverlay, startScreenDrawing } from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'

/**
 * The call's two screen switches (ADR 0059): Share screen, and Show me.
 *
 * Sharing is the person's, off when a call starts and off again when it
 * ends - never carried from one call to the next, never turned on by Studio.
 * While it is on, the harness samples the pointer and windows and the voice
 * agent may look; the moment the person stops speaking, a picture of the
 * display they point at is asked for, so it is ready by the time the agent
 * reads their words.
 *
 * Show me holds the agent back (`demonstrate` on the desktop lease) and puts
 * a pen on the screen. Done, in the overlay's own toolbar, gives the desktop
 * back; `useScreenCollaboration` hears it.
 */
export function useScreenShare(conversationId: string | null, open: boolean) {
  const { computer } = useWorkspace()
  const [sharing, setSharing] = useState(false)
  const [showing, setShowing] = useState(false)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState('')
  const available = isTauri() && conversationId !== null

  const live = useRef({ sharing, showing, conversationId, computer })
  live.current = { sharing, showing, conversationId, computer }

  const toggle = useCallback(async () => {
    const id = live.current.conversationId
    if (id === null) return
    const next = !live.current.sharing
    setPending(true)
    setNote('')
    const answer = await live.current.computer.share(id, next)
    setPending(false)
    if (!answer.ok) { setNote(answer.error.message); return }
    setSharing(answer.value)
    if (!answer.value) {
      void resetScreenOverlay()
      if (live.current.showing) { setShowing(false); void live.current.computer.control(id, 'resume') }
    }
  }, [])

  const showMe = useCallback(async () => {
    const id = live.current.conversationId
    if (id === null || !live.current.sharing || live.current.showing) return
    setNote('')
    const held = await live.current.computer.control(id, 'demonstrate')
    if (!held.ok) { setNote(held.error.message); return }
    setShowing(true)
    await startScreenDrawing(id).catch(() => {
      setShowing(false)
      setNote('The drawing layer could not open on this display.')
      void live.current.computer.control(id, 'resume')
    })
  }, [])

  /** As the person stops speaking: a picture of where they are pointing, if they are sharing. */
  const onSpeechEnd = useCallback(() => {
    const id = live.current.conversationId
    if (id !== null && live.current.sharing) void live.current.computer.glance(id)
  }, [])

  useEffect(() => {
    let alive = true
    let stop: (() => void) | null = null
    void onScreenDrawingFinished((finishedFor) => {
      if (finishedFor === live.current.conversationId) setShowing(false)
    }).then((unlisten) => { if (alive) stop = unlisten; else unlisten() })
    return () => { alive = false; stop?.() }
  }, [])

  // The call ending - or moving to another conversation - ends sharing with
  // it. Studio never carries the person's screen into the next call.
  useEffect(() => {
    if (open) return
    const { sharing: wasSharing, showing: wasShowing, conversationId: id, computer: client } = live.current
    if (id === null || !wasSharing) return
    setSharing(false)
    setShowing(false)
    void resetScreenOverlay()
    void client.share(id, false)
    if (wasShowing) void client.control(id, 'resume')
  }, [open])

  // The id is the effect's own, not the ref's: by the time this cleanup
  // runs for a change of conversation, the ref already names the new one.
  useEffect(() => {
    const id = conversationId
    return () => {
      const { sharing: wasSharing, showing: wasShowing, computer: client } = live.current
      if (id === null || !wasSharing) return
      setSharing(false)
      setShowing(false)
      void resetScreenOverlay()
      void client.share(id, false)
      if (wasShowing) void client.control(id, 'resume')
    }
  }, [conversationId])

  return { available, sharing, showing, pending, note, toggle, showMe, onSpeechEnd }
}
